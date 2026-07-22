import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// CesiumMap.tsx is browser-only (Cesium), so it can't render under renderToStaticMarkup —
// same constraint as tests/route-elevation-flags.test.ts / tests/map-panel-collapse.test.ts.
// These UI hints describe what the map's single save button will do, and that button always
// writes to the school's current-year assessment (POST /api/assessments/from-map), never to
// whichever record ?assessment=ID happened to open (see 106e1ae for the save-button version of
// this fix). So both hints must gate on currentYearAssessment.submitted, not assessment.submitted.
const component = readFileSync("components/map/CesiumMap.tsx", "utf8");

test("destination-add hint (เพิ่มจุดหมาย อำเภอ/รพ.) gates on the current-year assessment", () => {
  assert.match(
    component,
    /assessment && !national && !currentYearAssessment\?\.submitted \? \(/,
    "the confirm-coord/destination-add branch must check currentYearAssessment.submitted, not assessment.submitted",
  );
});

test("area-summary 'will be saved together' note gates on the current-year assessment", () => {
  assert.match(
    component,
    /assessment && !currentYearAssessment\?\.submitted && canSaveAssessment/,
    "the area-summary save note must check currentYearAssessment.submitted, not assessment.submitted",
  );
});

test("neither hint reads assessment.submitted directly anymore", () => {
  // Only lib/map.tsx's own `submitted: assessment.submitted` field passthrough (constructing the
  // GisAssessmentTarget prop) and the MapAssessment type's doc comment should mention it — no
  // conditional gate in the JSX should test `assessment.submitted` truthiness directly.
  const gateUses = component.match(/!assessment\.submitted/g) ?? [];
  assert.equal(gateUses.length, 0, "no remaining UI gate should negate assessment.submitted directly");
});
