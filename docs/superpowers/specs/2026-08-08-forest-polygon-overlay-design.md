# แสดงพื้นที่ป่าเป็น polygon บนแผนที่ 3 มิติ — ชั้นสภาพป่าจริง (กรมป่าไม้) + ชั้นป่าทั่วไป (OSM)

สถานะ: **ออกแบบแล้ว รออิมพลีเมนต์**
วันที่: 2026-08-08
ผู้รับ: ระบบคัดกรองโรงเรียนพื้นที่ลักษณะพิเศษ `newssra` — หน้า `/map`
เอกสารที่เกี่ยวข้อง:
- [`2026-08-07-forest-three-layers-highland-design.md`](./2026-08-07-forest-three-layers-highland-design.md) — นิยาม 3 ชั้น (Status / Type / Legal) ที่ห้ามยุบรวมกัน
- [`2026-08-07-forest-boundary-highland-screen-design.md`](./2026-08-07-forest-boundary-highland-screen-design.md) — ชั้น Legal จาก OSM (overlay ที่วาดอยู่แล้ววันนี้)

---

## 1. ปัญหาที่แก้

วันนี้หน้า `/map` มีชั้นป่าอยู่ในสองสถานะที่ไม่เท่ากัน:

| ชั้น | มีข้อมูล | เห็นบนแผนที่ |
|---|---|---|
| แนวเขตตามกฎหมาย/คุ้มครอง (OSM) | ดึงสดจาก Overpass | **เห็น** — polygon + ป้ายชื่อเขต |
| สภาพพื้นที่ป่าจริง (กรมป่าไม้ 2562) | ติดตั้งครบทั้งประเทศแล้วใน `data/forest-status/cells-cover/` (93,000 polygon) | **ไม่เห็น** — มีแต่ตัวเลขในแผงซ้าย |

ผลคือชั้นที่ **เกณฑ์ใช้คิดคะแนนจริง** (สภาพป่า — ดู `lib/terrain-difficulty.ts` กฎข้อ 4) เป็นชั้นเดียวที่ผู้ใช้มองไม่เห็น ต้องเชื่อตัวเลข `0% / 20.6% / 24.7%` โดยไม่มีภาพยืนยัน ขณะที่ชั้นที่ห้ามใช้ตัดสินคะแนนกลับเด่นที่สุดบนจอ

สาเหตุทางเทคนิค: `GET /api/forest-status` คืนเฉพาะผลสรุป (`inside` / `distanceM` / สัดส่วนรัศมี) ไม่ส่ง geometry ออกมาเลย

---

## 2. ขอบเขต

**ทำ**
1. ชั้น **สภาพพื้นที่ป่าจริง** (`rfd-forest-cover`, พ.ศ. 2562) วาดเป็น polygon รอบจุดวิเคราะห์ รัศมี 10 กม.
2. ชั้น **ป่าทั่วไปจาก OSM** (`natural=wood` / `landuse=forest`) วาดเป็น polygon รัศมีเดียวกัน
3. checkbox แยกกัน 2 ตัว ปิดเป็นค่าเริ่มต้นทั้งคู่

**ไม่ทำ (นอกขอบเขตงานนี้)**
- ไม่แตะคะแนน ไม่เขียนลง `state.gis` ไม่เข้า `lib/scoring.ts` / `lib/terrain-difficulty.ts` — **แสดงผลอย่างเดียว**
- ไม่แก้ชั้นชนิดป่า (Type) — ชุดข้อมูลกรมป่าไม้ที่ติดตั้งมีแค่ `f_code` ค่าเดียว ยังจำแนกชนิดไม่ได้ และห้ามกรอกเอง
- ไม่ทำ simplify geometry (Douglas–Peucker) — วัดแล้ว payload อยู่ในระดับที่ส่งดิบได้ ถ้าอนาคตขยายรัศมีค่อยพิจารณา
- ไม่แก้ปัญหา "วงนอก vs รูใน" ของ shapefile (ดู §6)

---

## 3. ข้อมูลที่วัดมาแล้ว (ไม่ใช่ประมาณการ)

วัดรอบพิกัดบ้านพญาไพร ≈ 20.28N, 99.72E:

| ชั้น | รัศมี 5 กม. | รัศมี 10 กม. |
|---|---|---|
| กรมป่าไม้ 2562 (จากดิสก์) | 17 polygon · 11,751 จุด · ~250 KB | **101 polygon · 32,082 จุด · ~690 KB** |
| OSM `natural=wood` (Overpass) | — | **8 ก้อน (3 way + 5 relation) · 5,793 จุด · 300 KB · 7 วิ** |

ข้อสังเกตที่ต้องสะท้อนใน UI: OSM มีป่าแค่ 8 ก้อนในบริเวณที่กรมป่าไม้มี 101 polygon — **ชั้น OSM ไม่ครบและจะดูโหว่** โดยเฉพาะภาคเหนือ ป้ายกำกับต้องบอกตรงว่าเป็นข้อมูลอ้างอิงที่ไม่ครบ ไม่ใช่ชั้นราชการ

ระหว่างวัด endpoint หลัก `overpass-api.de` ล่ม (`Dispatcher_Client` runtime error) ต้องใช้ `overpass.kumi.systems` — โค้ดเดิมมี fallback list อยู่แล้ว ชั้นใหม่ต้องใช้ list เดียวกัน

ขนาด cell ดิบใหญ่สุด 18 MB (`cells-cover/18.5_98.5.json`, เชียงใหม่) จึงเสิร์ฟไฟล์ cell ตรง ๆ ไม่ได้ ต้องตัดตามกรอบก่อนส่ง

---

## 4. ทางเลือกที่พิจารณา

| ทางเลือก | ตัดสิน |
|---|---|
| **A. API ใหม่ `/api/forest-status/polygons` แยกจาก route วิเคราะห์** | **เลือก** — route เดิมถูกเรียกทุกครั้งที่ย้ายหมุด ถ้ายัด geometry รวม payload จะบวมทุกครั้งแม้ไม่เปิดชั้น แยก route ทำให้โหลดเฉพาะตอนติ๊ก checkbox และ abort/cache แยกกัน |
| B. ต่อ `?geometry=1` ที่ route เดิม | ตก — ไฟล์น้อยกว่าแต่ผูกสองจังหวะการเรียกเข้าด้วยกัน |
| C. เสิร์ฟไฟล์ cell เป็น static | ตก — cell ใหญ่ถึง 18 MB และ `/data` อยู่นอก auth gate ของ `proxy.ts` |

---

## 5. สถาปัตยกรรม

```
เปิด checkbox "สภาพพื้นที่ป่าจริง"
  → GET /api/forest-status/polygons?lat=&lng=&radius=10000     (server, requireApiUser)
      → loadForestStatusAround(..., { authority: "rfd-forest-cover" })   [เดิม]
      → featuresInBox(features, box)                                     [ใหม่ · pure]
      → { available, yearBe, attribution, dataSource, features: [{ rings }] }
  → CesiumMap วาดใน datasource "forestCover"

เปิด checkbox "ป่าทั่วไป (OSM)"
  → fetchGenericForest(lat, lng, 10000, signal)                          [ใหม่ · client]
      → Overpass (endpoint list + cache เดิม)
  → CesiumMap วาดใน datasource "forestGeneric"
```

### 5.1 `lib/map/forest-polygons.ts` (ใหม่ · pure · ทดสอบได้)

ไม่ import `node:fs` ไม่ import `cesium` — เป็นคณิตกรอบล้วน ๆ

```ts
export interface LngLatBox { minLng: number; minLat: number; maxLng: number; maxLat: number }
export interface ForestPolygonFeature { rings: [number, number][][] }   // [lng, lat]

/** กรอบสี่เหลี่ยมรอบจุด (ชดเชย cos(lat) ที่ลองจิจูด) */
export function boxAround(lat: number, lng: number, radiusM: number): LngLatBox

/**
 * กรอง feature ที่ ring ใดก็ตามแตะกรอบ แล้วปัดพิกัดเหลือ 5 ตำแหน่ง (~1.1 ม.)
 * - ตัดวงที่มีน้อยกว่า 4 จุดทิ้ง (Cesium วาดไม่ได้)
 * - ตัดพิกัดที่ไม่ใช่จำนวนจำกัดทิ้ง (กัน NaN ทำ renderer พัง — บทเรียนเดียวกับ polygon-draw)
 * - ส่ง ring ทั้งวงไม่ตัดกลางวง เพื่อไม่ให้ขอบผืนป่าถูกตัดเป็นเส้นตรงปลอมที่กรอบ
 */
export function featuresInBox(features, box): ForestPolygonFeature[]
```

`radiusM` ถูก clamp ที่ปลายทาง (route) ไม่ใช่ในฟังก์ชัน pure

### 5.2 `app/api/forest-status/polygons/route.ts` (ใหม่)

- `export const dynamic = "force-dynamic"`
- `requireApiUser()` — คืน `guard.response` เมื่อไม่ผ่าน (แพตเทิร์นเดียวกับ route เดิม)
- validate `lat`/`lng`: ต้องเป็นจำนวนจำกัดและอยู่ในกรอบไทย (ใช้ค่าคงที่ชุดเดียวกับ `/api/forest-status`)
- `radius`: ค่าเริ่มต้น 10,000 ม. **clamp 1,000–10,000** — กันคำขอที่ลากทั้งจังหวัดมาทั้งก้อน
- `loadForestStatusAround(lat, lng, radiusM, { authority: "rfd-forest-cover" })` → ไม่มีชุดข้อมูล → `{ available: false, features: [] }` พร้อมข้อความแนะนำสคริปต์ติดตั้ง (fail soft เหมือน route เดิม — ห้าม 500)
- คืน `attribution` + `dataSource` + `yearBe` จากเอกสารจริง ไม่ hardcode ในหน้าเว็บ

### 5.3 `lib/map/forest-generic.ts` (ใหม่ · client)

**แยกไฟล์จาก `lib/map/forestBoundaries.ts` โดยเจตนา** ไม่ใช่เพื่อความสวยงามของโครงไฟล์ แต่เพื่อกันไม่ให้ "ป่าทั่วไป" ไหลเข้า `classifyForestOverlay()` ซึ่งผลของมันถูกเก็บเป็นหลักฐานประกอบเกณฑ์ (`gis.forestOverlay`) — ป่าทั่วไปใน OSM ไม่ใช่เขตประกาศและไม่ใช่ชั้นสภาพป่าราชการ ถ้ามันเข้าไปปนก็จะกลายเป็นหลักฐานปลอม

- ใช้ `OVERPASS_ENDPOINTS` + timeout + cache pattern เดิม (export ค่าคงที่จาก `forestBoundaries.ts` ใช้ร่วม ไม่ก็อป)
- query: `way`/`relation` ที่มี `natural=wood` หรือ `landuse=forest` ในรัศมี, `out geom;`
- parse: `way.geometry` → 1 วง; `relation.members[].geometry` → หลายวง (แต่ละ member เป็นวงของตัวเอง — ไม่ประกอบ multipolygon เพราะเราวาดทุกวงเป็นป่าอยู่แล้ว ดู §6)
- คืน type ของตัวเอง `GenericForestArea { rings: [number, number][][] }` — ไม่ reuse `ForestBoundary` เพราะ `ForestZoneKind` เป็นอนุกรมวิธานของเขตคุ้มครอง ป่าทั่วไปไม่ใช่สมาชิกของมัน

### 5.4 `components/map/CesiumMap.tsx`

- state ใหม่ 2 ตัว: `showForestCover`, `showForestGeneric` — **ค่าเริ่มต้น `false` ทั้งคู่** (เหมือนชั้น legal เดิม)
- datasource ใหม่ 2 ตัว (`forestCover`, `forestGeneric`) สร้าง/ทำลายที่เดียวกับ `forestDsRef`
- effect ต่อชั้น: keyed ด้วย `[center, show*, status, national]`, ใช้ `AbortController`, ปิด checkbox → ล้าง entity + ยกเลิกคำขอที่ค้าง
- ย้ายหมุด / ค้นหาใหม่ → refetch อัตโนมัติ (effect keyed ด้วย `center` อยู่แล้ว)
- ไม่วาดในโหมด `national` (มุมมองทั้งประเทศของ admin) — ไม่มีจุดวิเคราะห์ให้อิง

### 5.5 การวาด

| ชั้น | fill | ขอบ |
|---|---|---|
| สภาพป่าจริง (กรมป่าไม้) | `#16a34a` alpha 0.20 | `#15803d` width 2 |
| ป่าทั่วไป (OSM) | `#84cc16` alpha 0.20 | `#4d7c0f` width 2 |

- **แต่ละ ring = polygon หนึ่งวง** `clampToGround` (`classificationType: ClassificationType.TERRAIN`) ทาบภูมิประเทศ
- โทนสีต้องต่างจาก `FOREST_KIND_COLORS` ของชั้น legal ที่วาดอยู่แล้ว — ผู้ใช้ต้องแยกออกด้วยตาว่าเส้นไหนคือเขตกฎหมาย เส้นไหนคือป่าจริง
- ไม่ใส่ label ชื่อ — ชุดข้อมูลสภาพป่าไม่มีชื่อผืนป่า และ label จะไปชนกับธง 8 ทิศที่หนาแน่นอยู่แล้ว
- เครดิตใต้ checkbox แต่ละตัว แสดงเมื่อชั้นเปิด: กรมป่าไม้ (CC-BY, data.go.th) / `© OpenStreetMap contributors` (ODbL — เป็นหน้าที่ตามสัญญาอนุญาต)

---

## 6. ข้อจำกัดที่ยอมรับอย่างเปิดเผย: วงนอก vs รูใน

shapefile กรมป่าไม้เก็บทุก part เรียงกันโดยไม่ระบุว่าวงไหนเป็นขอบนอกวงไหนเป็นรู และ `scripts/install-rfd-forest-cover.py` ก็เขียนทุก part ลง `rings` ตามลำดับเดิม (`install-rfd-forest-cover.py:141-168`) ที่สำคัญกว่านั้นคือ `pointInForestCover()` (`lib/map/forest-status.ts:165`) **นับทุกวงเป็นป่า** — จุดที่อยู่ในวงใดก็ตามคือ "อยู่ในป่า"

การตัดสิน: **วาดทุกวงเป็นป่าเหมือนกัน** เพื่อให้ภาพบนแผนที่ตรงกับสิ่งที่เกณฑ์คำนวณจริง

- ผลข้างเคียงที่ยอมรับ: รูโล่งกลางผืนป่า (เช่น อ่างเก็บน้ำ หมู่บ้านกลางป่า) จะถูกถมเป็นสีเขียวด้วย
- เหตุผลที่ไม่แก้ตอนนี้: ถ้าแก้เฉพาะการวาดให้ถูก แผนที่จะขัดกับตัวเลขในแผงเดียวกัน ("ไม่ใช่ป่า" บนภาพ แต่ `inside=1` ในตัวเลข) ซึ่งแย่กว่าการถมเกินที่อธิบายได้
- ถ้าจะแก้ ต้องแก้พร้อมกันทั้งการวาดและ `pointInForestCover` / `forestPctInRadius` (จำแนกทิศทางการวนของวงตามธรรมเนียม shapefile: ตามเข็ม = ขอบนอก, ทวนเข็ม = รู) และต้องรีวิวผลกระทบต่อสัดส่วน 1/3/5 กม. ที่ `lib/terrain-difficulty.ts` ใช้ — เป็นงานคนละชิ้น

---

## 7. ความปลอดภัย / สัญญาอนุญาต

- route ใหม่ผ่าน `requireApiUser()` เหมือนทุก API ของแอป — ไม่มีทางเข้าถึงแบบไม่ล็อกอิน
- ไม่มีข้อมูลส่วนบุคคลในชั้นนี้ (polygon ภูมิศาสตร์ล้วน) — ไม่กระทบ PDPA
- ข้อมูลกรมป่าไม้เป็น CC-BY, OSM เป็น ODbL → **ต้องแสดงเครดิตขณะชั้นเปิด** ไม่ใช่ซ่อนในเอกสาร
- ไม่มีไฟล์ข้อมูลใหม่ต้อง deploy — ใช้ `data/forest-status/` ชุดเดิมที่ `docker-compose.yml` bind-mount อยู่แล้ว (ถ้าปลายทางยังไม่ได้ rsync ชั้นนี้จะขึ้น `available: false` ไม่พัง)

---

## 8. ทดสอบ

**pure (`npm test` — ไม่ต้องใช้ DB, เพิ่มชื่อไฟล์แบบระบุตรงใน `package.json` ตามธรรมเนียมเดิม)**

`lib/map/forest-polygons.test.ts`
- `boxAround` — ชดเชย cos(lat) จริง (กรอบที่ละติจูด 20 กว้างเป็นองศามากกว่าที่เส้นศูนย์สูตร) และรัศมีติดลบ/NaN → กรอบว่าง
- `featuresInBox` — feature ที่อยู่นอกกรอบทั้งก้อนถูกตัด, feature ที่แตะกรอบถูกเก็บ**ทั้งวง**, วง < 4 จุดถูกตัด, พิกัด NaN/Infinity ถูกตัด, ปัดทศนิยมเหลือ 5 ตำแหน่ง
- ไม่แก้ไข input (ไม่ mutate)

`lib/map/forest-generic.test.ts`
- parse `way` ที่มี `geometry` → 1 วง
- parse `relation` ที่มีหลาย member → หลายวง
- element ที่ไม่มี geometry / มีจุดน้อยกว่า 4 → ถูกตัด
- ผลลัพธ์เป็น `[lng, lat]` (ไม่ใช่ `[lat, lng]` แบบที่ Overpass ส่งมา)

**ตรวจด้วยตาบนแผนที่ (บ้านพญาไพร)**
- เปิดชั้นสภาพป่า → ภาพที่เห็นต้องสอดคล้องกับตัวเลขสัดส่วน 1/3/5 กม. ในแผงเดียวกัน ถ้าขัดกันแปลว่าอ่านผิดชุดข้อมูล (ห้ามปรับตัวเลขให้เข้ากับภาพ ให้ไล่หาสาเหตุ)
- **จุดที่ต้องเช็คเป็นพิเศษ:** หน้าจอปัจจุบันแสดงชั้น Status ว่า `0% / 20.6% / 24.7%` และระยะ 1,078 ม. ขณะที่ `CLAUDE.md` บันทึกค่าที่วัดได้ของชุดสภาพป่าจริงที่บ้านพญาไพรไว้ว่า `inside=1` และ 100% ที่ 1 กม. (ค่าที่ใกล้ 1,078 ม. คือชุด **แนวเขตกฎหมาย**) ต่างกันได้ถ้าหมุดถูกย้าย — แต่ถ้าหมุดอยู่ที่โรงเรียนจริงแล้วยังได้ 0% แปลว่ามีโอกาสที่ `/api/forest-status` กำลังถอยไปใช้ชุดกฎหมายแทนชุดสภาพป่า ต้องยืนยันก่อนสรุปว่างานนี้เสร็จ (ชั้น polygon จะทำให้เห็นทันทีว่าเป็นแบบไหน)
- เปิดชั้น OSM → คาดว่าเห็นน้อยกว่ามาก (8 ก้อน) ซึ่งเป็นผลที่ถูกต้อง ไม่ใช่บั๊ก

---

## 9. เกณฑ์ว่างานเสร็จ

1. checkbox 2 ตัวใหม่ในแผงซ้าย ปิดเป็นค่าเริ่มต้น เปิดแล้วเห็น polygon ทาบภูมิประเทศ
2. ย้ายหมุดแล้วชั้นตามไปที่จุดใหม่ ปิด checkbox แล้ว entity หายและคำขอที่ค้างถูกยกเลิก
3. เครดิตข้อมูลขึ้นเมื่อชั้นเปิด
4. ไม่มีข้อมูลชั้นป่าในเครื่อง → ขึ้นข้อความ "ยังไม่ได้ติดตั้งชั้นข้อมูล" ไม่ใช่ error
5. `npm test` เขียว (รวมไฟล์ทดสอบใหม่ 2 ไฟล์) และ `npm run build` ผ่าน
6. ไม่มีการเปลี่ยนแปลงคะแนน: `state.gis` และผลลัพธ์ของ `lib/scoring.ts` / `lib/terrain-difficulty.ts` เท่าเดิมทุกกรณี
