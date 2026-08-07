# ชั้นป่า 3 ชั้นสำหรับคัดกรองโรงเรียนพื้นที่สูง — สภาพป่า · เขตตามกฎหมาย · บริบทรอบโรงเรียน

สถานะ: **ออกแบบ + โครง pure แล้ว** (`lib/forest-layers.ts`) — ชั้นสถานภาพป่า (กรมป่าไม้) และชนิดป่ายังรอข้อมูลทางการ  
วันที่: 2026-08-07  
ผู้รับ: ระบบคัดกรองโรงเรียนพื้นที่สูง `newssra`  
เอกสารที่เกี่ยวข้อง:
- [`2026-08-07-forest-boundary-highland-screen-design.md`](./2026-08-07-forest-boundary-highland-screen-design.md) — เฟส 1 เขตตามกฎหมาย (OSM) = **ชั้น Legal เท่านั้น**
- [`2026-08-07-terrain-signature-classifier-design.md`](./2026-08-07-terrain-signature-classifier-design.md)
- [`../RESEARCH-community-classification.md`](../RESEARCH-community-classification.md)
- [`../GAPS-ปัจจัยที่ยังไม่เป็นเกณฑ์.md`](../GAPS-ปัจจัยที่ยังไม่เป็นเกณฑ์.md) (E8)

---

## 1. ปัญหาที่แก้

การใช้คำว่า **「แผนที่ป่า」** คลุมเครือจนทำให้ตัวชี้วัดผิดได้สองทาง:

| ความเข้าใจผิด | ผลเสีย |
|---|---|
| ป่า = มีต้นไม้จากดาวเทียม | สวนยาง / สวนผลไม้ / วนเกษตร ถูกนับเป็นป่า ทั้งที่กรมป่าไม้**ไม่นับ**เป็นพื้นที่ป่าไม้ |
| ป่า = อยู่ในเขตป่าสงวน/อุทยาน | โรงเรียนใน polygon เขตเดิมที่กลายเป็นชุมชนได้คะแนน “ป่า” ทั้งที่รอบตัวไม่ใช่ป่าแล้ว — หรือกลับกัน โรงเรียนนอกเขตแต่ถูกล้อมด้วยผืนป่าธรรมชาติไม่ถูกนับ |
| ป่า = 0/1 ตัวเดียว | โรงเรียนสูง 900 ม. กลางเมือง กับ 900 ม. ถูกล้อมด้วยป่า 80% ได้สัญญาณเดียวกัน |

**คำถามที่ถูก** ไม่ใช่แค่ “อยู่ในป่าหรือไม่?” แต่เป็นชุด:

```
School
  ├── พิกัด
  ├── Elevation / Slope (DEM)
  ├── Road accessibility
  ├── Settlement density
  └── Forest Overlay (3 ชั้น — ห้ามยุบ)
          ├── อยู่ในพื้นที่ป่า (สถานภาพ)?
          ├── ระยะถึงแนวป่า (สถานภาพ / เขต)
          ├── % พื้นที่ป่าในรัศมี 1 / 3 / 5 กม.
          ├── ชนิดป่า
          └── ความต่อเนื่องของผืนป่า (+ เขตตามกฎหมายแยก)
```

---

## 2. แยก 2 ความหมายหลักของ “แผนที่ป่า” (+ ชั้นที่ 3 บริบท)

### 2.1 แผนที่ **สภาพพื้นที่ป่าไม้** (Forest Status / Cover) — **Core Layer**

| รายการ | รายละเอียด |
|---|---|
| เจ้าของ | **กรมป่าไม้** — แผนที่ป่าไม้ของประเทศในระบบ GIS |
| ขอบเขต | **ทั้งประเทศ** (ไม่ใช่เฉพาะภาคเหนือหรือเฉพาะเขตสงวน) |
| วิธี | ภาพ Sentinel-2 / Landsat + กระบวนการจัดทำสถานภาพทรัพยากรป่าไม้ (ชุดข้อมูลหลายปี; เผยแพร่ล่าสุดที่อ้างในงานนี้ **พ.ศ. 2568**) |
| นิยามสำคัญ | **มีต้นไม้ ≠ ป่าเสมอ** — สวนผลไม้ สวนยาง สวนปาล์ม พื้นที่วนเกษตร **ไม่นับ** เป็นพื้นที่ป่าตามนิยามกรมป่าไม้ |
| ใช้ชี้วัด | **ความเป็นพื้นที่ป่าจริง ณ ปีชั้นข้อมูล** รอบโรงเรียน |
| ทำไมดีกว่า tree-cover ดิบ | ตรงนิยามทางการของไทย และกัน false positive จากเกษตรยืนต้น |

แหล่งอ้างอิงเชิงผลิตภัณฑ์: RFD Data Catalog / เอกสารเผยแพร่แผนที่ป่าไม้ของกรมป่าไม้ (ต้องยืนยัน license + รุ่นปีก่อน commit ไฟล์เข้า repo)

### 2.2 แผนที่ **ชนิดป่า** (Forest Type)

| รายการ | รายละเอียด |
|---|---|
| เจ้าของ / กรอบ | กรมอุทยานฯ / ระบบนิเวศไทย (และชุดที่เกี่ยวข้อง เช่น REDD+) |
| ตัวอย่างชนิด | ป่าดิบชื้น · ป่าดิบแล้ง · ป่าดิบเขา · ป่าเบญจพรรณ · ป่าเต็งรัง · ป่าสนเขา · ป่าชายเลน · ป่าพรุ · ป่าชายหาด ฯ |
| ใช้ชี้วัด | บริบทนิเวศและลักษณะพื้นที่สูง (เช่น ป่าดิบเขา ≠ ป่าชายเลน) — **ไม่ใช่** 0/1 |
| ระดับละเอียด | ละเอียดกว่า cover; อาจไม่มีครบทุกจังหวัดในชั้นเดียวกับ cover |

### 2.3 แผนที่ **แนวเขตตามกฎหมาย** (Forest Legal Boundary) — คนละเรื่องกับสถานภาพ

| รายการ | รายละเอียด |
|---|---|
| ตัวอย่าง | ป่าสงวนแห่งชาติ · อุทยาน · เขตรักษาพันธุ์ · ห้ามล่า · วนอุทยาน ฯ |
| ใช้ชี้วัด | **บริบทอำนาจ/การใช้ที่ดินตามประกาศ** ไม่ใช่ “มีต้นไม้ตอนนี้” |
| สถานะในแอป | เฟส 1 ใช้ OSM เป็น **อ้างอิง** (`lib/map/forestBoundaries.ts`) — ห้ามเป็นประตูคะแนนเพียงลำพังจนกว่าชั้นทางการ |

**ตัวอย่างที่ห้ามสับสน**

- นอกเขตสงวน แต่รอบโรงเรียนเป็นป่าธรรมชาติหนาแน่น → Status สูง, Legal ต่ำ  
- ใน polygon เขตสงวนเดิม แต่กลายเป็นชุมชน/เกษตร → Legal สูง, Status ต่ำ  

---

## 3. โมเดล 3 ชั้นสำหรับ newssra (บังคับแยก)

| ชั้น | ความหมาย | ใช้ชี้วัด |
|---|---|---|
| **A. Forest Status** | สภาพพื้นที่ป่าจริงตามนิยามกรมป่าไม้ ณ ปีชั้นข้อมูล | ความเป็นพื้นที่ป่า · % รอบโรงเรียน · ระยะถึงขอบป่าสถานภาพ |
| **B. Forest Legal Boundary** | ป่าสงวน / อุทยาน / เขตรักษาพันธุ์ ฯ | บริบทพื้นที่ตามกฎหมาย · ธงประกอบ |
| **C. Forest Context** | สรุปจาก A (+ เสริม B/ชนิดป่า) ในรัศมี 1/3/5 กม. | ความโดดเดี่ยว/ถูกล้อมด้วยป่า · แยก “เมืองบนดอย” ออกจาก “ถิ่นป่า” |

**ห้าม** ยุบเป็น `forest = 0/1` ตัวเดียวในประตูคัดกรองหรือคะแนน

---

## 4. ฟิลด์ตัวชี้วัดมาตรฐาน (flat metrics)

เก็บทั้ง **object 3 ชั้น** และ **flat metrics** เพื่อใช้ใน screen/รายงาน:

```
# จากชั้น Status (core) — ถ้ายังไม่มีชั้น → null ไม่เดา 0
forest_inside       = 0 | 1 | null     # จุดโรงเรียนทับ pixel/polygon สถานภาพป่า
forest_distance_m   = number | null  # ระยะถึงขอบป่าสถานภาพ (0 ถ้า inside)
forest_1km_pct      = 0–100 | null   # สัดส่วนพื้นที่ป่าในรัศมี 1 กม.
forest_3km_pct      = 0–100 | null
forest_5km_pct      = 0–100 | null

# จากชั้น Type
forest_type         = string | null  # เช่น "ป่าดิบเขา" (ป้ายไทยมาตรฐาน)
forest_type_code    = string | null  # รหัสภายในถ้ามี

# จากชั้น Legal
protected_area      = 0 | 1 | null   # อุทยาน / เขตรักษาพันธุ์ / ห้ามล่า / ฯ (ไม่นับแค่สงวน)
reserve_forest      = 0 | 1 | null   # ป่าสงวนแห่งชาติ
legal_distance_m    = number | null
legal_zones[]       = { name, kind, relation }  # ตาม forestBoundaries

# ความต่อเนื่อง (เฟสถัดไป)
forest_continuity   = "fragmented" | "contiguous" | "unknown" | null
```

**กฎ null:** ชั้นไหนยังไม่มีข้อมูล → ฟิลด์นั้นเป็น `null` และ `missing[]` ระบุชัด — **ห้าม** ใส่ 0 แล้วตีความว่า “ไม่ใช่ป่าทั้งประเทศ”

---

## 5. การคำนวณ Context (รัศมี)

รัศมีมาตรฐาน: **1_000 / 3_000 / 5_000 ม.** รอบหมุดโรงเรียน (WGS84)

| เมตริก | นิยาม |
|---|---|
| `forest_*km_pct` | 100 × (พื้นที่ที่ class = ป่าตามชั้น Status ภายในวง) / (พื้นที่วง) |
| `forest_distance_m` | ระยะตั้งฉากถึงขอบ class ป่าใกล้สุด; inside → 0 |
| `forest_inside` | 1 ถ้าจุดอยู่ใน class ป่า |

ความละเอียด DEM/กริด: ใช้ resolution ของชั้น RFD (มัก 10–30 ม. ตามแหล่ง) — บันทึก `gridResolutionM` ใน metadata

**ความต่อเนื่อง (เฟส 2+):** เช่น สัดส่วนของ largest forest patch ในรัศมี 3 กม. ต่อพื้นที่ป่าทั้งหมดในวง — ยังไม่ล็อกสูตรจนกว่าจะมีชั้น Status

---

## 6. เชื่อมประตูคัดกรองพื้นที่สูง (highland screen)

เป้าหมาย: **elevation อย่างเดียวไม่พอ** — โรงเรียน 900 ม. กลางเมือง ≠ 900 ม. ถูกล้อมป่า 80%

### 6.1 สัญญาณ Core (เมื่อมีชั้น Status ทางการ)

```
forestContextStrong =
  forest_inside === 1
  OR forest_1km_pct >= 40
  OR forest_3km_pct >= 50

forestContextWeak =
  forest_1km_pct >= 15 AND forest_1km_pct < 40
  // หรือ distance <= 1000 และ pct ยังต่ำ
```

(ค่า threshold เริ่มต้น — ปรับได้หลังสอบเทียบ; บันทึกใน `FOREST_CONTEXT_*` constants)

### 6.2 candidate (ขยายจาก hs-1)

```
candidate =
  elevGate OR terrainHighland
  OR (forestContextStrong && statusAuthority === "rfd")   // Status ทางการ
  OR (legalIn && legalAuthority === "authoritative" && !island)  // เขตทางการ
  OR (forestContextWeak && (elevGate || terrainHighland || accessSev >= 2))
```

- **OSM legal อย่างเดียว** ยังไม่ผ่านประตูคนเดียว (คงมติเดิม)  
- **Status RFD** เป็น core ที่ผ่านประตูได้เมื่อ context แข็ง  
- เกาะ: ไม่ดัน highland จากป่าชายเลน/พรุ โดยอัตโนมัติ — แสดงเป็น context เท่านั้น

### 6.3 แยก “เมืองบนดอย”

```
highElevUrban =
  elevGate
  AND settlement density >= 750 (ชุมชนใหญ่)
  AND (forest_1km_pct === null OR forest_1km_pct < 15)
  AND legal not required
```

→ ยังเป็นพื้นที่สูงได้ตาม elev แต่ **reviewFlag** “ที่สูงแต่บริบทรอบไม่ใช่ป่า/ถิ่นทุรกันดารป่า” — ไม่ให้ forest context ดันความทุรกันดาร

---

## 7. สถาปัตยกรรมโค้ด

```
lib/forest-layers.ts              # pure: types 3 ชั้น, flat metrics, clean*, buildFromParts
lib/map/forestBoundaries.ts       # Legal (OSM)
lib/map/forest-status.ts          # pure: sample inside/distance/pct จาก polygon
lib/map/forest-status-load.ts     # server: โหลด cells จาก data/forest-status/
lib/map/forest-type.ts            # ป้ายชนิดป่าไทย
scripts/import-forest-status.mjs  # GeoJSON → cells
app/api/forest-status/route.ts    # GET ?lat=&lng=
data/forest-status/README.md      # สัญญาไฟล์ + license
lib/highland-screen.ts            # hs-2 ใช้ context Status/Legal
gis.forestAnalysis / forestOverlay
```

### 7.1 `GisForestAnalysis` (ร่าง)

```ts
interface GisForestAnalysis {
  version: string; // fl-1
  status: GisForestStatusLayer | null;   // สภาพป่า — null = ยังไม่มีชั้น
  legal: GisForestLegalLayer | null;     // เขตตามกฎหมาย
  type: GisForestTypeLayer | null;       // ชนิดป่า
  metrics: GisForestMetrics;             // flat ด้านบน
  missing: string[];                     // ชั้นที่ยังไม่มี
  calculatedAt: string;
}
```

### 7.2 แหล่งข้อมูลและ license

| ชั้น | แหล่งเป้า | เงื่อนไขใช้ production |
|---|---|---|
| Status | กรมป่าไม้ GIS พ.ศ. ล่าสุด (เช่น 2568) | license + แปลง WGS84 + โฮสต์ tile/COG หรือ spatial query ฝั่ง server |
| Type | กรมอุทยานฯ / ชุดชนิดป่า | เช่นเดียว |
| Legal | ประกาศเขต + (ชั่วคราว) OSM | OSM = อ้างอิงเท่านั้น |

**ห้าม** commit shapefile ทั้งประเทศเข้า git ถ้า license ไม่อนุญาต — ใช้ runtime data path / object storage

### 7.3 เฟส implement

| เฟส | สิ่งที่ทำ | สถานะ |
|---|---|---|
| 0 | สเปก 3 ชั้น + pure types/metrics + highland hooks | **ทำแล้ว** `lib/forest-layers.ts` |
| 1 | Legal OSM overlay map เข้า `legal` + metrics | **ทำแล้ว** |
| 2a | pure Status: inside/distance/pct 1/3/5 + cell loader + import script + API | **ทำแล้ว** (`lib/map/forest-status.ts`, `scripts/import-forest-status.mjs`, `GET /api/forest-status`) |
| 2b | วางไฟล์ GIS กรมป่าไม้จริงใน `data/forest-status/cells/` | **รอข้อมูล** (license + แปลง GeoJSON) |
| 3 | ชนิดป่า → forest_type (map รหัส/ป้าย; เติมเมื่อ feature มี type) | **โครงพร้อม** `lib/map/forest-type.ts` |
| 4 | Continuity + dashboard filter + สอบเทียบ threshold | หลัง 2b |

---

## 8. UI / หลักฐาน

**แผนที่:** toggle แยกได้ 2 ชั้น (เมื่อมีข้อมูล)

1. สภาพพื้นที่ป่า (Status) — ระบาย polygon/raster ป่าตามปี พ.ศ.  
2. แนวเขตตามกฎหมาย (Legal) — เส้นขอบเขตสงวน/อุทยาน ฯ  

**GisSummary:** ตาราง metrics ชัดเจน ไม่รวมเป็น “อยู่ในป่า: ใช่/ไม่”

```
สภาพป่า (กรมป่าไม้ พ.ศ. …): อยู่ในพื้นที่ป่า · ระยะ … ม. · 1กม 62% · 3กม 78% · 5กม 84%
ชนิดป่า: ป่าดิบเขา
เขตตามกฎหมาย: ป่าสงวนแห่งชาติ … (อ้างอิง OSM / ทางการ)
```

---

## 9. ทดสอบ

| กลุ่ม | เคส |
|---|---|
| metrics null-safe | ไม่มี status → pct/inside เป็น null ไม่ใช่ 0 |
| legal map | OSM in + national_reserved → reserve_forest=1, protected ตาม kind |
| high elev urban | elev 900 + density สูง + forest_1km_pct 5 → candidate จาก elev แต่มี reviewFlag |
| forest surround | elev 400 + forest_1km_pct 70 + status RFD → candidate จาก forest context |
| island | legal mangrove ไม่ดัน highland |
| sanitize | แถวเก่ามีแค่ forestOverlay → build legal metrics ได้; ไม่มี forestAnalysis key ก็ได้ |

---

## 10. สรุป handoff

ระบบคัดกรองโรงเรียนพื้นที่สูงต้องแยก **สภาพพื้นที่ป่าไม้ (กรมป่าไม้)** ออกจาก **แนวเขตตามกฎหมาย** และสร้าง **Forest Context** จาก % ป่าในรัศมี 1/3/5 กม. + ระยะ + ชนิดป่า — ใช้คู่ DEM/slope/access/settlement ไม่ใช้ elevation อย่างเดียว และไม่ใช้ Forest = 0/1 ตัวเดียว ชั้น Status RFD เป็น **Core Layer** เมื่อมีข้อมูล; ชั้น Legal OSM ที่มีอยู่เป็นบริบทอ้างอิงเท่านั้นจนกว่าจะมีชั้นทางการ
