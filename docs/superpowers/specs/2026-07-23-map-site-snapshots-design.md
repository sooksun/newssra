# Design: จับภาพหน้าจอ 3D ยืนยันที่ตั้ง (Map Site Snapshots)

วันที่: 2026-07-23 · สถานะ: อนุมัติดีไซน์แล้ว (รอ implementation plan)

## เป้าหมาย

เพิ่มความสามารถให้ผู้ใช้ **จับภาพหน้าจอจากแผนที่ Cesium 3D อัตโนมัติ 9 มุมตายตัว** รอบจุดที่ตั้งโรงเรียน เพื่อยืนยันด้วยสายตาว่าพื้นที่เป็นภูมิประเทศแบบใด แล้วนำภาพไปแสดงเป็น **Thumbnail Gallery** ในส่วน "ลักษณะที่ตั้ง (ข้อมูลประกอบ)" ต้นแบบประเมิน

ขอบเขตเฟสนี้คือ **จับภาพ + เก็บ + แสดงผล** เท่านั้น การให้ AI วิเคราะห์ภาพจะแยกเป็น spec ของเฟสถัดไป (ภาพถูกเก็บบนดิสก์ที่ server อ่านได้ เพื่อให้เฟสหน้าต่อยอดได้โดยไม่ต้องรื้อ)

## ข้อตัดสินใจหลัก (ยืนยันกับผู้ใช้แล้ว)

1. **เฟสนี้จับภาพอย่างเดียว** — AI วิเคราะห์แยก spec ทีหลัง
2. **9 มุมตายตัว** — ไม่ให้ผู้ใช้เลือกจำนวน/ระยะ: top-down 1 + เอียง 4 ทิศระยะใกล้ + เอียง 4 ทิศระยะไกล
3. **เก็บใน `state.unit.siteSnapshots`** แสดงเป็น Thumbnail Gallery ใน `UnitPanel` ใต้ "ลักษณะที่ตั้ง"
4. **ปุ่มแยกบนแผนที่** (ไม่รวมกับปุ่มบันทึกเดิม) — จับใหม่แทนชุดเดิมทั้งหมด

## มุมกล้อง 9 มุม (`SNAPSHOT_VIEWS`)

รอบจุดวิเคราะห์ `center.{lat,lng}`:

| # | key | มุมก้ม (pitch) | heading | ระยะ (ความสูงกล้อง) | ป้ายไทย |
|---|-----|------|---------|------|--------|
| 1 | `top` | −90° | 0° | ~3,000 ม. | มุมมองจากด้านบน |
| 2–5 | `near-{n,e,s,w}` | −35° | 0/90/180/270° | ~4,000 ม. | ใกล้–เหนือ/ตะวันออก/ใต้/ตะวันตก |
| 6–9 | `far-{n,e,s,w}` | −30° | 0/90/180/270° | ~12,000 ม. | ไกล–เหนือ/ตะวันออก/ใต้/ตะวันตก |

ค่าเหล่านี้เป็นค่าคงที่ pure ใน `lib/map/snapshotViews.ts` (มีเทสต์ยืนยันว่ามี 9 มุม, key ไม่ซ้ำ, ป้ายครบ) — แยกจาก `CesiumMap.tsx` เพื่อทดสอบได้โดยไม่ต้องมีเบราว์เซอร์

## สถาปัตยกรรม

### 1. Client: จับภาพ (`CesiumMap.tsx` + helper)

- **เปิด `preserveDrawingBuffer: true`** บน `new Viewer(...)` — **จำเป็น** ไม่งั้น `canvas.toDataURL()` คืนภาพว่าง (WebGL ล้าง buffer หลัง composite ถ้าไม่ตั้ง flag นี้) ยอมรับ overhead เล็กน้อยของ Cesium
- ปุ่มใหม่ **"📸 จับภาพ 3D ยืนยันที่ตั้ง"** ในแผงวิเคราะห์ แสดงเมื่อ `!national && status==="ready"`; disabled ระหว่างจับ และเมื่อแบบประเมินปีปัจจุบันถูก submit แล้ว (เหมือนปุ่มบันทึก)
- ลำดับการทำงาน (async, มี state `capturing` + progress `x/9`):
  1. จำมุมกล้องเดิมไว้คืนให้ตอนจบ
  2. วนทีละมุมใน `SNAPSHOT_VIEWS`: `camera.flyTo(destination, orientation, duration:0)` (ตั้งมุมทันที) → **รอ tile โหลดจริง** ด้วย polling `viewer.scene.globe.tilesLoaded === true` (มี `requestAnimationFrame` + timeout ~4 วินาที/มุมกันค้าง) → `viewer.scene.render()` → `viewer.canvas.toDataURL("image/jpeg", 0.85)`
  3. แปลง data URL → `Blob` 9 ก้อน
  4. ถ้ายังไม่มีแบบประเมินปีปัจจุบัน เรียก `/api/assessments/from-map` (flow เดิม) เพื่อให้มี `assessmentId` ก่อน แล้ว POST ภาพทั้งชุดไป route ใหม่
  5. คืนมุมกล้องเดิม, แสดงผลลัพธ์/ข้อผิดพลาด
- helper การจับภาพ (`captureSnapshot(viewer, view)` + `waitForTilesLoaded(viewer, timeoutMs)`) แยกไว้ใน `lib/map/snapshotCapture.ts` (client-only; import `cesium` type ได้ แต่ไม่มี React) — logic ทดสอบยากเพราะต้องมี WebGL จริง จึงเทสต์เฉพาะส่วน pure (การเลือกมุม/แปลง dataURL→Blob) เท่าที่ทำได้

### 2. Server: รับ/เสิร์ฟ/ลบภาพ

- **`POST /api/assessments/[id]/site-snapshots`** (`requireAssessmentAccess`; **409 หลัง submit**): รับ multipart หลายไฟล์ (field `files`), แต่ละไฟล์ต้องผ่าน `sniffMimeType` + `isAllowedMimeType` + `MAX_FILE_SIZE` เดิม (เฉพาะภาพ — ปฏิเสธ PDF สำหรับ snapshot), จำกัด `MAX_SITE_SNAPSHOTS = 9`. **ลบชุดเก่าทั้งหมดก่อนเขียนชุดใหม่** (จับซ้ำ = แทนที่). เขียนไฟล์ผ่าน `lib/uploads.ts` ที่ folder เฉพาะ, คืน `SnapshotFile[]` และเซฟลง `state.unit.siteSnapshots` ผ่าน `saveAssessment`.
- **`GET /api/assessments/[id]/site-snapshots/[fileId]`** (`requireAssessmentAccess`): ตรวจ `FILE_ID_PATTERN` แล้วเสิร์ฟไบต์ (เหมือน evidence view route)
- **`lib/uploads.ts`** เพิ่มฟังก์ชันเจาะจง snapshot ที่ folder `uploads/{assessmentId}/__site/` (ชื่อ `__site` ขึ้นต้น `_` — ไม่ชนกับ `indicatorId` ที่เป็น `"1.1".."5.2"`): `saveSiteSnapshot`, `readSiteSnapshot`, `deleteAllSiteSnapshots`. `deleteAllEvidenceFiles` ลบทั้ง `uploads/{id}/` อยู่แล้วจึงครอบ `__site` ด้วย (ลบแบบประเมิน = ลบภาพหมด) — ไม่ต้องแก้ DELETE route

### 3. ชนิดข้อมูล + sanitize

- `lib/types.ts`: เพิ่ม `SnapshotFile` (โครงเหมือน `EvidenceFile` + `viewKey: string`, `viewLabel: string`) และ **optional** `UnitInfo.siteSnapshots?: SnapshotFile[]` (optional เพื่อให้แถวเก่า round-trip ไม่งอก key)
- `lib/state.ts`:
  - `makeBlankState` **ไม่ใส่** `siteSnapshots` (คง byte-identical กับแถวเดิม)
  - `sanitizeState`: ถ้า `rawUnit.siteSnapshots` เป็น array ให้ผ่าน `cleanSnapshotFiles` (แบบเดียวกับ `cleanFiles` + `viewKey`/`viewLabel`, cap 9) แล้ว set `state.unit.siteSnapshots`; ถ้าไม่มีก็ไม่ set key
  - `preserveServerOwned`: `siteSnapshots` เป็น **server-owned** เหมือน `evidence[].files` — PUT autosave ต้อง preserve จาก DB (กัน client ปลอม metadata หรือ snapshot ค้างมาทับจนภาพหาย). ใช้ conditional set: ถ้า `existing.unit.siteSnapshots` มี ให้ยกมา; ถ้าไม่มี key ก็ไม่งอก
- `lib/upload-constants.ts`: เพิ่ม `MAX_SITE_SNAPSHOTS = 9`

### 4. แสดงผล (`UnitPanel.tsx`)

- ใต้บล็อก "ลักษณะที่ตั้ง (ข้อมูลประกอบ)" เพิ่ม `<SiteSnapshotGallery>` เมื่อ `unit.siteSnapshots?.length`:
  - grid thumbnail (`<img src="/api/assessments/{id}/site-snapshots/{fileId}">`) มีป้าย `viewLabel` ใต้ภาพ
  - คลิกภาพ = เปิดขนาดเต็มใน `<a target="_blank">` (ไม่ต้องทำ lightbox เอง — YAGNI)
  - ถ้าไม่มีภาพ: แสดงบรรทัดเชิญชวน "ยังไม่มีภาพยืนยันที่ตั้ง — เปิดแผนที่ 3 มิติแล้วกดจับภาพ"
- ซ่อนตอน print (`@media print` — `.site-snapshot-gallery { display:none }`) เหมือน `.evidence-box`

## Error handling

- จับภาพล้มเหลว (WebGL/tile timeout): แสดง error ในแผง, คืนมุมกล้องเดิม, ไม่เขียนอะไรลง server
- upload ล้มเหลว: คงชุดเดิมไว้ (route ลบเก่าเฉพาะเมื่อเขียนใหม่สำเร็จ — ทำ atomic: เขียนไฟล์ใหม่ทั้งหมดก่อน แล้วค่อยลบเก่า แล้ว saveAssessment; ถ้า fail กลางทางให้ลบไฟล์ที่เพิ่งเขียนทิ้ง)
- ทุก route null-safe + คืน status code ตามแบบเดิม (400/404/409/500)

## สิ่งที่ไม่แตะ

`lib/scoring.ts`, `canSubmit`, คะแนน 100, flow `/from-map` (เรียกใช้ต่อ), demo totals, `lib/gis.ts` — ไม่มีผลต่อการให้คะแนนใด ๆ

## ทางเลือกที่พิจารณาแล้วไม่เลือก

- **เก็บ base64 ใน `state.gis`** — row บวมหลาย MB, autosave ส่งกลับไปมา, ชน cap ความยาว string ของ sanitize
- **แนบเป็นหลักฐานตัวชี้วัด 3.2** — จะกินโควตา 10 ไฟล์ของ 3.2 และผูกผิดที่ (ภาพเป็นของ "ที่ตั้ง" ไม่ใช่ตัวชี้วัดเดียว)
- **object storage ภายนอก** — เกินจำเป็น กระทบ Docker bind-mount runbook; ดิสก์ที่ระบบหลักฐานใช้อยู่แล้วเพียงพอ

## Testing

- `lib/map/snapshotViews.test.ts`: 9 มุม, key ไม่ซ้ำ, ป้ายไทยครบ, ค่ามุม/ระยะอยู่ในช่วงที่คาด
- `tests/state.test.ts`: `sanitizeState` รับ/cap `siteSnapshots` (≤9, ปลอม metadata ถูกกรอง), แถวไม่มี key → ไม่งอก key; `preserveServerOwned` preserve `siteSnapshots` จาก DB, client แก้ไม่ได้, แถวเดิมไม่งอก key
- `tests/uploads.test.ts`: save/read/delete-all snapshot round-trip + path traversal guard เดิมครอบ fileId ของ snapshot
- Integration (`tests/integration/assessment-security.test.mts` หรือไฟล์ใหม่): POST snapshots ถูก 409 หลัง submit; scoping ผ่าน `canAccessAssessment`
