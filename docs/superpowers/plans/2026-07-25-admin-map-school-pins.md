# Admin Map — School Overview Pins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the admin/ssra_admin `/map` overview, plot one colored pin per school that has saved an assessment (gray = draft, green = submitted ≥50, red = submitted <50), each labeled with the school name; clicking a pin opens that school's read-only analysis view.

**Architecture:** A pure helper module derives pin status and coordinates. A repo function builds the pin list from one SQL query (latest row per school) with a registry fallback for missing coords. `app/map/page.tsx` calls it only in the admin national overview and passes the list through `CesiumMapLoader` to `CesiumMap`, which draws a new `schoolPins` CustomDataSource and a national-only click handler that navigates to `/map?assessment=ID` (reusing the existing authorized read-only flow).

**Tech Stack:** Next.js 16 (App Router, server components), TypeScript strict, `mysql2`, CesiumJS (client-only), node:test + tsx (DB-free unit + source-grep tests).

## Global Constraints

- UI text and domain terminology are **Thai** — match existing wording.
- `npm test` must stay **DB-free** — new unit tests use only pure functions; DB code is verified by `npx tsc --noEmit` and covered indirectly by the tested pure helpers.
- Every test file is listed **explicitly** in the `test` script in `package.json` (glob-free, deterministic on Windows).
- Never import `cesium` from a server component (leaks into the server bundle). `CesiumMap.tsx` is client-only (`"use client"`).
- Pass/fail semantics (confirmed): green = submitted AND `level_key !== "neutral"` (score ≥50); red = submitted AND `level_key === "neutral"` (score <50); gray = not submitted.
- One pin per school = the row with the newest `updated_at` for that `owner_school_code`.
- The overview layer shows **only** when `role ∈ {admin, ssra_admin}` AND there is no `?assessment=ID` (national mode). School users and drill-in views are unchanged.

---

### Task 1: Pure pin helpers (`lib/school-pins.ts`)

**Files:**
- Create: `lib/school-pins.ts`
- Test: `tests/school-pins.test.ts`
- Modify: `package.json` (add test file to `test` script)

**Interfaces:**
- Consumes: nothing (leaf module, no imports).
- Produces:
  - `type SchoolPinStatus = "draft" | "pass" | "fail"`
  - `interface SchoolPin { id: number; name: string; lat: number; lng: number; status: SchoolPinStatus }`
  - `schoolPinStatus(args: { submitted: boolean; levelKey: string }): SchoolPinStatus`
  - `resolvePinCoord(rawLat: unknown, rawLng: unknown, fallback: { lat: number; lng: number } | null): { lat: number; lng: number } | null`

- [ ] **Step 1: Write the failing test**

Create `tests/school-pins.test.ts`:

```ts
// Unit tests สำหรับ lib/school-pins.ts — helper บริสุทธิ์ของหมุดภาพรวมโรงเรียน (ไม่ต้องมี DB)
// รันด้วย: npm test (node:test + tsx loader)

import assert from "node:assert/strict";
import test from "node:test";
import { schoolPinStatus, resolvePinCoord } from "../lib/school-pins";

test("schoolPinStatus: ยังไม่ส่ง = draft ไม่ว่าระดับใด", () => {
  assert.equal(schoolPinStatus({ submitted: false, levelKey: "level-3" }), "draft");
  assert.equal(schoolPinStatus({ submitted: false, levelKey: "neutral" }), "draft");
  assert.equal(schoolPinStatus({ submitted: false, levelKey: "" }), "draft");
});

test("schoolPinStatus: ส่งแล้ว + คะแนน ≥50 (ไม่ใช่ neutral) = pass", () => {
  assert.equal(schoolPinStatus({ submitted: true, levelKey: "level-3" }), "pass");
  assert.equal(schoolPinStatus({ submitted: true, levelKey: "level-2" }), "pass");
  assert.equal(schoolPinStatus({ submitted: true, levelKey: "level-1" }), "pass");
});

test("schoolPinStatus: ส่งแล้ว + neutral (คะแนน <50) = fail", () => {
  assert.equal(schoolPinStatus({ submitted: true, levelKey: "neutral" }), "fail");
});

test("resolvePinCoord: พิกัดในแบบประเมินใช้ได้ → ใช้เลย", () => {
  assert.deepEqual(resolvePinCoord("18.79", "98.98", null), { lat: 18.79, lng: 98.98 });
  assert.deepEqual(resolvePinCoord(18.79, 98.98, null), { lat: 18.79, lng: 98.98 });
});

test("resolvePinCoord: พิกัดว่าง/เป็น (0,0) → ใช้ fallback ทะเบียน", () => {
  assert.deepEqual(resolvePinCoord("0", "0", { lat: 19.1, lng: 99.2 }), { lat: 19.1, lng: 99.2 });
  assert.deepEqual(resolvePinCoord("", "", { lat: 19.1, lng: 99.2 }), { lat: 19.1, lng: 99.2 });
});

test("resolvePinCoord: ไม่มีพิกัดใช้ได้เลย → null (ไม่แสดงหมุด)", () => {
  assert.equal(resolvePinCoord("", "", null), null);
  assert.equal(resolvePinCoord("abc", "def", { lat: 0, lng: 0 }), null);
  assert.equal(resolvePinCoord("0", "0", null), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/school-pins'` (and/or the file isn't in the script yet).

- [ ] **Step 3: Create the implementation**

Create `lib/school-pins.ts`:

```ts
// หมุดภาพรวมโรงเรียนบนแผนที่ผู้ดูแล — helper บริสุทธิ์ (client-safe, ไม่แตะ DB/cesium)
// แยกไว้เพื่อทดสอบ mapping สถานะ/พิกัดโดยไม่ต้องพึ่ง DB และไม่ดึง repo (server-only) เข้า test

export type SchoolPinStatus = "draft" | "pass" | "fail";

export interface SchoolPin {
  /** assessment id — ใช้ทำลิงก์ /map?assessment=ID ตอนคลิกหมุด */
  id: number;
  name: string;
  lat: number;
  lng: number;
  status: SchoolPinStatus;
}

/** สถานะหมุดจาก "ส่งแล้วหรือยัง" + ระดับคะแนน (คอลัมน์สรุป level_key)
 *  - ยังไม่ส่ง                       → draft (เทา)
 *  - ส่งแล้ว + คะแนน ≥50 (ไม่ใช่ neutral) → pass  (เขียว, ขึ้นทะเบียนได้)
 *  - ส่งแล้ว + neutral (คะแนน <50)      → fail  (แดง) */
export function schoolPinStatus(args: { submitted: boolean; levelKey: string }): SchoolPinStatus {
  if (!args.submitted) return "draft";
  return args.levelKey === "neutral" ? "fail" : "pass";
}

/** เลือกพิกัดที่ใช้ได้: พิกัดในแบบประเมินก่อน → fallback (ทะเบียนโรงเรียน) → null ถ้าไม่มีเลย
 *  ค่า (0,0) และค่าที่แปลงเป็นตัวเลขไม่ได้ ถือว่า "ไม่มีพิกัด" */
export function resolvePinCoord(
  rawLat: unknown,
  rawLng: unknown,
  fallback: { lat: number; lng: number } | null,
): { lat: number; lng: number } | null {
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
    return { lat, lng };
  }
  if (
    fallback &&
    Number.isFinite(fallback.lat) &&
    Number.isFinite(fallback.lng) &&
    (fallback.lat !== 0 || fallback.lng !== 0)
  ) {
    return { lat: fallback.lat, lng: fallback.lng };
  }
  return null;
}
```

- [ ] **Step 4: Add the test file to the `test` script**

In `package.json`, append `tests/school-pins.test.ts` to the `test` script (right after `tests/map-hints-current-year.test.ts`):

```
... tests/map-hints-current-year.test.ts tests/school-pins.test.ts lib/map/geometry.test.ts ...
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `school-pins` cases green, no other test regressed.

- [ ] **Step 6: Commit**

```bash
git add lib/school-pins.ts tests/school-pins.test.ts package.json
git commit -m "feat: pure school-pin status + coord helpers"
```

---

### Task 2: Repo query (`listSchoolPins` in `lib/repo.ts`)

**Files:**
- Modify: `lib/repo.ts` (add import + `listSchoolPins` + private `SchoolPinRow`/`toSchoolPin`)

**Interfaces:**
- Consumes: `schoolPinStatus`, `resolvePinCoord`, `SchoolPin` (Task 1); existing `getPool`, `schoolLocationByCode` (same file).
- Produces: `listSchoolPins(): Promise<SchoolPin[]>`

- [ ] **Step 1: Add the import**

At the top of `lib/repo.ts`, add (near the other `./`-relative imports):

```ts
import { resolvePinCoord, schoolPinStatus, type SchoolPin } from "./school-pins";
```

Re-export the type so page/consumers can import it from `@/lib/repo` alongside the function:

```ts
export type { SchoolPin } from "./school-pins";
```

- [ ] **Step 2: Add the row type and mapper**

Add near the other row interfaces in `lib/repo.ts`:

```ts
interface SchoolPinRow extends RowDataPacket {
  id: number;
  owner_school_code: string | null;
  unit_name: string | null;
  level_key: string | null;
  state_name: string | null;
  lat: string | null;
  lng: string | null;
  submitted: unknown; // JSON_EXTRACT(state,'$.submitted') → boolean/1/0/"true" ตาม driver
}

function toSchoolPin(row: SchoolPinRow, coord: { lat: number; lng: number }): SchoolPin {
  const submitted = row.submitted === true || row.submitted === 1 || row.submitted === "true";
  return {
    id: row.id,
    name: row.state_name || row.unit_name || `แบบประเมิน #${row.id}`,
    lat: coord.lat,
    lng: coord.lng,
    status: schoolPinStatus({ submitted, levelKey: row.level_key ?? "" }),
  };
}
```

- [ ] **Step 3: Add `listSchoolPins`**

Add (place it after `listAssessments`/`countAssessments`, before `getAssessment` is fine):

```ts
/** หมุดภาพรวมโรงเรียนทุกแห่งที่มีแบบประเมิน (สำหรับ admin/ssra บนแผนที่มุมมองทั้งประเทศ):
 *  แถวล่าสุดต่อ owner_school_code → พิกัดจากแบบประเมิน (fallback ทะเบียนโรงเรียน) + สถานะร่าง/ผ่าน/ไม่ผ่าน
 *  ใช้ level_key (คอลัมน์สรุป cache) เพื่อความเร็ว — สอดคล้องกับหน้า list; dashboard คือที่ recompute สด */
export async function listSchoolPins(): Promise<SchoolPin[]> {
  const pool = await getPool();
  const [rows] = await pool.query<SchoolPinRow[]>(
    `SELECT a.id, a.owner_school_code, a.unit_name, a.level_key,
            JSON_UNQUOTE(JSON_EXTRACT(a.state, '$.unit.name')) AS state_name,
            JSON_UNQUOTE(JSON_EXTRACT(a.state, '$.unit.lat'))  AS lat,
            JSON_UNQUOTE(JSON_EXTRACT(a.state, '$.unit.lng'))  AS lng,
            JSON_EXTRACT(a.state, '$.submitted')               AS submitted
       FROM assessments a
       JOIN (
         SELECT owner_school_code, MAX(updated_at) AS mx
           FROM assessments
          WHERE owner_school_code IS NOT NULL AND owner_school_code <> ''
          GROUP BY owner_school_code
       ) t ON t.owner_school_code = a.owner_school_code AND t.mx = a.updated_at
      ORDER BY a.id`,
  );

  // de-dup ต่อโรงเรียน (กัน MAX(updated_at) เสมอกัน 2 แถว) — ORDER BY a.id → แถว id สูงกว่าทับ = เลือกเสถียร
  const byCode = new Map<string, SchoolPinRow>();
  for (const row of rows) {
    if (row.owner_school_code) byCode.set(row.owner_school_code, row);
  }

  const pins: SchoolPin[] = [];
  const needFallback: { code: string; row: SchoolPinRow }[] = [];
  for (const [code, row] of byCode) {
    const coord = resolvePinCoord(row.lat, row.lng, null);
    if (coord) pins.push(toSchoolPin(row, coord));
    else needFallback.push({ code, row });
  }

  // แบบร่างที่ยังไม่กรอกพิกัด → fallback พิกัดทะเบียนโรงเรียน (school_location); หาไม่ได้ = ไม่แสดงหมุด
  await Promise.all(
    needFallback.map(async ({ code, row }) => {
      const loc = await schoolLocationByCode(code);
      const coord = resolvePinCoord(loc?.lat, loc?.lng, null);
      if (coord) pins.push(toSchoolPin(row, coord));
    }),
  );

  return pins;
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (Do NOT run `npm run build` if a dev server is running against this folder.)

- [ ] **Step 5: Commit**

```bash
git add lib/repo.ts
git commit -m "feat: listSchoolPins repo query (latest row per school + fallback coords)"
```

---

### Task 3: Client map layer + loader (`CesiumMap.tsx`, `CesiumMapLoader.tsx`, `globals.css`)

**Files:**
- Modify: `components/map/CesiumMap.tsx`
- Modify: `components/map/CesiumMapLoader.tsx`
- Modify: `app/globals.css`
- Test: `tests/school-pins-map.test.ts` (source-grep)
- Modify: `package.json` (add test file)

**Interfaces:**
- Consumes: `SchoolPin` from `@/lib/school-pins` (Task 1).
- Produces: `CesiumMap`/`CesiumMapLoader` accept a `schoolPins?: SchoolPin[]` prop (default `[]`); overview pins + click-to-drill are rendered client-side.

- [ ] **Step 1: Write the failing source-grep test**

Create `tests/school-pins-map.test.ts`:

```ts
// Source-grep tests: pin ภาพรวมโรงเรียนบนแผนที่ (Cesium) — behavior ที่ browser test ไม่ครอบ
// ตรึงการผูก: prop schoolPins, การวาดหมุดสี, label ชื่อ, และคลิก → /map?assessment=ID
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const map = readFileSync("components/map/CesiumMap.tsx", "utf8");
const loader = readFileSync("components/map/CesiumMapLoader.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");

test("CesiumMap รับ prop schoolPins และมี datasource ของหมุดโรงเรียน", () => {
  assert.match(map, /schoolPins\s*=\s*\[\]/); // default ว่าง
  assert.match(map, /schoolPinsDsRef/);
  assert.match(map, /new CustomDataSource\("schoolPins"\)/);
});

test("หมุดโรงเรียนวาดเป็น point สีตามสถานะ + label ชื่อโรงเรียน", () => {
  assert.match(map, /function schoolPinColor/);
  assert.match(map, /#6b7280/); // เทา draft
  assert.match(map, /#22c55e/); // เขียว pass
  assert.match(map, /#ef4444/); // แดง fail
  assert.match(map, /id: `school-pin:\$\{pin\.id\}`/);
  assert.match(map, /text: pin\.name/);
});

test("คลิกหมุดโรงเรียน → เปิดมุมมองแบบประเมินของโรงเรียนนั้น (read-only)", () => {
  assert.match(map, /school-pin:/);
  assert.match(map, /window\.location\.assign\(`\/map\?assessment=\$\{schoolPinId\}`\)/);
});

test("พาเนลโหมดทั้งประเทศแสดง legend สีหมุด", () => {
  assert.match(map, /map-pin-legend/);
  assert.match(css, /\.map-pin-legend\b/);
});

test("CesiumMapLoader ส่งผ่าน prop schoolPins", () => {
  assert.match(loader, /schoolPins/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/school-pins-map.test.ts`
Expected: FAIL — none of the patterns exist yet.

- [ ] **Step 3: Add the `NearFarScalar` import**

In `components/map/CesiumMap.tsx`, add `NearFarScalar` to the `from "cesium"` import block (alongside `LabelStyle`, `Cartesian2`):

```ts
  VerticalOrigin,
  LabelStyle,
  Cartesian2,
  NearFarScalar,
  createWorldImageryAsync,
```

- [ ] **Step 4: Import the `SchoolPin` type and extend `Props`**

Add the type import near the other `@/lib` imports at the top of `CesiumMap.tsx`:

```ts
import type { SchoolPin } from "@/lib/school-pins";
```

In `interface Props` (ends around line 277), add:

```ts
  /** หมุดภาพรวมโรงเรียน (เฉพาะ admin/ssra โหมดทั้งประเทศ) — [] = ไม่แสดงชั้นนี้ */
  schoolPins: SchoolPin[];
```

In the `CesiumMap({ ... }: Props)` destructuring (around line 383-392), add a default:

```ts
  currentYearAssessment,
  showPlaceSearch,
  schoolPins = [],
}: Props) {
```

- [ ] **Step 5: Add the datasource ref**

Next to the other DS refs (around line 402-407), add:

```ts
  const schoolPinsDsRef = useRef<CustomDataSource | null>(null); // หมุดภาพรวมโรงเรียน (admin โหมดทั้งประเทศ)
```

- [ ] **Step 6: Create + register the datasource in the init effect**

In the viewer-init effect, after the `bordersDs` block (around line 612-614), add:

```ts
    const schoolPinsDs = new CustomDataSource("schoolPins");
    void viewer.dataSources.add(schoolPinsDs);
    schoolPinsDsRef.current = schoolPinsDs;
```

And in that effect's cleanup return (around line 648-649, next to `bordersDsRef.current = null;`), add:

```ts
      schoolPinsDsRef.current = null;
```

- [ ] **Step 7: Add the color helper (module scope)**

Near the other module-scope helpers (e.g. after `fmt` around line 279), add:

```ts
// สีหมุดภาพรวมโรงเรียนตามสถานะ: เทา=ร่าง, เขียว=ส่งแล้วผ่าน (≥50), แดง=ส่งแล้วไม่ผ่าน (<50)
function schoolPinColor(status: SchoolPin["status"]): Color {
  if (status === "pass") return Color.fromCssColorString("#22c55e");
  if (status === "fail") return Color.fromCssColorString("#ef4444");
  return Color.fromCssColorString("#6b7280");
}
```

- [ ] **Step 8: Add the draw effect**

Add a new effect (place it right after the school-pin/center-pin effect that ends around line 781, before the camera fly effect). Full code:

```ts
  // ── หมุดภาพรวมโรงเรียนทุกแห่งที่มีแบบประเมิน (เฉพาะ admin/ssra โหมดทั้งประเทศ) ──
  // แสดงเฉพาะหมุด+ป้ายชื่อ ไม่รันการวิเคราะห์ใด ๆ ของแต่ละพิกัด (ดูรายละเอียดเมื่อคลิกหมุด)
  useEffect(() => {
    const ds = schoolPinsDsRef.current;
    if (!ds || status !== "ready") return;
    ds.entities.removeAll();
    if (!national || schoolPins.length === 0) return;
    for (const pin of schoolPins) {
      ds.entities.add({
        id: `school-pin:${pin.id}`,
        position: Cartesian3.fromDegrees(pin.lng, pin.lat),
        point: {
          pixelSize: 11,
          color: schoolPinColor(pin.status),
          outlineColor: Color.WHITE,
          outlineWidth: 2,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: pin.name,
          font: "600 13px 'Sarabun', sans-serif",
          fillColor: Color.WHITE,
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineColor: Color.fromCssColorString("#111827"),
          outlineWidth: 3,
          showBackground: true,
          backgroundColor: Color.fromCssColorString("#111827").withAlpha(0.72),
          backgroundPadding: new Cartesian2(7, 4),
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -14),
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          // ซูมออกระดับประเทศ = ป้ายเล็ก/จางลง กันรก; ซูมเข้า = ชัดเต็ม
          scaleByDistance: new NearFarScalar(2.0e5, 1.0, 2.0e6, 0.5),
          translucencyByDistance: new NearFarScalar(1.5e6, 1.0, 3.0e6, 0.0),
        },
      });
    }
  }, [schoolPins, national, status]);
```

- [ ] **Step 9: Add the click-to-drill handler**

Add a new effect after the drag-pin effect (which ends around line 1125). Full code:

```ts
  // ── คลิกหมุดภาพรวมโรงเรียน → เปิดมุมมองแบบประเมินของโรงเรียนนั้น (โหมดทั้งประเทศเท่านั้น) ──
  // ผูกเฉพาะ national → ไม่ชนกับ handler ลากหมุด/วาด polygon (ผูกเฉพาะ !national)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status !== "ready" || !national) return;
    const scene = viewer.scene;
    const handler = new ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction((e: { position: Cartesian2 }) => {
      const picked = scene.pick(e.position) as { id?: Entity | string } | undefined;
      const raw = picked && typeof picked.id === "object" ? picked.id.id : picked?.id;
      if (typeof raw !== "string" || !raw.startsWith("school-pin:")) return;
      const schoolPinId = raw.slice("school-pin:".length);
      // full navigation → server โหลด+ตรวจสิทธิ์ (canAccessAssessment) แล้วแสดง read-only เหมือน user โรงเรียนนั้น
      window.location.assign(`/map?assessment=${schoolPinId}`);
    }, ScreenSpaceEventType.LEFT_CLICK);
    scene.canvas.style.cursor = "";
    return () => {
      handler.destroy();
    };
  }, [status, national]);
```

- [ ] **Step 10: Add the legend to the national panel**

In the panel JSX, right after the `map-coord` div and before the `{!national ? (...drag-hint...) : null}` block (around line 2139-2142), add:

```tsx
          {national && schoolPins.length > 0 ? (
            <div className="map-pin-legend">
              <div className="map-pin-legend-title">โรงเรียนที่บันทึกแบบประเมิน ({fmt(schoolPins.length)} แห่ง)</div>
              <div className="map-pin-legend-row">
                <span className="map-pin-legend-dot" style={{ background: "#6b7280" }} /> ยังร่าง
              </div>
              <div className="map-pin-legend-row">
                <span className="map-pin-legend-dot" style={{ background: "#22c55e" }} /> ส่งแล้ว ผ่านเกณฑ์ (≥50)
              </div>
              <div className="map-pin-legend-row">
                <span className="map-pin-legend-dot" style={{ background: "#ef4444" }} /> ส่งแล้ว ไม่ผ่านเกณฑ์ (&lt;50)
              </div>
              <p className="map-pin-legend-hint">💡 คลิกที่หมุดเพื่อดูข้อมูลวิเคราะห์ของโรงเรียนนั้น</p>
            </div>
          ) : null}
```

- [ ] **Step 11: Add the legend CSS**

In `app/globals.css`, add (near the other `.map-*` panel rules):

```css
.map-pin-legend {
  margin: 10px 0;
  padding: 10px 12px;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 8px;
  background: rgba(148, 163, 184, 0.08);
  font-size: 13px;
}
.map-pin-legend-title {
  font-weight: 600;
  margin-bottom: 6px;
}
.map-pin-legend-row {
  display: flex;
  align-items: center;
  gap: 8px;
  line-height: 1.9;
}
.map-pin-legend-dot {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15);
  flex: 0 0 auto;
}
.map-pin-legend-hint {
  margin: 6px 0 0;
  color: var(--muted, #6b7280);
}
```

- [ ] **Step 12: Thread the prop through `CesiumMapLoader`**

In `components/map/CesiumMapLoader.tsx`:

Add the type import:

```ts
import type { SchoolPin } from "@/lib/school-pins";
```

Add `schoolPins` to the destructured params (with default) and the prop type, then pass it down:

```tsx
export default function CesiumMapLoader({
  center,
  national,
  province,
  householdSize,
  assessment = null,
  canSaveAssessment = false,
  currentYearAssessment = null,
  showPlaceSearch = true,
  schoolPins = [],
}: {
  center: MapCenter;
  national: boolean;
  province: MapProvince | null;
  householdSize: number | null;
  assessment?: MapAssessment | null;
  canSaveAssessment?: boolean;
  currentYearAssessment?: MapCurrentYearAssessment | null;
  showPlaceSearch?: boolean;
  /** หมุดภาพรวมโรงเรียน (เฉพาะ admin/ssra โหมดทั้งประเทศ) */
  schoolPins?: SchoolPin[];
}) {
  return (
    <CesiumMap
      center={center}
      national={national}
      province={province}
      householdSize={householdSize}
      assessment={assessment}
      canSaveAssessment={canSaveAssessment}
      currentYearAssessment={currentYearAssessment}
      showPlaceSearch={showPlaceSearch}
      schoolPins={schoolPins}
    />
  );
}
```

- [ ] **Step 13: Add the test file to the `test` script**

In `package.json`, append `tests/school-pins-map.test.ts` right after `tests/school-pins.test.ts`.

- [ ] **Step 14: Run the source-grep test + type-check**

Run: `node --import tsx --test tests/school-pins-map.test.ts`
Expected: PASS (all 5 tests).

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 15: Commit**

```bash
git add components/map/CesiumMap.tsx components/map/CesiumMapLoader.tsx app/globals.css tests/school-pins-map.test.ts package.json
git commit -m "feat: draw admin school-overview pins with labels + click-to-drill"
```

---

### Task 4: Page wiring + back-to-overview link (`app/map/page.tsx`)

**Files:**
- Modify: `app/map/page.tsx`
- Test: `tests/school-pins-page.test.ts` (source-grep)
- Modify: `package.json` (add test file)

**Interfaces:**
- Consumes: `listSchoolPins`, `SchoolPin` from `@/lib/repo` (Task 2); `CesiumMapLoader` `schoolPins` prop (Task 3).
- Produces: nothing downstream (leaf page).

- [ ] **Step 1: Write the failing source-grep test**

Create `tests/school-pins-page.test.ts`:

```ts
// Source-grep test: หน้า /map เรียก listSchoolPins เฉพาะภาพรวม admin, ส่ง prop, และมีปุ่มกลับแผนที่รวม
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/map/page.tsx", "utf8");

test("เรียก listSchoolPins เฉพาะ admin โหมดภาพรวม (canSeeAll && ไม่มี assessment)", () => {
  assert.match(page, /listSchoolPins/);
  assert.match(page, /canSeeAll && !assessment/);
});

test("ส่ง prop schoolPins ให้ CesiumMapLoader", () => {
  assert.match(page, /schoolPins=\{schoolPins\}/);
});

test("มีปุ่มกลับแผนที่รวมเมื่อ admin เจาะดูโรงเรียน (canSeeAll && assessment)", () => {
  assert.match(page, /canSeeAll && assessment/);
  assert.match(page, /กลับแผนที่รวม/);
  assert.match(page, /href="\/map"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/school-pins-page.test.ts`
Expected: FAIL — patterns not present yet.

- [ ] **Step 3: Import `listSchoolPins` + `SchoolPin`**

In `app/map/page.tsx`, extend the existing `@/lib/repo` import to include `listSchoolPins`, and add the type to the `import type { ... } from "@/lib/repo"` line:

```ts
import {
  assessmentForSchoolYear,
  getAssessment,
  latestOwnerCoords,
  listProvinces,
  listSchoolPins,
  provinceHouseholdSize,
  resolveSchoolProvince,
  schoolLocationByCode,
} from "@/lib/repo";
import type { ProvinceInfo, SchoolPin } from "@/lib/repo";
```

- [ ] **Step 4: Build the pin list (admin national overview only)**

In `app/map/page.tsx`, after the `showPlaceSearch` line (around line 171) and before `return (`, add:

```ts
  // หมุดภาพรวมโรงเรียน — เฉพาะ admin/ssra ที่เปิดแผนที่มุมมองทั้งประเทศ (ไม่มี ?assessment=ID)
  // โหมดนี้ไม่รันการวิเคราะห์รายพิกัดอยู่แล้ว จึงตรงกับ "แสดงแค่หมุด ดูรายละเอียดเมื่อคลิก"
  let schoolPins: SchoolPin[] = [];
  if (canSeeAll && !assessment) {
    try {
      schoolPins = await listSchoolPins();
    } catch (error) {
      console.error("[map] school pins lookup failed:", error);
    }
  }
```

- [ ] **Step 5: Pass the prop to `CesiumMapLoader`**

In the `<CesiumMapLoader ... />` JSX (around line 201-210), add:

```tsx
        showPlaceSearch={showPlaceSearch}
        schoolPins={schoolPins}
      />
```

- [ ] **Step 6: Add the back-to-overview link**

In the header `top-actions` block, add a link right after the existing `assessment ? (...กลับไปที่แบบประเมิน...) : null` block (around line 184-188):

```tsx
          {canSeeAll && assessment ? (
            <Link className="ghost-btn" href="/map">
              กลับแผนที่รวม
            </Link>
          ) : null}
```

- [ ] **Step 7: Add the test file to the `test` script**

In `package.json`, append `tests/school-pins-page.test.ts` right after `tests/school-pins-map.test.ts`.

- [ ] **Step 8: Run the source-grep test + type-check**

Run: `node --import tsx --test tests/school-pins-page.test.ts`
Expected: PASS (all 3 tests).

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add app/map/page.tsx tests/school-pins-page.test.ts package.json
git commit -m "feat: wire school-overview pins + back-to-overview link into /map"
```

---

### Task 5: Full verification (test suite + browser smoke)

**Files:** none (verification only)

- [ ] **Step 1: Run the whole DB-free suite**

Run: `npm test`
Expected: PASS — the three new files plus all pre-existing tests green. Note the new expected total is the old count + the new cases.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Browser smoke test (manual, needs MySQL + a seeded admin)**

Ensure Laragon MySQL is running and there is at least one draft, one submitted-passing (≥50), and one submitted-failing (<50) assessment (use the form's "เติมตัวอย่าง ▾" profiles + submit to create varied statuses).

Start the dev server via the preview tool (NOT `npm run build` — it corrupts `.next` while dev runs), open `http://localhost:3000/map` logged in as `admin`, and verify:
- Gray / green / red pins appear at school coordinates, each with the school-name label.
- Clicking a pin navigates to `/map?assessment=ID` and shows that school's analysis read-only.
- The header shows **"กลับแผนที่รวม"**; clicking it returns to the plain `/map` overview.
- A `school` login sees its own single-school map unchanged (no overview layer).

Capture a screenshot of the overview pins as proof.

- [ ] **Step 4: Update `CLAUDE.md` docs (test count + feature note)**

Bump the `npm test` case-count line in `CLAUDE.md` to include the new tests, and add a short sentence under the 3D-map bullet describing the admin school-overview pins (colors, latest-row-per-school, click-to-drill, back-to-overview link). Commit:

```bash
git add CLAUDE.md
git commit -m "docs: note admin map school-overview pins + updated test count"
```

## Self-Review Notes

- **Spec coverage:** colors/status (Task 1 `schoolPinStatus` + Task 3 `schoolPinColor`), latest-row-per-school (Task 2 SQL), coord fallback (Task 1 `resolvePinCoord` + Task 2), admin-national-only gating (Task 4 `canSeeAll && !assessment` + Task 3 `national` guards), labels (Task 3 Step 8), click→`/map?assessment=ID` (Task 3 Step 9), back-to-overview link (Task 4 Step 6), legend (Task 3 Steps 10-11), tests (Tasks 1/3/4), docs (Task 5). All spec sections mapped.
- **Type consistency:** `SchoolPin`/`SchoolPinStatus` defined once in `lib/school-pins.ts`, re-exported from `lib/repo.ts`; `schoolPinStatus`, `resolvePinCoord`, `listSchoolPins`, `schoolPinColor`, `schoolPinsDsRef`, entity id `school-pin:${pin.id}`, and var `schoolPinId` are used identically across tasks and their source-grep tests.
- **No placeholders:** every code/step is concrete.
