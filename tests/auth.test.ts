import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canAccessAssessment,
  hashPassword,
  sessionCookieOptions,
  signSession,
  verifyPassword,
  verifySession,
} from "../lib/auth";
import type { SessionUser } from "../lib/types";

const baseUser: SessionUser = { uid: 1, role: "admin", name: "ผู้ดูแล", source: "local", schoolCode: "" };

test("hashPassword/verifyPassword — round-trip ถูก และปฏิเสธรหัสผิด", () => {
  const hash = hashPassword("s3cret-pw");
  assert.match(hash, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(verifyPassword("s3cret-pw", hash), true);
  assert.equal(verifyPassword("wrong", hash), false);
});

test("verifyPassword — รูปแบบ hash เสีย → false (ไม่ throw)", () => {
  assert.equal(verifyPassword("x", "not-a-hash"), false);
  assert.equal(verifyPassword("x", "scrypt$zz$zz"), false);
  assert.equal(verifyPassword("x", ""), false);
});

test("session — sign แล้ว verify กลับได้ครบ field", () => {
  const token = signSession({ uid: 42, role: "school", name: "รร.", source: "legacy", schoolCode: "10010001" });
  const back = verifySession(token);
  assert.equal(back?.uid, 42);
  assert.equal(back?.role, "school");
  assert.equal(back?.source, "legacy");
  assert.equal(back?.schoolCode, "10010001");
});

test("session — ลายเซ็นถูกแก้ → null", () => {
  const token = signSession(baseUser);
  const [body] = token.split(".");
  assert.equal(verifySession(`${body}.deadbeef`), null);
});

test("session — body ถูกแก้ (ลายเซ็นไม่ตรง) → null", () => {
  const token = signSession(baseUser);
  const sig = token.split(".")[1];
  const forged = Buffer.from(JSON.stringify({ uid: 1, role: "admin", exp: 9999999999 })).toString("base64url");
  assert.equal(verifySession(`${forged}.${sig}`), null);
});

test("session — หมดอายุ → null", () => {
  const token = signSession(baseUser, -10); // ttl ติดลบ = หมดอายุแล้ว
  assert.equal(verifySession(token), null);
});

test("session — token รูปแบบผิด → null", () => {
  assert.equal(verifySession("no-dot-here"), null);
  assert.equal(verifySession(""), null);
  assert.equal(verifySession(".abc"), null);
});

test("canAccessAssessment — admin/ssra เข้าถึงได้ทุกแถว", () => {
  assert.equal(canAccessAssessment({ ...baseUser, role: "admin" }, "10010001"), true);
  assert.equal(canAccessAssessment({ ...baseUser, role: "ssra_admin" }, null), true);
});

test("canAccessAssessment — school เข้าถึงเฉพาะรหัสตนเอง", () => {
  const school: SessionUser = { uid: 0, role: "school", name: "รร.", source: "legacy", schoolCode: "10010001" };
  assert.equal(canAccessAssessment(school, "10010001"), true);
  assert.equal(canAccessAssessment(school, "99999999"), false);
});

test("canAccessAssessment — school ไม่มี schoolCode หรือ owner ว่าง → เข้าไม่ได้", () => {
  const noCode: SessionUser = { uid: 0, role: "school", name: "รร.", source: "legacy", schoolCode: "" };
  assert.equal(canAccessAssessment(noCode, ""), false, "schoolCode ว่าง เข้าไม่ได้แม้ owner ว่าง (null !== '')");
  const school: SessionUser = { ...noCode, schoolCode: "10010001" };
  assert.equal(canAccessAssessment(school, null), false, "owner เป็น null → เข้าไม่ได้");
});

test("sessionCookieOptions — httpOnly + sameSite lax + path /", () => {
  const opts = sessionCookieOptions();
  assert.equal(opts.httpOnly, true);
  assert.equal(opts.sameSite, "lax");
  assert.equal(opts.path, "/");
  assert.ok(opts.maxAge > 0);
});

test("sessionCookieOptions — Secure ตาม NODE_ENV, ปิดได้ด้วย AUTH_COOKIE_SECURE=0 (deploy ผ่าน http ล้วน)", () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevOverride = process.env.AUTH_COOKIE_SECURE;
  try {
    // production ปกติ → Secure เปิด (พฤติกรรมเดิม)
    (process.env as Record<string, string>).NODE_ENV = "production";
    delete process.env.AUTH_COOKIE_SECURE;
    assert.equal(sessionCookieOptions().secure, true);

    // production + AUTH_COOKIE_SECURE=0 → ปิด Secure (browser จึงเก็บ cookie บน http ได้)
    process.env.AUTH_COOKIE_SECURE = "0";
    assert.equal(sessionCookieOptions().secure, false);

    // ค่าอื่นที่ไม่ใช่ "0" ไม่ถือเป็นการปิด — fail-safe เข้าหา Secure
    process.env.AUTH_COOKIE_SECURE = "false";
    assert.equal(sessionCookieOptions().secure, true);

    // นอก production → ไม่ Secure เหมือนเดิม
    (process.env as Record<string, string>).NODE_ENV = "test";
    delete process.env.AUTH_COOKIE_SECURE;
    assert.equal(sessionCookieOptions().secure, false);
  } finally {
    if (prevNodeEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else (process.env as Record<string, string>).NODE_ENV = prevNodeEnv;
    if (prevOverride === undefined) delete process.env.AUTH_COOKIE_SECURE;
    else process.env.AUTH_COOKIE_SECURE = prevOverride;
  }
});
