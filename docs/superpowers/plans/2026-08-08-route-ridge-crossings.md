# Route Ridge Crossings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** นับจำนวน "ลูกคลื่นภูเขา" ที่เส้นทางหลักต้องข้ามกว่าจะถึงโรงเรียน (พร้อมแนวขนานซ้าย-ขวา ±200 ม. เพื่อยืนยันสันเขาจริง) แล้วเก็บลง `gis.route.ridgeCrossings`, แสดงบนแผนที่ + GisSummary, และเข้าเกณฑ์ 5 ระดับเป็นมิติที่ 7

**Architecture:** โมดูล pure ใหม่ `lib/map/routeWaves.ts` (เรขาคณิต 3 แนว + hysteresis counting) — client สุ่มความสูงผ่าน Cesium terrain เหมือน route profile เดิม; server รับผ่าน allowlist (`lib/gis-request.ts` + `sanitizeGis`) โดยไม่คำนวณซ้ำ (ไม่มี DEM); `lib/terrain-difficulty.ts` เพิ่มมิติ `ridges`

**Tech Stack:** TypeScript strict, node:test + tsx, CesiumJS (client-only)

**Spec:** `docs/superpowers/specs/2026-08-08-route-ridge-crossings-design.md`

## Global Constraints

- `RW_PROMINENCE_M = 50`, `RW_SIDE_OFFSET_M = 200`, `RW_CONFIRM_WINDOW_M = 300`, `RW_SPACING_M = 50`, `RW_MAX_POINTS_PER_LINE = 1200`, `RW_MAX_WAVES_STORED = 30`, `TD_RIDGE_MIN = 3`
- `lib/map/routeWaves.ts` **ห้าม import `lib/gis.ts`** (วนกับ sanitizeGis) — import ได้แค่ `lib/map/geometry.ts` / `lib/map/morphology.ts` / types
- deterministic ทั้งหมด — ห้าม `Math.random()`
- แถว v1 ไม่มี key `ridgeCrossings` ต้อง round-trip byte-identical
- ทุก task จบด้วย `npm test` เขียวและ commit; ห้ามรัน `npm run build` ขณะ dev server ของผู้ใช้ยังรันอยู่ (ใช้ `npx tsc --noEmit` แทน)
- ทดสอบไฟล์เดี่ยว: `npx tsx --test <file>` (PowerShell 5.1 — chain ด้วย `;` ไม่ใช่ `&&` ถ้าใช้ PowerShell; Bash tool ใช้ `&&` ได้)

---

### Task 1: โมดูล pure `lib/map/routeWaves.ts` — เรขาคณิต 3 แนว + นับลูก

**Files:**
- Create: `lib/map/routeWaves.ts`
- Test: `lib/map/routeWaves.test.ts`
- Modify: `package.json` (เพิ่มไฟล์เทสต์เข้า `test` script ต่อจาก `lib/map/routeElevation.test.ts`)

**Interfaces:**
- Consumes: `haversineM(lat1, lng1, lat2, lng2)` จาก `lib/map/morphology.ts`
- Produces (Task 2–5 ใช้):

```ts
export interface WaveLinePoint { lat: number; lng: number }
export interface WaveLines {
  spacingM: number;                    // ระยะจริงหลังปรับเพดาน
  center: WaveLinePoint[];
  left: WaveLinePoint[];               // ยาวเท่า center เสมอ
  right: WaveLinePoint[];
  cumKm: number[];                     // ระยะสะสม (กม.) ต่อ index
}
export function sampleWaveLines(coords: readonly [number, number][] /* [lng,lat] */): WaveLines | null;

export interface RidgeWave { atKm: number; elevM: number; prominenceM: number; confirmed: boolean }
export interface RidgeCrossingsResult {
  count: number;
  confirmedCount: number;
  spacingM: number;
  sideOffsetM: number;
  prominenceM: number;
  waves: RidgeWave[];                  // cap 30
}
export function countRidgeCrossings(
  lines: WaveLines,
  centerElev: readonly number[],
  leftElev: readonly (number | null)[],
  rightElev: readonly (number | null)[],
): RidgeCrossingsResult;
export const RW_PROMINENCE_M = 50;
export const RW_SIDE_OFFSET_M = 200;
export const RW_CONFIRM_WINDOW_M = 300;
export const RW_SPACING_M = 50;
export const RW_MAX_POINTS_PER_LINE = 1200;
export const RW_MAX_WAVES_STORED = 30;
```

- [ ] **Step 1: เขียนเทสต์ (คาดว่า FAIL — โมดูลยังไม่มี)**

`lib/map/routeWaves.test.ts` — โปรไฟล์สังเคราะห์สร้างด้วย helper ในไฟล์เทสต์:

```ts
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
    cumKm: Array.from({ length: n }, (_, i) => (i * 50) / 1000,
    ),
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
  assert.ok(Math.abs(lines.center.length - 201) <= 2);
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
  // เส้นวิ่งตะวันออก → ตั้งฉากคือแกนเหนือ-ใต้: ซ้ายอยู่เหนือ ขวาอยู่ใต้ (หรือกลับกัน) แต่ต้องคนละฝั่ง
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
  const elev = profile([[300, 30], [400, 10], [300, 30]]);
  const n = elev.length;
  const r = countRidgeCrossings(fakeLines(n), elev, flat(n), flat(n));
  assert.equal(r.count, 1);
  assert.ok(Math.abs(r.waves[0].elevM - 400) < 1);
});

test("นับลูก: สองลูกมีหุบคั่นลึกพอ → 2; หุบคั่นตื้น (<50) → 1", () => {
  const deep = profile([[300, 20], [400, 10], [300, 20], [420, 10], [300, 20]]);
  const r1 = countRidgeCrossings(fakeLines(deep.length), deep, flat(deep.length), flat(deep.length));
  assert.equal(r1.count, 2);
  const shallow = profile([[300, 20], [400, 10], [370, 20], [420, 10], [300, 20]]);
  const r2 = countRidgeCrossings(fakeLines(shallow.length), shallow, flat(shallow.length), flat(shallow.length));
  assert.equal(r2.count, 1);
});

test("นับลูก: ขึ้นแค่ 49 ม. → 0 (ใต้ prominence)", () => {
  const elev = profile([[300, 30], [349, 10], [300, 30]]);
  const r = countRidgeCrossings(fakeLines(elev.length), elev, flat(elev.length), flat(elev.length));
  assert.equal(r.count, 0);
});

test("นับลูก: ไต่ท้ายเส้น ≥50 โดยไม่ลง → นับ 1 (โรงเรียนบนเขาลูกสุดท้าย)", () => {
  const elev = profile([[300, 40], [420, 20]]);
  const r = countRidgeCrossings(fakeLines(elev.length), elev, flat(elev.length), flat(elev.length));
  assert.equal(r.count, 1);
});

test("นับลูก: noise ±10 ม. บนไหล่ลูกเดียว → ยังนับ 1", () => {
  const base = profile([[300, 25], [450, 15], [300, 25]]);
  const noisy = base.map((v, i) => v + (i % 2 === 0 ? 10 : -10));
  const r = countRidgeCrossings(fakeLines(noisy.length), noisy, flat(noisy.length), flat(noisy.length));
  assert.equal(r.count, 1);
});

test("ยืนยันสันเขา: ยอด left ในหน้าต่าง ±300 ม. → confirmed; ไม่มีข้าง → ไม่ confirmed", () => {
  const centerElev = profile([[300, 30], [400, 10], [300, 30]]);
  const n = centerElev.length;
  // left มียอดตำแหน่งเดียวกัน (ห่างตามแนวเส้น 0 ม. — อยู่ในหน้าต่างแน่นอน)
  const leftRidge = profile([[310, 30], [430, 10], [310, 30]]);
  const r1 = countRidgeCrossings(fakeLines(n), centerElev, leftRidge, flat(n));
  assert.equal(r1.count, 1);
  assert.equal(r1.confirmedCount, 1);
  assert.equal(r1.waves[0].confirmed, true);
  const r2 = countRidgeCrossings(fakeLines(n), centerElev, flat(n), flat(n));
  assert.equal(r2.confirmedCount, 0);
  assert.equal(r2.waves[0].confirmed, false);
});

test("แนวข้างมีค่า null (สุ่มความสูงไม่สำเร็จบางจุด) → ไม่พังและไม่ confirmed มั่ว", () => {
  const centerElev = profile([[300, 30], [400, 10], [300, 30]]);
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
  assert.ok(r.count > 30);
  assert.equal(r.waves.length, 30);
});

test("ผลไม่แก้อินพุต", () => {
  const elev = profile([[300, 30], [400, 10], [300, 30]]);
  const snap = JSON.stringify(elev);
  countRidgeCrossings(fakeLines(elev.length), elev, flat(elev.length), flat(elev.length));
  assert.equal(JSON.stringify(elev), snap);
});
```

- [ ] **Step 2: รันให้เห็น FAIL**

Run: `npx tsx --test lib/map/routeWaves.test.ts`
Expected: FAIL `Cannot find module './routeWaves'`

- [ ] **Step 3: เขียน `lib/map/routeWaves.ts`**

```ts
// นับลูกคลื่นภูเขาที่เส้นทางต้องข้าม — pure ล้วน (client เป็นผู้สุ่มความสูง)
// ห้าม import lib/gis.ts (วนกับ sanitizeGis) — ดูสเปก 2026-08-08-route-ridge-crossings
import { haversineM } from "./morphology";

export const RW_PROMINENCE_M = 50;
export const RW_SIDE_OFFSET_M = 200;
export const RW_CONFIRM_WINDOW_M = 300;
export const RW_SPACING_M = 50;
export const RW_MAX_POINTS_PER_LINE = 1200;
export const RW_MAX_WAVES_STORED = 30;

const M_PER_DEG_LAT = 111_320;

export interface WaveLinePoint { lat: number; lng: number }
export interface WaveLines {
  spacingM: number;
  center: WaveLinePoint[];
  left: WaveLinePoint[];
  right: WaveLinePoint[];
  cumKm: number[];
}
export interface RidgeWave { atKm: number; elevM: number; prominenceM: number; confirmed: boolean }
export interface RidgeCrossingsResult {
  count: number;
  confirmedCount: number;
  spacingM: number;
  sideOffsetM: number;
  prominenceM: number;
  waves: RidgeWave[];
}

/** จุดทุก spacing เมตรตามเส้นทาง (linear interpolation ระหว่าง vertex) */
function resampleByDistance(coords: readonly [number, number][], spacingM: number): { pts: WaveLinePoint[]; cumKm: number[] } {
  const pts: WaveLinePoint[] = [{ lat: coords[0][1], lng: coords[0][0] }];
  const cumKm: number[] = [0];
  let carried = 0;
  let traveled = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lng0, lat0] = coords[i - 1];
    const [lng1, lat1] = coords[i];
    const seg = haversineM(lat0, lng0, lat1, lng1);
    if (!(seg > 0)) continue;
    let along = spacingM - carried;
    while (along <= seg) {
      const t = along / seg;
      pts.push({ lat: lat0 + (lat1 - lat0) * t, lng: lng0 + (lng1 - lng0) * t });
      cumKm.push((traveled + along) / 1000);
      along += spacingM;
    }
    carried = seg - (along - spacingM);
    traveled += seg;
  }
  return { pts, cumKm };
}

function routeLengthM(coords: readonly [number, number][]): number {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) {
    sum += haversineM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  }
  return sum;
}

/**
 * จุด 3 แนว (กลาง/ซ้าย/ขวา) ทุก RW_SPACING_M ตามเส้นทาง — เส้นยาวเกินเพดานขยาย spacing
 * left/right = offset ตั้งฉากกับทิศทางเดินหน้า ±RW_SIDE_OFFSET_M (ค่าคงที่ deterministic)
 */
export function sampleWaveLines(coords: readonly [number, number][]): WaveLines | null {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lengthM = routeLengthM(coords);
  if (!(lengthM > 0)) return null;
  const spacingM = Math.max(RW_SPACING_M, Math.ceil(lengthM / RW_MAX_POINTS_PER_LINE));
  const { pts: center, cumKm } = resampleByDistance(coords, spacingM);
  if (center.length < 2) return null;

  const left: WaveLinePoint[] = [];
  const right: WaveLinePoint[] = [];
  for (let i = 0; i < center.length; i++) {
    const prev = center[Math.max(0, i - 1)];
    const next = center[Math.min(center.length - 1, i + 1)];
    // ทิศทางเดินหน้าเป็นเวกเตอร์ระนาบเมตร (ชดเชย cos ที่ลองจิจูด)
    const cos = Math.max(0.01, Math.cos((center[i].lat * Math.PI) / 180));
    let dx = (next.lng - prev.lng) * M_PER_DEG_LAT * cos;
    let dy = (next.lat - prev.lat) * M_PER_DEG_LAT;
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) {
      left.push(center[i]);
      right.push(center[i]);
      continue;
    }
    dx /= len;
    dy /= len;
    // ตั้งฉาก: ซ้ายของทิศเดินหน้า = (-dy, dx)
    const offLatDeg = (dx * RW_SIDE_OFFSET_M) / M_PER_DEG_LAT;
    const offLngDeg = (-dy * RW_SIDE_OFFSET_M) / (M_PER_DEG_LAT * cos);
    left.push({ lat: center[i].lat + offLatDeg, lng: center[i].lng + offLngDeg });
    right.push({ lat: center[i].lat - offLatDeg, lng: center[i].lng - offLngDeg });
  }
  return { spacingM, center, left, right, cumKm };
}

/** median หน้าต่าง 3 — spike ของ DEM หายโดยไม่เลื่อนตำแหน่งยอด */
function median3(values: readonly number[]): number[] {
  return values.map((v, i) => {
    const a = values[Math.max(0, i - 1)];
    const b = v;
    const c = values[Math.min(values.length - 1, i + 1)];
    return [a, b, c].sort((x, y) => x - y)[1];
  });
}

interface ProfilePeak { index: number; elevM: number; prominenceM: number }

/** เดินโปรไฟล์แบบ hysteresis: ปิดลูกเมื่อไต่จากหุบ ≥ prominence และลงจากยอด ≥ prominence (หรือจบเส้นขณะไต่) */
function findPeaks(elev: readonly number[], prominenceM: number): ProfilePeak[] {
  const peaks: ProfilePeak[] = [];
  let valley = elev[0];
  let peak = elev[0];
  let peakIndex = 0;
  let climbing = false;
  for (let i = 1; i < elev.length; i++) {
    const v = elev[i];
    if (!climbing) {
      if (v < valley) valley = v;
      if (v - valley >= prominenceM) {
        climbing = true;
        peak = v;
        peakIndex = i;
      }
    } else {
      if (v > peak) {
        peak = v;
        peakIndex = i;
      }
      if (peak - v >= prominenceM) {
        peaks.push({ index: peakIndex, elevM: peak, prominenceM: peak - valley });
        valley = v;
        climbing = false;
      }
    }
  }
  if (climbing) peaks.push({ index: peakIndex, elevM: peak, prominenceM: peak - valley }); // ลูกท้ายเส้น
  return peaks;
}

/** แนวข้างที่มี null: แทนด้วยค่าก่อนหน้า (ตัดจุดที่วัดไม่ได้ออกจากการสร้างยอดปลอม) */
function fillNulls(values: readonly (number | null)[]): number[] | null {
  let last: number | null = null;
  const out: number[] = [];
  let known = 0;
  for (const v of values) {
    if (v !== null && Number.isFinite(v)) {
      last = v;
      known++;
    }
    out.push(last ?? 0);
  }
  // แนวที่วัดได้ไม่ถึงครึ่ง ไม่น่าเชื่อพอจะยืนยันสันเขา
  return known * 2 >= values.length ? out : null;
}

export function countRidgeCrossings(
  lines: WaveLines,
  centerElev: readonly number[],
  leftElev: readonly (number | null)[],
  rightElev: readonly (number | null)[],
): RidgeCrossingsResult {
  const smoothCenter = median3(centerElev as number[]);
  const centerPeaks = findPeaks(smoothCenter, RW_PROMINENCE_M);

  const sidePeakIndices: number[] = [];
  for (const side of [leftElev, rightElev]) {
    const filled = fillNulls(side);
    if (!filled) continue;
    for (const p of findPeaks(median3(filled), RW_PROMINENCE_M)) sidePeakIndices.push(p.index);
  }

  const windowIdx = Math.max(1, Math.round(RW_CONFIRM_WINDOW_M / lines.spacingM));
  const waves: RidgeWave[] = centerPeaks.map((p) => ({
    atKm: Math.round((lines.cumKm[Math.min(p.index, lines.cumKm.length - 1)] ?? 0) * 10) / 10,
    elevM: Math.round(p.elevM),
    prominenceM: Math.round(p.prominenceM),
    confirmed: sidePeakIndices.some((si) => Math.abs(si - p.index) <= windowIdx),
  }));

  return {
    count: waves.length,
    confirmedCount: waves.filter((w) => w.confirmed).length,
    spacingM: lines.spacingM,
    sideOffsetM: RW_SIDE_OFFSET_M,
    prominenceM: RW_PROMINENCE_M,
    waves: waves.slice(0, RW_MAX_WAVES_STORED),
  };
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `npx tsx --test lib/map/routeWaves.test.ts`
Expected: PASS ทุกเคส — ถ้า `noisy → 1` ไม่ผ่าน ตรวจว่า median3 ทำงานก่อน findPeaks และ hysteresis ใช้หุบ "ต่ำสุดตั้งแต่ปิดลูกก่อนหน้า" ไม่ใช่จุดก่อนหน้าจุดเดียว

- [ ] **Step 5: เพิ่มเข้า `npm test` แล้วรันทั้งชุด + commit**

`package.json` → ใน `"test"` แทรก `lib/map/routeWaves.test.ts` ถัดจาก `lib/map/routeElevation.test.ts`

```bash
npm test          # ทุกไฟล์เขียว
git add lib/map/routeWaves.ts lib/map/routeWaves.test.ts package.json
git commit -m "feat(map): โมดูล pure นับลูกคลื่นภูเขาบนเส้นทาง 3 แนวขนาน"
```

---

### Task 2: เก็บ `ridgeCrossings` ลง `gis.route` (`lib/gis.ts` + `lib/gis-request.ts`)

**Files:**
- Modify: `lib/gis.ts` (interface `GisRouteAnalysis` ~line 309, `GIS_LIMITS` ~line 180, `cleanRoute` ~line 691)
- Modify: `lib/gis-request.ts` (~line 84 — จุด copy field ของ route item)
- Test: `tests/gis.test.ts` (เพิ่มเคส), `tests/gis-request.test.ts` (เพิ่มเคส)

**Interfaces:**
- Consumes: shape `RidgeCrossingsResult` จาก Task 1 (โครงเดียวกัน แต่ **นิยาม type ซ้ำใน gis.ts** ชื่อ `GisRidgeCrossings` — ห้าม import routeWaves.ts เข้า gis.ts เพื่อกัน dependency ข้ามชั้น; sanitize เป็น allowlist จึงไม่ drift)
- Produces: `GisRouteAnalysis.ridgeCrossings?: GisRidgeCrossings` — Task 3/4/5 อ่านจากตรงนี้

- [ ] **Step 1: เขียนเทสต์เพิ่มใน `tests/gis.test.ts` (FAIL ก่อน)**

```ts
test("sanitizeGis: ridgeCrossings round-trip + ตัดค่านอกช่วง", () => {
  const base = validGis(); // helper เดิมของไฟล์ — ถ้าชื่อจริงต่างไป ใช้ตัวที่เทสต์ mountainPct ใช้อยู่
  base.routes[0].ridgeCrossings = {
    count: 5,
    confirmedCount: 3,
    spacingM: 50,
    sideOffsetM: 200,
    prominenceM: 50,
    waves: [
      { atKm: 2.5, elevM: 812, prominenceM: 120, confirmed: true },
      { atKm: 9999, elevM: 99999, prominenceM: -5, confirmed: false }, // นอกช่วง → ถูกตัดทั้งแถว
    ],
  };
  const out = sanitizeGis(base);
  const rc = out?.routes[0].ridgeCrossings;
  assert.ok(rc);
  assert.equal(rc.count, 5);
  assert.equal(rc.confirmedCount, 3);
  assert.equal(rc.waves.length, 1);
  assert.equal(rc.waves[0].confirmed, true);
});

test("sanitizeGis: ไม่มี ridgeCrossings → ไม่งอก key (v1 round-trip)", () => {
  const out = sanitizeGis(validGis());
  assert.ok(out);
  assert.equal("ridgeCrossings" in out.routes[0], false);
});
```

และใน `tests/gis-request.test.ts` (ตามแพตเทิร์นเคส `mountainPct` ที่มีอยู่):

```ts
test("buildGisFromMapRequest: คัดลอก ridgeCrossings จาก payload และตัดของปลอม", () => {
  const payload = validPayload(); // helper เดิมของไฟล์
  payload.gis.routes[0].ridgeCrossings = {
    count: 4, confirmedCount: 2, spacingM: 50, sideOffsetM: 200, prominenceM: 50,
    waves: [{ atKm: 1.2, elevM: 700, prominenceM: 90, confirmed: true }],
  };
  const { gis } = buildGisFromMapRequest(payload, opts()); // ใช้ options เดิมของไฟล์
  assert.equal(gis.routes[0].ridgeCrossings?.count, 4);
});
```

Run: `npx tsx --test tests/gis.test.ts tests/gis-request.test.ts` → Expected: FAIL (property ไม่มีใน type)

- [ ] **Step 2: แก้ `lib/gis.ts`**

เพิ่มใน `GIS_LIMITS`:

```ts
  ridgeCount: { min: 0, max: 500 },
  ridgeAtKm: { min: 0, max: 1000 },
  ridgeElevM: { min: -500, max: 9000 },
  ridgeProminenceM: { min: 0, max: 4000 },
  ridgeSpacingM: { min: 10, max: 2000 },
  ridgeOffsetM: { min: 50, max: 1000 },
```

เพิ่ม interface (ใกล้ `GisRouteHighestPoint`):

```ts
/** ผลนับลูกคลื่นภูเขาบนเส้นทาง (นับฝั่ง client จาก DEM — ดูสเปก route-ridge-crossings) */
export interface GisRidgeWave {
  atKm: number;
  elevM: number;
  prominenceM: number;
  confirmed: boolean;
}
export interface GisRidgeCrossings {
  count: number;
  confirmedCount: number;
  spacingM: number;
  sideOffsetM: number;
  prominenceM: number;
  waves: GisRidgeWave[];
}
```

ใน `GisRouteAnalysis` เพิ่ม `ridgeCrossings?: GisRidgeCrossings;` ถัดจาก `mountainPct`

เพิ่มฟังก์ชัน clean (ข้าง `cleanHighestPoint`):

```ts
const MAX_RIDGE_WAVES = 30;

function cleanRidgeCrossings(value: unknown): GisRidgeCrossings | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const count = cleanNum(r.count, GIS_LIMITS.ridgeCount, 0);
  const confirmedCount = cleanNum(r.confirmedCount, GIS_LIMITS.ridgeCount, 0);
  const spacingM = cleanNum(r.spacingM, GIS_LIMITS.ridgeSpacingM, 0);
  const sideOffsetM = cleanNum(r.sideOffsetM, GIS_LIMITS.ridgeOffsetM, 0);
  const prominenceM = cleanNum(r.prominenceM, GIS_LIMITS.ridgeProminenceM, 0);
  if (count === null || confirmedCount === null || spacingM === null || sideOffsetM === null || prominenceM === null)
    return null;
  const waves: GisRidgeWave[] = [];
  if (Array.isArray(r.waves)) {
    for (const w of r.waves.slice(0, MAX_RIDGE_WAVES)) {
      if (!w || typeof w !== "object") continue;
      const wave = w as Record<string, unknown>;
      const atKm = cleanNum(wave.atKm, GIS_LIMITS.ridgeAtKm, 1);
      const elevM = cleanNum(wave.elevM, GIS_LIMITS.ridgeElevM, 0);
      const prom = cleanNum(wave.prominenceM, GIS_LIMITS.ridgeProminenceM, 0);
      if (atKm === null || elevM === null || prom === null) continue;
      waves.push({ atKm, elevM, prominenceM: prom, confirmed: wave.confirmed === true });
    }
  }
  return {
    count,
    confirmedCount: Math.min(confirmedCount, count),
    spacingM,
    sideOffsetM,
    prominenceM,
    waves,
  };
}
```

(หมายเหตุ: ใช้ helper ตัวเลขที่ไฟล์มีอยู่ — ถ้าไฟล์มีเฉพาะ `cleanNullableNum` ให้ใช้ตัวนั้นแล้วเช็ค null ตามแบบเดียวกัน)

ใน `cleanRoute` เพิ่ม (ตามแพตเทิร์น highestPoint):

```ts
  const ridgeCrossings = cleanRidgeCrossings(r.ridgeCrossings);
  if (ridgeCrossings) route.ridgeCrossings = ridgeCrossings;
```

- [ ] **Step 3: แก้ `lib/gis-request.ts`** — ที่จุด copy route field (~line 84 area) เพิ่มการพก `ridgeCrossings` ดิบไว้บน object ก่อนส่งเข้า `sanitizeGis`/`cleanRoute` เส้นทางเดียวกับ `highestPoint` (~line 141):

```ts
    routes.push({ ...route, highestPoint: cleanRouteHighestPoint(item), ridgeCrossings: (item as Record<string, unknown>).ridgeCrossings });
```

(ตัว validate จริงคือ `cleanRidgeCrossings` ใน sanitize เส้นทางปลายทาง — gis-request แค่ไม่ทำ field หล่นหาย ตรวจไฟล์จริงว่า route object ถูกประกอบตรงไหนแล้ววางให้ผ่าน `sanitizeGis` เสมอ)

- [ ] **Step 4: รันเทสต์**

Run: `npx tsx --test tests/gis.test.ts tests/gis-request.test.ts`
Expected: PASS; ตามด้วย `npm test` ทั้งชุดเขียว

- [ ] **Step 5: Commit**

```bash
git add lib/gis.ts lib/gis-request.ts tests/gis.test.ts tests/gis-request.test.ts
git commit -m "feat(gis): เก็บผลนับลูกคลื่นภูเขาใน gis.route.ridgeCrossings ผ่าน allowlist"
```

---

### Task 3: มิติที่ 7 ของเกณฑ์ 5 ระดับ (`lib/terrain-difficulty.ts`)

**Files:**
- Modify: `lib/terrain-difficulty.ts` (`TD_ACCESS_CUTS` ~line 41, `TerrainDifficultyInput` ~line 75, จุดนับ access ~line 195, `missing` ~line 176, `terrainDifficultyFromGis` ~line 338)
- Test: `lib/terrain-difficulty.test.ts`

**Interfaces:**
- Consumes: `ctx.route?.ridgeCrossings?.confirmedCount` (shape จาก Task 2 — `TerrainDifficultyContext.route` คือ `GisRouteAnalysis`)
- Produces: input field ใหม่ `ridgeConfirmedCount: number | null`; cut ใหม่ `TD_ACCESS_CUTS.ridgeCount = 3`

- [ ] **Step 1: เทสต์ (FAIL ก่อน)** — เพิ่มใน `lib/terrain-difficulty.test.ts` ตามแพตเทิร์นเคส access เดิมของไฟล์ (ใช้ helper input ตัวเดิมของไฟล์ แล้ว override เฉพาะ field):

```ts
test("มิติ ridges: confirmedCount ≥ 3 นับเป็นอีกด้าน, null ไม่นับและแจ้ง missing", () => {
  const base = fullInput(); // helper เดิมในไฟล์ (ชื่อจริงตามที่เทสต์ access เดิมใช้)
  const withRidges = assessTerrainDifficulty({ ...base, ridgeConfirmedCount: 3 });
  const without = assessTerrainDifficulty({ ...base, ridgeConfirmedCount: 0 });
  assert.equal(withRidges.accessSignals, without.accessSignals + 1);
  assert.ok(withRidges.accessSignalLabels.some((l) => l.includes("ข้ามภูเขา")));

  const missing = assessTerrainDifficulty({ ...base, ridgeConfirmedCount: null });
  assert.equal(missing.accessSignals, without.accessSignals);
  assert.ok(missing.missing.some((m) => m.includes("จำนวนภูเขาที่ข้าม")));
});
```

Run: `npx tsx --test lib/terrain-difficulty.test.ts` → FAIL (field ไม่มีใน type)

- [ ] **Step 2: แก้ `lib/terrain-difficulty.ts`**

`TD_ACCESS_CUTS` เพิ่ม:

```ts
  /** จำนวนสันเขาจริงที่เส้นทางข้าม (ยืนยันด้วยแนวขนาน ±200 ม.) —
   *  ค่าเริ่มต้นเชิงหลักการ ยังไม่ calibrate กับประชากรจริง ทบทวนเมื่อมีข้อมูลสะสม */
  ridgeCount: 3,
```

`TerrainDifficultyInput` เพิ่ม:

```ts
  /** สันเขาจริงที่เส้นทางหลักข้าม (confirmedCount) — null = แถวเก่าไม่มีข้อมูล */
  ridgeConfirmedCount: number | null;
```

จุดนับ access (~line 195 หลัง mountainPct):

```ts
  if (input.ridgeConfirmedCount !== null && input.ridgeConfirmedCount >= TD_ACCESS_CUTS.ridgeCount)
    accessSignalLabels.push("ข้ามภูเขาหลายลูก");
```

จุด missing (ที่เดียวกับ missing อื่น — เพิ่มเมื่อ `ridgeConfirmedCount === null`):

```ts
  if (input.ridgeConfirmedCount === null)
    missing.push("จำนวนภูเขาที่ข้ามบนเส้นทาง — บันทึกจากแผนที่อีกครั้งเพื่ออัปเดต");
```

`terrainDifficultyFromGis` เพิ่มใน object ที่ส่งเข้า `assessTerrainDifficulty`:

```ts
    ridgeConfirmedCount: ctx.route?.ridgeCrossings?.confirmedCount ?? null,
```

- [ ] **Step 3: รันเทสต์**

Run: `npx tsx --test lib/terrain-difficulty.test.ts` → PASS; แล้ว `npm test` ทั้งชุด — **ระวัง**: เคสเดิมของไฟล์ที่สร้าง input เต็มจะ type-error เพราะ field ใหม่ required → เติม `ridgeConfirmedCount: null` ใน helper เดิม (การที่เคสเดิมทุกตัวยังให้ผลเดิมด้วย `null` คือหลักฐานว่าแถวเก่าไม่เปลี่ยนพฤติกรรม)

- [ ] **Step 4: Commit**

```bash
git add lib/terrain-difficulty.ts lib/terrain-difficulty.test.ts
git commit -m "feat(criteria): จำนวนสันเขาที่ข้ามเป็นมิติที่ 7 ของการเข้าถึงในเกณฑ์ 5 ระดับ"
```

---

### Task 4: วัดจริงบนแผนที่ + ใส่ payload บันทึก (`components/map/CesiumMap.tsx`)

**Files:**
- Modify: `components/map/CesiumMap.tsx` (effect สุ่ม gain ~line 2870–2930 area สำหรับเส้นหลัก, `buildRoutesPayload` ~line 3102)
- Test: `tests/ridge-crossings-wiring.test.ts` (source-grep ใหม่)

**Interfaces:**
- Consumes: `sampleWaveLines`/`countRidgeCrossings` (Task 1), `sampleCesiumPoints`/`withTimeout` (มีอยู่แล้วในไฟล์), state `routeAlternatives`/`selectedRouteIdx`
- Produces: state ใหม่ `mainRouteRidges: RidgeCrossingsResult | null` → payload field `ridgeCrossings` ในเส้น `province_hall`

- [ ] **Step 1: source-grep test (FAIL ก่อน)** — `tests/ridge-crossings-wiring.test.ts`:

```ts
// source-grep — ตรึงว่าการนับลูกเขาต่อสายไฟครบ: วัดจากเส้นหลัก และไปกับ payload บันทึก
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("components/map/CesiumMap.tsx", "utf8");

test("CesiumMap สุ่มความสูง 3 แนวแล้วเรียก countRidgeCrossings", () => {
  assert.match(source, /sampleWaveLines\(/);
  assert.match(source, /countRidgeCrossings\(/);
});

test("ผลนับลูกไปกับ payload เส้นหลัก (ridgeCrossings)", () => {
  const payload = source.slice(source.indexOf("const buildRoutesPayload"));
  assert.match(payload.slice(0, 2500), /ridgeCrossings: mainRouteRidges/);
});

test("การนับผูกกับเส้นทางที่ถูกเลือก (selectedRouteIdx) — เปลี่ยนเส้นแล้วนับใหม่", () => {
  const idx = source.indexOf("sampleWaveLines(");
  const around = source.slice(Math.max(0, idx - 3000), idx + 3000);
  assert.match(around, /selectedRouteIdx|routeCoordsRef/);
});
```

Run: `npx tsx --test tests/ridge-crossings-wiring.test.ts` → FAIL

- [ ] **Step 2: แก้ `CesiumMap.tsx`**

(1) import เพิ่ม:

```ts
import { countRidgeCrossings, sampleWaveLines, type RidgeCrossingsResult } from "@/lib/map/routeWaves";
```

(2) state ใหม่ ข้าง `mainRouteGain`:

```ts
  // ผลนับลูกคลื่นภูเขาบนเส้นทางหลัก — วัดใหม่ทุกครั้งที่เส้นทางที่เลือกเปลี่ยน
  const [mainRouteRidges, setMainRouteRidges] = useState<RidgeCrossingsResult | null>(null);
```

(3) ใน effect เดียวกับที่สุ่ม `mainRouteGain` ของเส้นหลัก (หาโค้ดที่ set `mainRouteGain` จากเส้นทางหลัก — keyed ด้วย `selectedRouteIdx`/route change): หลังได้ gain แล้ว เพิ่มการวัด 3 แนว (best-effort — ล้มเหลวได้โดยไม่ทำให้ route วิเคราะห์พัง):

```ts
      // นับลูกคลื่นภูเขา 3 แนวขนาน — ล้มเหลวเงียบได้ (metric อื่นยังใช้ได้)
      setMainRouteRidges(null);
      try {
        const lines = sampleWaveLines(coords); // coords = [lng,lat][] ของเส้นทางที่เลือก ตัวเดียวกับที่ใช้สุ่ม gain
        if (lines && provider) {
          const sampleLine = async (pts: { lat: number; lng: number }[]) =>
            Array.from(
              await withTimeout(
                sampleCesiumPoints(provider, pts, KEYLESS_SAMPLE_LEVEL),
                ANALYSIS_TIMEOUT_MS,
                "สุ่มความสูงแนวขนานใช้เวลานานเกินไป",
              ),
            );
          const [centerElev, leftElev, rightElev] = await Promise.all([
            sampleLine(lines.center),
            sampleLine(lines.left).catch(() => lines.left.map(() => null as number | null)),
            sampleLine(lines.right).catch(() => lines.right.map(() => null as number | null)),
          ]);
          setMainRouteRidges(countRidgeCrossings(lines, centerElev, leftElev, rightElev));
        }
      } catch {
        setMainRouteRidges(null); // ไม่มีผลนับก็บันทึกส่วนอื่นได้ — มิติ ridges จะเป็น null ฝั่งเกณฑ์
      }
```

(4) `buildRoutesPayload` เส้น `province_hall` เพิ่ม field:

```ts
        ridgeCrossings: mainRouteRidges,
```

และเพิ่ม `mainRouteRidges` เข้า dependency array ของ `useCallback`

(5) แผงแสดงผล: ใกล้บรรทัดที่โชว์ gain/ระยะของเส้นหลัก เพิ่ม:

```tsx
              {mainRouteRidges ? (
                <p className="map-note">
                  ข้ามภูเขา ~{mainRouteRidges.count.toLocaleString("th-TH")} ลูก
                  {" "}(สันเขาจริงที่แนวข้างยืนยัน {mainRouteRidges.confirmedCount.toLocaleString("th-TH")} ลูก)
                </p>
              ) : null}
```

- [ ] **Step 3: ตรวจ**

Run: `npx tsx --test tests/ridge-crossings-wiring.test.ts` → PASS; `npx tsc --noEmit` → เงียบ; เพิ่มไฟล์เทสต์เข้า `package.json` `test` script (ถัดจาก `tests/forest-polygon-layers.test.ts`) แล้ว `npm test` → เขียว

- [ ] **Step 4: ตรวจของจริงบนเบราว์เซอร์** (dev server ผู้ใช้รันที่ :3000 อยู่แล้ว — hot reload)

เปิด `/map?assessment=315` (login admin/admin123 ถ้า session หมด) รอวิเคราะห์เสร็จ แล้วดูว่า (1) มีบรรทัด "ข้ามภูเขา ~N ลูก" (2) console ไม่มี error (3) เปลี่ยนเส้นทาง 1→2 แล้วตัวเลขคำนวณใหม่ — ผ่าน `mcp__Claude_Browser__javascript_tool` อ่าน `.map-note`

- [ ] **Step 5: Commit**

```bash
git add components/map/CesiumMap.tsx tests/ridge-crossings-wiring.test.ts package.json
git commit -m "feat(map): วัดและนับลูกคลื่นภูเขา 3 แนวบนเส้นทางหลัก แล้วส่งไปกับการบันทึก"
```

---

### Task 5: แสดงใน `GisSummary` + อัปเดต CLAUDE.md

**Files:**
- Modify: `components/GisSummary.tsx` (กลุ่มภูมิประเทศ/ตารางเส้นทาง — ตามแพตเทิร์นแถว `mountainPct` ที่มีอยู่)
- Modify: `CLAUDE.md` (ย่อหน้าเกณฑ์ 5 ระดับ — เพิ่มมิติ ridges + คำเตือนยังไม่ calibrate)
- Test: `components/GisSummary.test.tsx` (เพิ่มเคส)

**Interfaces:**
- Consumes: `gis.route.ridgeCrossings` (Task 2), render ผ่าน `renderToStaticMarkup` แบบเทสต์เดิมของไฟล์

- [ ] **Step 1: เทสต์ (FAIL ก่อน)** — ใน `components/GisSummary.test.tsx` (ใช้ fixture gis ตัวเดิมของไฟล์):

```ts
test("แสดงจำนวนลูกเขาที่ข้ามพร้อมพารามิเตอร์ และแถวเก่าแสดงไม่มีข้อมูล", () => {
  const withRidges = structuredClone(baseGis); // fixture เดิมของไฟล์
  withRidges.routes[0].ridgeCrossings = {
    count: 6, confirmedCount: 4, spacingM: 50, sideOffsetM: 200, prominenceM: 50,
    waves: [{ atKm: 3.1, elevM: 900, prominenceM: 150, confirmed: true }],
  };
  const html = renderToStaticMarkup(<GisSummary state={stateWith(withRidges)} />);
  assert.ok(html.includes("ข้ามภูเขา"));
  assert.ok(html.includes("6"));
  assert.ok(html.includes("4"));
  assert.ok(html.includes("±200"));

  const html2 = renderToStaticMarkup(<GisSummary state={stateWith(baseGis)} />);
  const row = html2.slice(html2.indexOf("ข้ามภูเขา"));
  assert.ok(row.includes("ไม่มีข้อมูล"));
});
```

Run: `npx tsx --test components/GisSummary.test.tsx` → FAIL

- [ ] **Step 2: แก้ `GisSummary.tsx`** — ในส่วนที่ render ข้อมูลเส้นทางหลัก (แถวเดียวกับ mountainPct) เพิ่มแถว:

```tsx
        <tr>
          <th>ข้ามภูเขา (ลูก)</th>
          <td>
            {route.ridgeCrossings
              ? `${route.ridgeCrossings.count.toLocaleString("th-TH")} ลูก · สันเขาจริง ${route.ridgeCrossings.confirmedCount.toLocaleString("th-TH")} ลูก (นับที่ prominence ≥${route.ridgeCrossings.prominenceM} ม. · แนวข้าง ±${route.ridgeCrossings.sideOffsetM} ม.)`
              : "ไม่มีข้อมูล"}
          </td>
        </tr>
```

(วางตามโครง markup จริงของตาราง — ถ้าไฟล์ใช้ helper `valueOrMissing` ให้ใช้ตัวนั้นแทน string ตรง ๆ)

- [ ] **Step 3: รันเทสต์ + ทั้งชุด**

Run: `npx tsx --test components/GisSummary.test.tsx` → PASS; `npm test` → เขียว

- [ ] **Step 4: อัปเดต `CLAUDE.md`** — ย่อหน้า "เกณฑ์ความยากลำบากของพื้นที่ 5 ระดับ" ข้อ (3): เพิ่ม `· จำนวนสันเขาจริงที่ข้าม ≥3 (confirmedCount จาก ridgeCrossings — เกณฑ์ตัดยังไม่ calibrate กับประชากรจริง)` ต่อท้ายรายการมิติ และย่อหน้า GIS layer: เพิ่มประโยคว่า `GisRouteAnalysis.ridgeCrossings` เป็น optional field ใหม่ (นับฝั่ง client จาก 3 แนวขนาน ±200 ม., hysteresis 50 ม., server รับผ่าน allowlist ไม่คำนวณซ้ำ)

- [ ] **Step 5: Commit + push**

```bash
git add components/GisSummary.tsx components/GisSummary.test.tsx CLAUDE.md
git commit -m "feat(ui): แสดงจำนวนลูกเขาที่ข้ามใน GisSummary + บันทึกใน CLAUDE.md"
git push
```
