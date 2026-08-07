# ชั้น polygon พื้นที่ป่าบนแผนที่ 3 มิติ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้หน้า `/map` วาดพื้นที่ป่าเป็น polygon ได้ 2 ชั้นแยก checkbox — ชั้นสภาพป่าจริงของกรมป่าไม้ (จากดิสก์) และชั้นป่าทั่วไปจาก OpenStreetMap

**Architecture:** เพิ่ม API ใหม่ `/api/forest-status/polygons` ที่ตัด polygon จาก `data/forest-status/cells-cover/` ตามกรอบรอบจุดวิเคราะห์แล้วส่ง geometry ให้ client (route วิเคราะห์เดิมไม่แตะ), เพิ่มโมดูล client แยกไฟล์สำหรับดึงป่าทั่วไปจาก Overpass, แล้ววาดทั้งสองชั้นใน `CustomDataSource` ของตัวเองใน `CesiumMap.tsx` ตามแพตเทิร์นเดียวกับชั้นแนวเขตป่า OSM ที่มีอยู่แล้ว

**Tech Stack:** Next.js 16 App Router (TypeScript strict) · CesiumJS · node:test + tsx · ไม่มี dependency ใหม่

**สเปกอ้างอิง:** [`docs/superpowers/specs/2026-08-08-forest-polygon-overlay-design.md`](../specs/2026-08-08-forest-polygon-overlay-design.md) — อ่านก่อนเริ่ม โดยเฉพาะ §6 (วงนอก vs รูใน)

## Global Constraints

- **แสดงผลอย่างเดียว** — ห้ามเขียนลง `state.gis`, ห้ามแตะ `lib/scoring.ts` / `lib/terrain-difficulty.ts` / `lib/terrain-signature.ts` ผลคะแนนต้องเท่าเดิมทุกกรณี
- ป่าทั่วไปจาก OSM **ห้ามไหลเข้า** `classifyForestOverlay()` ใน `lib/map/forestBoundaries.ts` (ผลของฟังก์ชันนั้นถูกเก็บเป็นหลักฐานประกอบเกณฑ์) — จึงต้องอยู่คนละไฟล์ คนละ type
- โมดูลใน `lib/map/` ที่ pure ห้าม import `cesium` / `next` / `node:fs` (`lib/map/forest-polygons.ts` และ `lib/map/forest-generic.ts` เป็น pure/client — เฉพาะ route เท่านั้นที่แตะดิสก์ผ่าน `loadForestStatusAround`)
- รัศมีชั้นนี้ = **10,000 ม.** clamp ที่ route เป็น 1,000–10,000
- ปัดพิกัดเหลือ **5 ตำแหน่งทศนิยม** และตัดวงที่มีน้อยกว่า **4 จุด** (Cesium วาดไม่ได้) และตัดพิกัดที่ไม่ใช่จำนวนจำกัด (NaN ทำ renderer พังทั้งหน้า — บทเรียนเดิมจาก polygon-draw)
- checkbox ทั้งสองตัว **ค่าเริ่มต้นปิด**
- ไม่มีข้อมูลในเครื่อง → ตอบ `available: false` **ห้าม 500** (fail soft เหมือน `/api/forest-status` เดิม)
- แสดงเครดิตข้อมูลขณะชั้นเปิด: กรมป่าไม้ (CC-BY) / `© OpenStreetMap contributors` (ODbL — เป็นหน้าที่ตามสัญญาอนุญาต)
- ไฟล์ทดสอบใหม่ต้องเพิ่มชื่อแบบระบุตรงใน `package.json` script `test` (ธรรมเนียมของ repo คือ glob-free)
- ข้อความ UI เป็นภาษาไทย ตามคำในสเปก
- ห้ามใช้ `ClassificationType.TERRAIN` — ใช้ `heightReference: HeightReference.CLAMP_TO_GROUND` + `polyline.clampToGround` แบบเดียวกับชั้นป่า OSM ที่วาดอยู่แล้ว (`CesiumMap.tsx:2326-2344`) เพื่อไม่เพิ่ม import ใหม่และให้พฤติกรรมเหมือนกันทั้งแผนที่

---

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| `lib/map/forest-polygons.ts` (สร้าง) | pure: คำนวณกรอบรอบจุด + กรอง/ทำความสะอาด/ปัดพิกัด polygon ที่จะส่งให้ client |
| `lib/map/forest-polygons.test.ts` (สร้าง) | ทดสอบ pure ข้างบน |
| `app/api/forest-status/polygons/route.ts` (สร้าง) | glue: auth + validate + อ่านชุด `rfd-forest-cover` จากดิสก์ + ส่ง geometry |
| `lib/map/forest-generic.ts` (สร้าง) | client: query + parse ป่าทั่วไปจาก Overpass (แยกจาก `forestBoundaries.ts` โดยเจตนา) |
| `lib/map/forest-generic.test.ts` (สร้าง) | ทดสอบ parse ข้างบน |
| `lib/map/forestBoundaries.ts` (แก้) | export `OVERPASS_ENDPOINTS` / `OVERPASS_TIMEOUT_MS` ให้ไฟล์ใหม่ใช้ร่วม (ไม่ก็อป) |
| `components/map/CesiumMap.tsx` (แก้) | state + datasource + effect ดึง/วาด + checkbox + เครดิต |
| `tests/forest-polygon-layers.test.ts` (สร้าง) | source-grep test ตรึงพฤติกรรมฝั่ง Cesium ที่ทดสอบด้วย runtime ไม่ได้ |
| `package.json` (แก้) | เพิ่ม 3 ไฟล์ทดสอบใน script `test` |
| `CLAUDE.md` (แก้) | บันทึกชั้นใหม่ + ข้อจำกัด §6 |

---

## Task 1: โมดูล pure กรอง polygon ตามกรอบ

**Files:**
- Create: `lib/map/forest-polygons.ts`
- Test: `lib/map/forest-polygons.test.ts`
- Modify: `package.json:20` (เพิ่ม `lib/map/forest-polygons.test.ts` ต่อท้าย script `test`)

**Interfaces:**
- Consumes: ไม่มี (ไฟล์แรกของงานนี้)
- Produces:
  - `type LngLatPair = [number, number]` — `[lng, lat]`
  - `interface LngLatBox { minLng: number; minLat: number; maxLng: number; maxLat: number }`
  - `interface ForestPolygonFeature { rings: LngLatPair[][] }`
  - `boxAround(lat: number, lng: number, radiusM: number): LngLatBox | null`
  - `featuresInBox(features: readonly { rings?: unknown }[], box: LngLatBox | null): ForestPolygonFeature[]`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `lib/map/forest-polygons.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { boxAround, featuresInBox } from "./forest-polygons";

test("boxAround: กรอบกว้างเป็นองศามากขึ้นเมื่อละติจูดสูงขึ้น (ชดเชย cos)", () => {
  const eq = boxAround(0, 100, 10_000);
  const th = boxAround(20, 100, 10_000);
  assert.ok(eq && th);
  const eqWidth = eq.maxLng - eq.minLng;
  const thWidth = th.maxLng - th.minLng;
  assert.ok(thWidth > eqWidth, `คาดว่ากรอบที่ lat 20 กว้างกว่าที่เส้นศูนย์สูตร (${thWidth} vs ${eqWidth})`);
  // ความสูงเป็นองศาเท่ากันทุกละติจูด
  assert.ok(Math.abs(eq.maxLat - eq.minLat - (th.maxLat - th.minLat)) < 1e-9);
});

test("boxAround: อินพุตใช้ไม่ได้ → null", () => {
  assert.equal(boxAround(Number.NaN, 100, 10_000), null);
  assert.equal(boxAround(20, Number.NaN, 10_000), null);
  assert.equal(boxAround(20, 100, 0), null);
  assert.equal(boxAround(20, 100, -5), null);
});

test("featuresInBox: box = null → ว่าง", () => {
  assert.deepEqual(featuresInBox([{ rings: [[[100, 20], [100.1, 20], [100.1, 20.1], [100, 20.1]]] }], null), []);
});

test("featuresInBox: วงที่อยู่นอกกรอบทั้งก้อนถูกตัด", () => {
  const box = boxAround(20, 100, 10_000);
  const far = { rings: [[[105, 15], [105.1, 15], [105.1, 15.1], [105, 15.1]]] };
  assert.deepEqual(featuresInBox([far], box), []);
});

test("featuresInBox: วงที่ใหญ่กว่ากรอบและครอบกรอบไว้ต้องไม่ถูกตัด (โรงเรียนกลางผืนป่าใหญ่)", () => {
  const box = boxAround(20, 100, 10_000);
  const huge = { rings: [[[99, 19], [101, 19], [101, 21], [99, 21]]] };
  assert.equal(featuresInBox([huge], box).length, 1);
});

test("featuresInBox: เก็บวงทั้งวง ไม่ตัดกลางวงที่ขอบกรอบ", () => {
  const box = boxAround(20, 100, 10_000);
  const straddle = { rings: [[[99.99, 19.99], [100.5, 19.99], [100.5, 20.5], [99.99, 20.5]]] };
  const out = featuresInBox([straddle], box);
  assert.equal(out.length, 1);
  assert.equal(out[0].rings[0].length, 4);
});

test("featuresInBox: ปัดพิกัดเหลือ 5 ตำแหน่ง", () => {
  const box = boxAround(20, 100, 10_000);
  const f = { rings: [[[100.123456789, 20.987654321], [100.1, 20.0], [100.05, 20.05], [100.02, 20.02]]] };
  const out = featuresInBox([f], box);
  assert.deepEqual(out[0].rings[0][0], [100.12346, 20.98765]);
});

test("featuresInBox: วงที่เหลือน้อยกว่า 4 จุดถูกตัด และ feature ที่ไม่เหลือวงเลยหายไป", () => {
  const box = boxAround(20, 100, 10_000);
  const f = { rings: [[[100, 20], [100.01, 20], [100.01, 20.01]]] };
  assert.deepEqual(featuresInBox([f], box), []);
});

test("featuresInBox: พิกัด NaN/Infinity/นอกช่วงโลก ถูกตัดทิ้ง", () => {
  const box = boxAround(20, 100, 10_000);
  const f = {
    rings: [
      [
        [100, 20],
        [Number.NaN, 20],
        [100.01, Number.POSITIVE_INFINITY],
        [999, 20],
        [100.01, 20.01],
        [100, 20.01],
        [100.005, 20.005],
      ],
    ],
  };
  const out = featuresInBox([f], box);
  assert.equal(out.length, 1);
  assert.equal(out[0].rings[0].length, 4);
  for (const [lng, lat] of out[0].rings[0]) {
    assert.ok(Number.isFinite(lng) && Number.isFinite(lat));
  }
});

test("featuresInBox: ไม่แก้ไขอินพุต", () => {
  const box = boxAround(20, 100, 10_000);
  const ring = [[100.123456789, 20.987654321], [100.1, 20.0], [100.05, 20.05], [100.02, 20.02]];
  const snapshot = JSON.stringify(ring);
  featuresInBox([{ rings: [ring] }], box);
  assert.equal(JSON.stringify(ring), snapshot);
});

test("featuresInBox: feature ที่ rings ไม่ใช่ array ไม่ทำให้พัง", () => {
  const box = boxAround(20, 100, 10_000);
  assert.deepEqual(featuresInBox([{ rings: undefined }, {}], box), []);
});
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```bash
npx tsx --test lib/map/forest-polygons.test.ts
```

Expected: FAIL — `Cannot find module './forest-polygons'`

- [ ] **Step 3: เขียน implementation ให้น้อยที่สุดที่ทำให้ผ่าน**

สร้าง `lib/map/forest-polygons.ts`:

```ts
// ตัด polygon ชั้นป่าตามกรอบรอบจุดวิเคราะห์ ก่อนส่งให้ client วาด
// pure — ห้าม import cesium / next / node:fs (ทดสอบได้ด้วย node:test ล้วน)
//
// สเปก: docs/superpowers/specs/2026-08-08-forest-polygon-overlay-design.md

/** พิกัดหนึ่งจุด [lng, lat] — เรียงแบบเดียวกับไฟล์ cell และ GeoJSON */
export type LngLatPair = [number, number];

export interface LngLatBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface ForestPolygonFeature {
  rings: LngLatPair[][];
}

/** Cesium วาดรูปปิดไม่ได้ถ้ามีน้อยกว่า 4 จุด */
const MIN_RING_POINTS = 4;
/** 5 ตำแหน่ง ≈ 1.1 ม. — ละเอียดเกินพอสำหรับ overlay และลดขนาด payload ได้มาก */
const COORD_DECIMALS = 5;
const M_PER_DEG_LAT = 111_320;
/** กัน 1/cos ระเบิดใกล้ขั้วโลก (ไทยไม่เจอ แต่ฟังก์ชันต้องไม่คืนค่าอนันต์) */
const MIN_COS_LAT = 0.01;

function round5(value: number): number {
  const factor = 10 ** COORD_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * กรอบสี่เหลี่ยมรอบจุด — ชดเชย cos(lat) ที่ลองจิจูด
 * อินพุตใช้ไม่ได้ (NaN / รัศมี ≤ 0) → null เพื่อให้ปลายทางตอบว่า "ไม่มีอะไรให้วาด" แทนการเดา
 */
export function boxAround(lat: number, lng: number, radiusM: number): LngLatBox | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!Number.isFinite(radiusM) || radiusM <= 0) return null;

  const dLat = radiusM / M_PER_DEG_LAT;
  const cos = Math.max(MIN_COS_LAT, Math.cos((lat * Math.PI) / 180));
  const dLng = radiusM / (M_PER_DEG_LAT * cos);

  return { minLng: lng - dLng, minLat: lat - dLat, maxLng: lng + dLng, maxLat: lat + dLat };
}

function cleanRing(raw: unknown): LngLatPair[] | null {
  if (!Array.isArray(raw)) return null;
  const points: LngLatPair[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const lng = Number(entry[0]);
    const lat = Number(entry[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) continue;
    points.push([round5(lng), round5(lat)]);
  }
  return points.length >= MIN_RING_POINTS ? points : null;
}

/**
 * กรอบของวงตัดกับกรอบที่ขอหรือไม่
 * ใช้กรอบตัดกรอบ ไม่ใช่ "มีจุดยอดอยู่ในกรอบ" — วงใหญ่ที่ครอบจุดวิเคราะห์ไว้ทั้งหมด
 * อาจไม่มีจุดยอดสักจุดอยู่ในรัศมี ซึ่งเป็นกรณีของโรงเรียนที่อยู่กลางผืนป่าใหญ่พอดี
 */
function ringTouchesBox(ring: readonly LngLatPair[], box: LngLatBox): boolean {
  let minLng = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return !(maxLng < box.minLng || minLng > box.maxLng || maxLat < box.minLat || minLat > box.maxLat);
}

/**
 * กรองเฉพาะ polygon ที่แตะกรอบ แล้วคืนวงที่ทำความสะอาด + ปัดพิกัดแล้ว
 * เก็บ "ทั้งวง" ไม่ตัดกลางวงที่ขอบกรอบ — ตัดแล้วขอบผืนป่าจะกลายเป็นเส้นตรงปลอมตามกรอบ
 */
export function featuresInBox(
  features: readonly { rings?: unknown }[],
  box: LngLatBox | null,
): ForestPolygonFeature[] {
  if (!box || !Array.isArray(features)) return [];

  const out: ForestPolygonFeature[] = [];
  for (const feature of features) {
    const rawRings = Array.isArray(feature?.rings) ? feature.rings : [];
    const rings: LngLatPair[][] = [];
    for (const rawRing of rawRings) {
      const ring = cleanRing(rawRing);
      if (ring && ringTouchesBox(ring, box)) rings.push(ring);
    }
    if (rings.length > 0) out.push({ rings });
  }
  return out;
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

```bash
npx tsx --test lib/map/forest-polygons.test.ts
```

Expected: PASS ทุกเคส

- [ ] **Step 5: เพิ่มไฟล์ทดสอบใน `package.json`**

ใน `package.json` script `"test"` เพิ่ม `lib/map/forest-polygons.test.ts` ต่อท้าย (ก่อน `components/GisSummary.test.tsx`) แล้วรัน:

```bash
npm test
```

Expected: PASS ทั้งชุด (เดิม 727 เคส + เคสใหม่)

- [ ] **Step 6: Commit**

```bash
git add lib/map/forest-polygons.ts lib/map/forest-polygons.test.ts package.json
git commit -m "feat(map): โมดูล pure ตัด polygon ชั้นป่าตามกรอบรอบจุดวิเคราะห์"
```

---

## Task 2: API ส่ง geometry ชั้นสภาพป่าจริง

**Files:**
- Create: `app/api/forest-status/polygons/route.ts`
- Reference (อ่านก่อนเขียน ห้ามแก้): `app/api/forest-status/route.ts:1-40` (แพตเทิร์น guard + validate), `lib/map/forest-status-load.ts:100-138`

**Interfaces:**
- Consumes: `boxAround` / `featuresInBox` จาก Task 1; `loadForestStatusAround(lat, lng, radiusM, { authority: "rfd-forest-cover" })` (มีอยู่แล้ว)
- Produces: `GET /api/forest-status/polygons?lat=&lng=&radius=` → JSON
  ```ts
  {
    available: boolean;
    yearBe?: number;
    attribution?: string;
    dataSource?: string;
    radiusM?: number;
    features: { rings: [number, number][][] }[];
    message?: string;
  }
  ```

- [ ] **Step 1: เขียน route**

สร้าง `app/api/forest-status/polygons/route.ts`:

```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { boxAround, featuresInBox } from "@/lib/map/forest-polygons";
import { loadForestStatusAround } from "@/lib/map/forest-status-load";

export const dynamic = "force-dynamic";

const TH_LAT_MIN = 5.0;
const TH_LAT_MAX = 21.0;
const TH_LNG_MIN = 97.0;
const TH_LNG_MAX = 106.0;

const RADIUS_MIN_M = 1_000;
const RADIUS_MAX_M = 10_000;
const RADIUS_DEFAULT_M = 10_000;

/**
 * GET /api/forest-status/polygons?lat=&lng=&radius=
 * geometry ของชั้น "สภาพพื้นที่ป่าจริง" (rfd-forest-cover) สำหรับวาดบนแผนที่เท่านั้น
 *
 * แยกจาก /api/forest-status ตั้งใจ: route นั้นถูกเรียกทุกครั้งที่ย้ายหมุด
 * ถ้ายัด geometry รวมเข้าไป payload จะบวมทุกครั้งแม้ผู้ใช้ไม่ได้เปิดชั้นนี้
 */
export async function GET(request: NextRequest) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const sp = request.nextUrl.searchParams;
  const lat = Number(sp.get("lat"));
  const lng = Number(sp.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "ต้องระบุ lat,lng" }, { status: 400 });
  }
  if (lat < TH_LAT_MIN || lat > TH_LAT_MAX || lng < TH_LNG_MIN || lng > TH_LNG_MAX) {
    return NextResponse.json({ error: "พิกัดนอกประเทศไทย" }, { status: 400 });
  }

  const radiusRaw = Number(sp.get("radius"));
  const radiusM = Number.isFinite(radiusRaw)
    ? Math.min(RADIUS_MAX_M, Math.max(RADIUS_MIN_M, radiusRaw))
    : RADIUS_DEFAULT_M;

  const doc = await loadForestStatusAround(lat, lng, radiusM, { authority: "rfd-forest-cover" });
  if (!doc) {
    // ไม่ได้ติดตั้งชุดข้อมูล — ตอบเป็นสถานะ ไม่ใช่ error เพื่อให้ชั้นอื่นบนแผนที่ทำงานต่อได้
    return NextResponse.json({
      available: false,
      features: [],
      message: "ยังไม่ได้ติดตั้งชั้นสภาพพื้นที่ป่า — รัน scripts/install-rfd-forest-cover.py (ดู data/forest-status/README.md)",
    });
  }

  const features = featuresInBox(doc.features, boxAround(lat, lng, radiusM));

  return NextResponse.json({
    available: true,
    yearBe: doc.yearBe,
    attribution: doc.attribution,
    dataSource: doc.dataSource,
    radiusM,
    features,
  });
}
```

- [ ] **Step 2: ตรวจว่า type-check ผ่าน**

หยุด dev server ก่อนถ้ารันอยู่ (ทั้งคู่เขียน `.next/` ทับกัน) แล้ว:

```bash
npm run build
```

Expected: build ผ่าน ไม่มี type error และมี route `/api/forest-status/polygons` ในรายการ

- [ ] **Step 3: ยิงจริงด้วยเบราว์เซอร์ที่ล็อกอินแล้ว**

รัน `npm run dev` แล้วเปิด (ต้องล็อกอินอยู่ในแท็บเดียวกัน — route ผ่าน `requireApiUser`):

```
http://localhost:3000/api/forest-status/polygons?lat=20.28&lng=99.72&radius=10000
```

Expected: `available: true`, `yearBe: 2562`, `features` มีประมาณ 100 รายการ (ตัวเลขที่วัดไว้ในสเปก §3 คือ 101 polygon ที่รัศมี 10 กม.), `attribution` ขึ้นต้นด้วย "กรมป่าไม้"

ถ้าได้ `available: false` แปลว่าเครื่องนี้ยังไม่มี `data/forest-status/cells-cover/` — ตรวจก่อนว่าโฟลเดอร์มีจริงก่อนไปต่อ

- [ ] **Step 4: ตรวจว่าไม่ทะลุ clamp**

```
http://localhost:3000/api/forest-status/polygons?lat=20.28&lng=99.72&radius=500000
```

Expected: `radiusM: 10000` ใน response (ไม่ใช่ 500000)

- [ ] **Step 5: Commit**

```bash
git add app/api/forest-status/polygons/route.ts
git commit -m "feat(api): route ส่ง geometry ชั้นสภาพพื้นที่ป่าจริงสำหรับวาดบนแผนที่"
```

---

## Task 3: โมดูลดึงป่าทั่วไปจาก OpenStreetMap

**Files:**
- Create: `lib/map/forest-generic.ts`
- Test: `lib/map/forest-generic.test.ts`
- Modify: `lib/map/forestBoundaries.ts:116-117` (เปลี่ยน `const OVERPASS_ENDPOINTS` / `const OVERPASS_TIMEOUT_MS` เป็น `export const` — ไม่แก้ค่า)
- Modify: `package.json:20`

**Interfaces:**
- Consumes: `OVERPASS_ENDPOINTS`, `OVERPASS_TIMEOUT_MS` จาก `./forestBoundaries`
- Produces:
  - `interface GenericForestArea { rings: [number, number][][] }`
  - `GENERIC_FOREST_ATTRIBUTION: string`
  - `overpassGenericForestQuery(lat: number, lng: number, radiusM: number): string`
  - `parseOverpassGenericForest(raw: unknown): GenericForestArea[]`
  - `fetchGenericForest(lat: number, lng: number, radiusM: number, signal?: AbortSignal): Promise<GenericForestArea[]>`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `lib/map/forest-generic.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { overpassGenericForestQuery, parseOverpassGenericForest } from "./forest-generic";

test("query: ถามทั้ง natural=wood และ landuse=forest ทั้ง way และ relation ในรัศมีที่ขอ", () => {
  const q = overpassGenericForestQuery(20.28, 99.72, 10_000);
  assert.match(q, /way\["natural"="wood"\]\(around:10000,20\.28,99\.72\);/);
  assert.match(q, /way\["landuse"="forest"\]\(around:10000,20\.28,99\.72\);/);
  assert.match(q, /relation\["natural"="wood"\]\(around:10000,20\.28,99\.72\);/);
  assert.match(q, /relation\["landuse"="forest"\]\(around:10000,20\.28,99\.72\);/);
  assert.match(q, /out geom;/);
});

test("parse: way ที่มี geometry → 1 วง และแปลงเป็น [lng, lat]", () => {
  const out = parseOverpassGenericForest({
    elements: [
      {
        type: "way",
        geometry: [
          { lat: 20.0, lon: 99.0 },
          { lat: 20.0, lon: 99.1 },
          { lat: 20.1, lon: 99.1 },
          { lat: 20.1, lon: 99.0 },
        ],
      },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].rings.length, 1);
  assert.deepEqual(out[0].rings[0][0], [99.0, 20.0]);
});

test("parse: relation หลาย member → หลายวง", () => {
  const ring = (offset: number) => [
    { lat: 20.0 + offset, lon: 99.0 },
    { lat: 20.0 + offset, lon: 99.1 },
    { lat: 20.1 + offset, lon: 99.1 },
    { lat: 20.1 + offset, lon: 99.0 },
  ];
  const out = parseOverpassGenericForest({
    elements: [
      {
        type: "relation",
        members: [
          { type: "way", role: "outer", geometry: ring(0) },
          { type: "way", role: "outer", geometry: ring(1) },
        ],
      },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].rings.length, 2);
});

test("parse: member role inner ถูกตัด (รูในผืนป่า OSM ระบุไว้ชัด จึงไม่ถม)", () => {
  const ring = [
    { lat: 20.0, lon: 99.0 },
    { lat: 20.0, lon: 99.1 },
    { lat: 20.1, lon: 99.1 },
    { lat: 20.1, lon: 99.0 },
  ];
  const out = parseOverpassGenericForest({
    elements: [
      {
        type: "relation",
        members: [
          { type: "way", role: "outer", geometry: ring },
          { type: "way", role: "inner", geometry: ring },
        ],
      },
    ],
  });
  assert.equal(out[0].rings.length, 1);
});

test("parse: element ที่ไม่มี geometry หรือมีน้อยกว่า 4 จุด ถูกตัด", () => {
  const out = parseOverpassGenericForest({
    elements: [
      { type: "way" },
      { type: "way", geometry: [{ lat: 20, lon: 99 }, { lat: 20, lon: 99.1 }] },
      { type: "node", lat: 20, lon: 99 },
    ],
  });
  assert.deepEqual(out, []);
});

test("parse: อินพุตพัง → ว่าง ไม่ throw", () => {
  assert.deepEqual(parseOverpassGenericForest(null), []);
  assert.deepEqual(parseOverpassGenericForest({}), []);
  assert.deepEqual(parseOverpassGenericForest({ elements: "nope" }), []);
});
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```bash
npx tsx --test lib/map/forest-generic.test.ts
```

Expected: FAIL — `Cannot find module './forest-generic'`

- [ ] **Step 3: เปิด export ค่าคงที่ Overpass ที่ใช้ร่วม**

ใน `lib/map/forestBoundaries.ts` บรรทัด 116-117 เปลี่ยนเป็น:

```ts
export const OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
export const OVERPASS_TIMEOUT_MS = 30_000;
```

(เปลี่ยนแค่คำว่า `export` — ค่าต้องเท่าเดิม เพราะ endpoint หลักล่มเป็นครั้งคราวและ fallback ตัวที่สองคือตัวที่ใช้งานได้จริงตอนวัดข้อมูลในสเปก)

- [ ] **Step 4: เขียน implementation**

สร้าง `lib/map/forest-generic.ts`:

```ts
// ป่าทั่วไปจาก OpenStreetMap (natural=wood / landuse=forest) — overlay สำหรับ "ดู" เท่านั้น
//
// แยกจาก lib/map/forestBoundaries.ts โดยเจตนา ไม่ใช่เพื่อจัดระเบียบไฟล์:
// ผลของ classifyForestOverlay() ในไฟล์นั้นถูกเก็บเป็นหลักฐานประกอบเกณฑ์ (gis.forestOverlay)
// ป่าทั่วไปใน OSM ไม่ใช่เขตประกาศและไม่ใช่ชั้นสภาพป่าราชการ ถ้าปนเข้าไปจะกลายเป็นหลักฐานปลอม
//
// ข้อมูล ODbL 1.0 — หน้าที่แสดงผลต้องขึ้นเครดิต "© OpenStreetMap contributors"
// สเปก: docs/superpowers/specs/2026-08-08-forest-polygon-overlay-design.md

import { OVERPASS_ENDPOINTS, OVERPASS_TIMEOUT_MS } from "./forestBoundaries";

/** วง [lng, lat][] — ไม่มีชื่อ ไม่มีชนิด เพราะ OSM ป่าทั่วไปส่วนใหญ่ไม่มีแท็กชื่อ */
export interface GenericForestArea {
  rings: [number, number][][];
}

export const GENERIC_FOREST_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";

const MIN_RING_POINTS = 4;
const CACHE_LIMIT = 20;
const cache = new Map<string, GenericForestArea[]>();

function cacheKey(lat: number, lng: number, radiusM: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)},${Math.round(radiusM)}`;
}

export function overpassGenericForestQuery(lat: number, lng: number, radiusM: number): string {
  const at = `around:${Math.round(radiusM)},${lat},${lng}`;
  return [
    "[out:json][timeout:28];(",
    `way["natural"="wood"](${at});`,
    `way["landuse"="forest"](${at});`,
    `relation["natural"="wood"](${at});`,
    `relation["landuse"="forest"](${at});`,
    ");out geom;",
  ].join("");
}

function toRing(raw: unknown): [number, number][] | null {
  if (!Array.isArray(raw)) return null;
  const points: [number, number][] = [];
  for (const entry of raw) {
    const point = (entry ?? {}) as Record<string, unknown>;
    const lat = Number(point.lat);
    const lng = Number(point.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    points.push([lng, lat]);
  }
  return points.length >= MIN_RING_POINTS ? points : null;
}

export function parseOverpassGenericForest(raw: unknown): GenericForestArea[] {
  const doc = (raw ?? {}) as Record<string, unknown>;
  const elements = Array.isArray(doc.elements) ? doc.elements : [];

  const areas: GenericForestArea[] = [];
  for (const entry of elements) {
    const element = (entry ?? {}) as Record<string, unknown>;

    if (element.type === "way") {
      const ring = toRing(element.geometry);
      if (ring) areas.push({ rings: [ring] });
      continue;
    }

    if (element.type !== "relation") continue;
    const members = Array.isArray(element.members) ? element.members : [];
    const rings: [number, number][][] = [];
    for (const memberRaw of members) {
      const member = (memberRaw ?? {}) as Record<string, unknown>;
      if (member.type !== "way") continue;
      // OSM ระบุ role ไว้ชัด จึงตัด inner ออกได้จริง (ต่างจากชุด shapefile กรมป่าไม้ ดูสเปก §6)
      if (member.role !== "outer" && member.role !== "") continue;
      const ring = toRing(member.geometry);
      if (ring) rings.push(ring);
    }
    if (rings.length > 0) areas.push({ rings });
  }
  return areas;
}

export async function fetchGenericForest(
  lat: number,
  lng: number,
  radiusM: number,
  signal?: AbortSignal,
): Promise<GenericForestArea[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("พิกัดสำหรับดึงพื้นที่ป่าไม่ถูกต้อง");
  }

  const key = cacheKey(lat, lng, radiusM);
  const cached = cache.get(key);
  if (cached) return cached;

  const query = overpassGenericForestQuery(lat, lng, radiusM);
  let lastError: unknown = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const timeout = AbortSignal.timeout(OVERPASS_TIMEOUT_MS);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) throw new Error(`Overpass ตอบ ${response.status}`);
      const areas = parseOverpassGenericForest(await response.json());
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      cache.set(key, areas);
      return areas;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }

  throw new Error(
    lastError instanceof Error
      ? `โหลดพื้นที่ป่าจาก OpenStreetMap ไม่สำเร็จ: ${lastError.message}`
      : "โหลดพื้นที่ป่าจาก OpenStreetMap ไม่สำเร็จ",
  );
}
```

- [ ] **Step 5: รันเทสต์ให้ผ่าน**

```bash
npx tsx --test lib/map/forest-generic.test.ts
```

Expected: PASS ทุกเคส

- [ ] **Step 6: เพิ่มไฟล์ทดสอบใน `package.json` แล้วรันทั้งชุด**

เพิ่ม `lib/map/forest-generic.test.ts` ใน script `test` แล้ว:

```bash
npm test
```

Expected: PASS ทั้งชุด (เทสต์เดิมของ `forestBoundaries` ต้องยังผ่าน — การเติม `export` ไม่เปลี่ยนพฤติกรรม)

- [ ] **Step 7: Commit**

```bash
git add lib/map/forest-generic.ts lib/map/forest-generic.test.ts lib/map/forestBoundaries.ts package.json
git commit -m "feat(map): โมดูลดึงป่าทั่วไปจาก OpenStreetMap แยกจากชั้นแนวเขตคุ้มครอง"
```

---

## Task 4: วาดชั้นสภาพป่าจริงบนแผนที่

**Files:**
- Modify: `components/map/CesiumMap.tsx` (ค่าคงที่ ~บรรทัด 237, refs ~651, datasource ~944 + cleanup ~1001, effect ใหม่หลัง ~2357, UI ~3957)
- Create: `tests/forest-polygon-layers.test.ts`
- Modify: `package.json:20`

**Interfaces:**
- Consumes: `ForestPolygonFeature` จาก Task 1; `GET /api/forest-status/polygons` จาก Task 2
- Produces: state `showForestCover` + datasource `forestCover` ที่ Task 5 จะวางชั้น OSM ขนานกัน

- [ ] **Step 1: เขียน source-grep test ที่ยังไม่ผ่าน**

repo ใช้แพตเทิร์นนี้ตรึงพฤติกรรมฝั่ง Cesium ที่รันทดสอบไม่ได้ (ดู `tests/route-elevation-flags.test.ts` เป็นตัวอย่าง) สร้าง `tests/forest-polygon-layers.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("components/map/CesiumMap.tsx", "utf8");

test("ชั้นสภาพป่าจริงปิดเป็นค่าเริ่มต้น", () => {
  assert.match(source, /const \[showForestCover, setShowForestCover\] = useState\(false\)/);
});

test("ดึง geometry จาก route ที่แยกไว้ ไม่ใช่ route วิเคราะห์เดิม", () => {
  assert.match(source, /\/api\/forest-status\/polygons\?/);
});

test("polygon ป่าทาบภูมิประเทศ ไม่ลอยเหนือพื้น", () => {
  const draw = source.slice(source.indexOf("forest-cover-"));
  assert.match(draw.slice(0, 1200), /heightReference: HeightReference\.CLAMP_TO_GROUND/);
  assert.match(draw.slice(0, 1200), /clampToGround: true/);
});

test("แสดงเครดิตข้อมูลกรมป่าไม้เมื่อเปิดชั้น (CC-BY กำหนดให้ต้องแสดง)", () => {
  assert.match(source, /forestCoverCredit/);
});

test("ยกเลิกคำขอที่ค้างเมื่อย้ายหมุด/ปิดชั้น", () => {
  const effect = source.slice(source.indexOf("showForestCover, center.lat"));
  assert.ok(effect.length > 0, "effect ต้อง keyed ด้วย showForestCover + center");
  const before = source.slice(0, source.indexOf("showForestCover, center.lat"));
  assert.match(before.slice(-2000), /controller\.abort\(\)/);
});
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```bash
npx tsx --test tests/forest-polygon-layers.test.ts
```

Expected: FAIL ทุกเคส (ยังไม่มี `showForestCover` ใน source)

- [ ] **Step 3: เพิ่มค่าคงที่**

ใน `components/map/CesiumMap.tsx` ใต้บล็อก `FOREST_KIND_COLORS` (~บรรทัด 237-250) เพิ่ม:

```ts
/** รัศมีที่ดึง polygon ป่ามาวาด — ตรงกับ clamp ฝั่ง route */
const FOREST_POLYGON_RADIUS_M = 10_000;
/** สภาพป่าจริง (กรมป่าไม้) — เขียวเข้ม แยกจากโทนของชั้นแนวเขตคุ้มครอง */
const FOREST_COVER_COLOR = "#16a34a";
const FOREST_COVER_LINE_COLOR = "#15803d";
/** ป่าทั่วไป (OSM) — เขียวอมเหลือง ให้ต่างจากชั้นสภาพป่าจริงด้วยตาเปล่า */
const FOREST_GENERIC_COLOR = "#84cc16";
const FOREST_GENERIC_LINE_COLOR = "#4d7c0f";
```

- [ ] **Step 4: เพิ่ม import, ref, state**

import (รวมกับ import ของ `lib/map/` ที่มีอยู่):

```ts
import type { ForestPolygonFeature } from "@/lib/map/forest-polygons";
```

ref (ใกล้ `forestDsRef` ~บรรทัด 651):

```ts
const forestCoverDsRef = useRef<CustomDataSource | null>(null); // สภาพพื้นที่ป่าจริง (กรมป่าไม้)
```

state (ใกล้ `showForestBoundaries` ~บรรทัด 735):

```ts
// สภาพพื้นที่ป่าจริง (กรมป่าไม้) — วาดจาก geometry ที่เซิร์ฟเวอร์ตัดมาให้ ปิดเป็นค่าเริ่มต้น
const [showForestCover, setShowForestCover] = useState(false);
const [forestCoverPolys, setForestCoverPolys] = useState<ForestPolygonFeature[] | null>(null);
const [forestCoverCredit, setForestCoverCredit] = useState("");
const [forestCoverLoading, setForestCoverLoading] = useState(false);
const [forestCoverErr, setForestCoverErr] = useState("");
```

- [ ] **Step 5: สร้าง datasource + cleanup**

ใต้บล็อก `const forestDs = new CustomDataSource("forest")` (~บรรทัด 944):

```ts
const forestCoverDs = new CustomDataSource("forestCover");
void viewer.dataSources.add(forestCoverDs);
forestCoverDsRef.current = forestCoverDs;
```

และใน cleanup ใต้ `forestDsRef.current = null;` (~บรรทัด 1001):

```ts
forestCoverDsRef.current = null;
```

- [ ] **Step 6: เพิ่ม effect ดึงข้อมูล + effect วาด**

วางต่อจาก effect วาดชั้นแนวเขตป่าเดิม (จบที่ ~บรรทัด 2357):

```ts
// ── สภาพพื้นที่ป่าจริง (กรมป่าไม้) — geometry สำหรับวาดเท่านั้น ไม่เข้าคะแนน ──
useEffect(() => {
  if (!showForestCover || status !== "ready" || national) {
    setForestCoverPolys(null);
    setForestCoverCredit("");
    setForestCoverErr("");
    return;
  }

  const controller = new AbortController();
  setForestCoverLoading(true);
  setForestCoverErr("");
  const q = new URLSearchParams({
    lat: String(center.lat),
    lng: String(center.lng),
    radius: String(FOREST_POLYGON_RADIUS_M),
  });
  fetch(`/api/forest-status/polygons?${q.toString()}`, { signal: controller.signal })
    .then((r) => r.json())
    .then((data: { available?: boolean; attribution?: string; features?: ForestPolygonFeature[]; message?: string }) => {
      if (controller.signal.aborted) return;
      if (!data.available) {
        setForestCoverPolys(null);
        setForestCoverCredit("");
        setForestCoverErr(data.message || "ยังไม่ได้ติดตั้งชั้นสภาพพื้นที่ป่าในเซิร์ฟเวอร์");
        return;
      }
      setForestCoverPolys(data.features ?? []);
      setForestCoverCredit(data.attribution ?? "");
    })
    .catch((e: unknown) => {
      if (controller.signal.aborted) return;
      setForestCoverPolys(null);
      setForestCoverCredit("");
      setForestCoverErr(e instanceof Error ? e.message : "โหลดพื้นที่ป่าไม่สำเร็จ");
    })
    .finally(() => {
      if (!controller.signal.aborted) setForestCoverLoading(false);
    });

  return () => controller.abort();
}, [showForestCover, center.lat, center.lng, national, status]);

useEffect(() => {
  const ds = forestCoverDsRef.current;
  if (!ds || status !== "ready") return;
  ds.entities.removeAll();
  if (national || !showForestCover || !forestCoverPolys) return;

  forestCoverPolys.forEach((feature, featureIndex) => {
    feature.rings.forEach((ring, ringIndex) => {
      const positions = ring.map(([lng, lat]) => Cartesian3.fromDegrees(lng, lat));
      ds.entities.add({
        id: `forest-cover-${featureIndex}-${ringIndex}`,
        polyline: {
          positions,
          clampToGround: true,
          width: 2,
          material: Color.fromCssColorString(FOREST_COVER_LINE_COLOR).withAlpha(0.9),
        },
        polygon: {
          hierarchy: positions,
          material: Color.fromCssColorString(FOREST_COVER_COLOR).withAlpha(0.2),
          outline: false,
          heightReference: HeightReference.CLAMP_TO_GROUND,
        },
      });
    });
  });
}, [forestCoverPolys, showForestCover, national, status]);
```

- [ ] **Step 7: เพิ่ม checkbox + เครดิตใน UI**

แทรกก่อน `<label className="map-border-toggle">` ของชั้น Legal (~บรรทัด 3958):

```tsx
<label className="map-border-toggle">
  <input
    type="checkbox"
    checked={showForestCover}
    onChange={(e) => setShowForestCover(e.target.checked)}
  />
  <span>แสดงพื้นที่ป่าจริงบนแผนที่ (กรมป่าไม้ · ชั้น Status)</span>
</label>
{showForestCover ? (
  <>
    {forestCoverLoading ? <p className="map-note">กำลังโหลดพื้นที่ป่า…</p> : null}
    {forestCoverErr ? <p className="map-note map-note-error">{forestCoverErr}</p> : null}
    {!forestCoverLoading && forestCoverPolys ? (
      <>
        <p className="map-note">
          วาด {forestCoverPolys.length.toLocaleString("th-TH")} ผืนในรัศมี{" "}
          {(FOREST_POLYGON_RADIUS_M / 1000).toLocaleString("th-TH")} กม.
        </p>
        <p className="map-note map-note-warn">
          ชุดข้อมูลไม่ได้แยก “ขอบนอก” กับ “รูใน” และตัวคำนวณเกณฑ์ก็นับทุกวงเป็นป่า
          ภาพนี้จึงถมพื้นที่โล่งกลางผืนป่าด้วย เพื่อให้ตรงกับตัวเลขสัดส่วนด้านบน
        </p>
        {forestCoverCredit ? <p className="map-note map-note-credit">{forestCoverCredit}</p> : null}
      </>
    ) : null}
  </>
) : null}
```

- [ ] **Step 8: รันเทสต์ + build**

```bash
npx tsx --test tests/forest-polygon-layers.test.ts
```

Expected: PASS ทุกเคส

```bash
npm run build
```

Expected: build ผ่าน (หยุด dev server ก่อน)

- [ ] **Step 9: ตรวจด้วยตาบนแผนที่**

`npm run dev` → เปิด `/map` ด้วยบัญชีโรงเรียนบ้านพญาไพร → ติ๊ก “แสดงพื้นที่ป่าจริงบนแผนที่”

Expected:
- เห็น polygon เขียวโปร่งทาบภูมิประเทศ (ไม่ลอย ไม่แบนทะลุเขา)
- ตัวเลข “วาด N ผืน” สอดคล้องกับที่ route ตอบใน Task 2 Step 3
- ลากหมุดไปที่อื่น → ชั้นตามไป
- ปิด checkbox → polygon หายหมด
- **ถ้าภาพแสดงป่ารอบโรงเรียนเต็มไปหมด แต่แผงด้านบนยังบอกสัดส่วน 1 กม. = 0%** → หยุด อย่าไปต่อ นั่นคือสัญญาณว่า `/api/forest-status` อ่านผิดชุดข้อมูล (ดูสเปก §8) ให้บันทึกไว้และรายงาน

- [ ] **Step 10: Commit**

```bash
git add components/map/CesiumMap.tsx tests/forest-polygon-layers.test.ts package.json
git commit -m "feat(map): ชั้นแสดงพื้นที่ป่าจริงของกรมป่าไม้เป็น polygon บนแผนที่ 3 มิติ"
```

---

## Task 5: วาดชั้นป่าทั่วไปจาก OpenStreetMap

**Files:**
- Modify: `components/map/CesiumMap.tsx` (ref, state, datasource + cleanup, effect, UI — ขนานกับ Task 4)
- Modify: `tests/forest-polygon-layers.test.ts`

**Interfaces:**
- Consumes: `fetchGenericForest`, `GenericForestArea`, `GENERIC_FOREST_ATTRIBUTION` จาก Task 3
- Produces: ไม่มีของที่ task ถัดไปเรียกใช้

- [ ] **Step 1: เพิ่มเทสต์ที่ยังไม่ผ่าน**

เพิ่มท้าย `tests/forest-polygon-layers.test.ts`:

```ts
test("ชั้นป่าทั่วไป OSM ปิดเป็นค่าเริ่มต้น", () => {
  assert.match(source, /const \[showForestGeneric, setShowForestGeneric\] = useState\(false\)/);
});

test("ป่าทั่วไปดึงผ่านโมดูลที่แยกไว้ ไม่ผ่าน classifyForestOverlay", () => {
  assert.match(source, /fetchGenericForest\(/);
  const generic = source.slice(source.indexOf("fetchGenericForest("));
  assert.doesNotMatch(generic.slice(0, 1500), /classifyForestOverlay/);
});

test("แสดงเครดิต OpenStreetMap เมื่อเปิดชั้นป่าทั่วไป (ODbL กำหนดให้ต้องแสดง)", () => {
  assert.match(source, /GENERIC_FOREST_ATTRIBUTION/);
});

test("ป่าทั่วไปวาดคนละสีกับสภาพป่าจริง", () => {
  assert.match(source, /const FOREST_GENERIC_COLOR = "#84cc16"/);
  assert.match(source, /const FOREST_COVER_COLOR = "#16a34a"/);
});
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```bash
npx tsx --test tests/forest-polygon-layers.test.ts
```

Expected: 4 เคสใหม่ FAIL, เคสของ Task 4 ยัง PASS

- [ ] **Step 3: เพิ่ม import, ref, state**

```ts
import { fetchGenericForest, GENERIC_FOREST_ATTRIBUTION } from "@/lib/map/forest-generic";
import type { GenericForestArea } from "@/lib/map/forest-generic";
```

ref (ใต้ `forestCoverDsRef`):

```ts
const forestGenericDsRef = useRef<CustomDataSource | null>(null); // ป่าทั่วไป (OSM)
```

state (ใต้ state ของ Task 4):

```ts
// ป่าทั่วไปจาก OSM — ข้อมูลไม่ครบและไม่ใช่ชั้นราชการ ใช้ดูประกอบเท่านั้น ปิดเป็นค่าเริ่มต้น
const [showForestGeneric, setShowForestGeneric] = useState(false);
const [forestGenericAreas, setForestGenericAreas] = useState<GenericForestArea[] | null>(null);
const [forestGenericLoading, setForestGenericLoading] = useState(false);
const [forestGenericErr, setForestGenericErr] = useState("");
```

- [ ] **Step 4: datasource + cleanup**

ใต้ `forestCoverDs`:

```ts
const forestGenericDs = new CustomDataSource("forestGeneric");
void viewer.dataSources.add(forestGenericDs);
forestGenericDsRef.current = forestGenericDs;
```

cleanup:

```ts
forestGenericDsRef.current = null;
```

- [ ] **Step 5: effect ดึง + effect วาด**

วางต่อจาก effect ของ Task 4:

```ts
// ── ป่าทั่วไป (OSM) — overlay อ้างอิง ไม่เข้าหลักฐานและไม่เข้าคะแนน ────────────
useEffect(() => {
  if (!showForestGeneric || status !== "ready" || national) {
    setForestGenericAreas(null);
    setForestGenericErr("");
    return;
  }

  const controller = new AbortController();
  setForestGenericLoading(true);
  setForestGenericErr("");
  fetchGenericForest(center.lat, center.lng, FOREST_POLYGON_RADIUS_M, controller.signal)
    .then((areas) => {
      if (controller.signal.aborted) return;
      setForestGenericAreas(areas);
    })
    .catch((e: unknown) => {
      if (controller.signal.aborted) return;
      setForestGenericAreas(null);
      setForestGenericErr(e instanceof Error ? e.message : "โหลดพื้นที่ป่าจาก OpenStreetMap ไม่สำเร็จ");
    })
    .finally(() => {
      if (!controller.signal.aborted) setForestGenericLoading(false);
    });

  return () => controller.abort();
}, [showForestGeneric, center.lat, center.lng, national, status]);

useEffect(() => {
  const ds = forestGenericDsRef.current;
  if (!ds || status !== "ready") return;
  ds.entities.removeAll();
  if (national || !showForestGeneric || !forestGenericAreas) return;

  forestGenericAreas.forEach((area, areaIndex) => {
    area.rings.forEach((ring, ringIndex) => {
      const positions = ring.map(([lng, lat]) => Cartesian3.fromDegrees(lng, lat));
      ds.entities.add({
        id: `forest-generic-${areaIndex}-${ringIndex}`,
        polyline: {
          positions,
          clampToGround: true,
          width: 2,
          material: Color.fromCssColorString(FOREST_GENERIC_LINE_COLOR).withAlpha(0.9),
        },
        polygon: {
          hierarchy: positions,
          material: Color.fromCssColorString(FOREST_GENERIC_COLOR).withAlpha(0.2),
          outline: false,
          heightReference: HeightReference.CLAMP_TO_GROUND,
        },
      });
    });
  });
}, [forestGenericAreas, showForestGeneric, national, status]);
```

- [ ] **Step 6: UI**

แทรกใต้บล็อก UI ของ Task 4:

```tsx
<label className="map-border-toggle">
  <input
    type="checkbox"
    checked={showForestGeneric}
    onChange={(e) => setShowForestGeneric(e.target.checked)}
  />
  <span>แสดงป่าทั่วไปจาก OpenStreetMap (อ้างอิง · ไม่ครบ)</span>
</label>
{showForestGeneric ? (
  <>
    {forestGenericLoading ? <p className="map-note">กำลังโหลดป่าทั่วไปจาก OpenStreetMap…</p> : null}
    {forestGenericErr ? <p className="map-note map-note-error">{forestGenericErr}</p> : null}
    {!forestGenericLoading && forestGenericAreas ? (
      <>
        <p className="map-note">
          วาด {forestGenericAreas.length.toLocaleString("th-TH")} ผืนในรัศมี{" "}
          {(FOREST_POLYGON_RADIUS_M / 1000).toLocaleString("th-TH")} กม.
        </p>
        <p className="map-note map-note-warn">
          ป่าที่อาสาสมัครแท็กไว้ใน OpenStreetMap เท่านั้น ไม่ครบและไม่ใช่ชั้นราชการ —
          พื้นที่ที่ไม่มีเส้นในชั้นนี้ไม่ได้แปลว่าไม่ใช่ป่า ให้ยึดชั้นกรมป่าไม้เป็นหลัก
        </p>
        <p className="map-note map-note-credit">{GENERIC_FOREST_ATTRIBUTION}</p>
      </>
    ) : null}
  </>
) : null}
```

- [ ] **Step 7: รันเทสต์ + build**

```bash
npx tsx --test tests/forest-polygon-layers.test.ts
```

Expected: PASS ทุกเคส

```bash
npm run build
```

Expected: build ผ่าน

- [ ] **Step 8: ตรวจด้วยตาบนแผนที่**

`npm run dev` → `/map` → เปิดทั้งสอง checkbox พร้อมกัน

Expected:
- สองชั้นแยกสีออกจากกันชัด และแยกจากเส้นชั้นแนวเขตคุ้มครองเดิม
- ชั้น OSM มีน้อยกว่าชั้นกรมป่าไม้มาก (ที่บ้านพญาไพรวัดได้ 8 ก้อน เทียบกับ 101) — **นี่คือผลที่ถูกต้อง ไม่ใช่บั๊ก**
- ปิดทีละชั้นแล้วอีกชั้นยังอยู่ครบ

- [ ] **Step 9: Commit**

```bash
git add components/map/CesiumMap.tsx tests/forest-polygon-layers.test.ts
git commit -m "feat(map): ชั้นป่าทั่วไปจาก OpenStreetMap เป็น overlay แยก checkbox"
```

---

## Task 6: ตรวจครบวงจร + เอกสาร

**Files:**
- Modify: `CLAUDE.md` (บล็อก `**ชั้นป่า 2 ชุด (data/forest-status/)**`)

- [ ] **Step 1: รันชุดทดสอบเต็ม**

```bash
npm test
```

Expected: PASS ทั้งหมด รวมไฟล์ใหม่ 3 ไฟล์ — ถ้ามีเคสเดิมแดง ห้ามแก้เทสต์ให้ผ่าน ให้ย้อนดูว่าโค้ดใหม่ไปกระทบอะไร

- [ ] **Step 2: ยืนยันว่าคะแนนไม่เปลี่ยน**

```bash
npx tsx --test tests/scoring.test.ts tests/gis.test.ts lib/terrain-difficulty.test.ts lib/terrain-signature.test.ts
```

Expected: PASS — งานนี้เป็น display-only ถ้าไฟล์เหล่านี้แดงแปลว่ามีอะไรรั่วเข้าไปในเส้นทางคะแนน

- [ ] **Step 3: build**

```bash
npm run build
```

Expected: ผ่าน ไม่มี type error

- [ ] **Step 4: อัปเดต `CLAUDE.md`**

ในบล็อกชั้นป่า 2 ชุด เพิ่มย่อหน้าท้ายบล็อก:

```markdown
**การแสดงผลบนแผนที่:** ทั้งสองชุดวาดเป็น polygon ได้แล้วผ่าน checkbox แยกกันใน `/map` — ชั้นสภาพป่าจริงดึง geometry จาก `GET /api/forest-status/polygons?lat=&lng=&radius=` (route แยกจาก `/api/forest-status` ตั้งใจ เพราะ route วิเคราะห์ถูกเรียกทุกครั้งที่ย้ายหมุด, clamp รัศมี 1–10 กม., ตัด/ปัดพิกัดด้วย `lib/map/forest-polygons.ts` ที่ pure และทดสอบแล้ว) ส่วนชั้นป่าทั่วไปดึงสดจาก Overpass ผ่าน `lib/map/forest-generic.ts` ซึ่ง **แยกไฟล์จาก `forestBoundaries.ts` โดยเจตนา** — ผลของ `classifyForestOverlay()` ถูกเก็บเป็นหลักฐานประกอบเกณฑ์ ป่าทั่วไปใน OSM ไม่ใช่เขตประกาศจึงต้องไม่ปนเข้าไป ทั้งสองชั้นเป็น **display-only** ไม่แตะ `state.gis` และไม่เข้าคะแนน ข้อจำกัดที่ยอมรับไว้: shapefile กรมป่าไม้ไม่แยกขอบนอก/รูใน และ `pointInForestCover` ก็นับทุกวงเป็นป่า จึง **วาดทุกวงเป็นป่าเหมือนกัน** เพื่อให้ภาพตรงกับตัวเลขที่เกณฑ์คำนวณ (รูโล่งกลางผืนป่าถูกถมด้วย) — ถ้าจะแก้ต้องแก้ทั้งการวาดและตัวคำนวณพร้อมกัน สเปก: `docs/superpowers/specs/2026-08-08-forest-polygon-overlay-design.md`
```

- [ ] **Step 5: Commit + push**

```bash
git add CLAUDE.md
git commit -m "docs: บันทึกชั้น polygon ป่าบนแผนที่ใน CLAUDE.md"
git push
```

---

## Self-Review

**ครอบคลุมสเปกครบ:** §5.1 → Task 1 · §5.2 → Task 2 · §5.3 → Task 3 · §5.4-5.5 → Task 4-5 · §6 (ข้อจำกัดวงนอก/รูใน) → ข้อความเตือนใน Task 4 Step 7 + `CLAUDE.md` ใน Task 6 · §7 (เครดิต/สิทธิ์) → เทสต์เครดิตใน Task 4-5 · §8 (ทดสอบ) → Task 1/3/4/5 · §9 (เกณฑ์เสร็จ) → Task 6

**เบี่ยงจากสเปก 1 จุด:** สเปก §5.5 เขียนว่า `ClassificationType.TERRAIN` แต่แผนใช้ `HeightReference.CLAMP_TO_GROUND` + `polyline.clampToGround` ตามโค้ดชั้นป่าเดิมที่ `CesiumMap.tsx:2326-2344` — ไม่ต้อง import ใหม่และได้พฤติกรรมเดียวกับชั้นอื่นบนแผนที่นี้ ระบุไว้ใน Global Constraints แล้ว

**เพิ่มจากสเปก 1 จุด:** สเปกเขียนว่ากรอง "feature ที่ ring ใดก็ตามแตะกรอบ" — แผนใช้ **กรอบตัดกรอบ** แทน "มีจุดยอดในกรอบ" เพราะผืนป่าใหญ่ที่ครอบโรงเรียนไว้ทั้งหมดอาจไม่มีจุดยอดสักจุดในรัศมี 10 กม. ซึ่งเป็นเคสสำคัญที่สุดของงานนี้ (มีเทสต์ตรึงไว้ใน Task 1)
