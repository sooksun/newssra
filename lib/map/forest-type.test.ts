import assert from "node:assert/strict";
import test from "node:test";
import {
  FOREST_TYPE_LABELS_TH,
  classifyForestTypeLabel,
  forestTypeLayerFromCode,
} from "./forest-type";

test("classifyForestTypeLabel ชนิดหลักไทย", () => {
  assert.equal(classifyForestTypeLabel("ป่าดิบเขาดอยอินทนนท์"), "hill_evergreen");
  assert.equal(classifyForestTypeLabel("ป่าดิบชื้น"), "tropical_evergreen");
  assert.equal(classifyForestTypeLabel("ป่าดิบแล้ง"), "dry_evergreen");
  assert.equal(classifyForestTypeLabel("ป่าเบญจพรรณ"), "mixed_deciduous");
  assert.equal(classifyForestTypeLabel("ป่าเต็งรัง"), "dry_dipterocarp");
  assert.equal(classifyForestTypeLabel("ป่าสนเขา"), "pine");
  assert.equal(classifyForestTypeLabel("ป่าชายเลน"), "mangrove");
  assert.equal(classifyForestTypeLabel("ป่าพรุ"), "peat_swamp");
});

test("forestTypeLayerFromCode", () => {
  const layer = forestTypeLayerFromCode("hill_evergreen");
  assert.ok(layer);
  assert.equal(layer!.typeLabelTh, FOREST_TYPE_LABELS_TH.hill_evergreen);
  assert.equal(layer!.authority, "dnp-forest-type");
  assert.equal(forestTypeLayerFromCode(null, null), null);
});
