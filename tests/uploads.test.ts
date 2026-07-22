import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FILE_ID_PATTERN,
  deleteAllEvidenceFiles,
  deleteEvidenceFile,
  readEvidenceFile,
  saveEvidenceFile,
  sniffMimeType,
  saveSiteSnapshot,
  readSiteSnapshot,
  deleteAllSiteSnapshots,
} from "../lib/uploads";

test("FILE_ID_PATTERN — ยอมรับ UUID, ปฏิเสธ path traversal/รูปแบบผิด", () => {
  assert.equal(FILE_ID_PATTERN.test("123e4567-e89b-12d3-a456-426614174000"), true);
  assert.equal(FILE_ID_PATTERN.test("../../etc/passwd"), false);
  assert.equal(FILE_ID_PATTERN.test("..%2f..%2f"), false);
  assert.equal(FILE_ID_PATTERN.test("abc"), false);
  assert.equal(FILE_ID_PATTERN.test("123e4567e89b12d3a456426614174000"), false); // ไม่มีขีด
});

test("sniffMimeType — จับ magic bytes ได้ถูกชนิด", () => {
  assert.equal(sniffMimeType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(sniffMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);
  assert.equal(sniffMimeType(webp), "image/webp");
  assert.equal(sniffMimeType(Buffer.from("%PDF-1.7\n...")), "application/pdf");
});

test("sniffMimeType — ปฏิเสธไฟล์ที่ไม่ใช่ชนิดที่อนุญาต (กัน Content-Type ปลอม)", () => {
  assert.equal(sniffMimeType(Buffer.from([0x4d, 0x5a, 0x90, 0x00])), null); // PE/EXE (MZ)
  assert.equal(sniffMimeType(Buffer.from("<html>")), null);
  assert.equal(sniffMimeType(Buffer.from("hello world")), null);
  assert.equal(sniffMimeType(Buffer.from([])), null);
  // RIFF แต่ไม่ใช่ WEBP (เช่น WAV) → null
  const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WAVE")]);
  assert.equal(sniffMimeType(wav), null);
});

test("บันทึก → อ่าน → ลบ ไฟล์หลักฐานจริงบนดิสก์ (round-trip)", async () => {
  const id = 990001;
  const indicatorId = "1.1";
  const data = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5]);
  try {
    const meta = await saveEvidenceFile(id, indicatorId, "รูปหลักฐาน.jpg", "image/jpeg", data);
    assert.ok(FILE_ID_PATTERN.test(meta.id), "id ที่คืนต้องเป็น UUID");
    assert.equal(meta.size, data.length);
    assert.equal(meta.mimeType, "image/jpeg");
    assert.equal(meta.originalName, "รูปหลักฐาน.jpg");
    assert.match(meta.sha256, /^[0-9a-f]{64}$/);

    const read = await readEvidenceFile(id, indicatorId, meta.id);
    assert.deepEqual(read, data, "ไฟล์ที่อ่านต้องตรงกับที่บันทึก");

    await deleteEvidenceFile(id, indicatorId, meta.id);
    await assert.rejects(() => readEvidenceFile(id, indicatorId, meta.id), "ลบแล้วต้องอ่านไม่ได้");
  } finally {
    await deleteAllEvidenceFiles(id); // ล้างโฟลเดอร์ทดสอบเสมอ
  }
});

test("snapshot — บันทึก → อ่าน → ลบทั้งชุด (round-trip, โฟลเดอร์ __site)", async () => {
  const id = 990002;
  const data = Buffer.from([0xff, 0xd8, 0xff, 9, 8, 7]);
  try {
    const meta = await saveSiteSnapshot(id, "top.jpg", "image/jpeg", data);
    assert.ok(FILE_ID_PATTERN.test(meta.id), "id ที่คืนต้องเป็น UUID");
    assert.equal(meta.mimeType, "image/jpeg");
    const read = await readSiteSnapshot(id, meta.id);
    assert.deepEqual(read, data);
    await deleteAllSiteSnapshots(id);
    await assert.rejects(() => readSiteSnapshot(id, meta.id), "ลบทั้งชุดแล้วต้องอ่านไม่ได้");
  } finally {
    await deleteAllSiteSnapshots(id);
  }
});
