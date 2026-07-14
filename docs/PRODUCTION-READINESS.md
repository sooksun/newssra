# ความพร้อมก่อนขึ้น production — external dependencies + การ scale

เอกสารประเมินความเสี่ยงเชิงปฏิบัติการก่อนเปิดใช้จริงในวงกว้าง (โหลดจริง / หลาย instance)
ครอบคลุม 2 เรื่อง: (A) บริการภายนอกของหน้า `/map` + GIS, (B) rate-limit เมื่อ scale out

---

## A. บริการภายนอก (external services) ของ `/map` + GIS

หน้า `/map` และการวิเคราะห์ GIS เรียกบริการภายนอก **แบบ keyless เป็นหลัก** ทั้งหมดนี้ไม่มี SLA และ
มีเงื่อนไขการใช้งาน (ToS) + เพดานอัตราเรียกที่ต้องประเมินก่อนโหลดจริง:

| บริการ | endpoint (ในโค้ด) | ใช้ทำอะไร | ประเด็น ToS / rate limit | ระดับความเสี่ยง prod |
|---|---|---|---|---|
| **OSRM demo** | `router.project-osrm.org` ([mapApi.ts:6](../lib/map/mapApi.ts)) | คำนวณเส้นทางถนน (ระยะ/เวลา → RCR/TTR) | เซิร์ฟเวอร์ **"สำหรับพัฒนา/ทดลองเท่านั้น ห้ามใช้ production"** ไม่มี SLA, throttle หนัก, อาจล่ม/หายได้ | **สูง (blocker)** |
| **Nominatim** | `nominatim.openstreetmap.org` ([placeSearch.ts:150/164](../lib/map/placeSearch.ts)) | ค้นสถานที่ + reverse-geocode (fallback เมื่อไม่มี Google key) | Usage Policy: **≤1 req/วินาที**, ต้องมี User-Agent/Referer ระบุตัวตน, ห้าม bulk/autocomplete หนัก | **สูง** |
| **Esri World Imagery** | `services.arcgisonline.com` ([esriImagery.ts:2](../lib/map/esriImagery.ts)) | ภาพถ่ายดาวเทียม (basemap) | ต้องแสดง **attribution**; การใช้เชิงพาณิชย์/ปริมาณสูงต้องมี ArcGIS subscription | กลาง |
| **AWS Terrarium terrain** | `s3.amazonaws.com/elevation-tiles-prod` ([cesiumTerrain.ts:21](../lib/map/cesiumTerrain.ts)) | ชั้นความสูง (terrain) ของ Cesium | AWS **Open Data** (ฟรี, เปิด) แต่เป็น community dataset ไม่มี SLA | ต่ำ |
| **Google Maps JS** | `maps.googleapis.com` ([placeSearch.ts:84](../lib/map/placeSearch.ts)) | Places Autocomplete + Geocoder (เมื่อมี `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`) | **คิดเงินตามการใช้**; ต้องเปิด Maps JS + Places API + ตั้ง HTTP referrer restriction + budget alert | กลาง (ถ้าเปิดใช้) |

### ข้อเสนอแนะก่อน production

1. **OSRM — ต้อง self-host ก่อนเปิดจริง (สำคัญสุด)**
   `router.project-osrm.org` ห้ามใช้ production ตาม ToS และไม่มีความเสถียร → ตั้ง OSRM ของตัวเอง
   (มี Docker image ทางการ + ข้อมูล OSM ของไทย) แล้วชี้ `OSRM_URL`/ค่าใน `mapApi.ts` ไปที่ instance นั้น
   ทางเลือก: ใช้ผู้ให้บริการ routing เชิงพาณิชย์ (Mapbox/Google Directions) — มีค่าใช้จ่าย
   *ถ้าไม่แก้:* การคำนวณ RCR/TTR/Effective-Distance ทั้งหมดจะล้มเป็นระยะเมื่อ demo server throttle

2. **Nominatim — คุม ≤1 req/s + ระบุ User-Agent หรือ self-host**
   ปัจจุบันช่วยลดภาระด้วย debounce (≥3 ตัว/450 ms) แต่ **reverse-geocode ตอนลากหมุด** อาจยิงถี่เกิน 1/s
   → เพิ่ม throttle ฝั่ง client, ตั้ง `User-Agent`/`Referer` ที่ระบุแอปชัดเจน; ถ้าโหลดสูงให้ self-host Nominatim
   ทางที่ดีกว่า: เปิดใช้ Google key เป็นช่องทางหลัก (Nominatim เป็น fallback อยู่แล้ว) แล้วตั้ง budget alert

3. **Esri — ใส่ attribution + ประเมินปริมาณ**
   ตรวจว่ามีเครดิต "Powered by Esri" + แหล่งภาพ ตามเงื่อนไข; ถ้าคาดว่าปริมาณสูง/เชิงพาณิชย์ ให้ประเมิน
   ArcGIS subscription หรือสลับ imagery provider (มี `NEXT_PUBLIC_MAP_IMAGERY_PROVIDER` ให้ปรับได้)

4. **Terrain (AWS Open Data) — ยอมรับได้ แต่ควรมี fallback**
   ความเสี่ยงต่ำ; เพื่อความชัวร์ระยะยาวอาจ mirror/cache tile เอง หรือใช้ Cesium ion token (รองรับผ่าน env)

5. **PDPA/ความเป็นส่วนตัว:** พิกัดโรงเรียนถูกส่งไปบริการภายนอก (OSRM/Nominatim/Esri/Google) — ไม่ใช่ข้อมูล
   นักเรียนรายบุคคล จึงความเสี่ยงต่ำ แต่ควรระบุใน privacy notice ว่ามีการเรียก third-party map service

> สรุป A: บล็อกเดียวที่ **ต้องแก้ก่อน production จริง** คือ **self-host OSRM**; ที่เหลือคุมด้วย throttle +
> attribution + budget alert ได้ ระบบออกแบบให้ทุกตัว fail-soft อยู่แล้ว (โยน error แล้วให้ UI แจ้ง ไม่ crash)

---

## B. Rate-limit เมื่อ scale ออกหลาย instance

`lib/rate-limit.ts` เก็บสถานะ **ในหน่วยความจำของ process เดียว** (in-memory fixed-window) — เพียงพอสำหรับ
การ deploy แบบ **container เดียว** (สถาปัตยกรรมปัจจุบัน ดู `docker-compose.yml`) แต่มีข้อจำกัดที่ทราบ:

- **หลาย instance:** ตัวนับไม่ถูกแชร์ → ผู้โจมตีกระจายคำขอข้าม instance ทำให้เพดานจริง = เพดาน × จำนวน instance
- **รีสตาร์ต:** ตัวนับรีเซ็ต (ยอมรับได้สำหรับ brute-force กันชั้นแรก)

### ข้อเสนอแนะ

- **ถ้ายังเป็น single-instance (ตอนนี้):** ไม่ต้องทำอะไร — เพียงพอและไม่ควรเพิ่ม dependency โดยไม่จำเป็น
- **ถ้าจะ scale out เมื่อไร:** เปลี่ยนไปใช้ shared store (เช่น Redis `INCR`+`EXPIRE`) โดย **คงสัญญาเดิม**
  `check()/fail()/clear()` ของคลาส `RateLimiter` ไว้ — โค้ดถูกออกแบบให้สลับ backend ได้โดยไม่แตะ call site
  ที่ `app/api/auth/login/route.ts` (ดูคอมเมนต์ใน [rate-limit.ts](../lib/rate-limit.ts))
- **หมายเหตุการออกแบบ:** สัญญาปัจจุบันเป็น **synchronous** (`check`/`fail` คืนค่าทันที) — Redis เป็น async
  ดังนั้นการสลับจริงต้องเปลี่ยน signature เป็น `Promise` แล้ว `await` ที่ login route (จุดเดียว) — งานเล็กแต่
  ต้องแก้ทั้ง interface + call site พร้อมกัน; unit test `tests/rate-limit.test.ts` ต้องปรับตาม
- **ทางเลือกที่เบากว่า Redis:** ถ้า scale แค่ 2–3 instance หลัง reverse proxy สามารถทำ **sticky session by IP**
  ที่ proxy เพื่อให้คำขอจาก IP เดียวไปยัง instance เดิม — ตัวนับ in-memory ก็ยังใช้ได้ (ไม่ต้องเพิ่ม dep)

> สรุป B: **ยังไม่ต้องทำตอนนี้** (single container) — บันทึกไว้เป็นเงื่อนไข "ทำเมื่อ scale out"; seam สำหรับสลับ
> เป็น Redis มีอยู่แล้วในโครง `RateLimiter`
