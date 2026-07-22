import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import GisAssessmentPanel from "./GisAssessmentPanel";
import type { GisAnalysis, GisRouteAnalysis } from "@/lib/types";

const gis: GisAnalysis = {
  center: { lat: 18, lng: 99, source: "unit", confirmedAt: "", nearestProvinceName: "เชียงใหม่" },
  elevation: null,
  routes: [],
  autoScore: null,
  appliedToResponses: false,
  savedAt: "",
};

const provinceHallRoute: GisRouteAnalysis = {
  destinationType: "province_hall",
  destinationName: "ศาลากลางจังหวัดเชียงใหม่",
  destLat: 18.79,
  destLng: 98.98,
  straightDistanceKm: 10,
  roadDistanceKm: 12,
  travelTimeMin: 20,
  roadCircuityRatio: 1.2,
  travelTimeRatio: 1.1,
  effectiveDistanceKm: 13.2,
  averageSpeedKmh: 36,
  elevationGainM: 50,
  elevationLossM: 40,
  routeSource: "osrm",
  selected: true,
  calculatedAt: "",
};

// ผล GIS ที่มีเส้นทางศาลากลางจังหวัดครบ — ใช้แยกทดสอบ gating "submitted" ออกจากการเตือนข้อมูลขาด (missingData)
const gisWithRoute: GisAnalysis = { ...gis, routes: [provinceHallRoute] };

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

test("viewing a prior-year submitted assessment does not lock the button when the current year is still a draft", () => {
  const html = renderToStaticMarkup(
    <GisAssessmentPanel
      assessment={{ id: 1, submitted: true, year: "2566" }}
      currentYear={{ year: "2568", submitted: false }}
      canSaveAssessment
      previewGis={gisWithRoute}
      routeElevationReady
      saveState="idle"
      onSave={() => {}}
    />,
  );
  assert.doesNotMatch(html, /disabled/);
  assert.doesNotMatch(html, /แบบประเมินปีปัจจุบันส่งแล้ว/);
  assert.match(html, /2566/);
  assert.match(html, /2568/);
});

test("the current-year row's submitted state locks the button regardless of which assessment is open", () => {
  const html = renderToStaticMarkup(
    <GisAssessmentPanel
      assessment={{ id: 1, submitted: false, year: "2566" }}
      currentYear={{ year: "2568", submitted: true }}
      canSaveAssessment
      previewGis={gisWithRoute}
      routeElevationReady
      saveState="idle"
      onSave={() => {}}
    />,
  );
  assert.match(html, /disabled/);
  assert.match(html, /แบบประเมินปีปัจจุบันส่งแล้ว จึงเปิดดูได้อย่างเดียว/);
});

test("viewing the current year itself shows no cross-year note", () => {
  const html = renderToStaticMarkup(
    <GisAssessmentPanel
      assessment={{ id: 1, submitted: false, year: "2568" }}
      currentYear={{ year: "2568", submitted: false }}
      canSaveAssessment
      previewGis={gisWithRoute}
      routeElevationReady
      saveState="idle"
      onSave={() => {}}
    />,
  );
  assert.doesNotMatch(html, /บันทึกจะสร้าง\/ปรับปรุงแบบประเมินปีปัจจุบัน/);
});
