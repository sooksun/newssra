# ชั้นข้อมูลเขตเทศบาลบนแผนที่ 3 มิติ (overlay อ้างอิง)

วันที่: 2026-08-05
สถานะ: ออกแบบแล้ว รอ implement

## ปัญหาที่แก้

ผู้ตรวจ/โรงเรียนดูแผนที่ 3 มิติแล้วไม่รู้ว่าจุดที่ตั้งอยู่ในหรือนอกเขตองค์กรปกครองส่วนท้องถิ่น
ประเภทไหน (เทศบาลนคร/เทศบาลเมือง/เทศบาลตำบล/อบต.) ทั้งที่เป็นบริบทสำคัญของความเป็น
เมือง/ชนบทของพื้นที่

## ข้อตกลงที่เคลียร์แล้วกับผู้ใช้

1. **เป้าหมาย: overlay อ้างอิงเท่านั้น** — วาดเส้นเขตให้เห็นบนแผนที่ ไม่ผูกกับคะแนน
   ไม่บันทึกลงฐานข้อมูล และ**ไม่แตะ** `GisAutoScore.components.borderMunicipality`
   (ยังเป็น `null` ตามเดิม — จะเติมได้ต้องมีข้อมูลระดับตรวจสอบได้เพื่อให้คะแนน ไม่ใช่ overlay)
2. **ขอบเขตพื้นที่: รอบจุดวิเคราะห์เท่านั้น** — ดึงสดจาก OSM เมื่อผู้ใช้เปิดชั้นข้อมูล
   ไม่ pre-compute ทั้งประเทศ (ไฟล์ใหญ่หลายสิบ MB เกินความจำเป็นของ overlay)
3. **อบต. ไม่มี polygon ใน OSM** — พื้นที่ อบต. คือพื้นที่ตำบลส่วนที่ไม่อยู่ในเขตเทศบาล
   ข้อสรุป: **วาดเฉพาะเขตเทศบาล แล้วสื่อสารว่า "นอกเขตเทศบาลทุกแห่ง = เขต อบต."**
   (ไม่วาดเขตตำบลแทน — ตำบลเดียวคร่อมได้ทั้งเทศบาลและ อบต. จะสื่อความหมายผิด)

## แนวทางที่เลือก: client ดึงจาก Overpass ตรง

เลือกแบบ client-side fetch (pattern เดียวกับ Nominatim fallback ใน `lib/map/placeSearch.ts`
— OSM/Overpass เปิด CORS) แทน server route + ตาราง DB แบบ `/api/buildings`:

- overlay ที่เปิด/ปิดเองไม่คุ้มกับ infrastructure ใหม่ (ตาราง DB ต้องเพิ่มใน `lib/db.ts` และ
  `scripts/init-db.mjs` สองที่, route ใหม่, migration)
- Overpass ช้าได้ (1–10 วิ) และมี rate limit — ยอมรับได้เพราะโหลดเมื่อผู้ใช้เปิด toggle เอง
- ถ้าอนาคตยกระดับข้อมูลนี้ไปตัดสิน `borderMunicipality` ค่อยอัปเกรดเป็น server + DB cache

## โมดูลใหม่: `lib/map/adminBoundaries.ts`

client-safe (ห้าม import cesium — แบบเดียวกับ `lib/map/borders.ts`/`mapApi.ts`)

```ts
export type AdminKind = "nakhon" | "mueang" | "tambon" | "special";

export interface AdminBoundary {
  name: string;              // ชื่อเต็มจาก OSM เช่น "เทศบาลตำบลเวียงพางคำ"
  kind: AdminKind;
  rings: [number, number][][]; // [lng,lat][] ต่อ ring (เฉพาะ outer)
  labelLat: number;          // centroid ของ ring ใหญ่สุด — จุดวางป้ายชื่อ
  labelLng: number;
}

fetchAdminBoundaries(lat, lng, radiusM, signal): Promise<AdminBoundary[]>
classifyAdminKind(name: string): AdminKind | null
parseOverpassAdminBoundaries(json: unknown): AdminBoundary[]   // pure — ตัวที่เทสต์
```

- **Overpass query**: `relation["boundary"="administrative"]["admin_level"="7"]` ใน bbox
  สี่เหลี่ยมครอบรัศมี `ADMIN_FETCH_RADIUS_M = 15_000` รอบจุดวิเคราะห์, `out geom`
- **endpoint หลัก + สำรอง** ชุดเดียวกับ `scripts/fetch-borders.mjs`
  (overpass-api.de → overpass.kumi.systems) — ลองตัวถัดไปเมื่อ 429/5xx/ล้มเหลว
- **`classifyAdminKind`** จากคำนำหน้าชื่อไทย: `เทศบาลนคร…` → `nakhon`,
  `เทศบาลเมือง…` → `mueang`, `เทศบาลตำบล…` → `tambon`,
  `กรุงเทพมหานคร`/`เมืองพัทยา` → `special`; ชื่อไม่เข้าเค้า → `null` = ทิ้ง relation นั้น
  (อย่าเดา — แสดงผิดแย่กว่าไม่แสดง)
- **validate แบบเดียวกับ `parseSharedBorders`**: ตัดจุดไม่ finite/นอกช่วง, ตัด ring ที่
  เหลือ < 4 จุด, ตัด boundary ที่ไม่เหลือ ring — Cesium ห้ามเจอ NaN
- ใช้เฉพาะ member `role=outer` (เขตแทรก/enclave ของ ring ใน ไม่วาด — overlay ไม่ต้องเป๊ะ
  ระดับ donut และเส้นขอบ inner จะทำให้ภาพรก)
- **cache ในหน่วยความจำ** ต่อคีย์พิกัดปัดเศษ (~1 กม.) — เปิด/ปิด toggle ซ้ำที่จุดเดิม
  ไม่ยิง Overpass ใหม่

## การวาดใน `components/map/CesiumMap.tsx`

- `CustomDataSource` ใหม่ชื่อ `admin` + ref `adminDsRef` (ล้าง/วาดใหม่อิสระจากชั้นอื่น)
- checkbox ใหม่ **"แสดงเขตเทศบาล (พื้นที่นอกเขต = อบต.)"** ใต้สวิตช์ธง 8 ทิศ —
  **default ปิด** (ไม่ยิง Overpass ทุกครั้งที่เปิดแผนที่ — เคารพ rate limit ของบริการฟรี)
- effect โหลดเมื่อ `showAdminBoundaries && status === "ready" && !national` และ center เปลี่ยน
  — `AbortController` ยกเลิกคำขอเก่า, สถานะโหลด/ข้อผิดพลาดแสดงแบบเดียวกับ borders
  (`map-note`), ล้มเหลว → ข้อความ ไม่ crash
- เส้นขอบ: polyline `clampToGround` width 3 สีตามประเภท
  - เทศบาลนคร `#be185d` · เทศบาลเมือง `#c2410c` · เทศบาลตำบล `#0d9488` · พิเศษ `#6b21a8`
  - (ไม่ชนสีที่ใช้อยู่: วงรัศมีเขียว/เหลือง/แดง, เส้นทางน้ำเงิน, เส้นตรงอำพัน, ธงม่วง `#7c3aed`/ฟ้า `#0ea5e9`)
- ป้ายชื่อผ่าน `addPinLabel` ที่ centroid ของ ring ใหญ่สุด พื้นป้ายสีเดียวกับเส้น —
  `LABEL_PRIORITY` เพิ่มระดับ `admin` ต่อท้าย (ต่ำกว่า `sector` เลื่อน `overviewSchool`/`country` ลง)
- ใต้ checkbox เมื่อเปิดและมีข้อมูล: บรรทัดอธิบาย "พื้นที่นอกเขตเทศบาลทุกแห่ง = เขต อบต."
  และแสดงเครดิต **"© OpenStreetMap contributors"** (ODbL บังคับ — บรรทัดเครดิตแบบเดียวกับชายแดน)
  เมื่อพื้นที่นั้นไม่มีเทศบาลเลย → "ไม่พบเขตเทศบาลในรัศมี 15 กม. (ทั้งบริเวณเป็นเขต อบต.)"

## สิ่งที่ตั้งใจไม่ทำ

- ไม่บันทึกอะไรลงฐานข้อมูล — ปิด toggle แล้วทุกอย่างหายไปเฉย ๆ
- ไม่แตะ `GisAutoScore`/`sanitizeGis`/`lib/types.ts` — ไม่มี type ฝั่ง assessment เปลี่ยน
- ไม่วาดเขตตำบล (admin_level 8)
- ไม่วาด ring ใน (enclave) ของเขตเทศบาล
- ไม่มี server route / ตาราง DB ใหม่

## เทสต์

เพิ่ม `lib/map/adminBoundaries.test.ts` ในสคริปต์ `test` (ระบุชื่อไฟล์ตาม convention):

1. `parseOverpassAdminBoundaries` กับ fixture JSON จริงของ Overpass → ได้ชื่อ/ประเภท/rings ถูก
2. `classifyAdminKind` ครบ 4 ประเภท + ชื่อไม่เข้าเค้า → `null`
3. ring ที่มีพิกัดไม่ finite/นอกช่วง → จุดถูกตัด; เหลือ < 4 จุด → ring ถูกทิ้ง
4. relation ที่ไม่เหลือ ring ใช้ได้ → ถูกทิ้งทั้งอัน; ผลลัพธ์ว่าง → `[]` ไม่ throw
5. centroid ป้ายมาจาก ring ที่ใหญ่ที่สุด

ตรวจปิดท้าย: `npm test` + `npx tsc --noEmit` + `npm run build` (หยุด dev server ก่อน build)
