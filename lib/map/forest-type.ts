// ชั้นชนิดป่า (Forest Type) — ป้ายมาตรฐานไทย + map จากรหัส
// pure; ข้อมูล geometry มาคู่กับ forest-status เมื่อชั้นรวม type
// สเปก: docs/superpowers/specs/2026-08-07-forest-three-layers-highland-design.md

import type { ForestTypeLayer } from "../forest-layers";

/**
 * ชนิดป่าย่อยที่ใช้บ่อยในงานพื้นที่สูงไทย
 * (อ้างอิงคำอธิบายชนิดป่าตามระบบนิเวศ — กรมอุทยานฯ / เอกสาร REDD+ ที่เกี่ยวข้อง)
 */
export const FOREST_TYPE_LABELS_TH = {
  tropical_evergreen: "ป่าดิบชื้น",
  dry_evergreen: "ป่าดิบแล้ง",
  hill_evergreen: "ป่าดิบเขา",
  mixed_deciduous: "ป่าเบญจพรรณ",
  dry_dipterocarp: "ป่าเต็งรัง",
  pine: "ป่าสนเขา",
  mangrove: "ป่าชายเลน",
  peat_swamp: "ป่าพรุ",
  beach: "ป่าชายหาด",
  bamboo: "ป่าไผ่",
  scrub: "ทุ่งหญ้า / ไม้พุ่ม",
  other: "ชนิดป่าอื่น / ไม่ระบุ",
} as const;

export type ForestTypeCode = keyof typeof FOREST_TYPE_LABELS_TH;

export const FOREST_TYPE_CODES = Object.keys(FOREST_TYPE_LABELS_TH) as ForestTypeCode[];

/** แมปข้อความไทย/อังกฤษหลวม ๆ → รหัส */
export function classifyForestTypeLabel(label: unknown): ForestTypeCode | null {
  if (typeof label !== "string" || !label.trim()) return null;
  const t = label.trim();
  const lower = t.toLowerCase();

  if (t.includes("ดิบเขา") || /hill\s*evergreen/i.test(t)) return "hill_evergreen";
  if (t.includes("ดิบชื้น") || /tropical\s*evergreen|moist\s*evergreen/i.test(t)) return "tropical_evergreen";
  if (t.includes("ดิบแล้ง") || /dry\s*evergreen/i.test(t)) return "dry_evergreen";
  if (t.includes("เบญจพรรณ") || /mixed\s*deciduous/i.test(t)) return "mixed_deciduous";
  if (t.includes("เต็งรัง") || /dry\s*dipterocarp|deciduous\s*dipterocarp/i.test(t)) return "dry_dipterocarp";
  if (t.includes("สนเขา") || t.includes("ป่าสน") || /pine/i.test(lower)) return "pine";
  if (t.includes("ชายเลน") || /mangrove/i.test(lower)) return "mangrove";
  if (t.includes("พรุ") || /peat/i.test(lower)) return "peat_swamp";
  if (t.includes("ชายหาด") || /beach\s*forest/i.test(t)) return "beach";
  if (t.includes("ไผ่") || /bamboo/i.test(lower)) return "bamboo";
  if (t.includes("ทุ่งหญ้า") || t.includes("ไม้พุ่ม") || /scrub|savanna/i.test(lower)) return "scrub";
  if (t.includes("ป่า")) return "other";
  return null;
}

export function forestTypeLayerFromCode(
  code: string | null | undefined,
  labelTh?: string | null,
  meta?: { dataSource?: string; attribution?: string },
): ForestTypeLayer | null {
  if (!code && !labelTh) return null;
  const known = code && (FOREST_TYPE_CODES as string[]).includes(code) ? (code as ForestTypeCode) : null;
  const fromLabel = labelTh ? classifyForestTypeLabel(labelTh) : null;
  const resolved = known ?? fromLabel;
  const th =
    (labelTh && labelTh.trim()) ||
    (resolved ? FOREST_TYPE_LABELS_TH[resolved] : null) ||
    null;
  if (!th && !resolved) return null;
  return {
    typeLabelTh: th,
    typeCode: resolved ?? (typeof code === "string" ? code.slice(0, 40) : null),
    authority: "dnp-forest-type",
    dataSource: meta?.dataSource ?? "ชั้นชนิดป่า (เมื่อมีข้อมูล)",
    attribution: meta?.attribution ?? "",
  };
}
