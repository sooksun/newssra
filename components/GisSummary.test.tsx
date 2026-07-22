import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import GisSummary from "./GisSummary";
import { makeBlankState } from "@/lib/state";
import { sanitizeGis } from "@/lib/gis";
import type { AssessmentState, GisAnalysis } from "@/lib/types";

function stateWithGis(gis: GisAnalysis): AssessmentState {
  const s = makeBlankState();
  s.gis = gis;
  s.scoringVersion = gis.appliedToResponses ? "v2-gis" : undefined;
  return s;
}

const expandedGis: GisAnalysis = {
  center: {
    lat: 20.28,
    lng: 99.55,
    source: "unit",
    confirmedAt: "2569-01-15T09:00:00.000Z",
    nearestProvinceName: "เชียงราย",
  },
  elevation: {
    schoolMarkerElevationM: 1062,
    meanElevationM: 1010,
    minElevationM: 950,
    maxElevationM: 1090,
    reliefM: 140,
    meanSlopePct: 18.5,
    maxSlopePct: 30.2,
    localMaxElevation1KmM: 1080,
    slopeClass: "D: ลาดชันปานกลาง (12–20%)",
    landformTh: "หุบเขา",
    terrainConfidence: "client",
    provinceAvgElev: 380,
    routeFullMaxElev: 1120,
    routeTailMaxElev: 1090,
  },
  routes: [
    {
      destinationType: "province_hall",
      destinationName: "ศาลากลางจังหวัดเชียงราย",
      destLat: 20.32,
      destLng: 99.6,
      straightDistanceKm: 12,
      roadDistanceKm: 22,
      travelTimeMin: 35,
      roadCircuityRatio: 1.83,
      travelTimeRatio: 1.6,
      effectiveDistanceKm: 35.2,
      averageSpeedKmh: 37.7,
      elevationGainM: 320,
      elevationLossM: 210,
      routeSource: "osrm",
      selected: true,
      calculatedAt: "2569-01-15T09:00:00.000Z",
      highestPoint: { lat: 20.3, lng: 99.5, elevationM: 1070 },
    },
  ],
  autoScore: null,
  appliedToResponses: true,
  savedAt: "2569-01-15T09:00:00.000Z",
  radiusSummaries: [
    { radiusM: 500, buildingCount: 40, estPopulation: 120, popDensityPerKm2: 850 },
    { radiusM: 1000, buildingCount: 160, estPopulation: 480, popDensityPerKm2: 1200 },
    { radiusM: 1500, buildingCount: 300, estPopulation: 900, popDensityPerKm2: 1400 },
  ],
  dataSources: {
    terrain: "Terrarium DEM",
    routing: "OSRM",
    buildings: "Microsoft Building Footprints",
    populationMethod: "building-count-x-provincial-household-size",
    analyzedAt: "2569-01-15T09:00:00.000Z",
  },
};

test("GisSummary shows exact school and route-highest elevations separately", () => {
  const html = renderToStaticMarkup(<GisSummary state={stateWithGis(expandedGis)} assessmentId={7} />);
  assert.match(html, /ระดับความสูงจุดตั้งโรงเรียน/);
  assert.match(html, /1,062/);
  assert.match(html, /จุดสูงสุดบนเส้นทาง/);
  assert.match(html, /1,070/);
  assert.match(html, /20\.30000, 99\.50000/);
});

test("legacy GIS renders missing new fields without substituting mean elevation", () => {
  const legacyRaw = {
    center: {
      lat: 18.5,
      lng: 99.2,
      source: "unit",
      confirmedAt: "2568-01-01T00:00:00.000Z",
      nearestProvinceName: "เชียงราย",
    },
    // ก้อนเดิมก่อนขยาย (Task 1) — มีแค่ meanElevationM/landformTh/meanSlopePct/provinceAvgElev เก่า
    // ไม่มี schoolMarkerElevationM/min/max/relief/localMax/maxSlopePct/slopeClass/routes[].highestPoint
    elevation: {
      meanElevationM: 950,
      landformTh: "พื้นที่ราบ",
      meanSlopePct: 2,
      provinceAvgElev: 300,
    },
    routes: [
      {
        destinationType: "province_hall",
        destinationName: "ศาลากลางจังหวัดเชียงราย",
        destLat: 18.6,
        destLng: 99.3,
        straightDistanceKm: 10,
        roadDistanceKm: 15,
        travelTimeMin: 20,
        roadCircuityRatio: 1.5,
        travelTimeRatio: 1.2,
        effectiveDistanceKm: 18,
        averageSpeedKmh: 45,
        elevationGainM: 50,
        elevationLossM: 40,
        routeSource: "osrm",
        selected: true,
        calculatedAt: "2568-01-01T00:00:00.000Z",
      },
    ],
    autoScore: null,
    appliedToResponses: false,
    savedAt: "2568-01-01T00:00:00.000Z",
  };
  const gis = sanitizeGis(legacyRaw);
  assert.ok(gis, "legacy fixture must sanitize into a GisAnalysis");
  assert.equal(gis?.radiusSummaries, undefined);
  assert.equal(gis?.dataSources, undefined);
  assert.equal(gis?.elevation?.schoolMarkerElevationM, null);

  const html = renderToStaticMarkup(<GisSummary state={stateWithGis(gis as GisAnalysis)} assessmentId={8} />);
  assert.match(html, /ระดับความสูงจุดตั้งโรงเรียน[\s\S]*ไม่มีข้อมูล/);
});

test("GisSummary renders 500/1,000/1,500 m building/population rings and data sources with analyzedAt", () => {
  const html = renderToStaticMarkup(<GisSummary state={stateWithGis(expandedGis)} assessmentId={9} />);
  assert.match(html, /500/);
  assert.match(html, /1,000/);
  assert.match(html, /1,500/);
  assert.match(html, /Terrarium DEM/);
  assert.match(html, /OSRM/);
  assert.match(html, /Microsoft Building Footprints/);
});

test("GisSummary keeps the future F1/F2 section and comparisons table intact", () => {
  const html = renderToStaticMarkup(<GisSummary state={stateWithGis(expandedGis)} assessmentId={10} />);
  assert.match(html, /เกณฑ์เสนอเพิ่ม \(อนาคต\)/);
});
