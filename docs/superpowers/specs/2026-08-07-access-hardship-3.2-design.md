# ความยากลำบากในการเข้าถึง (ข้อ 3.2) — เกณฑ์ 5 ระดับจาก GIS

สถานะ: **ออกแบบแล้ว รอ implement**  
วันที่: 2026-08-07  
มติออกแบบ: แทนที่ตัวเลือก + วิธีคำนวณข้อ 3.2 ทั้งก้อน; ล็อกตาม GIS; ชุมชนใหญ่ ≥ 750; ภูเขาสลับซับซ้อน = ธง 8 ทิศ + % เส้นทาง; เคสขอบดันตามลำดับแกน

## เจตนา

นำผลการวิเคราะห์แผนที่ 3 มิติ — ความเป็นพื้นราบ/พื้นที่สูง, ระยะทาง, ความคดเคี้ยวของถนน (RCR), ความลาดชัน/ขึ้น–ลงตามเส้นทาง, ความเร็วเฉลี่ย, ขนาดชุมชน — มาเป็นเกณฑ์ประเมินข้อ **3.2** เป็น 5 ระดับ (คะแนน 0/4/6/8/10) แทนข้อความเดิมเรื่องประเภทถนน/พาหนะ

ระดับ 5 เพิ่มเงื่อนไข **ภูเขาสูงสลับซับซ้อน**: รอบโรงเรียนมีจุดสูง–ต่ำต่างระดับ ≥ 50 ม. มากกว่า 5 แห่งในรัศมี 1 กม. **และ** ตรวจสัดส่วนความสูงตลอดเส้นทางเข้าถึง (≥ 50% ของความยาวอยู่ที่ elev ≥ 500 ม.)

## มติผลิตภัณฑ์ (ล็อกจาก brainstorm)

| หัวข้อ | มติ |
|---|---|
| ตำแหน่งในคะแนน | **แทนที่ข้อ 3.2** ทั้งข้อความตัวเลือกและวิธี derive (ไม่ใช่ชั้นข้อมูลอย่างเดียว) |
| การแก้ด้วยมือ | **ล็อกตาม GIS** — แก้ไม่ได้ ยกเว้นข้อมูลไม่พอถึงให้กรอกเอง |
| ชุมชนใหญ่ | ความหนาแน่นวง 1,500 ม. **≥ 750** คน/ตร.กม. (`semi`+`urban`) |
| ชนบท | ความหนาแน่น **< 750** (`sparse`+`rural`) |
| ภูเขาสลับซับซ้อน | ธงยอด+หุบจาก 8 ทิศ **> 5** (±50 ม.) **และ** `routeMountainPct ≥ 50` |
| ช่วงเส้นทางเป็นภูเขา | sample/ความยาวที่ความสูง **≥ 500 ม.** นับเป็นภูเขา |
| เคสที่ไม่อยู่ในป้ายตรง ๆ | จัดตามลำดับ **ภูมิประเทศ → ชุมชน → ความยากเส้นทาง** แล้วดันระดับตามแกนที่ยากที่สุด |
| แนวทางอัลกอริทึม | **ต้นไม้ first-match** (แนวทาง A) ไม่ใช่คะแนนถ่วงน้ำหนักรวม |

## หลักการ

1. **หนึ่งข้อ 3.2 = หนึ่งระดับ 0–4** ที่อธิบายด้วยป้ายภูมิประเทศ+ชุมชน+ความยาก ไม่ใช่ worst-of access อย่างเดียวแบบ `derive32Severity` เดิม  
2. **Server เป็นแหล่งความจริง** — client แสดงผล; ห้ามเชื่อ `responses["3.2"]` จาก client เมื่อ hardship คำนวณได้  
3. **ข้อมูลไม่พอ = ไม่เดา** — คืน `level: null` + `missing[]` แล้วปลดล็อกให้กรอกเอง  
4. **ทุกคำตอบแนบหลักฐาน** — `ruleId`, ค่าอินพุต, margins ใกล้เส้นแบ่ง  
5. **reuse แบนด์ access เดิม** — RCR/TTR/ความเร็ว/gain ใช้ `rcrSeverity` / `ttrSeverity` / `avgSpeedSeverity` / `elevationGainSeverity` ใน `lib/gis.ts` ไม่สร้างตารางซ้ำที่เลื่อนได้  
6. **เกาะแยกชนิดความยาก** — ไม่ใช้ `complexMountain` ดันระดับ 5 บนเกาะ; สอดคล้อง `terrain-signature` กลุ่ม `island`

## ความสัมพันธ์กับโค้ดที่มีอยู่

| ชิ้น | บทบาทหลังงานนี้ |
|---|---|
| `derive32Severity` | ยังคำนวณ `accessSev` (worst-of) ให้ต้นไม้และ community-class / ธงอื่น — **เลิกเป็นค่าที่เขียนเข้า 3.2 โดยตรง** |
| `deriveD3Responses` | เรียก `derive32HardshipLevel` แทนการ `out["3.2"] = { level: String(derive32Severity) }` |
| `terrain-signature` | อินพุต landform / highland / flat / island — **ไม่ยุบแกน** เข้า hardship เป็นเลขเดียวภายใน terrain-signature เอง |
| `settlementClass` / density 1,500 ม. | เส้นตัดชุมชนใหญ่ 750 |
| `gis-sectors` (`SECTOR_RELIEF_K_M = 50`) | นับธงยอด/หุบสำหรับ complex |
| ตัวเลือก 3.2 เดิม (ลาดยาง/4WD/…) | **แทนที่** ด้วยป้าย 5 ระดับด้านล่าง |
| V19 / V20 | ใช้เฉพาะเมื่อ 3.2 ไม่ได้ล็อกจาก GIS (v1 หรือข้อมูลไม่พอ) |

## อินพุตและค่าคงที่

โมดูลใหม่ (pure, framework-free): **`lib/access-hardship.ts`**

```
export const ACCESS_HARDSHIP_VERSION = "ah-1";

export const AH_LARGE_COMMUNITY_DENSITY = 750; // ต้องเท่า settlement semi cut / TS_URBAN_DENSITY_CUT
export const AH_COMPLEX_FEATURE_MIN = 5;       // ต้องนับได้ > ค่านี้
export const AH_SECTOR_RELIEF_M = 50;          // ต้องเท่า SECTOR_RELIEF_K_M
export const AH_ROUTE_MOUNTAIN_ELEV_M = 500;
export const AH_ROUTE_MOUNTAIN_PCT_MIN = 50;
```

เทสต์บังคับความสัมพันธ์: `AH_LARGE_COMMUNITY_DENSITY === TS_URBAN_DENSITY_CUT` และ `AH_SECTOR_RELIEF_M === SECTOR_RELIEF_K_M`

| สัญลักษณ์ | นิยาม | ที่มา |
|---|---|---|
| `landform` / group | จาก terrain signature | `terrainSignatureFromGis` |
| `isHighland` | ภูเขาสูง / ภูเขา-ไหล่เขา / หุบแคบ / หุบกว้าง / ที่ราบสูง **หรือ** ALT≥500 **หรือ** barrier (ตาม terrain-signature) | signature + elevation |
| `isFlat` | ครอบครัวพื้นราบ (R6/R6b) และไม่ highland | signature |
| `isFlatOnMountain` | ที่ราบสูง (R4b) **หรือ** (isHighland ∧ slopeInner≤5% ∧ !complexMountain) | signature + slope |
| `density` | คน/ตร.กม. วง 1,500 ม. | `gis.radiusSummaries` / community |
| `rural` | density < 750 | |
| `largeCommunity` | density ≥ 750 | |
| `accessSev` | max ของ severity RCR/TTR/speed/gain ที่มีค่า | band เดิมใน `lib/gis.ts` |
| `complexFeatureCount` | จำนวนธง: ต่อทิศ highest ที่ delta≥50 นับ 1 + lowest ที่ delta≤−50 นับ 1 (สูงสุด 16) | `sectorElevations` + school elev |
| `routeMountainPct` | 100 × (ความยาวช่วงที่ elev ≥ 500 ม.) / ความยาวเส้นทางหลักที่ใช้ sample | profile เส้นทางหลัก (ใหม่) |
| `complexMountain` | `complexFeatureCount > 5` **และ** `routeMountainPct ≥ 50` | |

### `routeMountainPct`

- ใช้เส้นทางเดียวกับ `primaryRoute` (เขต/อำเภอ แล้วค่อยศาลากลาง)  
- อินพุต: ลำดับความสูงตามเส้นทางที่ sample อยู่แล้ว (route elevation profile) พร้อมระยะสะสมหรือสมมติช่วงเท่ากันถ้า sample สม่ำเสมอ  
- จุดที่ elev เป็น NaN/ไม่มีข้อมูล: **ไม่นับเป็นภูเขา** และไม่นับในตัวหารถ้าขาดเกินเกณฑ์ → ถ้า usable samples < เกณฑ์ขั้นต่ำ (เช่น < 50% ของจุด) ให้ถือว่า `routeMountainPct = null` (ข้อมูลไม่พอสำหรับ R5)  
- ค่าเป็น 0–100 ปัดทศนิยม 1 ตำแหน่ง

### ข้อมูลไม่พอ (`level: null`)

ขาดอย่างน้อยหนึ่งอย่างที่ต้นไม้ต้องการในกิ่งนั้น:

- ไม่มีเส้นทางหลักที่ใช้ได้ (`routeAccess` ใช้ไม่ได้ / ไม่มี primary route) → ไม่มี accessSev  
- ไม่มี density (ไม่มีวงแหวน/อาคาร) → ตัดสิน rural/large ไม่ได้สำหรับกิ่งที่พึ่งชุมชน  
- จะตัดสิน complex / R5 แต่ sector ใช้ได้น้อยกว่า 7/8 **หรือ** `routeMountainPct === null`  
- terrain signature insufficient และไม่มี ALT/barrier สำรองพอสำหรับ isHighland  

เมื่อ `level === null`: **ไม่เขียน** `responses["3.2"]` จาก derive; UI ปลดล็อก; แนบ `missing: string[]` ภาษาไทยสั้น ๆ

## ต้นไม้ตัดสิน (first match wins)

```
G0  ข้อมูลไม่พอสำหรับกิ่งที่จะใช้ → level null + missing[]

R5  complexMountain && rural && !island
    → level 4
    ถ้า complexMountain && largeCommunity → ไม่เข้า R5; ไป R2 / R-push

R4  isHighland && rural && accessSev >= 3
    → level 3

R3a isHighland && rural && accessSev >= 2
    → level 2
R3b !isHighland && rural && accessSev >= 2
    → level 2   // เคสขอบ: ราบ/ไม่สูง แต่ชนบท+เข้าถึงยาก

R2a isHighland && largeCommunity && accessSev <= 2
    → level 1   // รวมราบบนภูเขา + ชุมชนใหญ่ ยากเล็กน้อย–ปานกลาง
R2b isHighland && largeCommunity && accessSev >= 3
    → level 2   // ดันขึ้น: ชุมชนใหญ่แต่ถนนยากมาก

R1  (isFlat || !isHighland) && largeCommunity && accessSev <= 1
    → level 0

R-push  (ที่เหลือ บังคับลงระดับ):
    accessSev >= 4 → level 3
    accessSev >= 3 → level 2
    accessSev >= 2 || rural → level 1
    else → level 0
```

**เกาะ (`group === "island"`):** ข้าม R5 (และไม่ใช้ complexMountain เป็นตัวดันระดับ 5); ใช้ R3b / R-push ตาม rural+access เมื่อข้อมูลครบ; ถ้าไม่ครบ → null

**API หลัก**

```ts
derive32HardshipLevel(input): {
  level: 0 | 1 | 2 | 3 | 4 | null;
  ruleId: string;           // "R5" | "R4" | ... | "G0" | "R-push"
  evidence: string[];
  missing: string[];
  nearBoundary: boolean;
  complexFeatureCount: number | null;
  routeMountainPct: number | null;
  accessSev: number | null;
  density: number | null;
}
```

Caller จาก `GisAnalysis`: `terrainSignatureFromGis` + `primaryRoute` + components severity + sectors + density จาก radius 1,500 ม.

## ข้อความตัวเลือกข้อ 3.2 (`lib/criteria.ts`)

คะแนนคงที่: **0 / 4 / 6 / 8 / 10** (index 0–4)

| index | points | label |
|------:|-------:|---|
| 0 | 0 | พื้นที่ราบ ชุมชนใหญ่ ไม่ยากลำบาก |
| 1 | 4 | พื้นที่ภูเขาสูง ราบกว้างบนภูเขา ชุมชนใหญ่ ยากลำบากเล็กน้อย |
| 2 | 6 | พื้นที่ภูเขาสูง ชนบท ยากลำบาก |
| 3 | 8 | พื้นที่ภูเขาสูง ชุมชนชนบท ยากลำบากมาก |
| 4 | 10 | พื้นที่ภูเขาสูงสลับซับซ้อน ชุมชนชนบท ยากลำบากที่สุด |

`title` คงแนว: "ความยากลำบากในการเดินทางเข้าถึงสถานศึกษา"  
`evidence` ยังต้องมีภาพเส้นทาง/หนังสือรับรองตามระเบียบ — GIS ล็อกระดับแต่ไม่แทนหลักฐานเอกสาร

## เก็บผลใน `gis` และ derive

ฟิลด์ใหม่ optional บน `GisAnalysis`:

```ts
accessHardship?: {
  version: string;              // ACCESS_HARDSHIP_VERSION
  level: 0 | 1 | 2 | 3 | 4;
  ruleId: string;
  evidence: string[];
  missing: string[];            // ว่างเมื่อ level มีค่า
  nearBoundary: boolean;
  complexFeatureCount: number | null;
  routeMountainPct: number | null;
  accessSev: number | null;
  density: number | null;
  calculatedAt: string;         // ISO
};
```

- มีเฉพาะเมื่อ `level !== null` **หรือ** เมื่อต้องการโชว์ G0 (ทางเลือก implement: เก็บ object แม้ level null เพื่อแสดง missing ใน GisSummary — แนะนำ**เก็บทั้งสองกรณี**เมื่อมี `gis` จากการวิเคราะห์ล่าสุด)  
- `sanitizeGis`: allowlist + clamp level 0–4; แถวเก่าไม่มี key นี้ได้  
- `deriveD3Responses`: ถ้า hardship.level เป็นตัวเลข → เขียน `3.2`; ถ้า null → ไม่แตะ 3.2  

## ล็อกฟอร์มและ server-owned

| ชั้น | พฤติกรรม |
|---|---|
| Server PUT / from-map / gis | เมื่อ `scoringVersion === "v2-gis"` และ `accessHardship.level !== null` → `responses["3.2"]` **server-owned** (preserve/recompute) ห้าม client เขียนทับ |
| Server เมื่อ level null | 3.2 แก้ได้แบบ v1; sanitize ตาม level option ปกติ |
| Client DimensionPanel | radio 3.2 **disabled** เมื่อ hardship.level มีค่า; แสดงคำอธิบาย + หลักฐานสั้น |
| Client เมื่อ null / ไม่มี gis | radio เปิดตามเดิม |

## ธง validation

| ธง | โทน | เงื่อนไข |
|---|---|---|
| V19 / V20 | เดิม | **ไม่ยิง** เมื่อ 3.2 ล็อกจาก GIS (มี hardship.level); ยังใช้เมื่อผู้ใช้กรอกเอง (ไม่มี level) |
| V21 | info | มี `gis` จากการวิเคราะห์แต่ `accessHardship.level === null` → เตือนให้เลือก 3.2 เอง พร้อม missing |
| V22 | info | `accessHardship.nearBoundary === true` → ใกล้เส้นแบ่ง แนะนำตรวจหลักฐาน |

ไม่มี `block` ใหม่จาก hardship — `canSubmit` ยังพึ่ง 3.2 ถูกเลือกอยู่

## UI แสดงผล

- **GisSummary**: บล็อก “ระดับความยากลำบาก (ข้อ 3.2)” — ป้าย level, ruleId, density, accessSev, complexFeatureCount, routeMountainPct, evidence  
- **แผนที่ / แผง GIS**: แสดงระดับที่จะถูกบันทึก (preview จาก pure function ชุดเดียวกับ server)  
- พิมพ์: แสดงป้ายที่เลือก (disabled state ไม่วิกฤตใน print)

## แผนทดสอบ

| กลุ่ม | เคส |
|---|---|
| R5 | featureCount 6 + pct 50 + rural → 4; featureCount 5 → ไม่ R5; largeCommunity + complex → ไม่ R5 |
| R4 / R3 | highland+rural+sev3 → 3; +sev2 → 2; !highland+rural+sev2 → 2 |
| R2 / R1 | highland+large+sev≤2 → 1; +sev≥3 → 2; flat+large+sev≤1 → 0 |
| R-push | sev4/3/2 → 3/2/1 ตามลำดับ |
| G0 | ไม่มี route / density / sectors / profile → null + missing |
| เกาะ | ไม่ R5; rural+access ทำงาน |
| Boundary | density 749/750, pct 49.9/50, count 5/6 |
| Constants | AH_∗ ผูกกับ settlement / sector relief |
| deriveD3 | เขียน/ไม่เขียน 3.2 ถูกต้อง |
| UI | disabled เมื่อล็อก (source-grep หรือ render test) |
| Flags | V19/V20 เงียบเมื่อล็อก; V21/V22 |

ไฟล์เทสต์หลัก: `lib/access-hardship.test.ts` (+ อัปเดต `tests/gis.test.ts`, demo, criteria-related asserts)

## ลำดับ implement

1. คำนวณ `routeMountainPct` จาก profile เส้นทาง + unit tests  
2. `lib/access-hardship.ts` + ต้นไม้ + boundary tests  
3. types + `sanitizeGis` + ผูก `deriveD3Responses` / from-map / gis route  
4. server-owned 3.2 เมื่อ hardship.level มีค่า  
5. ป้าย `criteria.ts` + DimensionPanel lock UI + GisSummary  
6. V21 / V22; ปรับ V19/V20  
7. demo + CLAUDE.md (บรรทัด 3.2 / GIS derive เท่านั้น)

## นอกขอบเขต

- เปลี่ยนน้ำหนักมิติ 3, cut ≥70, หรือ max คะแนนข้อ 3.2  
- แทนที่ terrain-signature หรือ community-class composites  
- Local peak/pit เต็มกริด DEM (อนาคตได้โดยไม่เปลี่ยนป้าย 5 ระดับ ถ้านิยาม count เทียบเท่า)  
- เปลี่ยน 3.1 / 3.3  

## ความเสี่ยงที่ยอมรับ

1. **โรงเรียนที่เคยได้ 3.2 จาก worst-of อย่างเดียวจะได้ระดับใหม่หลัง re-save จากแผนที่** — ตั้งใจตามมติแทนที่เกณฑ์; ต้องสื่อใน release note ภายใน  
2. **ธง 8 ทิศหยาบกว่าการนับยอดจริง** — ยอมรับเพื่อใช้ข้อมูลที่มี; บันทึกช่องอัปเกรด  
3. **OSRM/DEM คลาด** — nearBoundary + V22 + หลักฐานเอกสารข้อ 3.2 ยังบังคับ  
4. **ไม่มี density** → ปลดล็อกมือ — อาจมีโรงเรียนกรอก 3.2 สูงโดยไม่มี GIS ชุมชน; ธง V21 ช่วยผู้ตรวจ  

## ไฟล์ที่คาดว่าจะแตะ

- `lib/access-hardship.ts` (ใหม่) + `lib/access-hardship.test.ts` (ใหม่)  
- `lib/gis.ts` (`deriveD3Responses`, อาจ re-export)  
- `lib/types.ts` (`GisAccessHardship` / บน `GisAnalysis`)  
- `lib/criteria.ts` (options 3.2)  
- `lib/gis-flags.ts` (V19–V22)  
- `lib/state.ts` / preserve server-owned บน PUT  
- `components/DimensionPanel.tsx` หรือที่เรนเดอร์ level options  
- `components/GisSummary.tsx`  
- `lib/demo.ts`, เทสต์ที่เกี่ยวข้อง, `CLAUDE.md` (เฉพาะส่วน 3.2/GIS)

## Open decisions ที่ปิดแล้วในเอกสารนี้

ไม่มี TBD ที่บล็อก implement — ถ้าตอนเขียนโค้ดพบว่า density ยัง client-measured อย่างเดียว ให้เรียกใน evidence ว่า "client-measured, server-validated" ตามแบบ terrain-signature จนกว่า server-side building density จะพร้อม (ไม่บล็อก ah-1)
