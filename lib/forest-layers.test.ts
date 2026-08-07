import assert from "node:assert/strict";
import test from "node:test";
import {
  FOREST_CONTEXT_STRONG_1KM_PCT,
  buildForestAnalysis,
  cleanForestAnalysis,
  deriveContextStrength,
  isHighElevLowForestContext,
  legalLayerFromOverlay,
  type ForestStatusLayer,
} from "./forest-layers";
import type { ForestOverlayResult } from "./map/forestBoundaries";

function osmLegal(status: ForestOverlayResult["status"], kind: "national_reserved_forest" | "national_park"): ForestOverlayResult {
  return {
    version: "fo-2",
    status,
    nearestDistanceM: status === "in" ? 0 : status === "near" ? 400 : 2000,
    zones:
      status === "in" || status === "near"
        ? [
            {
              name: kind === "national_park" ? "อุทยานทดสอบ" : "ป่าสงวนทดสอบ",
              kind,
              relation: status === "in" ? "in" : "near",
              distanceM: status === "in" ? 0 : 400,
            },
          ]
        : [],
    dataAuthority: "osm-reference",
    dataSource: "OSM",
    attribution: "©",
    calculatedAt: "t",
  };
}

const rfdStatus = (over: Partial<ForestStatusLayer>): ForestStatusLayer => ({
  inside: 0,
  distanceM: 500,
  pct1km: 10,
  pct3km: 20,
  pct5km: 30,
  yearBe: 2568,
  gridResolutionM: 10,
  authority: "rfd-forest-cover",
  dataSource: "กรมป่าไม้ แผนที่ป่าไม้ พ.ศ. 2568",
  attribution: "กรมป่าไม้",
  ...over,
});

test("legalLayerFromOverlay: ป่าสงวน → reserve_forest=1, อุทยาน → protected_area=1", () => {
  const reserve = legalLayerFromOverlay(osmLegal("in", "national_reserved_forest"));
  assert.equal(reserve?.inside, 1);
  assert.equal(reserve?.reserveForest, 1);
  assert.equal(reserve?.protectedArea, 0);

  const park = legalLayerFromOverlay(osmLegal("in", "national_park"));
  assert.equal(park?.protectedArea, 1);
  assert.equal(park?.reserveForest, 0);
});

test("metrics: ไม่มี status → pct เป็น null (ห้ามเดา 0) และ inside จาก legal พร้อม insideSource", () => {
  const a = buildForestAnalysis({ legalOverlay: osmLegal("in", "national_park"), calculatedAt: "t" });
  assert.equal(a.metrics.forest_1km_pct, null);
  assert.equal(a.metrics.forest_3km_pct, null);
  assert.equal(a.metrics.forest_inside, 1);
  assert.equal(a.metrics.insideSource, "legal");
  assert.equal(a.contextStrength, "unknown");
  assert.ok(a.missing.some((m) => m.includes("สภาพพื้นที่ป่า")));
});

test("metrics: status เป็นหลัก — inside/distance/pct จาก RFD", () => {
  const a = buildForestAnalysis({
    status: rfdStatus({ inside: 1, distanceM: 0, pct1km: 62.4, pct3km: 78.1, pct5km: 83.7 }),
    legalOverlay: osmLegal("out", "national_reserved_forest"),
    type: {
      typeLabelTh: "ป่าดิบเขา",
      typeCode: "hill_evergreen",
      authority: "dnp-forest-type",
      dataSource: "DNP",
      attribution: "กรมอุทยานฯ",
    },
    calculatedAt: "t",
  });
  assert.equal(a.metrics.forest_inside, 1);
  assert.equal(a.metrics.insideSource, "status");
  assert.equal(a.metrics.forest_1km_pct, 62.4);
  assert.equal(a.metrics.forest_3km_pct, 78.1);
  assert.equal(a.metrics.forest_5km_pct, 83.7);
  assert.equal(a.metrics.forest_type, "ป่าดิบเขา");
  assert.equal(a.contextStrength, "strong");
});

test("deriveContextStrength: strong / weak / none", () => {
  assert.equal(deriveContextStrength(rfdStatus({ inside: 1, pct1km: 5 })), "strong");
  assert.equal(
    deriveContextStrength(rfdStatus({ inside: 0, pct1km: FOREST_CONTEXT_STRONG_1KM_PCT, pct3km: 10 })),
    "strong",
  );
  assert.equal(deriveContextStrength(rfdStatus({ inside: 0, pct1km: 20, pct3km: 10 })), "weak");
  assert.equal(deriveContextStrength(rfdStatus({ inside: 0, pct1km: 5, pct3km: 5, distanceM: 5000 })), "none");
  assert.equal(deriveContextStrength(null), "unknown");
});

test("isHighElevLowForestContext: เมืองบนดอย", () => {
  assert.equal(isHighElevLowForestContext({ elevGate: true, largeCommunity: true, forest1kmPct: 5 }), true);
  assert.equal(isHighElevLowForestContext({ elevGate: true, largeCommunity: true, forest1kmPct: 50 }), false);
  assert.equal(isHighElevLowForestContext({ elevGate: true, largeCommunity: false, forest1kmPct: 5 }), false);
  assert.equal(isHighElevLowForestContext({ elevGate: true, largeCommunity: true, forest1kmPct: null }), false);
});

test("cleanForestAnalysis round-trip บางส่วน", () => {
  const raw = {
    status: rfdStatus({ inside: 0, pct1km: 55 }),
    legal: legalLayerFromOverlay(osmLegal("near", "national_reserved_forest")),
    calculatedAt: "2026-08-07T00:00:00.000Z",
  };
  const cleaned = cleanForestAnalysis(raw);
  assert.ok(cleaned);
  assert.equal(cleaned!.metrics.forest_1km_pct, 55);
  assert.equal(cleaned!.contextStrength, "strong");
  assert.equal(cleaned!.metrics.reserve_forest, 0); // near ไม่นับ inside สงวน
});

test("cleanForestAnalysis ว่าง → undefined", () => {
  assert.equal(cleanForestAnalysis({}), undefined);
  assert.equal(cleanForestAnalysis(null), undefined);
});
