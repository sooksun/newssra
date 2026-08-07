// โหลดชั้นสถานภาพป่าจากดิสก์ (server-only) — ใช้ node:fs
// วางไฟล์ที่ data/forest-status/cells/{cellKey}.json ตาม data/forest-status/README.md
// ถ้าไม่มีไฟล์ → คืน null (ไม่ throw) เพื่อให้ Legal layer ทำงานต่อได้

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  forestStatusCellKeysAround,
  mergeForestStatusDocs,
  parseForestStatusDoc,
  type ForestStatusDoc,
} from "./forest-status";

/** รากข้อมูล — override ด้วย FOREST_STATUS_DATA_DIR */
export function forestStatusDataRoot(): string {
  if (process.env.FOREST_STATUS_DATA_DIR) return process.env.FOREST_STATUS_DATA_DIR;
  return path.join(process.cwd(), "data", "forest-status");
}

/**
 * รายการชุดข้อมูลที่ติดตั้งแล้ว (data/forest-status/manifest.json — เขียนโดยสคริปต์ติดตั้ง)
 *
 * `nationwide: true` คือคำรับรองว่าชุดนี้แปลงมาครบทุก polygon ของทั้งประเทศ ซึ่งเป็นเงื่อนไขเดียว
 * ที่ทำให้ "ไม่พบ cell" แปลว่า "ไม่มีป่าประเภทนี้แถวนี้จริง" แทนที่จะเป็น "ข้อมูลยังไม่ครบ"
 */
export interface ForestDatasetManifestEntry {
  authority: ForestStatusDoc["authority"];
  layerRole?: string | null;
  /** โฟลเดอร์ cell ของชุดนี้ (ไม่ระบุ = "cells" ตามชุดแรกที่ติดตั้งก่อนมีหลายชุด) */
  dir?: string | null;
  yearBe: number;
  dataSource: string;
  attribution: string;
  featureCount?: number;
  cellCount?: number;
  nationwide: boolean;
  installedAt?: string;
}

/** ชั้นสภาพป่าจริงเป็นชั้นหลักตามสเปก — เลือกก่อนเสมอเมื่อผู้เรียกไม่ระบุ */
const DEFAULT_AUTHORITY_ORDER: ReadonlyArray<ForestStatusDoc["authority"]> = [
  "rfd-forest-cover",
  "rfd-national-reserved-forest",
];

/** ชื่อโฟลเดอร์เดิมสำหรับชุดที่ติดตั้งไว้ก่อนระบบหลายชุด */
const LEGACY_CELL_DIR = "cells";

async function readManifest(root: string): Promise<ForestDatasetManifestEntry[]> {
  try {
    const text = await readFile(path.join(root, "manifest.json"), "utf8");
    const raw = JSON.parse(text) as unknown;
    const list = (raw as { datasets?: unknown })?.datasets;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (d): d is ForestDatasetManifestEntry =>
        !!d &&
        typeof d === "object" &&
        typeof (d as ForestDatasetManifestEntry).authority === "string" &&
        Number.isFinite((d as ForestDatasetManifestEntry).yearBe),
    );
  } catch {
    return [];
  }
}

/**
 * เลือกชุดข้อมูลที่จะใช้
 * - ระบุ authority → ต้องได้ชุดนั้นเท่านั้น ไม่ถอยไปใช้ชุดอื่นแทน (คนละความหมายกัน)
 * - ไม่ระบุ → ไล่ตามลำดับความสำคัญ: สภาพป่าจริงก่อน แล้วค่อยแนวเขตกฎหมาย
 */
function pickDataset(
  entries: readonly ForestDatasetManifestEntry[],
  authority: ForestStatusDoc["authority"] | undefined,
): ForestDatasetManifestEntry | null {
  const usable = entries.filter((d) => d.nationwide === true);
  if (authority) return usable.find((d) => d.authority === authority) ?? null;
  for (const preferred of DEFAULT_AUTHORITY_ORDER) {
    const hit = usable.find((d) => d.authority === preferred);
    if (hit) return hit;
  }
  return usable[0] ?? null;
}

async function readCell(root: string, dir: string, key: string): Promise<ForestStatusDoc | null> {
  const file = path.join(root, dir, `${key}.json`);
  try {
    const text = await readFile(file, "utf8");
    return parseForestStatusDoc(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * โหลดและรวม cell ที่ครอบรัศมีรอบจุด (ค่าเริ่มต้น 5 กม. = รัศมี context สูงสุด)
 *
 * ไม่พบ cell เลย:
 *   - manifest รับรองว่าติดตั้งครบทั้งประเทศ → คืนเอกสาร **เปล่าที่ยืนยันแล้ว** (features: [])
 *     เพื่อให้ปลายทางตอบได้ว่า "ไม่อยู่ในป่า" ซึ่งเป็นคำตอบจริงที่ใช้คัดกรองได้
 *   - ไม่มี manifest / ไม่ได้รับรอง → null (ไม่ทราบ) ห้ามเดาว่าไม่มีป่า
 */
export async function loadForestStatusAround(
  lat: number,
  lng: number,
  radiusM = 5_000,
  options?: { authority?: ForestStatusDoc["authority"] },
): Promise<ForestStatusDoc | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const root = forestStatusDataRoot();
  const manifest = await readManifest(root);
  const dataset = pickDataset(manifest, options?.authority);
  if (!dataset) return null;

  const dir = dataset.dir ?? LEGACY_CELL_DIR;
  const keys = forestStatusCellKeysAround(lat, lng, radiusM);
  const docs: ForestStatusDoc[] = [];
  for (const key of keys) {
    const doc = await readCell(root, dir, key);
    // อ่านเฉพาะ cell ที่เป็นชุดเดียวกัน — polygon ต่างชุดมีความหมายคนละอย่าง ห้ามรวมกัน
    if (doc && doc.authority === dataset.authority) docs.push(doc);
  }

  const merged = mergeForestStatusDocs(docs);
  // ยืนยันความครอบคลุมจาก manifest เท่านั้น — ไฟล์ cell เองรับรองความครบของทั้งชุดไม่ได้
  if (merged) return { ...merged, coverageConfirmed: true };

  return {
    attribution: dataset.attribution,
    dataSource: dataset.dataSource,
    yearBe: dataset.yearBe,
    authority: dataset.authority,
    layerRole: dataset.layerRole ?? null,
    gridResolutionM: null,
    coverageConfirmed: true,
    features: [],
  };
}
