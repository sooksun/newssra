import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import SiteSnapshotGallery from "./SiteSnapshotGallery";
import type { SnapshotFile } from "@/lib/types";

const snap = (over: Partial<SnapshotFile> = {}): SnapshotFile => ({
  id: "123e4567-e89b-12d3-a456-426614174000",
  originalName: "top.jpg",
  mimeType: "image/jpeg",
  size: 100,
  sha256: "a".repeat(64),
  uploadedAt: "2026-07-23T00:00:00.000Z",
  viewKey: "top",
  viewLabel: "มุมมองจากด้านบน",
  ...over,
});

describe("SiteSnapshotGallery", () => {
  test("ไม่มีภาพ → แสดงบรรทัดเชิญชวน ไม่มี <img>", () => {
    const html = renderToStaticMarkup(<SiteSnapshotGallery assessmentId={7} snapshots={[]} />);
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /ยังไม่มีภาพยืนยันที่ตั้ง/);
  });
  test("มีภาพ → เรนเดอร์ <img> ชี้ route ที่ถูก + ป้ายมุม", () => {
    const html = renderToStaticMarkup(
      <SiteSnapshotGallery
        assessmentId={7}
        snapshots={[snap(), snap({ id: "00000000-0000-4000-8000-000000000001", viewKey: "near-n", viewLabel: "ใกล้–เหนือ" })]}
      />,
    );
    assert.match(html, /\/api\/assessments\/7\/site-snapshots\/123e4567-e89b-12d3-a456-426614174000/);
    assert.match(html, /มุมมองจากด้านบน/);
    assert.match(html, /ใกล้–เหนือ/);
  });
  test("thumbnail เป็นปุ่ม (เปิด lightbox) ไม่ใช่ลิงก์เปิดแท็บใหม่", () => {
    const html = renderToStaticMarkup(
      <SiteSnapshotGallery
        assessmentId={7}
        snapshots={[snap(), snap({ id: "00000000-0000-4000-8000-000000000001", viewKey: "near-n", viewLabel: "ใกล้–เหนือ" })]}
      />,
    );
    assert.doesNotMatch(html, /target="_blank"/);
    assert.equal((html.match(/class="site-snapshot-open"/g) ?? []).length, 2);
  });
  test("สถานะเริ่มต้นยังไม่เปิด lightbox (ไม่มี dialog)", () => {
    const html = renderToStaticMarkup(<SiteSnapshotGallery assessmentId={7} snapshots={[snap()]} />);
    assert.doesNotMatch(html, /role="dialog"/);
  });
});
