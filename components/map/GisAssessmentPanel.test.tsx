import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import GisAssessmentPanel from "./GisAssessmentPanel";
import type { GisAnalysis } from "@/lib/types";

const gis: GisAnalysis = {
  center: { lat: 18, lng: 99, source: "unit", confirmedAt: "", nearestProvinceName: "เชียงใหม่" },
  elevation: null,
  routes: [],
  autoScore: null,
  appliedToResponses: false,
  savedAt: "",
};

test("panel renders the single create-or-update action without an assessment id", () => {
  const html = renderToStaticMarkup(
    <GisAssessmentPanel assessment={null} canSaveAssessment previewGis={gis} saveState="idle" onSave={() => {}} />,
  );
  assert.match(html, /บันทึกข้อมูลประกอบเกณฑ์และกรอกแบบประเมิน/);
  assert.doesNotMatch(html, /นำผลไปคำนวณคะแนน/);
});

test("panel hides the save action when the viewer cannot save (read-only view)", () => {
  const html = renderToStaticMarkup(
    <GisAssessmentPanel
      assessment={{ id: 7, submitted: false }}
      canSaveAssessment={false}
      previewGis={gis}
      saveState="idle"
      onSave={() => {}}
    />,
  );
  assert.doesNotMatch(html, /บันทึกข้อมูลประกอบเกณฑ์และกรอกแบบประเมิน/);
});

test("panel lists the missing province-hall route and school elevation before it can save", () => {
  const html = renderToStaticMarkup(
    <GisAssessmentPanel
      assessment={null}
      canSaveAssessment
      previewGis={gis}
      routeElevationReady={false}
      saveState="idle"
      onSave={() => {}}
    />,
  );
  assert.match(html, /เส้นทางจากศาลากลางจังหวัด/);
  assert.match(html, /ระดับความสูงจุดโรงเรียน/);
});
