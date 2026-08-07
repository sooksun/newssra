# ธงจุดสูงสุด/ต่ำสุด 8 ทิศ ในรัศมีรอบโรงเรียน

วันที่: 2026-08-05
สถานะ: ออกแบบแล้ว รอ implement

## ปัญหาที่แก้

แผนที่ 3 มิติแสดงจุดสูงสุดของ *เส้นทาง* (ธงแดง) และจุดที่ผู้ใช้ชี้เอง (ธงส้ม) แต่ยังไม่มีภาพว่า
"ภูมิประเทศรอบโรงเรียนขรุขระแค่ไหน และขรุขระไปทางทิศไหน" ซึ่งเป็นข้อมูลประกอบการพิจารณา
ความยากลำบากของที่ตั้ง

แนวทาง: ในรัศมี 1 กม. รอบจุดที่ตั้งโรงเรียน แบ่งพื้นที่เป็น 8 ทิศ แล้วปักธงจุดสูงสุด (ม่วง) และ
จุดต่ำสุด (ฟ้า) ของแต่ละทิศ พร้อมป้ายบอกความสูงและส่วนต่าง แล้วบันทึกลงฐานข้อมูลไปกับ
ข้อมูล GIS ชุดเดิมของแบบประเมิน

## ข้อตกลงที่เคลียร์แล้วกับผู้ใช้

1. **เงื่อนไขค่า K (ข้อสรุปสุดท้าย 2026-08-05)** — **ปักธงเฉพาะจุดที่ต่างจากความสูงโรงเรียน
   ตั้งแต่ ±K ขึ้นไป จุดที่ต่างน้อยกว่านั้นไม่ปักธง** ตัดสิน **รายจุด** ไม่ใช่รายทิศ ทิศเดียวจึงอาจ
   ขึ้นเฉพาะธงม่วงโดยไม่มีธงฟ้าได้
   - การซ่อนมีผลกับ **การแสดงบนแผนที่เท่านั้น** — ค่ายังบันทึกลงฐานข้อมูลครบทั้ง 16 จุด และ
     ยังแสดงในตารางในแบบประเมิน (ตารางระบุด้วยว่าทิศไหนขึ้นธงอะไรบ้าง) จึงไม่มีข้อมูลหายไปเงียบ ๆ
   - ไม่รู้ความสูงโรงเรียน (`deltaFromSchoolM = null`) → **ยังปักธง** เพราะยังพิสูจน์ไม่ได้ว่าต่ำกว่าเกณฑ์
     การซ่อนโดยไม่มีฐานให้ตัดสินจะทำให้อ่านผิดว่า "ตรงนั้นราบ"
   - *ประวัติการตัดสินใจ*: รอบแรกตกลงกันว่าให้แสดงครบ 8 ทิศเสมอโดยใช้ K แค่เน้นสี และวัดจาก
     relief รายทิศ ผู้ใช้เปลี่ยนเป็นกติกาข้างต้นหลังเห็นผล
2. **นิยามความต่าง** — ป้ายแสดง **ทั้งสองค่า**: ความสูงจริงของจุด และส่วนต่างจากความสูงของโรงเรียน
   ค่าที่นำไปเทียบกับ K คือ **|ส่วนต่างจากโรงเรียน| ของแต่ละจุด** (ทั้ง +K และ −K)
   ส่วน **relief รายทิศ (สูงสุด − ต่ำสุด)** ยังคำนวณและบันทึกไว้เป็นข้อมูลประกอบ แต่ไม่ใช่เกณฑ์ปักธง
3. **ที่เก็บตัวแปร** — ค่าคงที่เดียวในโค้ด (ไม่ใช่ UI และไม่ใช่ `/admin/settings`)
4. **ความละเอียดข้อมูลที่บันทึก** — เก็บครบทั้ง 16 จุด (8 ทิศ × สูงสุด/ต่ำสุด) พร้อมพิกัด
   เพื่อให้ย้อนกลับตรวจสอบบนแผนที่ได้ว่าธงอยู่ตรงไหน

## แหล่งข้อมูลความสูง

ใช้กริดที่ `runAnalysis` ใน `components/map/CesiumMap.tsx` สุ่มอยู่แล้ว — **ไม่เพิ่ม request ใด ๆ**

- กริด 41×41 (`GRID_N`) ครอบสี่เหลี่ยมด้าน `ANALYSIS_WIDTH_M` ≈ 2,828 ม. → cell ≈ 70.7 ม.
- รัศมี 1 กม. อยู่ในกริดนี้เต็ม → ~628 เซลล์ เฉลี่ย ~78 เซลล์/ทิศ
- เซลล์ที่สุ่มไม่สำเร็จเป็น `NaN` อยู่แล้ว (ห้ามแทนด้วย 0) — การสแกนต้องข้ามเซลล์เหล่านี้

**ข้อจำกัดที่ต้องระบุตรง ๆ**: จุดสูงสุดที่ได้คือจุดสูงสุดของตัวอย่างทุก ~70 ม. ไม่ใช่ยอดจริงเป๊ะ
ถ้าภายหลังต้องการละเอียดกว่านี้ เปลี่ยนเฉพาะที่มาของกริด (สุ่มกริดเฉพาะรัศมี 1 กม.) ได้โดยไม่
กระทบ type หรือข้อมูลที่บันทึกไว้แล้ว

## โมดูลใหม่: `lib/gis-sectors.ts`

pure, framework-free — client และ server ใช้ร่วมกัน แบบเดียวกับ `lib/gis.ts`
นำเข้าได้เฉพาะ `lib/types.ts` (ห้ามนำเข้า `lib/scoring.ts` หรือโมดูลที่แตะ Cesium/DB)

### ค่าคงที่

```ts
export const SECTOR_RADIUS_M = 1000;    // รัศมีวิเคราะห์รอบจุดที่ตั้ง
export const SECTOR_RELIEF_K_M = 50;    // ค่า K — จุดที่ต่างจากโรงเรียนไม่ถึง ±K ไม่ปักธง
export const SECTOR_KEYS = ["N","NE","E","SE","S","SW","W","NW"] as const;
```

ทั้งสองค่าเป็นค่าคงที่เดียวในไฟล์นี้ ทั้งฝั่งวาดแผนที่และฝั่ง server ต้องอ้างจากที่นี่เท่านั้น
ห้าม hardcode ซ้ำที่อื่น

### การแบ่งทิศ

wedge ละ 45° โดยมีทิศนั้นอยู่กึ่งกลาง — N คือ bearing 337.5°–22.5°, NE คือ 22.5°–67.5° ไล่ตามเข็ม
ขอบเขตนับแบบ [ล่าง, บน) เพื่อไม่ให้เซลล์ตกสองทิศหรือหลุดทั้งคู่

### ฟังก์ชัน

```ts
sectorElevationsFromGrid(
  grid: Float32Array | number[],
  n: number,
  widthM: number,
  bbox: Bbox,
  options: { radiusM: number; schoolElevationM: number | null; thresholdM: number },
): GisSectorElevation[]
```

สแกนทุกเซลล์ในกริด ตัดเซลล์ที่ระยะจากจุดกึ่งกลาง > `radiusM` และเซลล์ที่ค่าไม่ finite
จัดเซลล์ที่เหลือเข้า wedge ตาม bearing แล้วเก็บจุดสูงสุด/ต่ำสุดของแต่ละ wedge
คืนครบ 8 รายการเสมอ (ทิศที่ไม่มีเซลล์ใช้ได้เลย → `highest`/`lowest`/`reliefM` เป็น `null`)

```ts
deriveSectorMetrics(
  sectors: GisSectorElevation[],
  schoolElevationM: number | null,
  thresholdM: number,
): GisSectorElevation[]
```

คำนวณค่าที่ derive ได้ทั้งหมดใหม่จากค่าดิบ: `reliefM = highest − lowest`,
`deltaFromSchoolM` ของแต่ละจุด (null เมื่อไม่รู้ความสูงโรงเรียน), `meetsThreshold = |deltaFromSchoolM| >= thresholdM`
รายจุด และ `aboveThreshold` = ทิศนี้มีจุดที่ถึงเกณฑ์อย่างน้อยหนึ่งจุด
**ฝั่ง server เรียกฟังก์ชันนี้เสมอ** ไม่ว่า client จะส่งค่าเหล่านี้มาหรือไม่

```ts
sectorFlagVisible(point: GisSectorPoint | null): boolean
```

กติกาปักธงจุดเดียว ใช้ร่วมกันทั้งแผนที่และตารางในแบบประเมิน — จริงเมื่อ `meetsThreshold`
หรือเมื่อ `deltaFromSchoolM === null` (ไม่รู้ความสูงโรงเรียน จึงยังพิสูจน์ไม่ได้ว่าต่ำกว่าเกณฑ์)

```ts
cleanSectorElevations(raw: unknown, options): GisSectorElevation[] | undefined
```

validate ค่าดิบจาก client/DB: ทิศต้องอยู่ใน `SECTOR_KEYS`, lat/lng ต้อง finite และอยู่ในช่วงที่ใช้ได้,
`elevationM` ต้อง finite จุดที่ไม่ผ่านถูกทิ้ง (ไม่แทนค่า) แล้วส่งผลผ่าน `deriveSectorMetrics` อีกชั้น
คืน `undefined` เมื่อไม่มีข้อมูลใช้ได้เลย เพื่อให้แถวเก่าไม่งอก key

## เปลี่ยนแปลงใน `lib/types.ts`

```ts
export type GisSectorKey = (typeof SECTOR_KEYS)[number];

export interface GisSectorPoint {
  lat: number;
  lng: number;
  elevationM: number;
  /** ส่วนต่างจากความสูงของโรงเรียน (ม.) — null = ไม่รู้ความสูงโรงเรียน */
  deltaFromSchoolM: number | null;
  /** |ส่วนต่างจากโรงเรียน| >= K — จุดที่ไม่ถึงเกณฑ์นี้ไม่ปักธง แต่ยังบันทึกไว้ */
  meetsThreshold: boolean;
}

export interface GisSectorElevation {
  sector: GisSectorKey;
  /** null = ทิศนี้อ่านความสูงไม่ได้เลย */
  highest: GisSectorPoint | null;
  lowest: GisSectorPoint | null;
  /** สูงสุด − ต่ำสุด ภายในทิศนี้ (ม.) — ข้อมูลประกอบ ไม่ใช่เกณฑ์ปักธง */
  reliefM: number | null;
  /** ทิศนี้มีธงขึ้นอย่างน้อยหนึ่งอัน */
  aboveThreshold: boolean;
}

export interface GisSectorConfig {
  radiusM: number;
  thresholdM: number;
  /** ความสูงโรงเรียนที่ใช้อ้างอิงคำนวณส่วนต่าง (ม.) */
  schoolElevationM: number | null;
  /** ที่มาของค่าข้างต้น — บันทึกไว้ให้ตรวจย้อนได้ว่าตัวเลขมาจากไหน */
  schoolElevationSource: "route-profile" | "grid-center";
}
```

เพิ่มใน `GisAnalysis` เป็น **optional ทั้งคู่**:

```ts
sectorElevations?: GisSectorElevation[];
sectorConfig?: GisSectorConfig;
```

`makeBlankState` ไม่สร้าง key เหล่านี้ และ `sanitizeGis` ใส่ให้เฉพาะเมื่อมีข้อมูลใช้ได้จริง
→ แถว v1 round-trip ได้ byte-identical เหมือนเดิม

**ความสูงอ้างอิงของโรงเรียน**: ใช้ค่าจาก route elevation profile (ค่าเดียวกับที่หมุดโรงเรียนแสดง)
ถ้าไม่มีเส้นทางจึงถอยไปใช้เซลล์กลางกริด และบันทึก `schoolElevationSource` ไว้เสมอ
**ห้ามเขียนค่าเหล่านี้ทับฟิลด์ `GisElevationInfo.schoolMarkerElevationM`** — เป็นคนละฟิลด์ คนละสัญญา

## การวาดบนแผนที่ (`components/map/CesiumMap.tsx`)

- ไอคอนใหม่ทรงเดียวกับ `RED_FLAG_ICON`: `PURPLE_FLAG_ICON` (`#7c3aed`, จุดสูงสุด) และ
  `BLUE_FLAG_ICON` (`#0ea5e9`, จุดต่ำสุด)
- `CustomDataSource` ใหม่ชื่อ `sectors` แยกจาก `rings`/`route` เพื่อล้าง/วาดใหม่ได้อิสระ
- คำนวณใน `runAnalysis` ทันทีหลังได้กริด (ไม่ยิง terrain เพิ่ม) เก็บลง state `sectorElevations`
- วาดเมื่อ `status === "ready" && !national && showSectorFlags` และมีข้อมูล
- **การซ่อนด้วย K**: ปักเฉพาะจุดที่ `sectorFlagVisible(point)` เป็นจริง (|ส่วนต่างจากโรงเรียน| ≥ K
  หรืออ่านความสูงโรงเรียนไม่ได้) — ตัดสินรายจุด ทิศเดียวจึงอาจขึ้นเฉพาะธงม่วงโดยไม่มีธงฟ้า
- ป้ายใช้ `addPinLabel` เดิม (ห้ามใช้ Cesium `label` กับข้อความไทย — glyph ไทยถูกฉีก)
  - ธงม่วง: `สูงสุดทิศเหนือ` / `1,240 ม. (+95 ม.)` / `ต่างในทิศ 168 ม.`
  - ธงฟ้า: `ต่ำสุดทิศเหนือ` / `1,072 ม. (−73 ม.)`
  - relief แสดงบนธงม่วงทิศละครั้ง ไม่ซ้ำสองป้าย
  - ค่าที่เป็น null ไม่แสดงบรรทัดนั้น (ไม่แทนด้วย 0)
- `LABEL_PRIORITY` เพิ่มระดับ `sector` ต่ำกว่า `destination` แล้วเลื่อน `overviewSchool`/`country`
  ลงหนึ่งขั้น — ป้าย 16 อันต้องยอมหลบป้ายหลักเมื่อทับกัน
- เพิ่ม checkbox **"ธงสูงสุด/ต่ำสุด 8 ทิศ"** ข้างสวิตช์แนวชายแดน (default เปิด)

## การบันทึก

ไม่มีปุ่มใหม่ — ข้อมูลเดินทางไปกับปุ่มเดิม "บันทึกข้อมูลประกอบเกณฑ์และกรอกแบบประเมิน"
(`POST /api/assessments/from-map`)

- payload ส่ง **เฉพาะค่าดิบ**: `sectorElevations[].sector` + `highest`/`lowest` ที่มี `lat`/`lng`/`elevationM`
- `lib/gis-request.ts#buildGisFromMapRequest` เรียก `cleanSectorElevations` แล้ว `deriveSectorMetrics`
  → `reliefM` / `deltaFromSchoolM` / `meetsThreshold` / `aboveThreshold` **คำนวณใหม่ฝั่ง server เสมอ**
  ค่าที่ client ส่งมาสำหรับฟิลด์เหล่านี้ไม่ถูกใช้
- `sectorConfig` เขียนโดย server จากค่าคงที่ในโค้ด ไม่รับจาก client
- `lib/map-assessment.ts#applyMapGisToState` และ route `POST /api/assessments/[id]/gis`
  ต้อง carry forward `sectorElevations`/`sectorConfig` เดิมเมื่อ payload รอบใหม่ไม่ได้ส่งมา
  (แบบเดียวกับที่ทำกับ `areaSummary`/`radiusSummaries`)
- PUT autosave ทั่วไปยังถือ `gis` เป็น server-owned เหมือนเดิม → ไม่ต้องแก้

## การแสดงในแบบประเมิน (`components/GisSummary.tsx`)

ตารางใหม่ในกลุ่มภูมิประเทศ: **"จุดสูงสุด/ต่ำสุด 8 ทิศ ในรัศมี 1 กม."**

| ทิศ | สูงสุด (ม.) | พิกัดสูงสุด | ต่ำสุด (ม.) | พิกัดต่ำสุด | ต่างในทิศ (ม.) | ธงบนแผนที่ |

คอลัมน์ "ธงบนแผนที่" บอกว่าทิศนั้นขึ้นธงอะไรบ้าง (`สูงสุด (ม่วง)` / `ต่ำสุด (ฟ้า)` / `ไม่ปักธง`)
เพื่อให้ผู้ตรวจเข้าใจว่าจุดที่ไม่มีธงคือ "ต่างไม่ถึง ±K" ไม่ใช่ "ไม่มีข้อมูล"

- ค่าที่ไม่มีขึ้น **"ไม่มีข้อมูล"** ผ่าน `valueOrMissing` เดิม ห้ามแทนด้วยค่าสมมติ
- หัวตารางระบุค่ารัศมีและค่า K ที่ใช้จริงจาก `sectorConfig` ของแถวนั้น ไม่ใช่ค่าคงที่ปัจจุบัน
  (แถวเก่าที่บันทึกด้วยค่าอื่นจะได้อ่านตรงกับตอนบันทึก)
- แสดงเฉพาะเมื่อ `gis.sectorElevations` มีอยู่ — แถวเก่าไม่เห็นส่วนนี้
- กติกา print เดิมใช้ได้ ไม่ต้องเพิ่ม override

## เทสต์

เพิ่มทุกไฟล์ในสคริปต์ `test` แบบระบุชื่อไฟล์ (glob-free ตาม convention เดิม)

1. `lib/gis-sectors.test.ts` (ใหม่, pure)
   - bearing ขอบ wedge พอดี (0°, 22.5°, 337.5°) เข้าทิศที่ถูกต้อง ไม่ตกสองทิศ
   - เซลล์นอกรัศมีถูกตัด
   - เซลล์ `NaN` ถูกข้าม ไม่กลายเป็น 0
   - `reliefM` / `deltaFromSchoolM` ถูกต้อง
   - ส่วนต่างเท่ากับ +K และ −K พอดี → `meetsThreshold === true` (เกณฑ์คือ `>=` และใช้ค่าสัมบูรณ์)
   - จุดที่ต่างไม่ถึง ±K → `sectorFlagVisible` เป็นเท็จ (ไม่ปักธง) แม้ relief ในทิศจะสูง
   - ไม่รู้ความสูงโรงเรียน → `sectorFlagVisible` เป็นจริง (ยังปักธง)
   - ทิศที่ไม่มีเซลล์ใช้ได้ → `highest`/`lowest`/`reliefM` เป็น null และ `aboveThreshold === false`
   - `cleanSectorElevations` ทิ้งจุดที่พิกัด/ความสูงไม่ถูกต้อง และคืน `undefined` เมื่อไม่เหลืออะไรเลย
2. `tests/gis.test.ts` (เพิ่มเคส) — `sanitizeGis` round-trip: แถว v1 **ต้องไม่งอก** key
   `sectorElevations`/`sectorConfig`
3. `tests/gis-request.test.ts` (เพิ่มเคส) — ส่ง `reliefM: 9999` และ `aboveThreshold` ปลอมมา
   ผลลัพธ์ต้องเป็นค่าที่ server คำนวณเอง
4. `tests/map-assessment.test.ts` (เพิ่มเคส) — carry forward เมื่อ payload รอบถัดไปไม่ส่งมา
5. `components/GisSummary.test.tsx` (เพิ่มเคส) — ตารางเรนเดอร์ครบ 8 แถว และค่าที่ขาดขึ้น "ไม่มีข้อมูล"
6. `tests/sector-flags.test.ts` (ใหม่, source-grep ตามแบบ `tests/route-elevation-flags.test.ts`)
   - `CesiumMap.tsx` ต้องเรียก `sectorElevationsFromGrid`
   - `CesiumMap.tsx` ต้องอ้าง `SECTOR_RADIUS_M` / `SECTOR_RELIEF_K_M` ไม่ hardcode ตัวเลข

ตรวจปิดท้ายด้วย `npm test` และ `npm run build` (หยุด dev server ก่อน — ทั้งคู่เขียน `.next/`)

## สิ่งที่ตั้งใจไม่ทำ

- ไม่ยิง terrain เพิ่มเพื่อความละเอียดสูงขึ้น (ใช้กริดเดิม — เปลี่ยนภายหลังได้โดยไม่กระทบ type)
- ไม่เพิ่มตาราง DB ใหม่ (ไปกับ `state.gis` JSON ที่มีอยู่)
- ไม่นำค่าเหล่านี้ไปคิดคะแนน 100 คะแนนทางการ — เป็นข้อมูลประกอบเท่านั้น
- ไม่เพิ่มปุ่มบันทึกแยก (ขัดกับหลัก "ปุ่มเดียว" ของหน้าแผนที่)
- ไม่ทำ UI ปรับค่ารัศมี/K (ตกลงว่าเป็นค่าคงที่ในโค้ด)
