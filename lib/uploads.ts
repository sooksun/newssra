// จัดเก็บไฟล์หลักฐานบน filesystem — server-only (ห้าม import จากไฟล์ที่ client อ่านด้วย เช่น lib/state.ts)
// โครงสร้าง: uploads/{assessmentId}/{indicatorId}/{fileId} — fileId เป็น UUID จึงใช้เป็นชื่อไฟล์บนดิสก์ได้ตรง ๆ อย่างปลอดภัย

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const UPLOAD_ROOT = path.join(process.cwd(), "uploads");

/** ตรวจรูปแบบ UUID v4 ของ fileId ที่รับมาจาก URL — กัน path traversal ก่อนใช้ต่อ path.join ใด ๆ */
export const FILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function indicatorDir(assessmentId: number, indicatorId: string): string {
  return path.join(UPLOAD_ROOT, String(assessmentId), indicatorId);
}

export interface SavedFileMeta {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  sha256: string;
  uploadedAt: string;
}

export async function saveEvidenceFile(
  assessmentId: number,
  indicatorId: string,
  originalName: string,
  mimeType: string,
  buffer: Buffer
): Promise<SavedFileMeta> {
  const id = randomUUID();
  const dir = indicatorDir(assessmentId, indicatorId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, id), buffer);
  return {
    id,
    originalName: originalName.slice(0, 255),
    mimeType,
    size: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    uploadedAt: new Date().toISOString(),
  };
}

export async function readEvidenceFile(assessmentId: number, indicatorId: string, fileId: string): Promise<Buffer> {
  return readFile(path.join(indicatorDir(assessmentId, indicatorId), fileId));
}

export async function deleteEvidenceFile(assessmentId: number, indicatorId: string, fileId: string): Promise<void> {
  await rm(path.join(indicatorDir(assessmentId, indicatorId), fileId), { force: true });
}

/** ลบไฟล์หลักฐานทั้งหมดของแบบประเมิน — เรียกตอนลบแบบประเมินทิ้ง กันไฟล์ค้างบนดิสก์ */
export async function deleteAllEvidenceFiles(assessmentId: number): Promise<void> {
  await rm(path.join(UPLOAD_ROOT, String(assessmentId)), { recursive: true, force: true });
}
