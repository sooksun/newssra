import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildSessionCookie, verifyPassword } from "@/lib/auth";
import { createUser, findByUsername, updateUser } from "@/lib/users-repo";
import { findLegacyUser } from "@/lib/legacy-users-repo";
import { clientIp, loginRateLimiter } from "@/lib/rate-limit";
import { ROLE_LABELS } from "@/lib/types";
import type { Role, SessionUser, UserSource } from "@/lib/types";

export const dynamic = "force-dynamic";

const BAD_CREDENTIALS = "ชื่อบัญชีหรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกระงับ";

// เข้าสู่ระบบแบบผสม (hybrid):
//   1) ตาราง users (บัญชี local: admin/ssra_admin/school ที่แฮชด้วย scrypt)
//   2) ถ้าไม่พบ → ตาราง `user` เดิม (บัญชีโรงเรียน รหัสผ่าน plaintext) → บทบาท school ผูกรหัสโรงเรียน
//      พร้อม "migrate ทันทีที่ login สำเร็จ": สร้างบัญชี local ที่แฮชแล้ว เพื่อให้ครั้งถัดไปไม่ต้องใช้ plaintext อีก
//      (ตาราง `user` เดิมยังเป็น read-only — เราเขียนลงตาราง users ที่เราเป็นเจ้าของเท่านั้น) ดู docs/AUTH-MIGRATION.md
// ข้อความ error เป็นแบบรวม (กัน user enumeration); มี rate-limiting กัน brute-force (lib/rate-limit.ts)
export async function POST(request: NextRequest) {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    return NextResponse.json({ error: "กรุณากรอกชื่อบัญชีและรหัสผ่าน" }, { status: 400 });
  }

  // ── rate-limit: บล็อกถ้า IP หรือชื่อบัญชีนี้พยายามล้มเหลวเกินเพดานในช่วงเวลาที่กำหนด ──
  const ip = clientIp(request.headers);
  const ipKey = ip ? `ip:${ip}` : null; // ระบุ IP ไม่ได้ → พึ่ง user key อย่างเดียว (กันล็อกรวมทั้งระบบ)
  const userKey = `user:${username.toLowerCase()}`;
  const statuses = [ipKey ? loginRateLimiter.check(ipKey) : null, loginRateLimiter.check(userKey)];
  let retryAfterSec = 0;
  for (const s of statuses) {
    if (s?.blocked && s.retryAfterSec > retryAfterSec) retryAfterSec = s.retryAfterSec;
  }
  if (retryAfterSec > 0) {
    return NextResponse.json(
      { error: "พยายามเข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่" },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  try {
    const session = await resolveLogin(username, password);
    if (!session) {
      if (ipKey) loginRateLimiter.fail(ipKey);
      loginRateLimiter.fail(userKey);
      return NextResponse.json({ error: BAD_CREDENTIALS }, { status: 401 });
    }
    // สำเร็จ → ล้างตัวนับความล้มเหลวของทั้งสอง key
    if (ipKey) loginRateLimiter.clear(ipKey);
    loginRateLimiter.clear(userKey);

    const res = NextResponse.json({
      user: { role: session.role, name: session.name, roleLabel: ROLE_LABELS[session.role] },
    });
    res.cookies.set(buildSessionCookie(session));
    return res;
  } catch (error) {
    console.error("[api] login failed:", error);
    return NextResponse.json({ error: "เข้าสู่ระบบไม่สำเร็จ — เชื่อมต่อฐานข้อมูลไม่ได้" }, { status: 500 });
  }
}

interface LocalUserRow {
  id: number;
  role: string;
  display_name: string;
  username: string;
  school_code: string | null;
  active: number;
  password_hash: string;
}

/** สร้าง session จากแถวบัญชี local (ตาราง users) */
function sessionFromLocal(row: LocalUserRow, schoolCodeFallback = ""): SessionUser {
  const role = row.role as Role;
  return {
    uid: row.id,
    role,
    name: row.display_name || row.username,
    source: "local",
    schoolCode: role === "school" ? (row.school_code ?? schoolCodeFallback) : "",
  };
}

async function resolveLogin(username: string, password: string): Promise<SessionUser | null> {
  // 1) บัญชี local (users) — ตรวจก่อนเพื่อให้บัญชีผู้ดูแลไม่ถูกบัง
  const row = await findByUsername(username);
  if (row) {
    if (row.active === 1 && verifyPassword(password, row.password_hash)) {
      return sessionFromLocal(row);
    }
    // บัญชี school ที่เคย migrate มาจาก legacy: ถ้ารหัสในตาราง `user` เดิมถูกเปลี่ยนภายหลัง
    // ให้ยอมรับรหัสใหม่จาก legacy แล้ว rehash ทับ (self-healing กันโรงเรียนถูกล็อกออก)
    // จำกัดเฉพาะบทบาท school เท่านั้น — บัญชี admin/ssra_admin ต้องไม่ถูก legacy row มา bypass
    if (row.active === 1 && (row.role as Role) === "school") {
      const legacy = await findLegacyUser(username);
      if (legacy && legacy.password.length > 0 && password === legacy.password) {
        try {
          await updateUser(row.id, { password });
        } catch (error) {
          console.error("[api] legacy password rehash failed:", error);
        }
        return sessionFromLocal(row, legacy.code);
      }
    }
    return null; // พบชื่อใน users แต่รหัสผิด/ถูกระงับ — ไม่ไปลอง legacy bypass
  }

  // 2) บัญชีโรงเรียนเดิม (ตาราง `user`) — เทียบรหัสผ่าน plaintext ตามระบบเดิม แล้ว migrate เป็นบัญชี local ที่แฮชแล้ว
  const legacy = await findLegacyUser(username);
  if (legacy && legacy.password.length > 0 && password === legacy.password) {
    let uid = 0;
    let source: UserSource = "legacy";
    try {
      uid = await createUser({
        username,
        password, // createUser แฮชด้วย scrypt ให้เอง
        role: "school",
        displayName: legacy.name.slice(0, 120),
        schoolCode: legacy.code,
      });
      source = "local";
    } catch (error) {
      // สร้างบัญชี local ไม่สำเร็จ (เช่น race กับอีก request หรือปัญหา DB ชั่วคราว)
      // — ยังให้เข้าระบบด้วย session legacy ได้ตามเดิม ครั้งถัดไปค่อย migrate ใหม่
      console.error("[api] legacy→local migration failed:", error);
    }
    return {
      uid,
      role: "school",
      name: legacy.name,
      source,
      schoolCode: legacy.code, // รหัส `user` 8 หลัก = คีย์จำกัดขอบเขตของโรงเรียน
    };
  }
  return null;
}
