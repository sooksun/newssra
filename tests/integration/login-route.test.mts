// Integration: POST /api/auth/login — ยิง route handler จริงกับ MySQL จริง
// ครอบคลุม security logic ที่ unit test เดิมไม่ได้แตะระดับ route:
//   • กันการนับ user (enumeration): ผู้ใช้ไม่มีจริง vs รหัสผิด → ข้อความ/สถานะเหมือนกันเป๊ะ
//   • rate-limit: ล้มเหลวครบเพดาน (10) → ครั้งถัดไป 429 + Retry-After
//   • สำเร็จ → 200 + ตั้ง cookie session; ล้างตัวนับ

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { dbAvailable, jsonRequest, rawExec } from "./_setup.mts";
import { SESSION_COOKIE } from "../../lib/auth-constants.ts";

const DB = await dbAvailable();
const LOGIN_URL = "http://localhost/api/auth/login";
const TEMP_USER = "zztest-login-integration";
const TEMP_PASS = "Test-pass-123";

let POST: typeof import("../../app/api/auth/login/route.ts").POST;

before(async () => {
  if (!DB) return;
  // ล้างของค้างจากรอบก่อน (ถ้ามี) แล้วสร้างบัญชี local ทดสอบด้วย scrypt ผ่านโค้ดจริง
  await rawExec("DELETE FROM users WHERE username = ?", [TEMP_USER]);
  const { createUser } = await import("../../lib/users-repo.ts");
  await createUser({ username: TEMP_USER, password: TEMP_PASS, role: "ssra_admin", displayName: "บัญชีทดสอบ" });
  ({ POST } = await import("../../app/api/auth/login/route.ts"));
});

after(async () => {
  if (!DB) return;
  await rawExec("DELETE FROM users WHERE username = ?", [TEMP_USER]);
});

const { NextRequest } = await import("next/server");
const { loginRateLimiter } = await import("../../lib/rate-limit.ts");
const req = (body: unknown, ip: string) =>
  jsonRequest(NextRequest, LOGIN_URL, { method: "POST", body, headers: { "x-forwarded-for": ip } });

/** ล้างตัวนับ rate-limit ของ key ที่ test นี้ใช้ (limiter เป็น singleton ร่วมทั้งไฟล์ ต้องกันสถานะรั่ว) */
function resetLimiter(ip: string, username: string) {
  loginRateLimiter.clear(`ip:${ip}`);
  loginRateLimiter.clear(`user:${username.toLowerCase()}`);
}

test("บัญชีถูกต้อง → 200 + ตั้ง cookie session", { skip: !DB }, async () => {
  resetLimiter("198.51.100.1", TEMP_USER);
  const res = await POST(req({ username: TEMP_USER, password: TEMP_PASS }, "198.51.100.1"));
  assert.equal(res.status, 200);
  const setCookie = res.headers.get("set-cookie") ?? "";
  assert.match(setCookie, new RegExp(`${SESSION_COOKIE}=`), "ต้องมีการตั้ง cookie session");
  assert.match(setCookie, /HttpOnly/i, "cookie ต้องเป็น HttpOnly");
  const json = await res.json();
  assert.equal(json.user.role, "ssra_admin");
});

test("กัน enumeration: user ไม่มีจริง กับ รหัสผิด ต้องได้ 401 + ข้อความเดียวกัน", { skip: !DB }, async () => {
  resetLimiter("198.51.100.2", TEMP_USER);
  resetLimiter("198.51.100.3", "zzz-no-such-user-xyz");
  const wrongPass = await POST(req({ username: TEMP_USER, password: "totally-wrong" }, "198.51.100.2"));
  const noSuchUser = await POST(req({ username: "zzz-no-such-user-xyz", password: "totally-wrong" }, "198.51.100.3"));

  assert.equal(wrongPass.status, 401);
  assert.equal(noSuchUser.status, 401);
  const a = await wrongPass.json();
  const b = await noSuchUser.json();
  assert.equal(a.error, b.error, "ข้อความต้องเหมือนกันเป๊ะ (ไม่บอกใบ้ว่ามี username นี้ไหม)");
  // ต้องไม่มี set-cookie เมื่อ login ล้มเหลว
  assert.equal(wrongPass.headers.get("set-cookie"), null);
});

test("rate-limit: ล้มเหลวครบ 10 ครั้งจาก IP เดียว → ครั้งที่ 11 ได้ 429 + Retry-After", { skip: !DB }, async () => {
  const ip = "203.0.113.77";
  const uname = "zz-bruteforce-probe";
  resetLimiter(ip, uname);
  for (let i = 0; i < 10; i++) {
    const r = await POST(req({ username: uname, password: `guess-${i}` }, ip));
    assert.equal(r.status, 401, `ครั้งที่ ${i + 1} ควรเป็น 401 (ยังไม่บล็อก)`);
  }
  const blocked = await POST(req({ username: uname, password: "guess-11" }, ip));
  assert.equal(blocked.status, 429, "ครั้งที่ 11 ต้องถูกบล็อก");
  const retry = Number(blocked.headers.get("retry-after"));
  assert.ok(retry > 0 && retry <= 15 * 60, `Retry-After ต้องเป็นวินาทีที่สมเหตุผล (ได้ ${retry})`);
});

test("login สำเร็จล้างตัวนับ rate-limit ของ user key", { skip: !DB }, async () => {
  const ip = "203.0.113.88";
  resetLimiter(ip, TEMP_USER);
  // ล้มเหลว 9 ครั้ง (ยังไม่ถึงเพดาน) ด้วย username จริง
  for (let i = 0; i < 9; i++) {
    await POST(req({ username: TEMP_USER, password: `bad-${i}` }, ip));
  }
  // สำเร็จ → ควรล้างตัวนับทั้ง ip และ user
  const good = await POST(req({ username: TEMP_USER, password: TEMP_PASS }, ip));
  assert.equal(good.status, 200);
  // หลังล้าง ตัวนับควรว่าง — ล้มเหลวอีกครั้งต้องยังเป็น 401 (ไม่ใช่ 429 จากยอดสะสมเดิม)
  const afterClear = await POST(req({ username: TEMP_USER, password: "bad-again" }, ip));
  assert.equal(afterClear.status, 401);
});
