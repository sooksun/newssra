// ค่าคงที่ร่วมสำหรับไฟล์หลักฐาน — แยกจาก lib/uploads.ts (ซึ่ง import node:fs) เพื่อให้ไฟล์นี้
// ปลอดภัยสำหรับใช้ทั้งฝั่ง client (lib/state.ts ถูกใช้ใน AssessmentForm.tsx) และฝั่ง server

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB ต่อไฟล์
export const MAX_FILES_PER_INDICATOR = 10;

export const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export function isAllowedMimeType(mime: string): mime is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
