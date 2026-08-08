import assert from "node:assert/strict";
import test from "node:test";
import { haversineM } from "./morphology";
import {
  countRidgeCrossings,
  RW_MAX_POINTS_PER_LINE,
  RW_SIDE_OFFSET_M,
  sampleWaveLines,
  type WaveLines,
} from "./routeWaves";

/** เส้นตรงไปทางทิศตะวันออกยาว lengthM เมตร ที่ lat 19 — จุดถี่ 25 ม. */
function straightRoute(lengthM: number): [number, number][] {
  const lat = 19;
  const mPerDegLng = 111_320 * Math.cos((lat * Math.PI) / 180);
  const n = Math.floor(lengthM / 25);
  return Array.from({ length: n + 1 }, (_, i) => [99 + (i * 25) / mPerDegLng, lat] as [number, number]);
}

/** สร้าง WaveLines ปลอมระยะห่าง 50 ม. n จุด (ไม่สนพิกัดจริง — ใช้ทดสอบตัวนับ) */
function fakeLines(n: number): WaveLines {
  return {
    spacingM: 50,
    center: Array.from({ length: n }, (_, i) => ({ lat: 19, lng: 99 + i * 0.0005 })),
    left: Array.from({ length: n }, (_, i) => ({ lat: 19.002, lng: 99 + i * 0.0005 })),
    right: Array.from({ length: n }, (_, i) => ({ lat: 18.998, lng: 99 + i * 0.0005 })),
    cumKm: Array.from({ length: n }, (_, i) => (i * 50) / 1000),
  };
}

const flat = (n: number, elev = 300) => Array.from({ length: n }, () => elev);

/** โปรไฟล์เป็นช่วง ๆ: [ระดับ, จำนวนจุด][] */
function profile(segs: [number, number][]): number[] {
  const out: number[] = [];
  for (const [elev, n] of segs) for (let i = 0; i < n; i++) out.push(elev);
  return out;
}

test("sampleWaveLines: เส้น 10 กม. → ระยะ 50 ม. ~200 จุด, left/right ยาวเท่า center", () => {
  const lines = sampleWaveLines(straightRoute(10_000));
  assert.ok(lines);
  assert.equal(lines.spacingM, 50);
  assert.ok(Math.abs(lines.center.length - 201) <= 2, `ได้ ${lines.center.length} จุด`);
  assert.equal(lines.left.length, lines.center.length);
  assert.equal(lines.right.length, lines.center.length);
  assert.ok(Math.abs(lines.cumKm[lines.cumKm.length - 1] - 10) < 0.2);
});

test("sampleWaveLines: offset ตั้งฉากระยะ ~200 ม. และอยู่คนละฝั่ง", () => {
  const lines = sampleWaveLines(straightRoute(2_000));
  assert.ok(lines);
  const mid = Math.floor(lines.center.length / 2);
  const c = lines.center[mid];
  const l = lines.left[mid];
  const r = lines.right[mid];
  assert.ok(Math.abs(haversineM(c.lat, c.lng, l.lat, l.lng) - RW_SIDE_OFFSET_M) < 20);
  assert.ok(Math.abs(haversineM(c.lat, c.lng, r.lat, r.lng) - RW_SIDE_OFFSET_M) < 20);
  // เส้นวิ่งตะวันออก → ตั้งฉากคือแกนเหนือ-ใต้: ซ้าย/ขวาต้องอยู่คนละฝั่งของแนวเส้น
  assert.ok((l.lat - c.lat) * (r.lat - c.lat) < 0);
});

test("sampleWaveLines: เส้นยาวกว่า 60 กม. → spacing ขยาย, จุดไม่เกินเพดาน", () => {
  const lines = sampleWaveLines(straightRoute(120_000));
  assert.ok(lines);
  assert.ok(lines.center.length <= RW_MAX_POINTS_PER_LINE + 1);
  assert.ok(lines.spacingM >= 100);
});

test("sampleWaveLines: อินพุตใช้ไม่ได้ → null", () => {
  assert.equal(sampleWaveLines([]), null);
  assert.equal(sampleWaveLines([[99, 19]]), null);
});

test("นับลูก: โปรไฟล์ราบ → 0", () => {
  const n = 100;
  const r = countRidgeCrossings(fakeLines(n), flat(n), flat(n), flat(n));
  assert.equal(r.count, 0);
  assert.equal(r.confirmedCount, 0);
});

test("นับลูก: ลูกเดียวชัด (ขึ้น 100 ลง 100) → 1", () => {
  const elev = profile([
    [300, 30],
    [400, 10],
    [300, 30],
  ]);
  const n = elev.length;
  const r = countRidgeCrossings(fakeLines(n), elev, flat(n), flat(n));
  assert.equal(r.count, 1);
  assert.ok(Math.abs(r.waves[0].elevM - 400) < 1);
});

test("นับลูก: สองลูกมีหุบคั่นลึกพอ → 2; หุบคั่นตื้น (<50) → 1", () => {
  const deep = profile([
    [300, 20],
    [400, 10],
    [300, 20],
    [420, 10],
    [300, 20],
  ]);
  const r1 = countRidgeCrossings(fakeLines(deep.length), deep, flat(deep.length), flat(deep.length));
  assert.equal(r1.count, 2);
  const shallow = profile([
    [300, 20],
    [400, 10],
    [370, 20],
    [420, 10],
    [300, 20],
  ]);
  const r2 = countRidgeCrossings(fakeLines(shallow.length), shallow, flat(shallow.length), flat(shallow.length));
  assert.equal(r2.count, 1);
});

test("นับลูก: ขึ้นแค่ 49 ม. → 0 (ใต้ prominence)", () => {
  const elev = profile([
    [300, 30],
    [349, 10],
    [300, 30],
  ]);
  const r = countRidgeCrossings(fakeLines(elev.length), elev, flat(elev.length), flat(elev.length));
  assert.equal(r.count, 0);
});

test("นับลูก: ไต่ท้ายเส้น ≥50 โดยไม่ลง → นับ 1 (โรงเรียนบนเขาลูกสุดท้าย)", () => {
  const elev = profile([
    [300, 40],
    [420, 20],
  ]);
  const r = countRidgeCrossings(fakeLines(elev.length), elev, flat(elev.length), flat(elev.length));
  assert.equal(r.count, 1);
});

test("นับลูก: noise ±10 ม. บนไหล่ลูกเดียว → ยังนับ 1", () => {
  const base = profile([
    [300, 25],
    [450, 15],
    [300, 25],
  ]);
  const noisy = base.map((v, i) => v + (i % 2 === 0 ? 10 : -10));
  const r = countRidgeCrossings(fakeLines(noisy.length), noisy, flat(noisy.length), flat(noisy.length));
  assert.equal(r.count, 1);
});

test("ยืนยันสันเขา: ยอด left ในหน้าต่าง ±300 ม. → confirmed; ไม่มีข้าง → ไม่ confirmed", () => {
  const centerElev = profile([
    [300, 30],
    [400, 10],
    [300, 30],
  ]);
  const n = centerElev.length;
  const leftRidge = profile([
    [310, 30],
    [430, 10],
    [310, 30],
  ]);
  const r1 = countRidgeCrossings(fakeLines(n), centerElev, leftRidge, flat(n));
  assert.equal(r1.count, 1);
  assert.equal(r1.confirmedCount, 1);
  assert.equal(r1.waves[0].confirmed, true);
  const r2 = countRidgeCrossings(fakeLines(n), centerElev, flat(n), flat(n));
  assert.equal(r2.confirmedCount, 0);
  assert.equal(r2.waves[0].confirmed, false);
});

test("แนวข้างมีค่า null (สุ่มความสูงไม่สำเร็จบางจุด) → ไม่พังและไม่ confirmed มั่ว", () => {
  const centerElev = profile([
    [300, 30],
    [400, 10],
    [300, 30],
  ]);
  const n = centerElev.length;
  const nulls = Array.from({ length: n }, () => null);
  const r = countRidgeCrossings(fakeLines(n), centerElev, nulls, nulls);
  assert.equal(r.count, 1);
  assert.equal(r.confirmedCount, 0);
});

test("waves cap 30 ลูก แต่ count นับครบ", () => {
  const segs: [number, number][] = [];
  for (let i = 0; i < 40; i++) segs.push([300, 4], [400, 4]);
  segs.push([300, 4]);
  const elev = profile(segs);
  const n = elev.length;
  const r = countRidgeCrossings(fakeLines(n), elev, flat(n), flat(n));
  assert.ok(r.count > 30, `count = ${r.count}`);
  assert.equal(r.waves.length, 30);
});

test("ผลไม่แก้อินพุต", () => {
  const elev = profile([
    [300, 30],
    [400, 10],
    [300, 30],
  ]);
  const snap = JSON.stringify(elev);
  countRidgeCrossings(fakeLines(elev.length), elev, flat(elev.length), flat(elev.length));
  assert.equal(JSON.stringify(elev), snap);
});
