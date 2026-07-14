// จัดเก็บไฟล์หลักฐานบน filesystem — server-only (ห้าม import จากไฟล์ที่ client อ่านด้วย เช่น lib/state.ts)
// โครงสร้าง: uploads/{assessmentId}/{indicatorId}/{fileId} — fileId เป็น UUID จึงใช้เป็นชื่อไฟล์บนดิสก์ได้ตรง ๆ อย่างปลอดภัย

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AllowedMimeType } from "./upload-constants";

const UPLOAD_ROOT = path.join(process.cwd(), "uploads");

/** ตรวจรูปแบบ UUID v4 ของ fileId ที่รับมาจาก URL — กัน path traversal ก่อนใช้ต่อ path.join ใด ๆ */
export const FILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ตรวจชนิดไฟล์จริงจาก "magic bytes" ของเนื้อไฟล์ — ไม่เชื่อ Content-Type ที่ client ส่งมา (ปลอมได้)
 * คืนชนิดที่ตรวจพบเมื่อเป็นชนิดที่อนุญาตเท่านั้น (JPEG/PNG/WebP/PDF) มิฉะนั้นคืน null
 */
export function sniffMimeType(buffer: Buffer): AllowedMimeType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  // WebP: "RIFF"<4 ไบต์ขนาด>"WEBP"
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  // PDF: "%PDF-"
  if (buffer.length >= 5 && buffer.toString("ascii", 0, 5) === "%PDF-") {
    return "application/pdf";
  }
  return null;
}

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
