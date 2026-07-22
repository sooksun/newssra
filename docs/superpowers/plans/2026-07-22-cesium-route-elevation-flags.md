# Cesium Route Elevation Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แสดงธงแดงพร้อมระดับความสูงที่โรงเรียนและที่จุดตัวอย่างสูงสุดบนเส้นทาง Cesium ที่เลือกจากศาลากลางจังหวัดมายังโรงเรียน

**Architecture:** แยกการลดจำนวนพิกัดและการสร้าง elevation profile เป็น pure functions ใน `lib/map/routeElevation.ts` แล้วให้ `CesiumMap.tsx` เรียก terrain sampling หนึ่งครั้งต่อเส้นทางที่เลือก ผลเดียวกันขับทั้งค่าความสูงโรงเรียน จุดสูงสุดบนเส้นทาง และค่าไต่ขึ้น/ลงของ GIS ก่อนนำไปวาดเป็น Cesium billboard สองจุด

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Cesium 1.143, Node test runner ผ่าน `tsx`

## Global Constraints

- จุดสูงสุดต้องมาจากตัวอย่างบนเส้นทาง OSRM ที่เลือกอยู่ ไม่ใช่กริดรอบโรงเรียนหรือผลรวมทุกเส้นทาง
- ใช้ตัวอย่างไม่เกิน `MAX_GAIN_SAMPLE_POINTS = 120` จุด และต้องคงจุดแรกกับจุดปลายทางโรงเรียน
- คงหมุดศาลากลางสีน้ำเงินและ entity id `center-pin` เพื่อรักษาการลากหมุดโรงเรียน
- ข้อมูล terrain ที่ใช้ไม่ได้ต้องเป็นสถานะไม่มีข้อมูล ห้ามแทนด้วย `0 ม.`
- มุมมองทั้งประเทศไม่แสดงธงทั้งสอง
- รักษาฟังก์ชันย่อ/ขยายแผง แนวชายแดน GIS และการแก้ไขเดิมใน dirty worktree
- ห้าม stage หรือ commit ไฟล์ที่มีการแก้ไขเดิมร่วมอยู่โดยไม่สามารถแยก intended hunks ได้อย่างปลอดภัย

---

## File Structure

- Create `lib/map/routeElevation.ts`: pure route sampling/profile/formatting helpers ไม่ขึ้นกับ Cesium หรือ React
- Create `lib/map/routeElevation.test.ts`: unit tests สำหรับ endpoint preservation, finite maximum, missing data และ label formatting
- Create `tests/route-elevation-flags.test.ts`: source-level integration contract ของ Cesium entities และข้อความป้าย
- Modify `components/map/CesiumMap.tsx`: terrain profile state/effect, red flag billboards, labels และแยก camera effect ออกจาก marker effect
- Modify `package.json`: เพิ่ม test files ใหม่เข้า `npm test` โดยรักษารายการทดสอบที่มีอยู่ทั้งหมด

### Task 1: Route Elevation Profile Helpers

**Files:**
- Create: `lib/map/routeElevation.ts`
- Create: `lib/map/routeElevation.test.ts`
- Modify: `package.json` test script

**Interfaces:**
- Produces: `type RouteCoordinate = [number, number]`
- Produces: `interface RouteElevationPoint { lng: number; lat: number; elevationM: number }`
- Produces: `interface RouteElevationProfile { schoolElevationM: number | null; highestPoint: RouteElevationPoint | null }`
- Produces: `sampleRouteCoordinates(coords: readonly RouteCoordinate[], maxCount: number): RouteCoordinate[]`
- Produces: `buildRouteElevationProfile(coords: readonly RouteCoordinate[], heights: ArrayLike<number>): RouteElevationProfile`
- Produces: `formatElevationMeters(value: number): string`

- [x] **Step 1: Write the failing helper tests**

Create `lib/map/routeElevation.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRouteElevationProfile,
  formatElevationMeters,
  sampleRouteCoordinates,
  type RouteCoordinate,
} from "./routeElevation";

test("sampleRouteCoordinates spreads samples and preserves both endpoints", () => {
  const coords = Array.from({ length: 11 }, (_, i) => [100 + i, 10 + i] as RouteCoordinate);
  const sampled = sampleRouteCoordinates(coords, 4);

  assert.equal(sampled.length, 4);
  assert.deepEqual(sampled[0], coords[0]);
  assert.deepEqual(sampled.at(-1), coords.at(-1));
  assert.deepEqual(sampled, [coords[0], coords[3], coords[7], coords[10]]);
});

test("sampleRouteCoordinates rejects a limit that cannot preserve both endpoints", () => {
  assert.throws(() => sampleRouteCoordinates([[100, 10], [101, 11]], 1), /at least 2/);
});

test("buildRouteElevationProfile selects the highest finite route point and exact school endpoint", () => {
  const coords: RouteCoordinate[] = [[100, 10], [101, 11], [102, 12], [103, 13]];
  const profile = buildRouteElevationProfile(coords, new Float32Array([100, Number.NaN, 375, 250]));

  assert.equal(profile.schoolElevationM, 250);
  assert.deepEqual(profile.highestPoint, { lng: 102, lat: 12, elevationM: 375 });
});

test("buildRouteElevationProfile never converts missing terrain to zero", () => {
  const profile = buildRouteElevationProfile([[100, 10], [101, 11]], [Number.NaN, Number.NaN]);

  assert.equal(profile.schoolElevationM, null);
  assert.equal(profile.highestPoint, null);
});

test("formatElevationMeters rounds and formats metres for Thai UI", () => {
  assert.equal(formatElevationMeters(1245.6), "1,246 ม.");
});
```

- [x] **Step 2: Run the helper tests to verify RED**

Run:

```powershell
node --import tsx --test lib/map/routeElevation.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `./routeElevation`.

- [x] **Step 3: Implement the pure helpers**

Create `lib/map/routeElevation.ts`:

```ts
export type RouteCoordinate = [number, number];

export interface RouteElevationPoint {
  lng: number;
  lat: number;
  elevationM: number;
}

export interface RouteElevationProfile {
  schoolElevationM: number | null;
  highestPoint: RouteElevationPoint | null;
}

export function sampleRouteCoordinates(
  coords: readonly RouteCoordinate[],
  maxCount: number,
): RouteCoordinate[] {
  if (!Number.isInteger(maxCount) || maxCount < 2) {
    throw new RangeError("maxCount must be an integer of at least 2");
  }
  if (coords.length <= maxCount) return coords.map(([lng, lat]) => [lng, lat]);

  return Array.from({ length: maxCount }, (_, index) => {
    const sourceIndex = Math.round((index * (coords.length - 1)) / (maxCount - 1));
    const [lng, lat] = coords[sourceIndex];
    return [lng, lat];
  });
}

export function buildRouteElevationProfile(
  coords: readonly RouteCoordinate[],
  heights: ArrayLike<number>,
): RouteElevationProfile {
  let highestPoint: RouteElevationPoint | null = null;
  const pairedLength = Math.min(coords.length, heights.length);

  for (let index = 0; index < pairedLength; index += 1) {
    const elevationM = heights[index];
    if (!Number.isFinite(elevationM)) continue;
    if (!highestPoint || elevationM > highestPoint.elevationM) {
      highestPoint = { lng: coords[index][0], lat: coords[index][1], elevationM };
    }
  }

  const schoolIndex = coords.length - 1;
  const schoolHeight = schoolIndex >= 0 && schoolIndex < heights.length ? heights[schoolIndex] : Number.NaN;
  return {
    schoolElevationM: Number.isFinite(schoolHeight) ? schoolHeight : null,
    highestPoint,
  };
}

export function formatElevationMeters(value: number): string {
  return `${Math.round(value).toLocaleString("th-TH")} ม.`;
}
```

- [x] **Step 4: Run the helper tests to verify GREEN**

Run:

```powershell
node --import tsx --test lib/map/routeElevation.test.ts
```

Expected: 5 tests pass, 0 fail.

- [x] **Step 5: Register the helper and integration tests in the full suite**

Append `lib/map/routeElevation.test.ts tests/route-elevation-flags.test.ts` to the existing `test` command in `package.json`; do not remove `tests/map-panel-collapse.test.ts` or `components/map/MapPanelToggle.test.tsx` from the current dirty working copy.

- [x] **Step 6: Commit only safely isolated new helper files**

Run:

```powershell
git add -- lib/map/routeElevation.ts lib/map/routeElevation.test.ts
git diff --cached --check
git commit -m "test: define route elevation profile behavior"
```

Expected: the commit contains only the two new helper files. Leave `package.json` unstaged because it contains pre-existing/shared edits.

### Task 2: Cesium Red Flags and Selected-Route Sampling

**Files:**
- Create: `tests/route-elevation-flags.test.ts`
- Modify: `components/map/CesiumMap.tsx:34-65, 119-132, 382-452, 694-886, 1496-1521`

**Interfaces:**
- Consumes: `sampleRouteCoordinates`, `buildRouteElevationProfile`, `formatElevationMeters`, and `RouteElevationProfile` from Task 1
- Produces: Cesium entity `center-pin` as a red flag billboard
- Produces: Cesium entity `route-highest-point` as a red flag billboard
- Produces: one cancellable selected-route terrain sampling effect

- [x] **Step 1: Write the failing integration contract**

Create `tests/route-elevation-flags.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync("components/map/CesiumMap.tsx", "utf8");

test("Cesium renders red flag billboards for the school and selected-route high point", () => {
  assert.match(component, /const RED_FLAG_ICON/);

  const schoolStart = component.indexOf('id: "center-pin"');
  const highStart = component.indexOf('id: "route-highest-point"');
  assert.ok(schoolStart >= 0, "missing draggable school entity");
  assert.ok(highStart >= 0, "missing selected-route highest-point entity");
  assert.match(component.slice(schoolStart, schoolStart + 1_400), /billboard:\s*\{/);
  assert.match(component.slice(highStart, highStart + 1_400), /billboard:\s*\{/);
});

test("both flag labels expose elevation and route sampling keeps the exact school coordinate", () => {
  assert.match(component, /ระดับความสูง.*formatElevationMeters/s);
  assert.match(component, /จุดสูงสุดบนเส้นทาง.*formatElevationMeters/s);
  assert.match(component, /sampledCoords\[sampledCoords\.length - 1\] = \[center\.lng, center\.lat\]/);
  assert.match(component, /buildRouteElevationProfile\(sampledCoords, heights\)/);
});
```

- [x] **Step 2: Run the integration contract to verify RED**

Run:

```powershell
node --import tsx --test tests/route-elevation-flags.test.ts
```

Expected: FAIL because `RED_FLAG_ICON`, `route-highest-point`, and route profile integration do not exist.

- [x] **Step 3: Add imports, icon, and route elevation state**

Add the helper import beside the existing map-library imports:

```ts
import {
  buildRouteElevationProfile,
  formatElevationMeters,
  sampleRouteCoordinates,
  type RouteElevationProfile,
} from "@/lib/map/routeElevation";
```

Add this constant after `MAX_GAIN_SAMPLE_POINTS`:

```ts
const RED_FLAG_ICON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 44"><path d="M9 41V4" stroke="white" stroke-width="5" stroke-linecap="round"/><path d="M9 5h22l-6 8 6 8H9z" fill="#dc2626" stroke="white" stroke-width="2" stroke-linejoin="round"/><circle cx="9" cy="41" r="3" fill="#7f1d1d" stroke="white" stroke-width="2"/></svg>',
)}`;
```

Add state beside `mainRouteGain`:

```ts
const [routeElevationProfile, setRouteElevationProfile] = useState<RouteElevationProfile | null>(null);
const [routeElevationStatus, setRouteElevationStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
```

- [x] **Step 4: Replace assessment-only gain sampling with one selected-route profile effect**

Replace the effect currently headed `ความสูงสะสมของเส้นทางหลักทั้งเส้น` with:

```ts
useEffect(() => {
  if (national) {
    setRouteElevationProfile(null);
    setRouteElevationStatus("idle");
    setMainRouteGain(null);
    return;
  }

  const provider = terrainRef.current;
  const selected = routeAlternatives[selectedRouteIdx];
  const selectedRoute = selected && selected.coords.length >= 2 ? selected : null;
  setRouteElevationProfile(null);
  setMainRouteGain(null);

  if (!provider || !terrainReady || (!selectedRoute && !routeSettled)) {
    setRouteElevationStatus("loading");
    return;
  }

  const sampledCoords = selectedRoute
    ? sampleRouteCoordinates(selectedRoute.coords, MAX_GAIN_SAMPLE_POINTS)
    : ([[center.lng, center.lat]] as [number, number][]);
  sampledCoords[sampledCoords.length - 1] = [center.lng, center.lat];

  let cancelled = false;
  setRouteElevationStatus("loading");
  withTimeout(
    sampleCesiumPoints(
      provider,
      sampledCoords.map(([lng, lat]) => ({ lat, lng })),
      KEYLESS_SAMPLE_LEVEL,
    ),
    ANALYSIS_TIMEOUT_MS,
    "สุ่มระดับความสูงตามเส้นทางใช้เวลานานเกินไป",
  )
    .then((heights) => {
      if (cancelled) return;
      const profile = buildRouteElevationProfile(sampledCoords, heights);
      setRouteElevationProfile(profile);
      setRouteElevationStatus(profile.highestPoint ? "ready" : "error");
      setMainRouteGain(selectedRoute && profile.highestPoint ? elevationGainLoss(Array.from(heights)) : null);
    })
    .catch(() => {
      if (cancelled) return;
      setRouteElevationProfile(null);
      setRouteElevationStatus("error");
      setMainRouteGain(null);
    });

  return () => {
    cancelled = true;
  };
}, [
  center.lat,
  center.lng,
  national,
  terrainReady,
  routeSettled,
  routeAlternatives,
  selectedRouteIdx,
]);
```

- [x] **Step 5: Convert the school marker to a red flag without coupling it to camera motion**

In the current marker/camera effect, keep marker creation in one effect and move the `viewer.camera.flyTo(...)` block into a second effect that depends only on `center.lat`, `center.lng`, `national`, and `status`.

Use this marker body for `center-pin`:

```ts
const schoolElevationText =
  routeElevationProfile?.schoolElevationM != null
    ? `ระดับความสูง ${formatElevationMeters(routeElevationProfile.schoolElevationM)}`
    : routeElevationStatus === "loading" || routeElevationStatus === "idle"
      ? "กำลังอ่านระดับความสูง…"
      : "ไม่พบข้อมูลระดับความสูง";

centerPinRef.current = pinDs.entities.add({
  id: "center-pin",
  position: Cartesian3.fromDegrees(center.lng, center.lat),
  billboard: {
    image: RED_FLAG_ICON,
    width: 36,
    height: 44,
    verticalOrigin: VerticalOrigin.BOTTOM,
    heightReference: HeightReference.CLAMP_TO_GROUND,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  },
  label: {
    text: `${center.name}\n${schoolElevationText}`,
    font: "600 14px 'Sarabun', sans-serif",
    fillColor: Color.WHITE,
    style: LabelStyle.FILL_AND_OUTLINE,
    outlineColor: Color.fromCssColorString("#111827"),
    outlineWidth: 3,
    showBackground: true,
    backgroundColor: Color.fromCssColorString("#b91c1c").withAlpha(0.88),
    backgroundPadding: new Cartesian2(9, 6),
    verticalOrigin: VerticalOrigin.BOTTOM,
    pixelOffset: new Cartesian2(0, -48),
    heightReference: HeightReference.CLAMP_TO_GROUND,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  },
});
```

Marker effect dependencies must include `routeElevationProfile` and `routeElevationStatus`; the new camera effect must not include them, so terrain completion does not fly the camera a second time.

- [x] **Step 6: Add the selected-route highest-point red flag**

Inside the route drawing effect, after drawing the selected blue route, add:

```ts
const highestPoint = routeElevationProfile?.highestPoint;
if (sel && highestPoint) {
  routeDs.entities.add({
    id: "route-highest-point",
    position: Cartesian3.fromDegrees(highestPoint.lng, highestPoint.lat),
    billboard: {
      image: RED_FLAG_ICON,
      width: 36,
      height: 44,
      verticalOrigin: VerticalOrigin.BOTTOM,
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: `จุดสูงสุดบนเส้นทาง\n${formatElevationMeters(highestPoint.elevationM)}`,
      font: "600 13px 'Sarabun', sans-serif",
      fillColor: Color.WHITE,
      style: LabelStyle.FILL_AND_OUTLINE,
      outlineColor: Color.fromCssColorString("#111827"),
      outlineWidth: 3,
      showBackground: true,
      backgroundColor: Color.fromCssColorString("#b91c1c").withAlpha(0.88),
      backgroundPadding: new Cartesian2(8, 5),
      verticalOrigin: VerticalOrigin.BOTTOM,
      pixelOffset: new Cartesian2(0, -48),
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
}
```

Add `routeElevationProfile` to the route drawing effect dependencies.

- [x] **Step 7: Run focused tests and TypeScript validation**

Run:

```powershell
node --import tsx --test lib/map/routeElevation.test.ts tests/route-elevation-flags.test.ts
npx tsc --noEmit
```

Expected: 7 tests pass, 0 fail; TypeScript exits 0.

- [x] **Step 8: Preserve the dirty-worktree boundary**

Run:

```powershell
git diff --check -- components/map/CesiumMap.tsx lib/map/routeElevation.ts lib/map/routeElevation.test.ts tests/route-elevation-flags.test.ts package.json
git status --short
```

Expected: no whitespace errors. Do not commit `components/map/CesiumMap.tsx` or `package.json` wholesale because both contain earlier/shared modifications; report these intended changes as uncommitted unless their hunks can be isolated without staging other work.

### Task 3: Full Regression and Browser Verification

**Files:**
- Verify only; do not create or modify production files

**Interfaces:**
- Consumes: completed red flag entities and route elevation profile from Tasks 1–2
- Produces: test/build/browser evidence for handoff

- [x] **Step 1: Run the complete unit suite**

Run:

```powershell
npm test
```

Expected: all registered tests pass, including `routeElevation.test.ts`, `route-elevation-flags.test.ts`, panel-collapse tests, GIS tests, border tests, and existing security/unit tests.

- [x] **Step 2: Run the production build**

Run:

```powershell
npm run build
```

Expected: Next.js compilation, TypeScript validation, static generation, and `/map` route build all succeed.

- [x] **Step 3: Verify localhost availability**

Run:

```powershell
(Invoke-WebRequest -UseBasicParsing http://localhost:3000/map).StatusCode
```

Expected: `200`. If the build stopped the dev process, restart this repository's `npm run dev` process and verify the bound listener before continuing.

- [x] **Step 4: Verify the school flag in the browser**

Open a non-national `/map` school view and confirm:

- the school uses a red flag rather than a red dot;
- its label contains the school name and a numeric elevation in metres;
- dragging the school flag still selects `center-pin`, relocates the school, and recomputes the route.

- [x] **Step 5: Verify the selected-route highest flag in the browser**

After the route and terrain finish loading, confirm:

- a second red flag appears directly on the selected blue road route;
- its label says `จุดสูงสุดบนเส้นทาง` and shows a numeric elevation;
- switching route 1/2/3 moves or recalculates the second flag;
- the blue province-hall marker remains visible.

- [x] **Step 6: Verify failure and regression behavior**

Confirm that the panel collapse/expand control still works, there is no browser error overlay or console error, and no UI ever displays `0 ม.` when terrain data is unavailable.

- [x] **Step 7: Final diff audit**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors; all unrelated dirty files remain present and unchanged by this feature. Record exact test totals, build result, HTTP result, and browser observations in the final handoff.
