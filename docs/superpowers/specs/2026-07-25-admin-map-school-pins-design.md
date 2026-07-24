# Admin Map — School Overview Pins (ดีไซน์)

วันที่: 2026-07-25
สถานะ: อนุมัติดีไซน์แล้ว รอเขียนแผน implementation

## เป้าหมาย

บนหน้าแผนที่ `/map` ของผู้ดูแล (admin / ssra_admin) ให้แสดง **หมุดพิกัดที่ตั้งของทุกโรงเรียนที่มีการบันทึกแบบประเมิน** โดยแยกสีหมุดตามสถานะ:

- **เทา** — ยังเป็นร่าง (ยังไม่ส่ง)
- **เขียว** — ส่งแล้วและ "ผ่านเกณฑ์" = คะแนน ≥ 50 (ขึ้นทะเบียนได้ — ระดับ 1/2/3)
- **แดง** — ส่งแล้วแต่ไม่ผ่านเกณฑ์ = คะแนน < 50 (ยังไม่จัดระดับ / neutral)

ภาพรวมนี้แสดง **เฉพาะหมุด** เท่านั้น ไม่รันการวิเคราะห์แผนที่อื่น ๆ ของทุกพิกัด ข้อมูลวิเคราะห์เต็มจะแสดงเมื่อ **คลิกที่หมุด** ของโรงเรียนนั้น ซึ่งจะเปิดมุมมองเหมือนที่ user โรงเรียนนั้นเห็น

## การตัดสินใจที่ยืนยันแล้ว

1. **นิยาม "ผ่านเกณฑ์" (เขียว)** = คะแนน ≥ 50 (ขึ้นทะเบียนได้) → เขียวครอบ `level-1/2/3`, แดงเฉพาะ `neutral`
2. **หมุดต่อโรงเรียน** = ฉบับ **ล่าสุด** ของแต่ละโรงเรียน (แถวที่ `updated_at` ใหม่สุดต่อ `owner_school_code`) — 1 หมุด/โรงเรียน ไม่ว่าปีไหน
3. **พิกัดที่ขาด** = ใช้พิกัดในแบบประเมินก่อน ถ้าว่าง/เป็น 0 → fallback ทะเบียนโรงเรียน (`school_location`); หาไม่ได้เลย → ไม่แสดงหมุด
4. **Label ชื่อโรงเรียน** = แสดงบนทุกหมุด
5. **ปุ่ม "กลับแผนที่รวม"** = เพิ่มในหัวหน้าเมื่อ admin/ssra กำลังเจาะดูโรงเรียนหนึ่ง

## ขอบเขตการแสดง

หมุดภาพรวมจะแสดงเมื่อ **ทั้งหมด** เป็นจริง:

- `user.role === "admin" || user.role === "ssra_admin"` (`canSeeAll`)
- ไม่มี `?assessment=ID` (คือโหมด `national` — ภาพรวมทั้งประเทศ)

กรณี user โรงเรียน และการเจาะดู `?assessment=ID` — **ไม่เปลี่ยนพฤติกรรมเดิม** โหมด `national` ปัจจุบันปิดเอฟเฟกต์วิเคราะห์หนัก (route/rings/terrain/GIS) อยู่แล้ว จึงตรงกับ requirement "ไม่แสดงข้อมูลอื่น" โดยธรรมชาติ

## ชั้นข้อมูล (server)

### type ใหม่
```ts
// lib/repo.ts (หรือ lib/types.ts ตามความเหมาะสมของ import graph)
export type SchoolPinStatus = "draft" | "pass" | "fail";
export interface SchoolPin {
  id: number;        // assessment id — ใช้ทำลิงก์ /map?assessment=ID
  name: string;      // ชื่อโรงเรียน (unit.name || unit_name)
  lat: number;
  lng: number;
  status: SchoolPinStatus;
}
```

### helper บริสุทธิ์ `schoolPinStatus`
แยกไว้ทดสอบง่าย (client-safe, ไม่แตะ DB):
```ts
// map: submitted + level_key → status
// - ยังไม่ส่ง            → "draft"
// - ส่งแล้ว + level_key !== "neutral" → "pass"  (คะแนน ≥ 50)
// - ส่งแล้ว + level_key === "neutral" → "fail"  (คะแนน < 50)
schoolPinStatus(args: { submitted: boolean; levelKey: string }): SchoolPinStatus
```
วางไว้ในโมดูลบริสุทธิ์ (เช่น `lib/school-pins.ts`) เพื่อไม่ให้ test ต้องพึ่ง DB และไม่ให้ repo (server-only) ถูก import เข้า test แบบ pure

### repo `listSchoolPins()`
- 1 query หยิบ **แถวล่าสุดต่อ `owner_school_code`**:
  ```sql
  SELECT a.id, a.owner_school_code, a.unit_name, a.level_key,
         JSON_UNQUOTE(JSON_EXTRACT(a.state, '$.unit.name')) AS state_name,
         JSON_UNQUOTE(JSON_EXTRACT(a.state, '$.unit.lat'))  AS lat,
         JSON_UNQUOTE(JSON_EXTRACT(a.state, '$.unit.lng'))  AS lng,
         JSON_EXTRACT(a.state, '$.submitted')               AS submitted
  FROM assessments a
  JOIN (
    SELECT owner_school_code, MAX(updated_at) AS mx
    FROM assessments
    WHERE owner_school_code IS NOT NULL AND owner_school_code <> ''
    GROUP BY owner_school_code
  ) t ON t.owner_school_code = a.owner_school_code AND t.mx = a.updated_at
  ```
- de-dup ในโค้ด (กันกรณี `MAX(updated_at)` เสมอกัน 2 แถว → เก็บ id สูงสุด/แรกอย่างสม่ำเสมอ)
- แปลงพิกัด: `Number(lat/lng)`; ถ้าไม่ finite หรือ (0,0) → เก็บรหัสไว้ทำ fallback
- fallback: เรียก `schoolLocationByCode` สำหรับรหัสที่ขาดพิกัด (Promise.all จำนวนจำกัด); ยังหาไม่ได้ → ตัดหมุดนั้นทิ้ง
- สถานะ: `schoolPinStatus({ submitted: <จาก JSON>, levelKey: a.level_key })`
  - หมายเหตุ: `submitted` อ่านจาก `state.submitted` (source of truth) เพื่อความแม่น; `level_key` ใช้คอลัมน์สรุป (cache) เพื่อความเร็ว สอดคล้องกับหน้า list — มี caveat ว่าอาจ drift ถ้ากฎคะแนนเปลี่ยน (dashboard เป็นที่ recompute สด)
- คืน `SchoolPin[]` (ตัดหมุดที่ไม่มีพิกัดออกแล้ว)

## เชื่อมหน้า (`app/map/page.tsx`)

- เพิ่มการเรียก `listSchoolPins()` เมื่อ `canSeeAll && !assessment` (ภาพรวม admin) — ห่อ try/catch แบบเดียวกับ lookup อื่น ๆ (พังแล้ว log + คืน `[]` ไม่ให้ทั้งหน้าใช้ไม่ได้)
- ส่ง prop `schoolPins: SchoolPin[]` ผ่าน `CesiumMapLoader` → `CesiumMap` (ค่า default `[]`)
- **ปุ่มกลับแผนที่รวม**: ในหัวหน้า เพิ่ม `<Link href="/map">กลับแผนที่รวม</Link>` แสดงเมื่อ `canSeeAll && assessment` (admin/ssra กำลังเจาะดูโรงเรียน)

## ชั้นแผนที่ (client `components/map/CesiumMap.tsx`)

### prop
เพิ่ม `schoolPins: SchoolPin[]` (default `[]`) ใน `Props`, `CesiumMapLoader`

### datasource + วาดหมุด
- `schoolPinsDsRef = useRef<CustomDataSource|null>(null)` ชื่อ `"schoolPins"` เพิ่มลง viewer ตอน init เหมือน datasource อื่น ๆ
- effect: เมื่อ `national && schoolPins.length` → เคลียร์แล้ววาดใหม่ 1 entity/หมุด
  - `point`: `pixelSize ~11`, `outlineColor` ขาว/ดำ, `color` ตามสถานะ
    - เทา `Cesium.Color.GRAY`, เขียว `Cesium.Color.LIMEGREEN`/`#22c55e`, แดง `Cesium.Color.RED`/`#ef4444`
    - `disableDepthTestDistance = Number.POSITIVE_INFINITY` (มองเห็นเสมอบนพื้นผิว)
  - `label`: ชื่อโรงเรียน, ฟอนต์เล็ก, `showBackground` โปร่งบาง, `pixelOffset` เยื้องขึ้น, `scaleByDistance` เพื่อลดความรกตอนซูมออกระดับประเทศ
  - เก็บ `properties: { assessmentId: id, kind: "school-pin" }` บน entity เพื่อ pick
- ล้าง datasource เมื่อออกจาก national หรือ unmount

### คลิกหมุด → เจาะดู
- `ScreenSpaceEventHandler` ใหม่ (LEFT_CLICK) ผูกเฉพาะเมื่อ `status === "ready" && national`
  - แยกจาก drag/draw handler ที่ผูกเฉพาะ `!national` → ไม่ชนกัน
  - `scene.pick` → ถ้าโดน entity ที่ `kind === "school-pin"` → อ่าน `assessmentId` → `window.location.assign('/map?assessment=' + id)`
- ใช้ full navigation (เหมือน flow บันทึก/วิเคราะห์เดิม) เพื่อโหลด + ตรวจสิทธิ์ผ่าน server (`canAccessAssessment`) — admin/ssra เห็น read-only เหมือน user โรงเรียนนั้นเห็น

### UI พาเนล (โหมด national)
- Legend เล็ก ๆ: จุดเทา/เขียว/แดง + ข้อความ (ร่าง / ผ่านเกณฑ์≥50 / ไม่ผ่าน) และจำนวนโรงเรียนที่แสดง เช่น "N โรงเรียน"
- ใส่ CSS ใน `app/globals.css` (คลาสใหม่ เช่น `.map-pin-legend`, `.map-pin-legend-dot`), ซ่อนในโหมดพิมพ์ตามแนวเดิมถ้าจำเป็น

## คงพฤติกรรมเดิม / ไม่ทำ (YAGNI)

- โหมด national ยังไม่รัน route/rings/terrain/GIS
- ไม่ทำ entity clustering — จำนวนหมุดจำกัดตามแถวใน `assessments` (pilot); ถ้าโตมากค่อยพิจารณา `EntityCluster` ภายหลัง
- ไม่แตะ flow ของ user โรงเรียน และการเจาะ `?assessment=ID`

## เทสต์

- `tests/school-pins.test.ts` (บริสุทธิ์ node:test, ไม่ต้องมี DB):
  - `schoolPinStatus` ครบทุก mapping: ร่าง→draft; ส่งแล้ว level-1/2/3→pass; ส่งแล้ว neutral→fail
  - logic เลือกพิกัด/ตัดหมุด (ถ้าแยก helper บริสุทธิ์ เช่น `pickPinCoord`)
- source-grep test แนวเดียวกับ `tests/map-panel-collapse.test.ts` / `snapshot-capture-framing.test.ts`:
  - `CesiumMap.tsx` มีการผูก click ของ school-pin → `window.location.assign('/map?assessment=`
  - เพิ่มไฟล์ทั้งหมดเข้า `test` script ใน `package.json` (glob-free ตามแนวโปรเจกต์)

## ไฟล์ที่คาดว่าจะแตะ

- `lib/school-pins.ts` (ใหม่) — `SchoolPin`, `SchoolPinStatus`, `schoolPinStatus`, helper พิกัด
- `lib/repo.ts` — `listSchoolPins()`
- `app/map/page.tsx` — เรียก + ส่ง prop + ปุ่มกลับแผนที่รวม
- `components/map/CesiumMapLoader.tsx` — ส่งผ่าน prop
- `components/map/CesiumMap.tsx` — datasource, effect วาดหมุด, click handler, legend
- `app/globals.css` — legend + label styling (ถ้าต้อง)
- `tests/school-pins.test.ts` (+ source-grep test) และ `package.json` test script
