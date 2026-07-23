import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import SettingSuggestionCard from "./SettingSuggestionCard";
import type { TerrainSuggestion } from "@/lib/types";

const sug: TerrainSuggestion = {
  settingType: "ภูเขาสูง",
  rationale: "ภาพแสดงยอดเขาสูงชันล้อมรอบทุกด้าน",
  confidence: "high",
  analyzedAt: "2026-07-23T00:00:00.000Z",
};

describe("SettingSuggestionCard", () => {
  test("แสดง settingType + เหตุผล + ระดับความมั่นใจไทย", () => {
    const html = renderToStaticMarkup(<SettingSuggestionCard suggestion={sug} current="" onUse={() => {}} />);
    assert.match(html, /ภูเขาสูง/);
    assert.match(html, /ยอดเขาสูงชัน/);
    assert.match(html, /สูง/); // high → สูง
  });
  test("current ตรงกับที่แนะ → ไม่มีปุ่ม 'ใช้ค่านี้' (แสดงว่าตรงแล้ว)", () => {
    const html = renderToStaticMarkup(<SettingSuggestionCard suggestion={sug} current="ภูเขาสูง" onUse={() => {}} />);
    assert.doesNotMatch(html, /ใช้ค่านี้/);
    assert.match(html, /ตรงกับที่เลือกไว้/);
  });
  test("current ต่าง → มีปุ่ม 'ใช้ค่านี้'", () => {
    const html = renderToStaticMarkup(<SettingSuggestionCard suggestion={sug} current="เกาะ" onUse={() => {}} />);
    assert.match(html, /ใช้ค่านี้/);
  });
});
