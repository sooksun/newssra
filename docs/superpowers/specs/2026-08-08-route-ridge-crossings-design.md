# นับลูกคลื่นภูเขาที่เส้นทางต้องข้ามกว่าจะถึงโรงเรียน (Route Ridge Crossings)

- วันที่: 2026-08-08
- สถานะ: อนุมัติแบบแล้ว (brainstorming session)
- เกี่ยวข้อง: `lib/map/routeElevation.ts`, `lib/gis.ts`, `lib/terrain-difficulty.ts`, `components/map/CesiumMap.tsx`, `components/GisSummary.tsx`

## 1. ปัญหา

เกณฑ์ปัจจุบันวัดเส้นทางด้วย ระยะทาง / เวลา / ความคดเคี้ยว (RCR) / ความสูงสะสม (gain) /
สัดส่วนเส้นทางบนภูเขา (mountainPct) — แต่ไม่มีตัวไหนตอบคำถามที่กรรมการถามจริงว่า
**"กว่าจะถึงโรงเรียนต้องข้ามภูเขากี่ลูก"** ความสูงสะสม 600 ม. อาจเป็นการไต่ยาวลูกเดียว
หรือข้ามเขาเตี้ย ๆ 8 ลูกก็ได้ ซึ่งความยากลำบากต่างกันมาก

การนับจากโปรไฟล์กลางถนนอย่างเดียวก็ยังหลอกได้: ถนนที่เจาะช่องเขา/เลียบหุบจะ "แบน"
ทั้งที่วิ่งอยู่กลางแนวสันเขา จึงต้องวัด **แนวขนานซ้าย-ขวาของถนน** ประกอบ —
ถ้าสองข้างทางยกตัวขึ้นพร้อมแนวถนน แปลว่าข้ามสันเขาจริง

## 2. ขอบเขต

- นับจากเส้นทางหลัก (`primaryRoute` — เส้นไป ศาลากลาง/สนง.เขต ที่ผู้ใช้เลือก) เท่านั้น
- คำนวณฝั่ง client (Cesium terrain มีอยู่แล้ว) — เซิร์ฟเวอร์รับค่าผ่าน allowlist ของ
  `sanitizeGis` เหมือนข้อมูล GIS อื่น และไม่คำนวณซ้ำ (เซิร์ฟเวอร์ไม่มี DEM)
- ผลเข้าเกณฑ์ความยากลำบาก 5 ระดับเป็นมิติการเข้าถึงมิติใหม่ทันที (ตามมติผู้ใช้)
- แถว v1 / แถวที่บันทึกก่อนฟีเจอร์นี้: ไม่มี key ใหม่, round-trip byte-identical,
  มิติใหม่ไม่ถูกนับ และแจ้งใน `missing`

## 3. นิยาม

| คำ | นิยาม |
|---|---|
| ภูเขา 1 ลูก (wave) | ยอดบนโปรไฟล์ที่ไต่จากหุบก่อนหน้า ≥ `RW_PROMINENCE_M` = **50 ม.** และลงหลังยอด ≥ 50 ม. (hysteresis counting) |
| ลูกท้ายเส้น | ไต่ช่วงท้าย ≥ 50 ม. โดยไม่มีขาลง → นับ 1 ลูก (โรงเรียนตั้งบนเขาลูกสุดท้าย ต้อง "ขึ้นให้ถึง") |
| สันเขาจริง (confirmed) | ยอดในแนวกลางที่มียอดในแนวซ้าย **หรือ** ขวา ภายในหน้าต่าง ±`RW_CONFIRM_WINDOW_M` = 300 ม. ตามระยะทางแนวเส้น |
| แนวข้าง | จุด offset ตั้งฉากจากแนวถนน ±`RW_SIDE_OFFSET_M` = **200 ม.** (ค่าคงที่ ไม่สุ่ม — ผลต้องทำซ้ำได้ทุกครั้งที่กดบันทึก) |

เหตุผลเลือก 50 ม.: เท่ากับเกณฑ์ "สลับซับซ้อน" ของธง 8 ทิศ (`SECTOR_RELIEF_K_M`) —
ระบบใช้ตัวเลขเดียวกันตอบคำว่า "ลูกเขา" ทุกที่

## 4. อัลกอริทึม (pure — `lib/map/routeWaves.ts`)

1. **สุ่มจุดกึ่งกลาง**: ทุก `RW_SPACING_M` = 50 ม. ตามเส้นทาง; เพดาน
   `RW_MAX_POINTS_PER_LINE` = 1,200 จุด/แนว — เส้นยาวกว่า 60 กม. ขยายระยะเป็น
   `ceil(length/1200)` และรายงานระยะจริงในผลลัพธ์ (`spacingM`)
2. **แนวข้าง**: ต่อจุด คำนวณ bearing จากจุดเพื่อนบ้าน แล้ว offset ตั้งฉาก ±200 ม.
   → พิกัด 3 ชุด (center/left/right) ให้ผู้เรียกไปสุ่มความสูง
3. **ปรับเรียบ**: median หน้าต่าง 3 จุด ต่อโปรไฟล์ (กัน spike ของ DEM)
4. **นับลูกต่อโปรไฟล์**: เดินตามเส้นแบบ hysteresis — เก็บหุบต่ำสุดล่าสุด, เข้าสถานะ
   "กำลังไต่" เมื่อสูงกว่าหุบ ≥ 50 ม., ปิดลูกเมื่อลงจากยอดชั่วคราว ≥ 50 ม.
   แล้วรีเซ็ตหุบ; จบเส้นทั้งที่ยังไต่ → ปิดลูกท้ายเส้น
5. **ยืนยันสันเขา**: ยอด center ที่มียอด left หรือ right ใน ±300 ม. (ระยะตามแนวเส้น)
   → `confirmed: true`
6. **ผลลัพธ์**: `count` (ลูกทั้งหมดบนแนวถนน), `confirmedCount` (สันเขาจริง),
   รายการ `waves[]` (ตำแหน่ง กม., ความสูงยอด, prominence, confirmed) cap 30 ลูกแรก
   (`RW_MAX_WAVES_STORED`), พารามิเตอร์ที่ใช้ (`spacingM`/`sideOffsetM`/`prominenceM`)

ข้อควรระวังที่เป็นบทเรียนจริงของ repo: โมดูลนี้ **ห้าม import `lib/gis.ts`**
(จะวนกับ `sanitizeGis`) — pure ล้วน import ได้แค่ `lib/map/geometry.ts`/`morphology.ts`

## 5. โครงข้อมูลที่เก็บ (`lib/gis.ts`)

```ts
export interface GisRidgeCrossings {
  count: number;            // ลูกทั้งหมดบนแนวถนน
  confirmedCount: number;   // ลูกที่แนวข้างยืนยันว่าเป็นสันเขาจริง
  spacingM: number;         // ระยะสุ่มจริง (≥50)
  sideOffsetM: number;      // 200
  prominenceM: number;      // 50
  waves: {
    atKm: number;           // ตำแหน่งบนเส้นทาง (กม. จากต้นทาง)
    elevM: number;          // ความสูงยอด
    prominenceM: number;    // ไต่จริงจากหุบก่อนหน้า
    confirmed: boolean;
  }[];                      // cap 30
}
// GisRouteAnalysis.ridgeCrossings?: GisRidgeCrossings  — optional เขียนเมื่อมีเท่านั้น
```

`sanitizeGis`: เพิ่ม clause อ่าน `ridgeCrossings` แบบ allowlist ต่อ field พร้อมช่วงค่า
(`GIS_LIMITS`: count 0–500, atKm 0–1000, elev −500–9000, prominence 0–4000,
spacing 10–2000, offset 50–1000) — key ไม่มี → ไม่ emit (v1 round-trip เดิม)

## 6. เข้าเกณฑ์ 5 ระดับ (`lib/terrain-difficulty.ts`)

- เพิ่มมิติที่ 7 ใน `TD_ACCESS_CUTS`: **`ridges` = confirmedCount ≥ `TD_RIDGE_MIN` = 3**
- ใช้ `confirmedCount` ไม่ใช่ `count` — ถนนคดเคี้ยวบนเนินที่แนวข้างไม่ยืนยัน
  ต้องไม่ดันเกณฑ์
- ไม่มีข้อมูล (แถวเก่า) → มิตินี้เป็น `null`: ไม่นับทั้งเข้าและออก และเพิ่มข้อความใน
  `missing` ว่า "จำนวนภูเขาที่ข้าม — บันทึกจากแผนที่อีกครั้ง"
- **คำเตือนที่ต้องคงไว้ในโค้ด/รายงาน**: เกณฑ์ตัด 3 ลูกเป็นค่าเริ่มต้นเชิงหลักการ
  ยังไม่ได้ calibrate กับประชากรจริง (ต่างจาก 146 กม. ที่เป็น P75 จริง) —
  เมื่อมีข้อมูลสะสมพอ ให้ทบทวนด้วยการแจกแจงจริงก่อนใช้ตัดสินระดับนโยบาย

## 7. การแสดงผล

- **แผงแผนที่** (`CesiumMap.tsx`): หลังวิเคราะห์เส้นทาง แสดงบรรทัด
  "ข้ามภูเขา ~N ลูก (สันเขาจริง M ลูก)" ใต้ metric เส้นทางเดิม
- **`GisSummary.tsx`**: แถวใหม่ในกลุ่มภูมิประเทศ — ค่า + พารามิเตอร์กำกับ
  ("นับที่ prominence ≥50 ม., แนวข้าง ±200 ม."); แถวเก่าแสดง "ไม่มีข้อมูล"
- ตัวเลขที่แสดงบนจอกับที่บันทึกมาจากฟังก์ชันเดียวกัน (แพตเทิร์นเดียวกับ
  `buildRouteAnalysis`)

## 8. การไหลของข้อมูล

```
OSRM route coords
  → routeWaves.sampleWaveLines()        (pure: จุด center/left/right)
  → CesiumMap สุ่มความสูง 3 แนว (sampleTerrainMostDetailed, batch)
  → routeWaves.countRidgeCrossings()    (pure: นับ + ยืนยัน)
  → แสดงบนแผง + ใส่ payload บันทึก (/from-map หรือ /gis)
  → buildGisFromMapRequest คัดลอกผ่าน sanitizeGis (server ไม่คำนวณซ้ำ — ไม่มี DEM)
  → gis.route.ridgeCrossings → GisSummary + terrainDifficultyFromGis
```

หมายเหตุความปลอดภัยข้อมูล: ค่านี้เป็น **ข้อมูลภูมิประเทศที่ client วัดได้เสมอ**
(เหมือน elevationGainM ที่รับจาก client อยู่แล้ว) — เซิร์ฟเวอร์ validate ช่วงค่า
แต่รับรองความจริงไม่ได้จนกว่าจะมี DEM ฝั่ง server; ยอมรับข้อจำกัดนี้แบบเดียวกับ
gain/loss เดิม

## 9. การทดสอบ

- `lib/map/routeWaves.test.ts` (pure, node:test):
  - โปรไฟล์ราบ → 0 ลูก; ลูกเดียวชัด → 1; สองลูกมีหุบคั่น ≥50 → 2
  - ขึ้น 49 ม. → 0 (ใต้ threshold); ไต่ท้ายเส้นไม่ลง → 1 (ลูกท้ายเส้น)
  - noise ±10 ม. บนไหล่ลูกเดียว → ยังนับ 1 (median smoothing + hysteresis)
  - ยืนยันสันเขา: ยอด center + ยอด left ใน 300 ม. → confirmed; ไม่มีข้าง → ไม่ confirmed
  - เรขาคณิต: offset ตั้งฉากจริง (dot product ≈ 0), ระยะ ≈ 200 ม. (haversine),
    เพดานจุด (เส้นยาว → spacing ขยาย, จุด ≤ 1200)
  - `waves` cap 30; ผลไม่แก้อินพุต
- `tests/gis.test.ts`: `sanitizeGis` round-trip `ridgeCrossings` + ตัดค่านอกช่วง +
  แถวเก่าไม่งอก key
- `lib/terrain-difficulty.test.ts`: มิติ ridges นับเมื่อ ≥3, ไม่นับเมื่อ null,
  ข้อความ missing เมื่อไม่มีข้อมูล
- source-grep (`tests/`): CesiumMap เรียก `countRidgeCrossings` และส่งผลเข้า payload
  บันทึก (กันสายไฟหลุดแบบเดียวกับ `route-elevation-flags.test.ts`)

## 10. สิ่งที่ไม่ทำในรอบนี้

- ไม่คำนวณฝั่ง server (ไม่มี DEM) — บันทึกไว้เป็นงานอนาคตถ้าต้องการ audit อิสระ
- ไม่ใช้กับเส้นทาง รพ./สนง.เขต อื่น (เฉพาะ primaryRoute)
- ไม่ปรับ `derive32Severity` / คะแนน 100 เดิม — เข้าเฉพาะเกณฑ์ 5 ระดับ
- ไม่มีการสุ่มแบบ random จริง — ทุกอย่าง deterministic เพื่อ audit ซ้ำได้
