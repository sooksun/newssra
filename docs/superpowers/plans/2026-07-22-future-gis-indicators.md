# เกณฑ์เสนอเพิ่ม (อนาคต) F1+F2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มเกณฑ์เสริม 2 รายการ (F1 Displacement Ratio, F2 Travel Time Ratio) คำนวณสดจาก `state.gis` แสดงใน GisSummary — ไม่นับรวมคะแนน 100

**Architecture:** derived-only — เพิ่มฟังก์ชัน pure ใน `lib/gis.ts` (ไม่แตะ schema/sanitize/scoring) แล้วเรนเดอร์ section ใหม่ใน `components/GisSummary.tsx` ด้วย CSS class เดิมทั้งหมด F1 ใช้ severity จาก `rcrSeverity` เดิม (DR เป็นส่วนกลับของ RCR — single source of truth) F2 ใช้ `ttrSeverity` เดิม

**Tech Stack:** Next.js 16 + TypeScript strict, node:test + tsx (`npm test`), ไม่มี dependency ใหม่

## Global Constraints

- `lib/gis.ts` ห้าม import `lib/scoring.ts` (กัน circular) และห้ามใช้ framework/node API — pure ล้วน
- ห้ามแตะ: `lib/scoring.ts`, `lib/criteria.ts`, `INDICATOR_IDS`, `sanitizeState`/`sanitizeGis`, `canSubmit`, flags, `/gis` route, demo totals
- ข้อความ UI เป็นภาษาไทย ป้ายกำกับต้องมีคำว่า "ไม่นับรวมในคะแนน 100"
- ห้ามรัน `npm run build` ขณะ dev server รันอยู่ (`.next/` ชนกัน)
- ชื่อ field จริงบน `GisRouteAnalysis`: `straightDistanceKm`, `roadDistanceKm`, `roadCircuityRatio`, `travelTimeRatio`

---

### Task 1: `lib/gis.ts` — `displacementRatio` + `futureIndicators` (TDD)

**Files:**
- Modify: `lib/gis.ts` (เพิ่มท้าย section "คณิตศาสตร์ตัวชี้วัด" ราวบรรทัด 130 และท้ายไฟล์ส่วน explainers)
- Test: `tests/gis.test.ts` (ไฟล์เดิม — อยู่ในสคริปต์ `test` ของ package.json แล้ว ไม่ต้องแก้สคริปต์)

**Interfaces:**
- Consumes: `primaryRoute(gis)`, `rcrSeverity(rcr)`, `ttrSeverity(ttr)`, `explainTtrTh(ttr)`, `roundTo` (ทั้งหมดมีอยู่แล้วใน `lib/gis.ts`); fixtures `makeRoute`/`makeGis` ใน `tests/gis.test.ts`
- Produces (Task 2 ใช้):
  - `displacementRatio(straightKm: number, roadKm: number): number | null`
  - `FUTURE_INDICATOR_IDS = ["F1", "F2"] as const`; `type FutureIndicatorId = "F1" | "F2"`
  - `interface FutureIndicatorResult { id: FutureIndicatorId; title: string; valueLabel: string; severity: number; score: number; maxScore: number; explain: string }`
  - `futureIndicators(gis: GisAnalysis): FutureIndicatorResult[]`

- [ ] **Step 1: เขียน failing test**

เพิ่ม import ใน `tests/gis.test.ts` (ต่อท้าย list import จาก `"../lib/gis"` — หลัง `suggestSettingTypeFromGis,`):

```ts
  displacementRatio,
  futureIndicators,
  FUTURE_INDICATOR_IDS,
```

เพิ่ม describe block ใหม่ท้ายไฟล์:

```ts
// ───────────────── เกณฑ์เสนอเพิ่ม (อนาคต) F1/F2 — ไม่นับรวมคะแนน 100 ─────────────────

describe("displacementRatio (การกระจัด ÷ ระยะถนนจริง)", () => {
  test("คำนวณและปัด 2 ตำแหน่ง", () => {
    assert.equal(displacementRatio(30, 72), 0.42);
    assert.equal(displacementRatio(10, 10), 1);
    assert.equal(displacementRatio(1, 3), 0.33);
  });
  test("guard: ค่าไม่ finite / เส้นตรงสั้นเกิน / ถนนเป็นศูนย์หรือติดลบ → null", () => {
    assert.equal(displacementRatio(Number.NaN, 10), null);
    assert.equal(displacementRatio(10, Number.NaN), null);
    assert.equal(displacementRatio(0.05, 10), null);
    assert.equal(displacementRatio(0, 10), null);
    assert.equal(displacementRatio(10, 0), null);
    assert.equal(displacementRatio(10, -5), null);
  });
});

describe("futureIndicators (F1 Displacement Ratio + F2 Travel Time Ratio)", () => {
  test("เส้นทางกันดารหนัก (fixture เดิม RCR 2.4/TTR 2.5) → F1+F2 ระดับ 4 ทั้งคู่", () => {
    const out = futureIndicators(makeGis());
    assert.equal(out.length, 2);
    const [f1, f2] = out;
    assert.equal(f1.id, "F1");
    assert.equal(f1.severity, 4);
    assert.equal(f1.score, 4);
    assert.equal(f1.maxScore, 4);
    assert.ok(f1.valueLabel.includes("0.42"));
    assert.equal(f2.id, "F2");
    assert.equal(f2.severity, 4);
    assert.equal(f2.score, 4);
    assert.equal(f2.maxScore, 4);
    assert.ok(f2.valueLabel.includes("2.50"));
  });

  test("ids ตรงกับ FUTURE_INDICATOR_IDS", () => {
    const out = futureIndicators(makeGis());
    assert.deepEqual(out.map((f) => f.id), [...FUTURE_INDICATOR_IDS]);
  });

  test("F1 severity ตามขอบ band RCR เดิมทุกจุด (1.29/1.3/1.5/1.8/2.1)", () => {
    const at = (rcr: number) =>
      futureIndicators(makeGis({ routes: [makeRoute({ roadCircuityRatio: rcr })] }))[0].severity;
    assert.equal(at(1.29), 0);
    assert.equal(at(1.3), 1);
    assert.equal(at(1.5), 2);
    assert.equal(at(1.8), 3);
    assert.equal(at(2.1), 4);
  });

  test("F1 severity สอดคล้อง rcrSeverity เสมอ (single source of truth)", () => {
    for (const rcr of [1.0, 1.29, 1.3, 1.49, 1.5, 1.79, 1.8, 2.09, 2.1, 3.5]) {
      const out = futureIndicators(makeGis({ routes: [makeRoute({ roadCircuityRatio: rcr })] }));
      assert.equal(out[0].severity, rcrSeverity(rcr));
    }
  });

  test("F2 severity ตามขอบ band TTR เดิมทุกจุด (1.29/1.3/1.6/2.0/2.5)", () => {
    const at = (ttr: number) =>
      futureIndicators(makeGis({ routes: [makeRoute({ travelTimeRatio: ttr })] }))[1].severity;
    assert.equal(at(1.29), 0);
    assert.equal(at(1.3), 1);
    assert.equal(at(1.6), 2);
    assert.equal(at(2.0), 3);
    assert.equal(at(2.5), 4);
  });

  test("ไม่มีเส้นทาง → list ว่าง", () => {
    assert.deepEqual(futureIndicators(makeGis({ routes: [] })), []);
  });

  test("เส้นตรงสั้นเกิน (DR คำนวณไม่ได้) → มีแต่ F2", () => {
    const out = futureIndicators(
      makeGis({ routes: [makeRoute({ straightDistanceKm: 0.04 })] })
    );
    assert.deepEqual(out.map((f) => f.id), ["F2"]);
  });
});
```

- [ ] **Step 2: รัน test ให้เห็นว่า fail**

Run: `npm test 2>&1 | Select-String -Pattern "displacementRatio|futureIndicators|fail" -Context 0,2`
Expected: FAIL — `displacementRatio` / `futureIndicators` is not exported (SyntaxError หรือ TypeError)

- [ ] **Step 3: implement ใน `lib/gis.ts`**

เพิ่มหลังฟังก์ชัน `computeEffectiveDistance` (หลังบรรทัด ~132):

```ts
/** อัตราส่วนการกระจัดต่อระยะทางจริง = เส้นตรง ÷ ถนน (0–1; ยิ่งต่ำ = ถนนอ้อมมาก) — ส่วนกลับของ RCR */
export function displacementRatio(straightKm: number, roadKm: number): number | null {
  if (!Number.isFinite(straightKm) || !Number.isFinite(roadKm) || straightKm <= 0.05 || roadKm <= 0) return null;
  return roundTo(straightKm / roadKm, 2);
}
```

เพิ่มท้ายไฟล์ (ก่อนหรือหลังกลุ่ม explainer ก็ได้ — วางหลัง `explainTtrTh` เพื่ออยู่ใกล้ของที่ใช้):

```ts
// ── เกณฑ์เสนอเพิ่ม (อนาคต) — ไม่นับรวมในคะแนน 100 ─────────────────────────────
// F1 Displacement Ratio (มุมมองกลับของ RCR — severity ใช้ตาราง rcrSeverity เดิม กัน band drift)
// F2 Travel Time Ratio (severity ใช้ตาราง ttrSeverity เดิม)

export const FUTURE_INDICATOR_IDS = ["F1", "F2"] as const;
export type FutureIndicatorId = (typeof FUTURE_INDICATOR_IDS)[number];

export interface FutureIndicatorResult {
  id: FutureIndicatorId;
  title: string;
  valueLabel: string;
  severity: number;
  score: number;
  maxScore: number;
  explain: string;
}

/** คำนวณเกณฑ์เสนอเพิ่มจากเส้นทางหลัก (ที่ว่าการอำเภอ/ศาลากลาง) — คืน list ว่างเมื่อไม่มีข้อมูลพอ */
export function futureIndicators(gis: GisAnalysis): FutureIndicatorResult[] {
  const route = primaryRoute(gis);
  if (!route) return [];
  const out: FutureIndicatorResult[] = [];

  const dr = displacementRatio(route.straightDistanceKm, route.roadDistanceKm);
  const drSev = rcrSeverity(route.roadCircuityRatio);
  if (dr !== null && drSev !== null) {
    const detourPct = Math.max(0, Math.round((route.roadCircuityRatio - 1) * 100));
    out.push({
      id: "F1",
      title: "อัตราส่วนการกระจัดต่อระยะทางจริง (Displacement Ratio)",
      valueLabel: `${dr.toFixed(2)} (เส้นตรง ${route.straightDistanceKm.toFixed(1)} กม. / ถนนจริง ${route.roadDistanceKm.toFixed(1)} กม.)`,
      severity: drSev,
      score: drSev,
      maxScore: 4,
      explain:
        drSev === 0
          ? "เส้นทางถนนใกล้เคียงเส้นตรง — โครงข่ายถนนเข้าถึงได้ตามปกติ"
          : `ระยะเส้นตรงเพียง ${route.straightDistanceKm.toFixed(1)} กม. แต่ต้องเดินทางจริง ${route.roadDistanceKm.toFixed(1)} กม. (อ้อมกว่าเส้นตรง ${detourPct}%)`,
    });
  }

  const ttrSev = ttrSeverity(route.travelTimeRatio);
  if (ttrSev !== null) {
    out.push({
      id: "F2",
      title: "อัตราส่วนเวลาเดินทางเทียบพื้นที่ปกติ (Travel Time Ratio)",
      valueLabel: `${route.travelTimeRatio.toFixed(2)} เท่า`,
      severity: ttrSev,
      score: ttrSev,
      maxScore: 4,
      explain: explainTtrTh(route.travelTimeRatio),
    });
  }

  return out;
}
```

หมายเหตุ: `primaryRoute` ประกาศอยู่บรรทัด ~278 หลังจุดที่เพิ่ม — hoisting ของ function declaration ทำให้เรียกได้ปกติ (แบบเดียวกับที่ `computeCommunityClass` บรรทัด 70 เรียก `derive32Severity` บรรทัด 295 อยู่แล้ว)

- [ ] **Step 4: รัน test ให้ผ่านทั้งหมด**

Run: `npm test`
Expected: PASS ทุกไฟล์ (322 + ~8 case ใหม่) — 0 failing

- [ ] **Step 5: Commit**

```bash
git add lib/gis.ts tests/gis.test.ts
git commit -m "feat: add future indicators F1 displacement ratio + F2 travel time ratio (informational)"
```

---

### Task 2: `components/GisSummary.tsx` — section "เกณฑ์เสนอเพิ่ม (อนาคต)"

**Files:**
- Modify: `components/GisSummary.tsx` (import ~บรรทัด 5-14, คำนวณ ~บรรทัด 63, JSX หลัง block `auto` ~บรรทัด 298)

**Interfaces:**
- Consumes: `futureIndicators(gis): FutureIndicatorResult[]` + `severityLabelTh(severity)` จาก `@/lib/gis` (Task 1)
- Produces: UI section เท่านั้น — ไม่มี export ใหม่

- [ ] **Step 1: เพิ่ม import + คำนวณ**

ใน import block จาก `@/lib/gis` (บรรทัด 5-14) เพิ่ม `futureIndicators,` (เรียงตามตัวอักษร — หลัง `effectiveScoringVersion,`):

```tsx
import {
  avgSpeedSeverity,
  computeCommunityClass,
  derive32Severity,
  deriveD3Responses,
  effectiveScoringVersion,
  futureIndicators,
  rcrSeverity,
  severityLabelTh,
  suggestSettingTypeFromGis,
} from "@/lib/gis";
```

หลังบรรทัด `const suggestedSetting = suggestSettingTypeFromGis(gis);` (บรรทัด ~63) เพิ่ม:

```tsx
  const future = futureIndicators(gis);
```

- [ ] **Step 2: เพิ่ม JSX section**

วางต่อจาก block `{auto ? (...) : null}` (หลังบรรทัด ~298 ก่อน `{gis.areaSummary ? ...}`):

```tsx
      {future.length > 0 ? (
        <div className="gis-compare gis-future">
          <p className="gis-compare-title">
            เกณฑ์เสนอเพิ่ม (อนาคต) — <strong>ไม่นับรวมในคะแนน 100</strong>
          </p>
          <div className="gis-table-wrap">
            <table className="gis-table gis-compare-table">
              <thead>
                <tr>
                  <th>เกณฑ์</th>
                  <th>ค่าที่วัดได้</th>
                  <th>ระดับ</th>
                  <th>คำอธิบาย</th>
                </tr>
              </thead>
              <tbody>
                {future.map((f, i) => (
                  <tr key={f.id}>
                    <td>
                      {i + 1}) {f.title}
                    </td>
                    <td>{f.valueLabel}</td>
                    <td>
                      {f.score} / {f.maxScore} ({severityLabelTh(f.severity)})
                    </td>
                    <td>{f.explain}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <span className="gis-auto-note">
            คำนวณอัตโนมัติจากเส้นทางหลัก (ที่ว่าการอำเภอ/ศาลากลาง) ที่บันทึกจากแผนที่ —
            เกณฑ์ทดลองเพื่อประกอบการพิจารณา ไม่มีผลต่อคะแนนรวมและการยื่นแบบประเมิน
          </span>
        </div>
      ) : null}
```

ใช้ class เดิมทั้งหมด (`gis-compare`, `gis-table`, `gis-auto-note`) — ไม่ต้องแก้ `globals.css`; พฤติกรรม print ตามกลุ่ม GIS เดิม (ตารางพิมพ์ได้ ปุ่มใน `.gis-actions` ถูกซ่อนอยู่แล้ว)

- [ ] **Step 3: ตรวจว่า dev server ไม่ได้รันอยู่ แล้ว build + test**

Run: `npm test` → Expected: PASS ทั้งหมด
Run: `npm run build` → Expected: build สำเร็จ ไม่มี type error (ห้ามรันขณะ dev server เปิดอยู่)

- [ ] **Step 4: ตรวจด้วยตาผ่าน dev server (ถ้าทำได้)**

เปิดแบบประเมินที่ใช้โปรไฟล์ตัวอย่าง "severe-remote" (มี `gis` blob) — ต้องเห็น section "เกณฑ์เสนอเพิ่ม (อนาคต)" มี 2 แถว F1/F2 ระดับ 4; แบบประเมินที่ไม่มี `state.gis` ต้องไม่เห็น section (เห็นบรรทัดเชิญชวนเดิม)

- [ ] **Step 5: Commit**

```bash
git add components/GisSummary.tsx
git commit -m "feat: show future indicators F1/F2 section in GIS summary"
```
