# Map-to-Assessment Autofill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มปุ่มเดียวบนหน้า Cesium สำหรับบันทึกผล GIS ไปยังแบบประเมินปีปัจจุบัน โดยสร้างแบบร่างใหม่หรือปรับปรุงฉบับเดิมแบบ atomic และเปิดฉบับที่ส่งแล้วแบบอ่านอย่างเดียว

**Architecture:** ขยายสัญญา `GisAnalysis` ให้เก็บค่าความสูงจากแหล่งเดียวกับธงแดงและข้อมูลประกอบทั้งหมด จากนั้นแยกการตรวจ payload/คำนวณ GIS ฝั่ง server เป็นโมดูลร่วม API เดิมและ API ใหม่ API `POST /api/assessments/from-map` จะใช้ transaction และ unique key `(owner_school_code, assessment_year)` เพื่อเลือกสร้าง/ปรับปรุง/ล็อกแบบประเมินอย่างปลอดภัย ก่อนส่ง assessment ID กลับให้หน้าแผนที่นำทางไปยังแบบฟอร์ม

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Cesium 1.143, MySQL/MariaDB ผ่าน `mysql2/promise`, Node test runner, React DOM server rendering

## Global Constraints

- หนึ่งโรงเรียนมีแบบประเมินได้ปีละ 1 ฉบับ โดยปีเป็นปี พ.ศ. ปัจจุบันตาม `Asia/Bangkok`
- ใช้ `schoolCode` จาก session เท่านั้น ห้ามรับเจ้าของแบบประเมินจาก client
- แบบร่างแก้ไขได้; แบบที่ส่งแล้วห้ามเปลี่ยน GIS หรือคะแนนและต้องเปิดดูฉบับเดิม
- การสร้าง/ปรับปรุง assessment, GIS และคำตอบมิติที่ 3 ต้องอยู่ใน transaction เดียว
- `schoolMarkerElevationM` ต้องมาจากจุดปลายทางโรงเรียนใน route elevation profile ห้ามใช้ค่าเฉลี่ยพื้นที่แทน
- ธงจุดสูงสุด พิกัด และค่าที่บันทึกต้องใช้ `routeElevationProfile.highestPoint` ชุดเดียวกัน
- กรอกอัตโนมัติเฉพาะข้อมูลที่มีแหล่งจริง; `totalStudents` และ `areaOffice` คงว่างเมื่อ master data ไม่มีค่า
- ผล GIS เป็นข้อมูลประกอบแบบอ่านอย่างเดียว แต่คำตอบมิติที่ 3 ที่กรอกอัตโนมัติยังแก้ได้ก่อนส่ง
- รองรับ assessment เก่าที่ไม่มีฟิลด์ GIS ใหม่ โดยแสดง “ไม่มีข้อมูล” และไม่สร้างค่าทดแทน
- รักษาการเปลี่ยนแปลงเดิมที่ยังไม่ commit ใน worktree และ stage เฉพาะไฟล์ของแต่ละ task

---

## File Structure

- `lib/types.ts` — สัญญาข้อมูล GIS, ring summary, route highest point และผลลัพธ์ API
- `lib/gis.ts` — allowlist/clamp/finalize ฟิลด์ GIS ใหม่และการรองรับ JSON รุ่นเก่า
- `lib/map/routeElevation.ts` — แหล่งความจริงของความสูงหมุดโรงเรียนและจุดสูงสุดบนเส้นทาง
- `lib/assessment-year.ts` — คำนวณปี พ.ศ. ตามเขตเวลาไทยแบบทดสอบได้
- `lib/map-assessment.ts` — pure functions สำหรับ prefill และรวม GIS/คำตอบมิติที่ 3 เข้ากับ state
- `lib/gis-request.ts` — parse วัตถุดิบจากแผนที่และสร้างผล GIS ที่ server ตรวจแล้ว
- `lib/repo.ts` — lookup โรงเรียน–ปีและ transaction create/update/locked
- `lib/db.ts`, `scripts/init-db.mjs` — audit duplicate และ unique index โรงเรียน–ปี
- `app/api/assessments/from-map/route.ts` — atomic endpoint ใหม่
- `app/api/assessments/[id]/gis/route.ts` — เปลี่ยนมาใช้ตัวประมวลผล GIS ร่วม
- `app/map/page.tsx`, `components/map/CesiumMapLoader.tsx` — ส่งสิทธิ์บันทึกและ assessment ของปีปัจจุบันลง client
- `components/map/CesiumMap.tsx` — สร้าง payload จากข้อมูลที่แสดงจริงและนำทางหลังบันทึก
- `components/map/GisAssessmentPanel.tsx` — ปุ่มหลักเดียวและข้อความ created/updated/locked
- `components/GisSummary.tsx`, `app/globals.css` — ส่วนข้อมูลประกอบแบบอ่านอย่างเดียว
- `tests/*.test.ts`, `tests/integration/*.test.mts`, `components/**/*.test.tsx` — unit, rendering และ MySQL integration coverage

---

### Task 1: Thai assessment year and expanded GIS contract

**Files:**
- Create: `lib/assessment-year.ts`
- Create: `tests/assessment-year.test.ts`
- Modify: `lib/types.ts:148-330`
- Modify: `lib/gis.ts:85-107, 462-655`
- Modify: `lib/state.ts:1-54`
- Modify: `lib/map/routeElevation.ts:1-69`
- Modify: `lib/map/routeElevation.test.ts`
- Modify: `tests/gis.test.ts`
- Modify: `package.json:8-18`

**Interfaces:**
- Produces: `currentBuddhistYear(now?: Date): string`
- Produces: `GisRouteHighestPoint`, `GisRadiusSummary`, `GisDataSources`
- Produces: `GisElevationInfo.schoolMarkerElevationM`, `meanElevationM`, `minElevationM`, `maxElevationM`, `reliefM`, `maxSlopePct`, `localMaxElevation1KmM`
- Produces: `GisAnalysis.radiusSummaries` and `GisAnalysis.dataSources`
- Compatibility: sanitizer accepts legacy `elevation.schoolElevationM` but emits `schoolMarkerElevationM`

- [ ] **Step 1: Write failing year and GIS compatibility tests**

```ts
test("currentBuddhistYear uses the Asia/Bangkok calendar boundary", () => {
  assert.equal(currentBuddhistYear(new Date("2026-12-31T16:59:59.000Z")), "2569");
  assert.equal(currentBuddhistYear(new Date("2026-12-31T17:00:00.000Z")), "2570");
});

test("sanitizeGis maps legacy schoolElevationM to the exact marker field", () => {
  const gis = sanitizeGis(validGis({ elevation: { schoolElevationM: 1062 } }));
  assert.equal(gis?.elevation?.schoolMarkerElevationM, 1062);
  assert.equal("schoolElevationM" in (gis?.elevation ?? {}), false);
});

test("route profile keeps school marker and highest point from the same samples", () => {
  const profile = buildRouteElevationProfile([[99, 20], [99.1, 20.1]], [1070, 1062]);
  assert.deepEqual(profile.highestPoint, { lng: 99, lat: 20, elevationM: 1070 });
  assert.equal(profile.schoolElevationM, 1062);
});
```

- [ ] **Step 2: Run the focused tests and confirm the contract is missing**

Run: `node --import tsx --test tests/assessment-year.test.ts tests/gis.test.ts lib/map/routeElevation.test.ts`

Expected: FAIL because `currentBuddhistYear` and `schoolMarkerElevationM` do not exist.

- [ ] **Step 3: Add the deterministic Thai-year helper**

```ts
export function currentBuddhistYear(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).formatToParts(now);
  const gregorianYear = Number(parts.find((part) => part.type === "year")?.value);
  if (!Number.isInteger(gregorianYear)) throw new Error("cannot resolve Asia/Bangkok year");
  return String(gregorianYear + 543);
}
```

- [ ] **Step 4: Replace the ambiguous elevation contract and add supporting records**

```ts
export interface GisRouteHighestPoint {
  lat: number;
  lng: number;
  elevationM: number;
}

export interface GisRadiusSummary {
  radiusM: 500 | 1000 | 1500;
  buildingCount: number;
  estPopulation: number | null;
  popDensityPerKm2: number | null;
}

export interface GisDataSources {
  terrain: "Terrarium DEM";
  routing: "OSRM";
  buildings: "Microsoft Building Footprints" | null;
  populationMethod: "building-count-x-provincial-household-size" | null;
  analyzedAt: string;
}

export interface GisElevationInfo {
  schoolMarkerElevationM: number | null;
  meanElevationM: number | null;
  minElevationM: number | null;
  maxElevationM: number | null;
  reliefM: number | null;
  meanSlopePct: number | null;
  maxSlopePct: number | null;
  localMaxElevation1KmM: number | null;
  slopeClass: string;
  landformTh: string;
  terrainConfidence: "client";
  provinceAvgElev?: number | null;
  routeFullMaxElev?: number | null;
  routeTailMaxElev?: number | null;
}
```

Add optional `highestPoint?: GisRouteHighestPoint | null` to `GisRouteAnalysis`, and optional `radiusSummaries?: GisRadiusSummary[]` plus `dataSources?: GisDataSources` to `GisAnalysis`. Update all community/scoring reads from `schoolElevationM` to `schoolMarkerElevationM`. Change `makeBlankState` to `makeBlankState(year = currentBuddhistYear())` and assign that argument to `unit.year`, removing the hard-coded `2569`.

- [ ] **Step 5: Extend the allowlist and legacy reader**

Implement `cleanHighestPoint`, `cleanRadiusSummaries`, and `cleanDataSources` in `lib/gis.ts`. In `cleanElevation`, use:

```ts
schoolMarkerElevationM: cleanNullableNum(
  e.schoolMarkerElevationM !== undefined ? e.schoolMarkerElevationM : e.schoolElevationM,
  GIS_LIMITS.elevationM,
  0,
),
meanElevationM: cleanNullableNum(e.meanElevationM, GIS_LIMITS.elevationM, 0),
minElevationM: cleanNullableNum(e.minElevationM, GIS_LIMITS.elevationM, 0),
maxElevationM: cleanNullableNum(e.maxElevationM, GIS_LIMITS.elevationM, 0),
reliefM: cleanNullableNum(e.reliefM, GIS_LIMITS.elevationM, 0),
maxSlopePct: cleanNullableNum(e.maxSlopePct, GIS_LIMITS.slopePct, 1),
localMaxElevation1KmM: cleanNullableNum(e.localMaxElevation1KmM, GIS_LIMITS.elevationM, 0),
```

Only attach optional arrays/source metadata when validation succeeds, so old rows remain readable.

- [ ] **Step 6: Run focused tests and the type checker through build**

Run: `node --import tsx --test tests/assessment-year.test.ts tests/gis.test.ts lib/map/routeElevation.test.ts`

Expected: all focused tests PASS.

Run: `npm run build`

Expected: production build PASS after every old `schoolElevationM` read is migrated.

- [ ] **Step 7: Commit the contract**

```powershell
git add -- lib/assessment-year.ts tests/assessment-year.test.ts lib/types.ts lib/gis.ts lib/state.ts lib/map/routeElevation.ts lib/map/routeElevation.test.ts tests/gis.test.ts tests/state.test.ts package.json
git commit -m "feat: expand map assessment GIS contract"
```

---

### Task 2: Shared server-side GIS request processor

**Files:**
- Create: `lib/gis-request.ts`
- Create: `tests/gis-request.test.ts`
- Modify: `app/api/assessments/[id]/gis/route.ts:37-229`
- Modify: `package.json:8-18`

**Interfaces:**
- Consumes: expanded GIS types from Task 1
- Produces: `buildGisFromMapRequest(input, context): GisRequestResult`
- Produces: `GisRequestError` with stable `code` values
- Existing `/api/assessments/[id]/gis` remains backward compatible

- [ ] **Step 1: Write failing tests for raw-route recomputation and field rejection**

```ts
test("buildGisFromMapRequest recomputes route ratios and keeps validated terrain evidence", () => {
  const result = buildGisFromMapRequest(rawBody, {
    schoolCode: "57000001",
    provinceName: "เชียงราย",
    provinceAvgElev: 544,
    now: "2026-07-22T05:00:00.000Z",
    previousAreaSummary: undefined,
    previouslyApplied: false,
  });
  assert.equal(result.gis.routes[0].roadCircuityRatio, 1.2);
  assert.equal(result.gis.elevation?.schoolMarkerElevationM, 1062);
  assert.deepEqual(result.gis.routes[0].highestPoint, { lat: 20.3, lng: 99.5, elevationM: 1070 });
});

test("buildGisFromMapRequest rejects invalid center coordinates", () => {
  assert.throws(
    () => buildGisFromMapRequest({ center: { lat: 999, lng: 99 } }, context),
    (error: unknown) => error instanceof GisRequestError && error.code === "INVALID_CENTER",
  );
});
```

- [ ] **Step 2: Run the new test and confirm the processor is absent**

Run: `node --import tsx --test tests/gis-request.test.ts`

Expected: FAIL with module/function not found.

- [ ] **Step 3: Implement the shared processor**

```ts
export type GisRequestErrorCode = "INVALID_CENTER" | "INVALID_GIS" | "NO_VALID_ROUTE";

export class GisRequestError extends Error {
  constructor(public readonly code: GisRequestErrorCode, message: string) {
    super(message);
  }
}

export interface GisRequestContext {
  schoolCode: string;
  provinceName: string;
  provinceAvgElev: number | null;
  now: string;
  previousAreaSummary: GisAreaSummary | undefined;
  previouslyApplied: boolean;
  requireProvinceRoute?: boolean;
}

export interface GisRequestResult {
  gis: GisAnalysis;
  droppedRoutes: string[];
}

export function buildGisFromMapRequest(input: unknown, context: GisRequestContext): GisRequestResult {
  if (!input || typeof input !== "object") {
    throw new GisRequestError("INVALID_GIS", "รูปแบบข้อมูล GIS ไม่ถูกต้อง");
  }
  const body = input as Record<string, unknown>;
  const center = body.center && typeof body.center === "object"
    ? body.center as Record<string, unknown>
    : {};
  const lat = typeof center.lat === "number" ? center.lat : Number.NaN;
  const lng = typeof center.lng === "number" ? center.lng : Number.NaN;
  if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) {
    throw new GisRequestError("INVALID_CENTER", "พิกัดศูนย์กลางไม่ถูกต้อง");
  }

  const routes: GisRouteAnalysis[] = [];
  const droppedRoutes: string[] = [];
  for (const item of Array.isArray(body.routes) ? body.routes.slice(0, MAX_GIS_ROUTES) : []) {
    const raw = toRawRoute(item);
    if (!raw) continue;
    const route = buildRouteAnalysis(lat, lng, raw, context.now);
    if (!route) {
      droppedRoutes.push(`เส้นทางไป${raw.destinationName || "จุดหมาย"}: ข้อมูลใช้ไม่ได้`);
      continue;
    }
    const issue = routePhysicsIssue(route.roadDistanceKm, route.straightDistanceKm, route.averageSpeedKmh);
    if (issue) {
      droppedRoutes.push(`เส้นทางไป${route.destinationName || "จุดหมาย"}: ${issue}`);
      continue;
    }
    routes.push({ ...route, highestPoint: cleanRouteHighestPoint(item) });
  }
  if (context.requireProvinceRoute && !routes.some((route) => route.destinationType === "province_hall")) {
    throw new GisRequestError("NO_VALID_ROUTE", "ยังไม่มีเส้นทางจากศาลากลางจังหวัดที่ใช้ได้");
  }

  const source = center.source === "unit" || center.source === "search" ? center.source : "map-pin";
  const draft: GisAnalysis = {
    center: {
      lat,
      lng,
      source,
      confirmedAt: context.now,
      nearestProvinceName: context.provinceName,
    },
    elevation: body.elevation && typeof body.elevation === "object"
      ? body.elevation as GisAnalysis["elevation"]
      : null,
    routes,
    autoScore: null,
    appliedToResponses: context.previouslyApplied,
    savedAt: context.now,
  };
  const incomingArea = cleanAreaSummary(body.areaSummary);
  if (incomingArea) draft.areaSummary = incomingArea;
  else if (context.previousAreaSummary) draft.areaSummary = context.previousAreaSummary;
  if (Array.isArray(body.radiusSummaries)) {
    draft.radiusSummaries = body.radiusSummaries as GisRadiusSummary[];
  }
  if (body.dataSources && typeof body.dataSources === "object") {
    draft.dataSources = body.dataSources as GisDataSources;
  }

  const clamped = clampGisPayload(draft);
  if (!clamped) throw new GisRequestError("INVALID_GIS", "ข้อมูล GIS ไม่ถูกต้อง");
  return {
    gis: finalizeGisAnalysis(clamped, {
      provinceAvgElev: context.provinceAvgElev,
      calculatedAt: context.now,
    }),
    droppedRoutes,
  };
}
```

`toRawRoute` must copy only destination type/name, destination coordinates, raw road distance/duration, gain/loss and selected state. `cleanRouteHighestPoint` must read `item.highestPoint`, accept latitude `-90..90`, longitude `-180..180`, and elevation `-500..9000`; otherwise it returns `null`. No ratio, score, community class or timestamp from the client is retained.

The implementation must require at least one valid `province_hall` route for the new main-save flow. Expose an option `requireProvinceRoute?: boolean`, default `false`, so the legacy `/gis` endpoint can still save terrain-only data while `/from-map` passes `true`.

- [ ] **Step 4: Refactor the legacy GIS route to call the shared processor**

Keep access checks, submit lock, relocation checks and `saveAssessment` in the route. Replace `toRawRoute`, the route loop, draft construction, clamp and finalize blocks with:

```ts
const { gis, droppedRoutes } = buildGisFromMapRequest(body, {
  schoolCode: existing.ownerSchoolCode ?? "",
  provinceName: near?.name ?? "",
  provinceAvgElev: near?.avgElev ?? null,
  now,
  previousAreaSummary: existing.state.gis?.areaSummary,
  previouslyApplied: existing.state.scoringVersion === "v2-gis",
});
```

Preserve the existing response shape and status codes.

- [ ] **Step 5: Verify shared logic and legacy route security**

Run: `node --import tsx --test tests/gis-request.test.ts tests/gis.test.ts`

Expected: PASS.

Run: `npm run test:integration`

Expected: existing `/gis` submit-lock, access and invalid-coordinate tests PASS or are explicitly SKIP only when MySQL is unavailable.

- [ ] **Step 6: Commit the processor refactor**

```powershell
git add -- lib/gis-request.ts tests/gis-request.test.ts app/api/assessments/[id]/gis/route.ts package.json
git commit -m "refactor: share server GIS request processing"
```

---

### Task 3: Atomic school-year persistence and safe unique index

**Files:**
- Create: `lib/map-assessment.ts`
- Create: `tests/map-assessment.test.ts`
- Modify: `lib/repo.ts:4-323, 421-449`
- Modify: `lib/db.ts:19-167`
- Modify: `scripts/init-db.mjs:21-124`
- Modify: `tests/integration/assessment-security.test.mts`
- Modify: `package.json:8-18`

**Interfaces:**
- Consumes: `currentBuddhistYear`, `deriveD3Responses`, `suggestSettingTypeFromGis`
- Produces: `prefillMapAssessmentState(master, year): AssessmentState`
- Produces: `applyMapGisToState(state, gis, options): AssessmentState`
- Produces: `saveAssessmentFromMapAtomic(input): Promise<MapAssessmentSaveResult>`
- Produces: `assessmentForSchoolYear(schoolCode, year): Promise<AssessmentRecord | null>`

- [ ] **Step 1: Write failing pure-state tests**

```ts
test("prefill creates only fields backed by school master data", () => {
  const state = prefillMapAssessmentState(
    { code: "57000001", name: "บ้านพญาไพร", province: "เชียงราย", lat: 20.32174, lng: 99.61929 },
    "2569",
  );
  assert.equal(state.unit.year, "2569");
  assert.equal(state.unit.totalStudents, "");
  assert.equal(state.unit.areaOffice, "");
});

test("applyMapGisToState fills Dimension 3 but preserves unrelated answers", () => {
  const existing = makeBlankState();
  existing.responses["1.1"] = { count: "4" };
  const next = applyMapGisToState(existing, gis, { syncUnitLocation: true });
  assert.deepEqual(next.responses["1.1"], { count: "4" });
  assert.equal(next.responses["3.2"].level, "4");
  assert.equal(next.scoringVersion, "v2-gis");
});
```

- [ ] **Step 2: Run the focused test and confirm the helpers are absent**

Run: `node --import tsx --test tests/map-assessment.test.ts`

Expected: FAIL with module/function not found.

- [ ] **Step 3: Implement pure prefill and merge behavior**

```ts
export interface SchoolAssessmentMaster {
  code: string;
  name: string;
  province: string;
  lat: number;
  lng: number;
}

export function prefillMapAssessmentState(master: SchoolAssessmentMaster, year: string): AssessmentState {
  const state = makeBlankState();
  state.unit = {
    ...state.unit,
    name: master.name,
    code: master.code,
    year,
    province: master.province,
    lat: master.lat.toFixed(6),
    lng: master.lng.toFixed(6),
    totalStudents: "",
    areaOffice: "",
  };
  return state;
}

export function applyMapGisToState(
  state: AssessmentState,
  gis: GisAnalysis,
  options: { syncUnitLocation: boolean },
): AssessmentState {
  const derived = deriveD3Responses(gis);
  const suggested = state.unit.settingType || suggestSettingTypeFromGis(gis) || "";
  const mergedGis: GisAnalysis = {
    ...gis,
    ...(gis.areaSummary
      ? { areaSummary: gis.areaSummary }
      : state.gis?.areaSummary
        ? { areaSummary: state.gis.areaSummary }
        : {}),
    ...(gis.radiusSummaries
      ? { radiusSummaries: gis.radiusSummaries }
      : state.gis?.radiusSummaries
        ? { radiusSummaries: state.gis.radiusSummaries }
        : {}),
  };
  return {
    ...state,
    unit: {
      ...state.unit,
      settingType: suggested,
      ...(options.syncUnitLocation
        ? { lat: gis.center.lat.toFixed(6), lng: gis.center.lng.toFixed(6) }
        : {}),
    },
    gis: { ...mergedGis, appliedToResponses: Object.keys(derived).length > 0 },
    responses: { ...state.responses, ...derived },
    scoringVersion: "v2-gis",
  };
}
```

- [ ] **Step 4: Add year-specific lookup and transaction result types**

```ts
export type MapAssessmentSaveAction = "created" | "updated" | "locked";

export interface MapAssessmentSaveResult {
  assessmentId: number;
  action: MapAssessmentSaveAction;
  state: AssessmentState;
}

export interface SaveAssessmentFromMapInput {
  ownerUserId: number | null;
  schoolCode: string;
  year: string;
  initialState: AssessmentState;
  gis: GisAnalysis;
  syncUnitLocation: boolean;
}
```

Implement `assessmentForSchoolYear` with `WHERE owner_school_code = ? AND assessment_year = ? LIMIT 1`. Replace `latestOwnerAssessmentForMap` calls later; do not retain draft-first selection across years.

- [ ] **Step 5: Implement the atomic transaction in `lib/repo.ts`**

Use a dedicated connection from `pool.getConnection()`, `beginTransaction()`, and:

```sql
SELECT id, state, owner_user_id, owner_school_code, created_at, updated_at
FROM assessments
WHERE owner_school_code = ? AND assessment_year = ?
LIMIT 1
FOR UPDATE
```

If the row is submitted, commit without update and return `locked`. Otherwise call `applyMapGisToState`, then use the same `summaryValues` mapping as `createAssessment`/`saveAssessment`. Insert when absent and update the selected ID when present. On `ER_DUP_ENTRY`, rollback, read the winning school-year row, and retry once only when it remains a draft. Always release the connection in `finally`.

- [ ] **Step 6: Add duplicate audit and the unique key to both schema paths**

For new databases add:

```sql
UNIQUE KEY uq_owner_school_year (owner_school_code, assessment_year)
```

For existing databases, query before ALTER:

```sql
SELECT owner_school_code, assessment_year, COUNT(*) AS n,
       GROUP_CONCAT(id ORDER BY id) AS ids
FROM assessments
WHERE owner_school_code IS NOT NULL AND owner_school_code <> ''
GROUP BY owner_school_code, assessment_year
HAVING COUNT(*) > 1
```

If rows exist, throw an error containing every `school/year/ids` group. Do not delete, merge or select a winner. Apply the same audit behavior in `lib/db.ts` and `scripts/init-db.mjs` before adding `uq_owner_school_year`.

- [ ] **Step 7: Add an integration assertion for database uniqueness**

```ts
test("database rejects a second assessment for the same school and year", { skip: !DB }, async () => {
  const first = draftState();
  first.unit.year = "2599";
  const second = draftState();
  second.unit.year = "2599";
  const id = await repo.createAssessment(first, { userId: null, schoolCode: "TESTAAAA" });
  created.push(id);
  await assert.rejects(
    repo.createAssessment(second, { userId: null, schoolCode: "TESTAAAA" }),
    (error: unknown) => (error as { code?: string }).code === "ER_DUP_ENTRY",
  );
});
```

Adjust the existing `submittedState()` fixture to year `2568` while `draftState()` remains `2569`, so the pre-existing security setup itself does not violate the new unique key.

- [ ] **Step 8: Run state and database tests**

Run: `node --import tsx --test tests/map-assessment.test.ts tests/state.test.ts`

Expected: PASS.

Run: `npm run test:integration`

Expected: transaction/security tests PASS, or SKIP only when MySQL is unavailable. If duplicate audit stops initialization, report the exact duplicate groups and resolve them only with user approval.

- [ ] **Step 9: Commit atomic persistence**

```powershell
git add -- lib/map-assessment.ts tests/map-assessment.test.ts lib/repo.ts lib/db.ts scripts/init-db.mjs tests/integration/assessment-security.test.mts package.json
git commit -m "feat: enforce atomic yearly map assessments"
```

---

### Task 4: Atomic `/api/assessments/from-map` endpoint

**Files:**
- Create: `app/api/assessments/from-map/route.ts`
- Create: `tests/integration/map-to-assessment.test.mts`
- Modify: `lib/repo.ts:421-480`
- Modify: `package.json:8-18`

**Interfaces:**
- Consumes: `requireApiRole("school")`, `currentBuddhistYear`, `buildGisFromMapRequest`, `saveAssessmentFromMapAtomic`
- Produces: `POST /api/assessments/from-map`
- Response: `{ assessmentId, action, gis, droppedRoutes }`, where action is `created | updated | locked`

- [ ] **Step 1: Write failing end-to-end route tests against MySQL**

```ts
test("POST from-map creates then updates the same current-year draft", { skip: !DB }, async () => {
  await actAs(SESSIONS.schoolA);
  const first = await route.POST(jsonRequest(NextRequest, BASE, { method: "POST", body: validPayload }));
  assert.equal(first.status, 201);
  const createdBody = await first.json();
  assert.equal(createdBody.action, "created");

  const second = await route.POST(jsonRequest(NextRequest, BASE, { method: "POST", body: validPayload }));
  assert.equal(second.status, 200);
  const updatedBody = await second.json();
  assert.equal(updatedBody.action, "updated");
  assert.equal(updatedBody.assessmentId, createdBody.assessmentId);
});

test("POST from-map returns locked and leaves submitted state unchanged", { skip: !DB }, async () => {
  const before = await repo.getAssessment(submittedId);
  const response = await route.POST(jsonRequest(NextRequest, BASE, { method: "POST", body: validPayload }));
  const body = await response.json();
  const after = await repo.getAssessment(submittedId);
  assert.equal(body.action, "locked");
  assert.deepEqual(after?.state, before?.state);
});
```

Also test unauthenticated `401`, admin/ssra `403`, empty session school code `403`, invalid center `400`, missing province route `422`, and a forged `schoolCode` in the body having no effect.

- [ ] **Step 2: Run the integration file and confirm the route is absent**

Run: `node --import tsx --experimental-test-module-mocks --test-force-exit --test tests/integration/map-to-assessment.test.mts`

Expected: FAIL because the route module does not exist, or SKIP only if MySQL is unavailable after import wiring is present.

- [ ] **Step 3: Add a master-data adapter without inventing fields**

In `lib/repo.ts`, add:

```ts
export async function schoolAssessmentMaster(schoolCode: string): Promise<SchoolAssessmentMaster | null> {
  const [location, province] = await Promise.all([
    schoolLocationByCode(schoolCode),
    schoolProvinceName(schoolCode),
  ]);
  if (!location) return null;
  return {
    code: schoolCode,
    name: location.name,
    province: province ?? "",
    lat: location.lat,
    lng: location.lng,
  };
}
```

- [ ] **Step 4: Implement the route with stable status mapping**

```ts
export async function POST(request: NextRequest) {
  const guard = await requireApiRole("school");
  if (!guard.ok) return guard.response;
  if (!guard.user.schoolCode) {
    return NextResponse.json({ error: "บัญชีนี้ยังไม่ผูกกับรหัสโรงเรียน" }, { status: 403 });
  }

  const body = await readJsonObject(request);
  const year = currentBuddhistYear();
  const master = await schoolAssessmentMaster(guard.user.schoolCode);
  if (!master) return NextResponse.json({ error: "ไม่พบข้อมูลพิกัดโรงเรียน" }, { status: 422 });

  const province = await resolveSchoolProvince(await listProvinces(), {
    schoolCode: guard.user.schoolCode,
    enteredProvince: master.province,
    lat: master.lat,
    lng: master.lng,
  });
  const initialState = prefillMapAssessmentState(master, year);
  const { gis, droppedRoutes } = buildGisFromMapRequest(body, {
    schoolCode: guard.user.schoolCode,
    provinceName: province?.name ?? master.province,
    provinceAvgElev: province?.avgElev ?? null,
    now: new Date().toISOString(),
    previousAreaSummary: undefined,
    previouslyApplied: false,
    requireProvinceRoute: true,
  });
  const result = await saveAssessmentFromMapAtomic({
    ownerUserId: guard.user.source === "local" ? guard.user.uid : null,
    schoolCode: guard.user.schoolCode,
    year,
    initialState,
    gis,
    syncUnitLocation: body.syncUnitLocation === true,
  });
  return NextResponse.json(
    { assessmentId: result.assessmentId, action: result.action, gis: result.state.gis, droppedRoutes },
    { status: result.action === "created" ? 201 : 200 },
  );
}
```

Catch `GisRequestError` and map `INVALID_CENTER/INVALID_GIS` to `400`, `NO_VALID_ROUTE` to `422`; map relocation conflict to `409`; log and return `500` for unexpected failures.

- [ ] **Step 5: Verify all route branches**

Run: `node --import tsx --experimental-test-module-mocks --test-force-exit --test tests/integration/map-to-assessment.test.mts tests/integration/assessment-security.test.mts`

Expected: created, updated, locked, auth, forged-owner, validation and legacy security tests PASS.

- [ ] **Step 6: Commit the endpoint**

```powershell
git add -- app/api/assessments/from-map/route.ts tests/integration/map-to-assessment.test.mts lib/repo.ts package.json
git commit -m "feat: add atomic map assessment endpoint"
```

---

### Task 5: Cesium payload correctness and one-button workflow

**Files:**
- Modify: `app/map/page.tsx:1-178`
- Modify: `components/map/CesiumMapLoader.tsx:1-35`
- Modify: `components/map/CesiumMap.tsx:218-251, 426-470, 1739-1954, 2209-2242, 2358-2368`
- Modify: `components/map/GisAssessmentPanel.tsx:127-310`
- Modify: `components/map/MapPanelToggle.test.tsx`
- Create: `components/map/GisAssessmentPanel.test.tsx`
- Modify: `tests/route-elevation-flags.test.ts`
- Modify: `app/globals.css`
- Modify: `package.json:8-18`

**Interfaces:**
- Consumes: atomic endpoint and expanded GIS contract
- Produces: `MapAssessment | null` filtered to the current school/year
- Produces: `canSaveAssessment: boolean`
- Produces: one button “บันทึกข้อมูลประกอบเกณฑ์และกรอกแบบประเมิน”

- [ ] **Step 1: Write failing render and source-of-truth tests**

```tsx
test("panel renders the single create-or-update action without an assessment id", () => {
  const html = renderToStaticMarkup(
    <GisAssessmentPanel assessment={null} canSaveAssessment previewGis={gis} saveState="idle" onSave={() => {}} />,
  );
  assert.match(html, /บันทึกข้อมูลประกอบเกณฑ์และกรอกแบบประเมิน/);
  assert.doesNotMatch(html, /นำผลไปคำนวณคะแนน/);
});

test("school marker payload uses the route profile endpoint height", () => {
  const source = readFileSync("components/map/CesiumMap.tsx", "utf8");
  assert.match(source, /schoolMarkerElevationM:\s*routeElevationProfile\?\.schoolElevationM/);
  assert.doesNotMatch(source, /schoolElevationM:\s*Math\.round\(analysis\.meanElev\)/);
});
```

- [ ] **Step 2: Run focused UI/source tests and confirm they fail**

Run: `node --import tsx --test components/map/GisAssessmentPanel.test.tsx tests/route-elevation-flags.test.ts`

Expected: FAIL because the panel requires `assessmentId` and Cesium still persists mean elevation as the school point.

- [ ] **Step 3: Make map-page selection year-specific**

Use `currentBuddhistYear()` and `assessmentForSchoolYear(user.schoolCode, year)` for normal school `/map`. Pass `canSaveAssessment={user.role === "school" && Boolean(user.schoolCode)}` independently from whether an assessment already exists. Keep `?assessment=ID` access behavior for explicit viewing.

- [ ] **Step 4: Build the preview from the exact displayed evidence**

Remove the `!assessment` guard from `previewGis`; retain `national` guard. Populate:

```ts
elevation: analysis
  ? {
      schoolMarkerElevationM: routeElevationProfile?.schoolElevationM ?? null,
      meanElevationM: Math.round(analysis.meanElev),
      minElevationM: Math.round(analysis.minElev),
      maxElevationM: Math.round(analysis.maxElev),
      reliefM: Math.round(analysis.relief),
      meanSlopePct: Math.round(analysis.meanSlopePct * 10) / 10,
      maxSlopePct: Math.round(analysis.maxSlopePct * 10) / 10,
      localMaxElevation1KmM: analysis.local1000Elev === null ? null : Math.round(analysis.local1000Elev),
      slopeClass: analysis.lddClass,
      landformTh: analysis.landformTh,
      terrainConfidence: "client",
      provinceAvgElev: Number.isFinite(analysis.provinceAvgElev) ? Math.round(analysis.provinceAvgElev) : null,
      routeFullMaxElev: routeElevationProfile?.highestPoint
        ? Math.round(routeElevationProfile.highestPoint.elevationM)
        : null,
      routeTailMaxElev: analysis.routeTailMaxElev === null ? null : Math.round(analysis.routeTailMaxElev),
    }
  : null,
```

Attach `highestPoint: routeElevationProfile?.highestPoint ?? null` to the selected province-hall entry returned by `buildRoutesPayload`. Custom destination routes use `highestPoint: null`. This makes the persisted maximum use the same sampled point as the red flag.

- [ ] **Step 5: Replace the assessment-specific POST with the atomic endpoint**

```ts
const saveAssessmentFromMap = useCallback(async () => {
  if (!canSaveAssessment || savingGis || !previewGis) return;
  setSavingGis(true);
  setGisSaveErr("");
  try {
    const response = await fetch("/api/assessments/from-map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        syncUnitLocation: centerDiffersFromForm,
        center: { lat: center.lat, lng: center.lng, source: centerSourceRef.current },
        elevation: previewGis.elevation,
        routes: buildRoutesPayload(),
        radiusSummaries: ringStats?.map((ring) => ({
          radiusM: ring.radiusM,
          buildingCount: ring.buildingCount,
          estPopulation: ring.population,
          popDensityPerKm2: ring.densityPerKm2,
        })),
        areaSummary: currentAreaSummary ?? undefined,
        dataSources: {
          terrain: "Terrarium DEM",
          routing: "OSRM",
          buildings: ringStats ? "Microsoft Building Footprints" : null,
          populationMethod: householdSize !== null ? "building-count-x-provincial-household-size" : null,
          analyzedAt: new Date().toISOString(),
        },
      }),
    });
    const data = await response.json() as MapAssessmentSaveResponse & { error?: string };
    if (!response.ok) throw new Error(data.error || "บันทึกข้อมูลไม่สำเร็จ");
    setSaveAction(data.action);
    window.location.assign(`/assessment/${data.assessmentId}`);
  } catch (error) {
    setGisSaveErr(error instanceof Error ? error.message : "บันทึกข้อมูลไม่สำเร็จ");
  } finally {
    setSavingGis(false);
  }
}, [canSaveAssessment, savingGis, previewGis, center, centerDiffersFromForm, ringStats, currentAreaSummary, householdSize, buildRoutesPayload]);
```

Always apply Dimension 3 server-side; remove the `applyToScores` checkbox and remove the separate area-summary send button so there is one authoritative save action.

- [ ] **Step 6: Update panel states and copy**

The button is disabled when the current-year assessment is submitted, a province-hall route is absent, route elevation is not ready, or a save is pending. Use these messages:

- `created`: “สร้างแบบประเมินปีปัจจุบันและกรอกข้อมูลแล้ว”
- `updated`: “ปรับปรุงแบบร่างปีปัจจุบันแล้ว”
- `locked`: “แบบประเมินปีปัจจุบันส่งแล้ว จึงเปิดดูได้อย่างเดียว”
- missing data: list “เส้นทางจากศาลากลางจังหวัด” and/or “ระดับความสูงจุดโรงเรียน” explicitly

- [ ] **Step 7: Run UI tests and production build**

Run: `node --import tsx --test components/map/GisAssessmentPanel.test.tsx tests/route-elevation-flags.test.ts components/map/MapPanelToggle.test.tsx`

Expected: PASS.

Run: `npm run build`

Expected: PASS with no client/server type mismatch.

- [ ] **Step 8: Commit the map workflow**

```powershell
git add -- app/map/page.tsx components/map/CesiumMapLoader.tsx components/map/CesiumMap.tsx components/map/GisAssessmentPanel.tsx components/map/GisAssessmentPanel.test.tsx components/map/MapPanelToggle.test.tsx tests/route-elevation-flags.test.ts app/globals.css package.json
git commit -m "feat: save map evidence into yearly assessment"
```

---

### Task 6: Read-only assessment evidence section

**Files:**
- Modify: `components/GisSummary.tsx:21-380`
- Create: `components/GisSummary.test.tsx`
- Modify: `app/globals.css`
- Modify: `package.json:8-18`

**Interfaces:**
- Consumes: expanded `GisAnalysis` from Task 1
- Produces: section heading “ข้อมูลประกอบเกณฑ์จากแผนที่ 3 มิติ”
- Produces: read-only terrain, route-highest, ring, polygon, source and analysis-time presentation

- [ ] **Step 1: Write failing server-render tests**

```tsx
test("GisSummary shows exact school and route-highest elevations separately", () => {
  const html = renderToStaticMarkup(<GisSummary state={stateWithExpandedGis} assessmentId={7} />);
  assert.match(html, /ระดับความสูงจุดตั้งโรงเรียน/);
  assert.match(html, /1,062/);
  assert.match(html, /จุดสูงสุดบนเส้นทาง/);
  assert.match(html, /1,070/);
  assert.match(html, /20\.30000, 99\.50000/);
});

test("legacy GIS renders missing new fields without substituting mean elevation", () => {
  const html = renderToStaticMarkup(<GisSummary state={legacyState} assessmentId={8} />);
  assert.match(html, /ระดับความสูงจุดตั้งโรงเรียน[\s\S]*ไม่มีข้อมูล/);
});
```

- [ ] **Step 2: Run the rendering test and confirm the new labels are absent**

Run: `node --import tsx --test components/GisSummary.test.tsx`

Expected: FAIL on the new heading/labels.

- [ ] **Step 3: Render all read-only evidence groups**

Change the heading to “ข้อมูลประกอบเกณฑ์จากแผนที่ 3 มิติ”. Add definition-list groups for:

- exact school marker elevation
- mean/min/max/relief and local 1 km maximum
- mean/max slope and LDD class
- full-route highest point with coordinates; last-5-km maximum
- route distance/time/RCR/TTR/speed/elevation gain
- 500/1,000/1,500 m building and estimated-population rings
- polygon area summary when present
- community class and automatic supporting score
- terrain/routing/building sources and `analyzedAt` formatted with `timeZone: "Asia/Bangkok"`

Use a common formatter:

```ts
function valueOrMissing(value: number | null | undefined, suffix = ""): string {
  return value === null || value === undefined
    ? "ไม่มีข้อมูล"
    : `${value.toLocaleString("th-TH")}${suffix}`;
}
```

Do not render inputs or mutation controls inside the evidence section. Keep the existing link back to the map, with submitted assessments labelled for viewing only.

- [ ] **Step 4: Style screen and print layouts**

Add `.gis-evidence-grid`, `.gis-radius-table`, `.gis-source-list`, and print rules that keep headings with their values and hide only navigation actions. Reuse existing panel colors and responsive table wrappers.

- [ ] **Step 5: Run rendering tests and build**

Run: `node --import tsx --test components/GisSummary.test.tsx tests/gis.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 6: Commit the assessment presentation**

```powershell
git add -- components/GisSummary.tsx components/GisSummary.test.tsx app/globals.css package.json
git commit -m "feat: show read-only map evidence in assessments"
```

---

### Task 7: Full regression, live database audit and browser acceptance

**Files:**
- Modify only if verification exposes a defect in files already listed above
- Record evidence in the implementation handoff or final response; do not create synthetic data outside `TEST*` rows

**Interfaces:**
- Consumes: all prior tasks
- Produces: evidence that created/updated/locked flows work and displayed elevations match stored state

- [ ] **Step 1: Scan the implementation for stale ambiguous fields and duplicate endpoints**

Run: `rg -n "schoolElevationM|Math\.round\(analysis\.meanElev\)|latestOwnerAssessmentForMap|applyToScores|ส่งข้อสรุปพื้นที่" app components lib tests`

Expected: only the intentional legacy-key read in `lib/gis.ts` and compatibility test remain; no mean-elevation assignment to the school marker and no separate GIS area-send action remain.

- [ ] **Step 2: Run formatting checks**

Run: `npm run format:check`

Expected: PASS. If it fails only on touched files, run `npx prettier --write` with the exact touched paths, then rerun the check.

- [ ] **Step 3: Run all unit and integration tests**

Run: `npm test`

Expected: all unit/rendering tests PASS with zero failures.

Run: `npm run test:integration`

Expected: all integration tests PASS. A SKIP is acceptable only when the output explicitly says MySQL is unavailable; browser acceptance cannot proceed until MySQL is available.

- [ ] **Step 4: Run the production build**

Run: `npm run build`

Expected: Next.js production build PASS.

- [ ] **Step 5: Audit the live school-year uniqueness migration**

Run: `npm run db:init`

Expected: `uq_owner_school_year` exists or is added successfully. If duplicate groups are reported, stop without deleting records and present the school code, year and IDs to the user for a deduplication decision.

- [ ] **Step 6: Start the app and test the create flow in Chrome**

Run: `npm run dev`

Open `http://localhost:3000/map` as a school account with no current-year assessment, complete the terrain/route analysis, and click “บันทึกข้อมูลประกอบเกณฑ์และกรอกแบบประเมิน”.

Expected: one request creates the assessment, navigates to `/assessment/{id}`, fills master-backed school fields, leaves student count/area office blank when unavailable, shows read-only GIS evidence, and fills editable Dimension 3 responses.

- [ ] **Step 7: Test update and locked flows in Chrome**

Return to `/map`, analyze and save again.

Expected: the same assessment ID opens and the action is `updated`; no second school-year row exists.

Submit the assessment, return to `/map`, and trigger the action again.

Expected: the existing ID opens read-only, action is `locked`, and database state is byte-for-byte unchanged from immediately after submission.

- [ ] **Step 8: Compare displayed and persisted elevation evidence**

For the same route, record:

- red school flag value
- red highest-route flag value and coordinates
- assessment school marker elevation
- assessment highest-route elevation and coordinates

Expected: school values match each other, highest-route values/coordinates match each other, and the school marker is not replaced by mean terrain elevation.

- [ ] **Step 9: Verify persistence and authorization**

Refresh the assessment, sign out/in, and reopen it.

Expected: evidence and Dimension 3 answers persist. A different school account receives no access to the assessment; admin/ssra behavior remains governed by existing access rules, while `/from-map` remains school-only.

- [ ] **Step 10: Commit verification-only fixes, if any**

If verification required code changes, stage only those exact files and commit:

```powershell
git commit -m "fix: close map assessment acceptance gaps"
```

If no fixes were needed, do not create an empty commit.

---

## Completion Criteria

- A school can create or update exactly one current-year assessment from `/map` with one button.
- A submitted current-year assessment is never mutated and opens by its existing ID.
- GIS and Dimension 3 changes commit or roll back together.
- Database uniqueness blocks concurrent duplicate school-year assessments.
- Both red flags use the same elevation profile values that are persisted and displayed in the assessment.
- All requested GIS support fields are stored, sanitized, rendered read-only and backward compatible.
- Unit tests, MySQL integration tests, formatting and production build pass.
- Browser checks prove created, updated and locked flows plus authorization and persistence.
