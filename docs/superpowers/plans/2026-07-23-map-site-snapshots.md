# Map Site Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** จับภาพหน้าจอแผนที่ Cesium 3D อัตโนมัติ 9 มุมตายตัวรอบจุดที่ตั้งโรงเรียน เก็บบนดิสก์ + `state.unit.siteSnapshots` แล้วแสดงเป็น thumbnail gallery ใต้ "ลักษณะที่ตั้ง" ในแบบประเมิน

**Architecture:** ต่อยอดโครงสร้างไฟล์หลักฐานเดิม — เพิ่มโฟลเดอร์ `uploads/{id}/__site/` ผ่านฟังก์ชันใหม่ใน `lib/uploads.ts`, ชนิด `SnapshotFile` + `UnitInfo.siteSnapshots?` (optional, server-owned เหมือน `evidence[].files`), route ใหม่ 2 ตัว (POST ทั้งชุด / GET รายไฟล์), มุมกล้อง pure ใน `lib/map/snapshotViews.ts`, การจับภาพจริงใน `CesiumMap.tsx` (ต้องเปิด `preserveDrawingBuffer:true`), gallery ใน `UnitPanel.tsx`

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, CesiumJS 1.143, node:test + tsx (`npm test`), mysql2 (integration). ไม่มี dependency ใหม่

## Global Constraints

- เฟสนี้ **จับภาพ + เก็บ + แสดง เท่านั้น** — ไม่มี AI (แยก spec ทีหลัง)
- 9 มุมตายตัว: top-down 1 (~3,000 ม.) + เอียง 4 ทิศใกล้ (−35°, ~4,000 ม.) + เอียง 4 ทิศไกล (−30°, ~12,000 ม.)
- ภาพเป็น **JPEG คุณภาพ 0.85**
- เก็บที่ `uploads/{assessmentId}/__site/{fileId}` — `fileId` เป็น UUID (ชื่อไฟล์บนดิสก์ตรง ๆ), โฟลเดอร์ขึ้นต้น `__` ไม่ชนกับ `indicatorId` (`"1.1".."5.2"`)
- `MAX_SITE_SNAPSHOTS = 9`; ตรวจชนิดจริงด้วย `sniffMimeType` (เฉพาะภาพ, ปฏิเสธ PDF); cap `MAX_FILE_SIZE` เดิม (10MB)
- **จับซ้ำ = แทนที่ทั้งชุด** (ลบเก่าทั้งหมดก่อนเขียนใหม่)
- `state.unit.siteSnapshots` เป็น **server-owned**: PUT autosave ต้อง preserve จาก DB; `makeBlankState` ไม่ใส่ key นี้ (แถวเก่า round-trip byte-identical); POST หลัง submit ต้อง **409**
- `siteSnapshots` ไม่กระทบ scoring/canSubmit/คะแนน 100/`/from-map` ใด ๆ; ซ่อนตอน print
- ห้ามแตะ: `lib/scoring.ts`, `lib/gis.ts`, `lib/criteria.ts`, demo totals
- ห้ามรัน `npm run build` ขณะ dev server รันอยู่ (`.next/` ชนกัน)

---

## File Structure

- `lib/map/snapshotViews.ts` (สร้าง) — ค่าคงที่ pure `SNAPSHOT_VIEWS` (9 มุม) + type `SnapshotView`
- `lib/upload-constants.ts` (แก้) — เพิ่ม `MAX_SITE_SNAPSHOTS`
- `lib/uploads.ts` (แก้) — เพิ่ม `saveSiteSnapshot`/`readSiteSnapshot`/`deleteAllSiteSnapshots`
- `lib/types.ts` (แก้) — `SnapshotFile` + `UnitInfo.siteSnapshots?`
- `lib/state.ts` (แก้) — `cleanSnapshotFiles`, sanitize + `preserveServerOwned`
- `app/api/assessments/[id]/site-snapshots/route.ts` (สร้าง) — POST ทั้งชุด
- `app/api/assessments/[id]/site-snapshots/[fileId]/route.ts` (สร้าง) — GET รายไฟล์
- `lib/map/snapshotCapture.ts` (สร้าง) — helper client จับภาพ (`waitForTilesLoaded`, `captureCurrentView`)
- `components/map/CesiumMap.tsx` (แก้) — `preserveDrawingBuffer:true` + ปุ่ม + ลูปจับภาพ + อัปโหลด
- `components/SiteSnapshotGallery.tsx` (สร้าง) — gallery presentational
- `components/UnitPanel.tsx` (แก้) — วาง gallery ใต้ "ลักษณะที่ตั้ง"
- `app/globals.css` (แก้) — สไตล์ gallery + ปุ่ม + ซ่อน print
- tests: `lib/map/snapshotViews.test.ts` (สร้าง), `tests/uploads.test.ts` / `tests/state.test.ts` / `tests/integration/assessment-security.test.mts` (แก้), `package.json` (เพิ่มไฟล์เทสต์ใหม่ในสคริปต์)

---

### Task 1: มุมกล้อง 9 มุม (`lib/map/snapshotViews.ts`)

**Files:**
- Create: `lib/map/snapshotViews.ts`
- Create: `lib/map/snapshotViews.test.ts`
- Modify: `package.json` (เพิ่มไฟล์เทสต์ใน `test` script)

**Interfaces:**
- Produces:
  - `interface SnapshotView { key: string; label: string; pitchDeg: number; headingDeg: number; heightM: number }`
  - `const SNAPSHOT_VIEWS: readonly SnapshotView[]` (9 รายการ)

- [ ] **Step 1: เขียน failing test**

สร้าง `lib/map/snapshotViews.test.ts`:

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SNAPSHOT_VIEWS } from "./snapshotViews";

describe("SNAPSHOT_VIEWS — มุมกล้องจับภาพ 3D", () => {
  test("มี 9 มุมพอดี", () => {
    assert.equal(SNAPSHOT_VIEWS.length, 9);
  });
  test("key ไม่ซ้ำกัน", () => {
    const keys = SNAPSHOT_VIEWS.map((v) => v.key);
    assert.equal(new Set(keys).size, 9);
  });
  test("มุมแรกเป็น top-down (pitch −90)", () => {
    assert.equal(SNAPSHOT_VIEWS[0].key, "top");
    assert.equal(SNAPSHOT_VIEWS[0].pitchDeg, -90);
  });
  test("มีมุมใกล้ 4 + ไกล 4 ครบทุกทิศ (heading 0/90/180/270)", () => {
    const near = SNAPSHOT_VIEWS.filter((v) => v.key.startsWith("near-"));
    const far = SNAPSHOT_VIEWS.filter((v) => v.key.startsWith("far-"));
    assert.equal(near.length, 4);
    assert.equal(far.length, 4);
    for (const group of [near, far]) {
      assert.deepEqual(
        group.map((v) => v.headingDeg).sort((a, b) => a - b),
        [0, 90, 180, 270],
      );
    }
  });
  test("ระยะไกล > ระยะใกล้ > 0 และทุกมุมมี label ไทยไม่ว่าง", () => {
    const near = SNAPSHOT_VIEWS.find((v) => v.key === "near-n")!;
    const far = SNAPSHOT_VIEWS.find((v) => v.key === "far-n")!;
    assert.ok(far.heightM > near.heightM && near.heightM > 0);
    for (const v of SNAPSHOT_VIEWS) assert.ok(v.label.trim().length > 0);
  });
});
```

- [ ] **Step 2: รัน test ให้ fail**

Run: `node --import tsx --test lib/map/snapshotViews.test.ts`
Expected: FAIL — Cannot find module './snapshotViews'

- [ ] **Step 3: implement**

สร้าง `lib/map/snapshotViews.ts`:

```ts
// มุมกล้องตายตัว 9 มุม สำหรับจับภาพยืนยันที่ตั้งจากแผนที่ 3D — pure (ไม่พึ่ง cesium/React) เพื่อทดสอบได้
export interface SnapshotView {
  key: string;
  /** ป้ายไทยแสดงใต้ภาพใน gallery */
  label: string;
  /** มุมก้มกล้อง (องศา; −90 = มองตรงลง) */
  pitchDeg: number;
  /** ทิศหันกล้อง (องศาจากทิศเหนือ ตามเข็ม) */
  headingDeg: number;
  /** ความสูงกล้องเหนือจุดวิเคราะห์ (เมตร) — ยิ่งมาก = เห็นกว้าง/ไกล */
  heightM: number;
}

const DIRS: { suffix: string; label: string; headingDeg: number }[] = [
  { suffix: "n", label: "เหนือ", headingDeg: 0 },
  { suffix: "e", label: "ตะวันออก", headingDeg: 90 },
  { suffix: "s", label: "ใต้", headingDeg: 180 },
  { suffix: "w", label: "ตะวันตก", headingDeg: 270 },
];

export const SNAPSHOT_VIEWS: readonly SnapshotView[] = [
  { key: "top", label: "มุมมองจากด้านบน", pitchDeg: -90, headingDeg: 0, heightM: 3000 },
  ...DIRS.map((d) => ({
    key: `near-${d.suffix}`,
    label: `ใกล้–${d.label}`,
    pitchDeg: -35,
    headingDeg: d.headingDeg,
    heightM: 4000,
  })),
  ...DIRS.map((d) => ({
    key: `far-${d.suffix}`,
    label: `ไกล–${d.label}`,
    pitchDeg: -30,
    headingDeg: d.headingDeg,
    heightM: 12000,
  })),
];
```

- [ ] **Step 4: เพิ่มไฟล์เทสต์ใน package.json**

ใน `package.json` `test` script ต่อท้ายรายการไฟล์ (ก่อน `components/map/MapPanelToggle.test.tsx`) เพิ่ม `lib/map/snapshotViews.test.ts`

- [ ] **Step 5: รัน test ให้ผ่าน**

Run: `npm test`
Expected: PASS ทั้งหมด (รวม 5 case ใหม่)

- [ ] **Step 6: Commit**

```bash
git add lib/map/snapshotViews.ts lib/map/snapshotViews.test.ts package.json
git commit -m "feat: define 9 fixed snapshot camera views"
```

---

### Task 2: ที่เก็บไฟล์ snapshot บนดิสก์ (`lib/uploads.ts`)

**Files:**
- Modify: `lib/uploads.ts` (เพิ่มหลัง `deleteAllEvidenceFiles`, ~บรรทัด 91)
- Modify: `lib/upload-constants.ts` (เพิ่มค่าคงที่)
- Modify: `tests/uploads.test.ts` (เพิ่ม import + test)

**Interfaces:**
- Consumes: `SavedFileMeta` (มีอยู่แล้วใน `lib/uploads.ts`), `randomUUID`/`mkdir`/`writeFile`/`readFile`/`rm` (import แล้ว)
- Produces:
  - `MAX_SITE_SNAPSHOTS = 9` (ใน `lib/upload-constants.ts`)
  - `saveSiteSnapshot(assessmentId: number, originalName: string, mimeType: string, buffer: Buffer): Promise<SavedFileMeta>`
  - `readSiteSnapshot(assessmentId: number, fileId: string): Promise<Buffer>`
  - `deleteAllSiteSnapshots(assessmentId: number): Promise<void>`

- [ ] **Step 1: เพิ่มค่าคงที่**

ใน `lib/upload-constants.ts` หลัง `MAX_FILES_PER_INDICATOR`:

```ts
export const MAX_SITE_SNAPSHOTS = 9;
```

- [ ] **Step 2: เขียน failing test**

ใน `tests/uploads.test.ts` เพิ่ม import (ต่อจากรายการ import เดิมจาก `"../lib/uploads"`):

```ts
  saveSiteSnapshot,
  readSiteSnapshot,
  deleteAllSiteSnapshots,
```

เพิ่ม test ท้ายไฟล์:

```ts
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
```

- [ ] **Step 3: รัน test ให้ fail**

Run: `node --import tsx --test tests/uploads.test.ts`
Expected: FAIL — saveSiteSnapshot is not a function

- [ ] **Step 4: implement**

ใน `lib/uploads.ts` เพิ่มท้ายไฟล์:

```ts
/** โฟลเดอร์ snapshot ยืนยันที่ตั้ง — ชื่อขึ้นต้น "__" จึงไม่ชนกับ indicatorId ("1.1".."5.2") */
function siteSnapshotDir(assessmentId: number): string {
  return path.join(UPLOAD_ROOT, String(assessmentId), "__site");
}

export async function saveSiteSnapshot(
  assessmentId: number,
  originalName: string,
  mimeType: string,
  buffer: Buffer,
): Promise<SavedFileMeta> {
  const id = randomUUID();
  const dir = siteSnapshotDir(assessmentId);
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

export async function readSiteSnapshot(assessmentId: number, fileId: string): Promise<Buffer> {
  return readFile(path.join(siteSnapshotDir(assessmentId), fileId));
}

/** ลบภาพ snapshot ทั้งชุดของแบบประเมิน — ใช้ตอนจับใหม่ (แทนที่) หรือก่อนเขียนชุดใหม่ */
export async function deleteAllSiteSnapshots(assessmentId: number): Promise<void> {
  await rm(siteSnapshotDir(assessmentId), { recursive: true, force: true });
}
```

- [ ] **Step 5: รัน test ให้ผ่าน**

Run: `npm test`
Expected: PASS ทั้งหมด

- [ ] **Step 6: Commit**

```bash
git add lib/uploads.ts lib/upload-constants.ts tests/uploads.test.ts
git commit -m "feat: add site snapshot disk storage helpers"
```

---

### Task 3: ชนิด `SnapshotFile` + sanitize + preserve (`lib/types.ts`, `lib/state.ts`)

**Files:**
- Modify: `lib/types.ts` (เพิ่ม `SnapshotFile` หลัง `EvidenceFile` ~บรรทัด 109; เพิ่มฟิลด์ใน `UnitInfo` ~บรรทัด 94)
- Modify: `lib/state.ts` (`cleanSnapshotFiles`, sanitize, `preserveServerOwned`)
- Modify: `tests/state.test.ts` (เพิ่ม test)

**Interfaces:**
- Consumes: `MAX_SITE_SNAPSHOTS` (Task 2), `cleanString`/`MAX_FILE_META_TEXT` (มีใน `lib/state.ts`)
- Produces:
  - `interface SnapshotFile` (id/originalName/mimeType/size/sha256/uploadedAt/viewKey/viewLabel)
  - `UnitInfo.siteSnapshots?: SnapshotFile[]`
  - พฤติกรรม sanitize + preserve ของ `siteSnapshots`

- [ ] **Step 1: เพิ่มชนิดใน `lib/types.ts`**

หลัง `EvidenceFile` (บรรทัด ~109) เพิ่ม:

```ts
/** ภาพจับหน้าจอ 3D ยืนยันที่ตั้ง — metadata เท่านั้น; ไฟล์จริงอยู่ที่ uploads/{id}/__site/ (lib/uploads.ts) */
export interface SnapshotFile {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  sha256: string;
  uploadedAt: string;
  /** คีย์มุมกล้อง (จาก SNAPSHOT_VIEWS) */
  viewKey: string;
  /** ป้ายไทยของมุม เช่น "ใกล้–เหนือ" */
  viewLabel: string;
}
```

ใน `UnitInfo` หลัง `settingType: SettingType | "";` (บรรทัด ~94) เพิ่ม:

```ts
  /** ภาพจับหน้าจอ 3D ยืนยันที่ตั้ง (server-owned) — optional เพื่อให้แถวเก่า round-trip ไม่งอก key */
  siteSnapshots?: SnapshotFile[];
```

- [ ] **Step 2: เขียน failing test ใน `tests/state.test.ts`**

ก่อนเขียน ให้เปิด `tests/state.test.ts` อ่านว่า import อะไรบ้างและมี helper `makeBlankState`/`sanitizeState`/`preserveServerOwned` พร้อม pattern การประกอบ state อย่างไร แล้วเพิ่ม test ต่อท้ายไฟล์ (ปรับ import ให้มี `preserveServerOwned` ถ้ายังไม่ได้ import):

```ts
describe("siteSnapshots — ภาพยืนยันที่ตั้ง (server-owned)", () => {
  const snap = (over = {}) => ({
    id: "123e4567-e89b-12d3-a456-426614174000",
    originalName: "top.jpg",
    mimeType: "image/jpeg",
    size: 1234,
    sha256: "a".repeat(64),
    uploadedAt: "2026-07-23T00:00:00.000Z",
    viewKey: "top",
    viewLabel: "มุมมองจากด้านบน",
    ...over,
  });

  test("แถวไม่มี siteSnapshots → sanitize ไม่งอก key", () => {
    const s = sanitizeState({ unit: { name: "รร" } });
    assert.equal("siteSnapshots" in s.unit, false);
  });

  test("sanitize รับ array + cap ที่ 9 และกรองรายการไม่มี id ทิ้ง", () => {
    const many = Array.from({ length: 12 }, (_, i) => snap({ id: `123e4567-e89b-12d3-a456-42661417400${i % 10}` }));
    many.push({ viewKey: "x" } as never); // ไม่มี id → ถูกกรอง
    const s = sanitizeState({ unit: { siteSnapshots: many } });
    assert.ok(Array.isArray(s.unit.siteSnapshots));
    assert.equal(s.unit.siteSnapshots!.length, 9);
    assert.equal(s.unit.siteSnapshots![0].viewLabel, "มุมมองจากด้านบน");
  });

  test("preserveServerOwned — siteSnapshots มาจาก DB, client แก้ไม่ได้", () => {
    const existing = makeBlankState();
    existing.unit.siteSnapshots = [snap()];
    const incoming = makeBlankState();
    incoming.unit.siteSnapshots = [snap({ id: "00000000-0000-4000-8000-000000000000", originalName: "ปลอม.jpg" })];
    const merged = preserveServerOwned(incoming, existing);
    assert.equal(merged.unit.siteSnapshots!.length, 1);
    assert.equal(merged.unit.siteSnapshots![0].originalName, "top.jpg");
  });

  test("preserveServerOwned — existing ไม่มี key → ไม่งอก key", () => {
    const merged = preserveServerOwned(makeBlankState(), makeBlankState());
    assert.equal("siteSnapshots" in merged.unit, false);
  });
});
```

- [ ] **Step 3: รัน test ให้ fail**

Run: `node --import tsx --test tests/state.test.ts`
Expected: FAIL — sanitize/preserve ยังไม่จัดการ `siteSnapshots`

- [ ] **Step 4: implement ใน `lib/state.ts`**

เพิ่ม `cleanSnapshotFiles` หลัง `cleanFiles` (บรรทัด ~81):

```ts
/** ตรวจ metadata ภาพ snapshot ที่มากับ payload (ไฟล์จริงจัดการแยกผ่าน route) — cap จำนวน + กันปลอม metadata */
function cleanSnapshotFiles(value: unknown): SnapshotFile[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .slice(0, MAX_SITE_SNAPSHOTS)
    .map((item) => ({
      id: cleanString(item.id, 64),
      originalName: cleanString(item.originalName, MAX_FILE_META_TEXT),
      mimeType: cleanString(item.mimeType, 100),
      size: typeof item.size === "number" && Number.isFinite(item.size) ? item.size : 0,
      sha256: cleanString(item.sha256, 64),
      uploadedAt: cleanString(item.uploadedAt, 40),
      viewKey: cleanString(item.viewKey, 32),
      viewLabel: cleanString(item.viewLabel, 64),
    }))
    .filter((f) => f.id.length > 0);
}
```

เพิ่ม import: ที่ต้นไฟล์ import `MAX_SITE_SNAPSHOTS` จาก `./upload-constants` (ดูบรรทัด import เดิมที่ดึง `MAX_FILES_PER_INDICATOR`) และ type `SnapshotFile` จาก `./types`.

ในบล็อก sanitize ของ `unit` — หลังบล็อกที่จัดการ `settingType` (บรรทัด ~115) เพิ่ม:

```ts
  const rawSnapshots = (rawUnit as Record<string, unknown>).siteSnapshots;
  if (Array.isArray(rawSnapshots)) {
    const cleaned = cleanSnapshotFiles(rawSnapshots);
    if (cleaned.length > 0) state.unit.siteSnapshots = cleaned;
  }
```

ใน `preserveServerOwned` (บรรทัด ~189) — หลังบล็อกที่ประกอบ `merged` และก่อน `return merged`, จัดการ `siteSnapshots` แบบ server-owned (ล้างค่าจาก client ก่อน แล้วยกจาก DB ถ้ามี):

```ts
  delete merged.unit.siteSnapshots;
  if (existing.unit.siteSnapshots) {
    merged.unit = { ...merged.unit, siteSnapshots: existing.unit.siteSnapshots };
  }
```

หมายเหตุ: `merged` สร้างจาก `{ ...incoming, evidence }` ซึ่ง `incoming.unit` ยังเป็น object เดิม — การ `delete merged.unit.siteSnapshots` จะกระทบ object ที่แชร์กับ `incoming` แต่ `incoming` ถูกทิ้งหลังฟังก์ชันนี้อยู่แล้ว จึงปลอดภัย; อย่างไรก็ตามให้ทำผ่านสำเนาเพื่อความชัดเจน — เปลี่ยนต้นฟังก์ชันให้ `const merged: AssessmentState = { ...incoming, unit: { ...incoming.unit }, evidence };` (คัดลอก unit ตื้น) แล้วค่อย delete/ตั้งค่าตามด้านบน

- [ ] **Step 5: รัน test ให้ผ่าน**

Run: `npm test`
Expected: PASS ทั้งหมด (รวม 4 case ใหม่ + เทสต์ preserveServerOwned/sanitize เดิมยังเขียว)

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/state.ts tests/state.test.ts
git commit -m "feat: add siteSnapshots to unit state (sanitize + server-owned)"
```

---

### Task 4: Route POST/GET ภาพ snapshot

**Files:**
- Create: `app/api/assessments/[id]/site-snapshots/route.ts` (POST ทั้งชุด)
- Create: `app/api/assessments/[id]/site-snapshots/[fileId]/route.ts` (GET รายไฟล์)
- Modify: `tests/integration/assessment-security.test.mts` (เพิ่ม 409-after-submit)
- Modify: `package.json` (ไม่ต้อง — integration ไฟล์เดิมอยู่ในสคริปต์แล้ว)

**Interfaces:**
- Consumes: `requireAssessmentAccess` (`lib/api-auth`), `getAssessment`/`saveAssessment` (`lib/repo`), `saveSiteSnapshot`/`readSiteSnapshot`/`deleteAllSiteSnapshots`/`sniffMimeType`/`FILE_ID_PATTERN` (`lib/uploads`), `isAllowedMimeType`/`MAX_FILE_SIZE`/`MAX_SITE_SNAPSHOTS` (`lib/upload-constants`), `SNAPSHOT_VIEWS` (`lib/map/snapshotViews`), `SnapshotFile` (`lib/types`)
- Produces: `POST` คืน `{ files: SnapshotFile[] }` (201); `GET` คืนไบต์ภาพ

- [ ] **Step 1: เขียน POST route**

สร้าง `app/api/assessments/[id]/site-snapshots/route.ts`:

```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAssessment, saveAssessment } from "@/lib/repo";
import { requireAssessmentAccess } from "@/lib/api-auth";
import { deleteAllSiteSnapshots, saveSiteSnapshot, sniffMimeType } from "@/lib/uploads";
import { isAllowedMimeType, MAX_FILE_SIZE, MAX_SITE_SNAPSHOTS } from "@/lib/upload-constants";
import { SNAPSHOT_VIEWS } from "@/lib/map/snapshotViews";
import type { SnapshotFile } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function parseAssessmentId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// อัปโหลดภาพ snapshot ทั้งชุด (แทนที่ชุดเดิมทั้งหมด) — field "files" หลายไฟล์ + "viewKeys" (JSON array) จับคู่ตามลำดับ
export async function POST(request: NextRequest, { params }: Ctx) {
  const { id: rawId } = await params;
  const assessmentId = parseAssessmentId(rawId);
  if (!assessmentId) return NextResponse.json({ error: "รหัสไม่ถูกต้อง" }, { status: 400 });

  const guard = await requireAssessmentAccess(assessmentId);
  if (!guard.ok) return guard.response;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "ไม่พบไฟล์ภาพ" }, { status: 400 });
  if (files.length > MAX_SITE_SNAPSHOTS) {
    return NextResponse.json({ error: `แนบภาพได้สูงสุด ${MAX_SITE_SNAPSHOTS} ภาพ` }, { status: 400 });
  }

  let viewKeys: string[] = [];
  try {
    const raw = formData.get("viewKeys");
    viewKeys = typeof raw === "string" ? (JSON.parse(raw) as string[]) : [];
  } catch {
    viewKeys = [];
  }

  const record = await getAssessment(assessmentId);
  if (!record) return NextResponse.json({ error: "ไม่พบแบบประเมิน" }, { status: 404 });
  if (record.state.submitted) {
    return NextResponse.json({ error: "แบบประเมินถูกยื่นแล้ว แก้ไขภาพไม่ได้" }, { status: 409 });
  }

  // ตรวจทุกไฟล์ก่อน (เฉพาะภาพ; ไม่รับ PDF), แล้วค่อยเขียน — atomic: ถ้าพลาดกลางทางลบที่เพิ่งเขียนทิ้ง
  const buffers: { buffer: Buffer; mime: string; name: string; viewKey: string; viewLabel: string }[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "ไฟล์ใหญ่เกินไป (สูงสุด 10MB ต่อภาพ)" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const detected = sniffMimeType(buffer);
    if (!detected || !detected.startsWith("image/") || !isAllowedMimeType(detected)) {
      return NextResponse.json({ error: "รองรับเฉพาะไฟล์ภาพ (JPEG/PNG/WebP) เท่านั้น" }, { status: 400 });
    }
    const viewKey = viewKeys[i] ?? "";
    const view = SNAPSHOT_VIEWS.find((v) => v.key === viewKey);
    buffers.push({
      buffer,
      mime: detected,
      name: `${viewKey || "view"}.jpg`,
      viewKey: view?.key ?? "",
      viewLabel: view?.label ?? "",
    });
  }

  try {
    await deleteAllSiteSnapshots(assessmentId); // แทนที่ชุดเดิมทั้งหมด
    const saved: SnapshotFile[] = [];
    for (const b of buffers) {
      const meta = await saveSiteSnapshot(assessmentId, b.name, b.mime, b.buffer);
      saved.push({ ...meta, viewKey: b.viewKey, viewLabel: b.viewLabel });
    }
    const nextState = { ...record.state, unit: { ...record.state.unit, siteSnapshots: saved } };
    await saveAssessment(assessmentId, nextState);
    return NextResponse.json({ files: saved }, { status: 201 });
  } catch (error) {
    console.error("[api] site snapshot upload failed:", error);
    return NextResponse.json({ error: "บันทึกภาพไม่สำเร็จ" }, { status: 500 });
  }
}
```

- [ ] **Step 2: เขียน GET route**

สร้าง `app/api/assessments/[id]/site-snapshots/[fileId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAssessment } from "@/lib/repo";
import { requireAssessmentAccess } from "@/lib/api-auth";
import { FILE_ID_PATTERN, readSiteSnapshot } from "@/lib/uploads";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; fileId: string }> };

function parseAssessmentId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_request: NextRequest, { params }: Ctx) {
  const { id: rawId, fileId } = await params;
  const assessmentId = parseAssessmentId(rawId);
  if (!assessmentId || !FILE_ID_PATTERN.test(fileId)) {
    return NextResponse.json({ error: "รหัสไม่ถูกต้อง" }, { status: 400 });
  }
  const guard = await requireAssessmentAccess(assessmentId);
  if (!guard.ok) return guard.response;

  try {
    const record = await getAssessment(assessmentId);
    const meta = record?.state.unit.siteSnapshots?.find((f) => f.id === fileId);
    if (!record || !meta) return NextResponse.json({ error: "ไม่พบไฟล์" }, { status: 404 });

    const buffer = await readSiteSnapshot(assessmentId, fileId);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": meta.mimeType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(meta.originalName)}`,
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("[api] read site snapshot failed:", error);
    return NextResponse.json({ error: "อ่านไฟล์ไม่สำเร็จ" }, { status: 500 });
  }
}
```

- [ ] **Step 3: เพิ่ม integration test (409 หลัง submit)**

เปิด `tests/integration/assessment-security.test.mts` อ่าน pattern การ `actAs`, สร้าง record submitted, และ import route module. เพิ่ม test ที่ POST ไป `site-snapshots/route.ts` ของแบบประเมินที่ submitted แล้ว → คาด 409. ใช้ pattern เดียวกับเทสต์ `/gis` 409 submit-lock ที่มีอยู่ (สร้าง `FormData` แนบ `Blob` JPEG magic-byte 1 ไฟล์ + field `viewKeys='["top"]'`, เรียก `route.POST(new NextRequest(url, { method:"POST", body: formData }), { params: Promise.resolve({ id: String(submittedId) }) })`, assert `res.status === 409`).

- [ ] **Step 4: รัน integration + unit**

Run: `npm test` → Expected: PASS
Run: `npm run test:integration` → Expected: PASS (รวม 409 ใหม่); ถ้า MySQL ไม่พร้อม test skip — รายงานว่า skip

- [ ] **Step 5: ตรวจ build (ถ้า dev server ไม่ได้รัน)**

Run: `npm run build`
Expected: build สำเร็จ ไม่มี type error

- [ ] **Step 6: Commit**

```bash
git add "app/api/assessments/[id]/site-snapshots" tests/integration/assessment-security.test.mts
git commit -m "feat: add site snapshot upload/serve routes"
```

---

### Task 5: จับภาพจริงบนแผนที่ (`CesiumMap.tsx` + helper)

**Files:**
- Create: `lib/map/snapshotCapture.ts`
- Modify: `components/map/CesiumMap.tsx` (viewer options ~บรรทัด 521; เพิ่ม state/handler; ปุ่มในแผง)
- Modify: `app/globals.css` (สไตล์ปุ่ม + progress)

**Interfaces:**
- Consumes: `SNAPSHOT_VIEWS`/`SnapshotView` (Task 1), Cesium `Viewer`/`Cartesian3`/`Math as CesiumMath` (import แล้วใน CesiumMap), route POST (Task 4), `/api/assessments/from-map` (มีอยู่แล้ว)
- Produces (helper, client-only):
  - `waitForTilesLoaded(viewer: Viewer, timeoutMs: number): Promise<void>`
  - `captureCurrentView(viewer: Viewer): string` (คืน data URL JPEG 0.85)
  - `dataUrlToBlob(dataUrl: string): Blob`

- [ ] **Step 1: implement helper**

สร้าง `lib/map/snapshotCapture.ts`:

```ts
// เครื่องมือจับภาพจาก Cesium canvas — client-only (ต้องมี WebGL จริง จึงไม่มี unit test; ทดสอบผ่าน browser)
import type { Viewer } from "cesium";

/** รอจน terrain/imagery tile รอบมุมกล้องปัจจุบันโหลดครบ (หรือหมดเวลา) เพื่อกันภาพเบลอ/โหลดไม่ครบ */
export function waitForTilesLoaded(viewer: Viewer, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      if (viewer.isDestroyed()) return resolve();
      if (viewer.scene.globe.tilesLoaded || performance.now() - start > timeoutMs) {
        return resolve();
      }
      viewer.scene.requestRender();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** เรนเดอร์เฟรมปัจจุบันแล้วคืน data URL JPEG (ต้องเปิด preserveDrawingBuffer:true ตอนสร้าง Viewer) */
export function captureCurrentView(viewer: Viewer): string {
  viewer.scene.render();
  return viewer.canvas.toDataURL("image/jpeg", 0.85);
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(head)?.[1] ?? "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
```

- [ ] **Step 2: เปิด preserveDrawingBuffer**

ใน `components/map/CesiumMap.tsx` ที่ `new Viewer(container, {...})` (บรรทัด ~521) เพิ่ม option:

```ts
        contextOptions: { webgl: { preserveDrawingBuffer: true } },
```

(วางในอ็อบเจกต์ options เดียวกับ `animation: false` ฯลฯ)

- [ ] **Step 3: เพิ่ม state + handler จับภาพ**

**ข้อตัดสินใจการต่อ flow (ตายตัว — ห้ามเปิด branch อื่น):** ปุ่มจับภาพ **ทำงานเฉพาะเมื่อมี `assessment?.id` อยู่แล้ว** (เปิดจาก `/map?assessment=ID` หรือหลังผู้ใช้กด "บันทึกข้อมูลประกอบเกณฑ์..." ครั้งแรกแล้วกลับมา) — snapshot handler **ไม่สร้างแบบประเมินเอง** เพื่อเลี่ยง duplicate logic ของ `/from-map` และเลี่ยง race. เมื่อยังไม่มี `assessment?.id` จะไม่แสดงปุ่ม (แสดง hint แทน — ดู Step 4).

ใน `CesiumMap.tsx` (ใกล้ state อื่น ๆ เช่น `savingGis`) เพิ่ม:

```tsx
  const [capturing, setCapturing] = useState(false);
  const [captureProgress, setCaptureProgress] = useState(0);
  const [captureErr, setCaptureErr] = useState("");
```

เพิ่ม import ที่หัวไฟล์:

```tsx
import { SNAPSHOT_VIEWS } from "@/lib/map/snapshotViews";
import { captureCurrentView, dataUrlToBlob, waitForTilesLoaded } from "@/lib/map/snapshotCapture";
```

เพิ่ม callback (ใกล้ `saveAssessmentFromMap`) — ใช้ `Cartesian3.fromDegrees(lng, lat, heightM)` เป็น destination และ `CesiumMath.toRadians` สำหรับ heading/pitch; `center` เป็น state ในคอมโพเนนต์ (ตาม flow เดิมที่รีวิวไว้ว่า center เป็น internal useState):

```tsx
  const captureSiteSnapshots = useCallback(async () => {
    const viewer = viewerRef.current;
    const targetId = assessment?.id;
    if (!viewer || capturing || national || !targetId) return;
    setCapturing(true);
    setCaptureErr("");
    setCaptureProgress(0);

    const prevPos = viewer.camera.position.clone();
    const prevHeading = viewer.camera.heading;
    const prevPitch = viewer.camera.pitch;
    const prevRoll = viewer.camera.roll;

    try {
      const blobs: { blob: Blob; viewKey: string }[] = [];
      for (let i = 0; i < SNAPSHOT_VIEWS.length; i++) {
        const view = SNAPSHOT_VIEWS[i];
        viewer.camera.setView({
          destination: Cartesian3.fromDegrees(center.lng, center.lat, view.heightM),
          orientation: {
            heading: CesiumMath.toRadians(view.headingDeg),
            pitch: CesiumMath.toRadians(view.pitchDeg),
            roll: 0,
          },
        });
        await waitForTilesLoaded(viewer);
        blobs.push({ blob: dataUrlToBlob(captureCurrentView(viewer)), viewKey: view.key });
        setCaptureProgress(i + 1);
      }

      const fd = new FormData();
      for (const b of blobs) fd.append("files", b.blob, `${b.viewKey}.jpg`);
      fd.append("viewKeys", JSON.stringify(blobs.map((b) => b.viewKey)));
      const res = await fetch(`/api/assessments/${targetId}/site-snapshots`, { method: "POST", body: fd });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "อัปโหลดภาพไม่สำเร็จ");
      }
      window.location.assign(`/assessment/${targetId}#unitPanel`);
    } catch (e) {
      setCaptureErr(e instanceof Error ? e.message : "จับภาพไม่สำเร็จ");
    } finally {
      viewer.camera.setView({
        destination: prevPos,
        orientation: { heading: prevHeading, pitch: prevPitch, roll: prevRoll },
      });
      setCapturing(false);
    }
  }, [capturing, national, center, assessment]);
```

หมายเหตุ: ถ้าชื่อ prop ของ assessment ในคอมโพเนนต์ไม่ใช่ `assessment` (เช่นถูกแปลงเป็น internal state) ให้ implementer อ่านโค้ดจริงแล้วใช้ตัวที่ถือ `id`/`submitted` ของแบบประเมินที่เปิดอยู่ — logic คงเดิม.

- [ ] **Step 4: เพิ่มปุ่มในแผง**

ในแผงวิเคราะห์ (ใกล้ปุ่ม "บันทึกข้อมูลประกอบเกณฑ์...") เพิ่ม เมื่อ `!national`. แสดงปุ่มเมื่อมี `assessment?.id`; ถ้ายังไม่มี ให้แสดง hint ให้กดบันทึกก่อน. การ disable ใช้ `assessment?.submitted` เพื่อให้สอดคล้องกับแบบประเมินที่กำลังเปิด (ปุ่ม snapshot ผูกกับ `assessment.id` ที่เปิดอยู่ ไม่ใช่แถวปีปัจจุบัน จึงใช้ `assessment.submitted` ไม่ใช่ `currentYear.submitted`):

```tsx
        {!national ? (
          <div className="map-snapshot-block">
            {assessment?.id ? (
              <>
                <button
                  type="button"
                  className="ghost-btn map-snapshot-btn"
                  onClick={captureSiteSnapshots}
                  disabled={capturing || Boolean(assessment.submitted)}
                >
                  {capturing
                    ? `กำลังจับภาพ ${captureProgress}/${SNAPSHOT_VIEWS.length}…`
                    : "📸 จับภาพ 3D ยืนยันที่ตั้ง"}
                </button>
                {captureErr ? <p className="map-snapshot-err">{captureErr}</p> : null}
                <p className="map-snapshot-hint">
                  จับภาพ 9 มุม (มุมบน + ใกล้/ไกล 4 ทิศ) แล้วแนบเข้าแบบประเมินในหัวข้อ “ลักษณะที่ตั้ง” — จับใหม่จะแทนชุดเดิม
                </p>
              </>
            ) : (
              <p className="map-snapshot-hint">
                กดบันทึกแบบประเมินก่อน แล้วเปิดแผนที่จากแบบประเมินอีกครั้งเพื่อจับภาพ 3D ยืนยันที่ตั้ง
              </p>
            )}
          </div>
        ) : null}
```

หมายเหตุ: `assessment.submitted` เป็น object|null (`state.submitted`) — ใช้ `Boolean(...)` ครอบ. ถ้าโครง prop จริงต่างไป ให้ implementer ปรับให้ตรงชนิด แต่คงเงื่อนไข "ปิดปุ่มเมื่อแบบประเมินที่เปิดอยู่ถูกยื่นแล้ว".

- [ ] **Step 5: เพิ่มสไตล์ใน `app/globals.css`**

```css
.map-snapshot-block { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.map-snapshot-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.map-snapshot-hint { font-size: 12px; color: var(--muted, #667); margin: 0; }
.map-snapshot-err { font-size: 12px; color: #c0392b; margin: 0; }
```

- [ ] **Step 6: ตรวจ build + ยืนยันด้วย browser**

Run: `npm run build` (เฉพาะเมื่อ dev server ไม่ได้รัน) → Expected: PASS
ยืนยันบน dev server ภายหลัง (Task 7): เปิด `/map?assessment=ID` ของบัญชีโรงเรียน กดปุ่มจับภาพ → เห็น progress 1..9 → เด้งไปหน้าแบบประเมิน มีภาพครบ

- [ ] **Step 7: Commit**

```bash
git add lib/map/snapshotCapture.ts components/map/CesiumMap.tsx app/globals.css
git commit -m "feat: capture 9 map snapshots and upload to assessment"
```

---

### Task 6: Gallery ใน UnitPanel (`SiteSnapshotGallery.tsx`, `UnitPanel.tsx`)

**Files:**
- Create: `components/SiteSnapshotGallery.tsx`
- Create: `components/SiteSnapshotGallery.test.tsx`
- Modify: `components/UnitPanel.tsx` (วาง gallery ใต้ "ลักษณะที่ตั้ง")
- Modify: `app/globals.css` (grid + print hide)
- Modify: `package.json` (เพิ่มไฟล์เทสต์ใหม่ใน `test` script)

**Interfaces:**
- Consumes: `SnapshotFile` (`lib/types`)
- Produces: `<SiteSnapshotGallery assessmentId={number} snapshots={SnapshotFile[]} />`

- [ ] **Step 1: เขียน failing test**

สร้าง `components/SiteSnapshotGallery.test.tsx` (ใช้ `renderToStaticMarkup` เหมือน `components/map/GisAssessmentPanel.test.tsx`):

```tsx
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
      <SiteSnapshotGallery assessmentId={7} snapshots={[snap(), snap({ id: "00000000-0000-4000-8000-000000000001", viewKey: "near-n", viewLabel: "ใกล้–เหนือ" })]} />,
    );
    assert.match(html, /\/api\/assessments\/7\/site-snapshots\/123e4567-e89b-12d3-a456-426614174000/);
    assert.match(html, /มุมมองจากด้านบน/);
    assert.match(html, /ใกล้–เหนือ/);
  });
});
```

- [ ] **Step 2: รัน test ให้ fail**

Run: `node --import tsx --test components/SiteSnapshotGallery.test.tsx`
Expected: FAIL — Cannot find module './SiteSnapshotGallery'

- [ ] **Step 3: implement gallery**

สร้าง `components/SiteSnapshotGallery.tsx`:

```tsx
import type { SnapshotFile } from "@/lib/types";

interface Props {
  assessmentId: number;
  snapshots: SnapshotFile[];
}

export default function SiteSnapshotGallery({ assessmentId, snapshots }: Props) {
  if (snapshots.length === 0) {
    return (
      <p className="site-snapshot-empty">
        ยังไม่มีภาพยืนยันที่ตั้ง — เปิดแผนที่ 3 มิติแล้วกด “จับภาพ 3D ยืนยันที่ตั้ง”
      </p>
    );
  }
  return (
    <div className="site-snapshot-gallery">
      {snapshots.map((s) => {
        const src = `/api/assessments/${assessmentId}/site-snapshots/${s.id}`;
        return (
          <figure key={s.id} className="site-snapshot-item">
            <a href={src} target="_blank" rel="noreferrer">
              <img src={src} alt={s.viewLabel} loading="lazy" />
            </a>
            <figcaption>{s.viewLabel}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: วางใน UnitPanel**

ใน `components/UnitPanel.tsx` เพิ่ม import:

```tsx
import SiteSnapshotGallery from "./SiteSnapshotGallery";
```

ในบล็อก `.unit-setting` (หลัง `</div>` ปิด `.unit-setting-options` ก่อนปิด `.unit-setting` — บรรทัด ~108) เพิ่ม:

```tsx
        <div className="unit-snapshots">
          <span className="unit-setting-label">ภาพยืนยันที่ตั้งจากแผนที่ 3 มิติ</span>
          <SiteSnapshotGallery assessmentId={assessmentId} snapshots={unit.siteSnapshots ?? []} />
        </div>
```

- [ ] **Step 5: เพิ่มสไตล์ + ซ่อน print ใน `app/globals.css`**

```css
.unit-snapshots { margin-top: 12px; }
.site-snapshot-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; margin-top: 6px; }
.site-snapshot-item { margin: 0; }
.site-snapshot-item img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 6px; border: 1px solid var(--border, #dcdce3); }
.site-snapshot-item figcaption { font-size: 12px; color: var(--muted, #667); text-align: center; margin-top: 3px; }
.site-snapshot-empty { font-size: 13px; color: var(--muted, #667); margin: 6px 0 0; }
@media print { .unit-snapshots { display: none; } }
```

- [ ] **Step 6: เพิ่มไฟล์เทสต์ใน package.json**

ใน `test` script เพิ่ม `components/SiteSnapshotGallery.test.tsx`

- [ ] **Step 7: รัน test + build**

Run: `npm test` → Expected: PASS (รวม 2 case ใหม่)
Run: `npm run build` (ถ้า dev server ไม่ได้รัน) → Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add components/SiteSnapshotGallery.tsx components/SiteSnapshotGallery.test.tsx components/UnitPanel.tsx app/globals.css package.json
git commit -m "feat: show site snapshot thumbnail gallery in UnitPanel"
```

---

### Task 7: ยืนยันด้วย browser (end-to-end)

**Files:**
- แก้เฉพาะเมื่อพบ defect ในไฟล์ที่ทำไปแล้ว

**Interfaces:**
- Consumes: ทุก Task ก่อนหน้า

- [ ] **Step 1: ตรวจสอบชุดเทสต์ครบ**

Run: `npm test` → Expected: ทุกไฟล์ PASS, 0 fail
Run: `npm run test:integration` → Expected: PASS (รวม 409 snapshot); SKIP ได้เฉพาะเมื่อ MySQL ไม่พร้อม (รายงาน)

- [ ] **Step 2: build**

Run: `npm run build` → Expected: PASS

- [ ] **Step 3: ยืนยันบน dev server**

เปิด dev server (preview), login บัญชีโรงเรียนที่มีพิกัด (เช่น 57030129 บ้านพญาไพร), เปิด `/map` กดบันทึกเพื่อให้มีแบบประเมินปีปัจจุบัน, กลับมา `/map?assessment=ID`, กดปุ่ม "📸 จับภาพ 3D ยืนยันที่ตั้ง".

Expected: เห็น progress 1/9..9/9, เด้งไป `/assessment/ID#unitPanel`, ในหัวข้อ "ลักษณะที่ตั้ง" มี gallery 9 ภาพ (ไม่ใช่ภาพว่าง/ดำ), ป้ายมุมครบ, คลิกภาพเปิดเต็มได้; จับซ้ำ = ภาพชุดใหม่แทนที่ (จำนวนยัง 9); ไม่มี error ใน console/network

- [ ] **Step 4: ยืนยันภาพไม่ว่าง (preserveDrawingBuffer)**

ตรวจ network: GET `/api/assessments/ID/site-snapshots/{fileId}` คืน 200 + Content-Type image/jpeg + ขนาด > ~5KB (ภาพว่างจะเล็กผิดปกติ). ถ้าภาพดำ/ว่าง = `preserveDrawingBuffer` ไม่ทำงาน → ตรวจ Task 5 Step 2.

- [ ] **Step 5: Commit (เฉพาะถ้ามีแก้)**

```bash
git commit -m "fix: close site snapshot acceptance gaps"
```

---

## Completion Criteria

- ผู้ใช้โรงเรียนกดปุ่มเดียวจับภาพ 3D 9 มุมได้ ภาพไม่ว่าง แนบเข้าแบบประเมินปีปัจจุบัน
- gallery แสดงใต้ "ลักษณะที่ตั้ง" ใน UnitPanel พร้อมป้ายมุมไทย, ซ่อนตอนพิมพ์
- จับซ้ำแทนที่ชุดเดิม (ลบไฟล์เก่าบนดิสก์); POST หลัง submit ได้ 409
- `siteSnapshots` เป็น server-owned (PUT preserve จาก DB), แถวเก่าไม่งอก key, ไม่กระทบคะแนน/`/from-map`
- unit + integration + build เขียวทั้งหมด
