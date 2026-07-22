// Unit tests สำหรับ lib/assessment-year.ts — ปี พ.ศ. ปัจจุบันตามเขตเวลา Asia/Bangkok
// กัน regress: ต้องใช้ขอบเขตปฏิทินกรุงเทพฯ (UTC+7) ไม่ใช่เขตเวลาเครื่องที่รันจริง
// รันด้วย: npm test (node:test + tsx loader)

import assert from "node:assert/strict";
import test from "node:test";
import { currentBuddhistYear } from "../lib/assessment-year";

test("currentBuddhistYear uses the Asia/Bangkok calendar boundary", () => {
  assert.equal(currentBuddhistYear(new Date("2026-12-31T16:59:59.000Z")), "2569");
  assert.equal(currentBuddhistYear(new Date("2026-12-31T17:00:00.000Z")), "2570");
});

test("currentBuddhistYear adds 543 to the Gregorian year", () => {
  assert.equal(currentBuddhistYear(new Date("2026-07-22T04:00:00.000Z")), "2569");
});

test("currentBuddhistYear defaults to the current instant when called with no argument", () => {
  const nowYear = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric" }).format(new Date()),
  );
  assert.equal(currentBuddhistYear(), String(nowYear + 543));
});
