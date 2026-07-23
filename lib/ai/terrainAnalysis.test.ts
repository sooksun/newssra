import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseTerrainResponse, TerrainAnalysisError } from "./terrainAnalysis";

describe("parseTerrainResponse", () => {
  test("ผลถูกต้อง → คืนค่า", () => {
    const out = parseTerrainResponse({
      settingType: "ภูเขาสูง",
      rationale: "ภาพแสดงยอดเขาสูงชันล้อมรอบ",
      confidence: "high",
    });
    assert.equal(out.settingType, "ภูเขาสูง");
    assert.equal(out.confidence, "high");
    assert.ok(out.rationale.includes("ยอดเขา"));
  });
  test("settingType นอก enum → throw bad-content", () => {
    assert.throws(
      () => parseTerrainResponse({ settingType: "ดาวอังคาร", rationale: "x", confidence: "high" }),
      (e: unknown) => e instanceof TerrainAnalysisError && e.code === "bad-content",
    );
  });
  test("confidence ผิดค่า → throw bad-content", () => {
    assert.throws(
      () => parseTerrainResponse({ settingType: "เกาะ", rationale: "x", confidence: "สูงมาก" }),
      (e: unknown) => e instanceof TerrainAnalysisError && e.code === "bad-content",
    );
  });
  test("rationale ยาวเกิน 500 → cap", () => {
    const out = parseTerrainResponse({ settingType: "หุบเขา", rationale: "ก".repeat(800), confidence: "low" });
    assert.equal(out.rationale.length, 500);
  });
  test("ไม่ใช่ object / ขาด field → throw bad-content", () => {
    assert.throws(() => parseTerrainResponse(null), (e: unknown) => e instanceof TerrainAnalysisError);
    assert.throws(() => parseTerrainResponse({ settingType: "เกาะ" }), (e: unknown) => e instanceof TerrainAnalysisError);
  });
});
