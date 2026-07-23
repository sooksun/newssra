import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter, clientIp, terrainAnalyzeRateLimiter } from "../lib/rate-limit";

test("RateLimiter — ไม่บล็อกก่อนถึงเพดาน แล้วบล็อกเมื่อถึง", () => {
  const rl = new RateLimiter({ maxFails: 3, windowMs: 1000, blockMs: 1000 });
  const t = 1000;
  assert.equal(rl.check("k", t).blocked, false);
  rl.fail("k", t);
  rl.fail("k", t);
  assert.equal(rl.check("k", t).blocked, false, "2 ครั้งยังไม่บล็อก");
  const s = rl.fail("k", t); // ครั้งที่ 3
  assert.equal(s.blocked, true, "ครั้งที่ 3 ต้องบล็อก");
  assert.ok(rl.check("k", t).retryAfterSec > 0);
});

test("RateLimiter — บล็อกหมดอายุตาม blockMs", () => {
  const rl = new RateLimiter({ maxFails: 1, windowMs: 1000, blockMs: 1000 });
  const t = 5000;
  rl.fail("k", t);
  assert.equal(rl.check("k", t).blocked, true);
  assert.equal(rl.check("k", t + 1001).blocked, false, "หลังพ้น blockMs ต้องปลดบล็อก");
});

test("RateLimiter — clear() ปลดบล็อกทันที", () => {
  const rl = new RateLimiter({ maxFails: 1, windowMs: 1000, blockMs: 10000 });
  rl.fail("k", 0);
  assert.equal(rl.check("k", 0).blocked, true);
  rl.clear("k");
  assert.equal(rl.check("k", 0).blocked, false);
});

test("RateLimiter — ความล้มเหลวที่ห่างเกินหน้าต่างไม่สะสม", () => {
  const rl = new RateLimiter({ maxFails: 2, windowMs: 1000, blockMs: 1000 });
  rl.fail("k", 0);
  const s = rl.fail("k", 2000); // เกินหน้าต่าง → รีเซ็ตหน้าต่าง นับใหม่เป็น 1
  assert.equal(s.blocked, false);
});

test("RateLimiter — แต่ละ key แยกกัน", () => {
  const rl = new RateLimiter({ maxFails: 1, windowMs: 1000, blockMs: 1000 });
  rl.fail("a", 0);
  assert.equal(rl.check("a", 0).blocked, true);
  assert.equal(rl.check("b", 0).blocked, false);
});

test("RateLimiter — retryAfterSec ปัดขึ้นเป็นวินาที", () => {
  const rl = new RateLimiter({ maxFails: 1, windowMs: 1000, blockMs: 1500 });
  rl.fail("k", 0);
  assert.equal(rl.check("k", 0).retryAfterSec, 2); // ceil(1500/1000) = 2
});

test("clientIp — เอา IP ตัวแรกจาก x-forwarded-for", () => {
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" })), "1.2.3.4");
});

test("clientIp — fallback ไป x-real-ip", () => {
  assert.equal(clientIp(new Headers({ "x-real-ip": "9.9.9.9" })), "9.9.9.9");
});

test("clientIp — ระบุไม่ได้ → null", () => {
  assert.equal(clientIp(new Headers()), null);
});

test("terrainAnalyzeRateLimiter — บล็อกหลังครบ 10 ครั้งในหน้าต่างเดียวกัน", () => {
  const key = `test-terrain-${Date.now()}-${Math.random()}`;
  const t = 10_000;
  for (let i = 0; i < 9; i++) {
    assert.equal(terrainAnalyzeRateLimiter.check(key, t).blocked, false, `ครั้งที่ ${i + 1} ยังไม่บล็อก`);
    terrainAnalyzeRateLimiter.fail(key, t);
  }
  assert.equal(terrainAnalyzeRateLimiter.check(key, t).blocked, false, "ครั้งที่ 9 ยังไม่บล็อก");
  const status = terrainAnalyzeRateLimiter.fail(key, t); // ครั้งที่ 10
  assert.equal(status.blocked, true, "ครั้งที่ 10 ต้องบล็อก");
  assert.ok(status.retryAfterSec > 0, "retryAfterSec ต้องเป็นค่าบวกเมื่อถูกบล็อก");
});
