"use client";

import type { SettingType, TerrainSuggestion } from "@/lib/types";

interface Props {
  suggestion: TerrainSuggestion;
  current: SettingType | "";
  onUse: (t: SettingType) => void;
}

const CONFIDENCE_TH: Record<TerrainSuggestion["confidence"], string> = {
  high: "สูง",
  medium: "ปานกลาง",
  low: "ต่ำ",
};

export default function SettingSuggestionCard({ suggestion, current, onUse }: Props) {
  const matches = current === suggestion.settingType;
  return (
    <div className="setting-suggestion">
      <p className="setting-suggestion-head">
        🤖 AI แนะนำลักษณะที่ตั้ง: <strong>{suggestion.settingType}</strong>{" "}
        <span className="setting-suggestion-conf">(ความมั่นใจ {CONFIDENCE_TH[suggestion.confidence]})</span>
      </p>
      {suggestion.rationale ? <p className="setting-suggestion-why">{suggestion.rationale}</p> : null}
      {matches ? (
        <span className="setting-suggestion-matched">✓ ตรงกับที่เลือกไว้</span>
      ) : (
        <button type="button" className="ghost-btn setting-suggestion-use" onClick={() => onUse(suggestion.settingType)}>
          ใช้ค่านี้
        </button>
      )}
    </div>
  );
}
