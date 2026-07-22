# Design: เกณฑ์เสนอเพิ่ม (อนาคต) — Displacement Ratio + Travel Time Ratio

วันที่: 2026-07-22 · สถานะ: อนุมัติดีไซน์แล้ว (รอ implementation plan)

## เป้าหมาย

เพิ่ม "เกณฑ์เสนอเพิ่ม (อนาคต)" 2 รายการในแบบประเมิน เพื่อทดลองแนวคิดการวัดความยากลำบากของการเดินทางด้วยข้อมูล GIS จริง ก่อนเสนอปรับเกณฑ์ทางการในอนาคต:

1. **F1 — อัตราส่วนการกระจัดต่อระยะทางจริง (Displacement Ratio, DR)**
   = ระยะเส้นตรง (การกระจัด) ÷ ระยะทางตามถนนจริง — ค่าอยู่ในช่วง (0, 1]
   ยิ่งต่ำ = ถนนอ้อมมากเมื่อเทียบกับเส้นตรง = พื้นที่ยากลำบาก
2. **F2 — อัตราส่วนเวลาเดินทาง (Travel Time Ratio, TTR)**
   = เวลาเดินทางจริง ÷ เวลาอ้างอิงที่ความเร็ว 60 กม./ชม. บนระยะทางเท่ากัน
   ยิ่งสูง = ระยะทางเท่ากันแต่ใช้เวลานานกว่า = พื้นที่ยากลำบาก

## ข้อตัดสินใจหลัก (ยืนยันกับผู้ใช้แล้ว)

- **ไม่นับรวมในคะแนนเต็ม 100** — แสดงเป็นหมวด "เกณฑ์เสนอเพิ่ม (อนาคต)" มีระดับ/คะแนนของตัวเอง (0–4 ต่อรายการ) พร้อมป้ายกำกับชัดเจนว่าไม่นับรวม เพื่อไม่กระทบสัดส่วน 30/10/30/20/10 และจุดตัด 70/60/50 ตาม spec ทางการ
- **ข้อมูลจาก GIS อัตโนมัติเท่านั้น** — คำนวณจากผลวิเคราะห์เส้นทางที่บันทึกจากแผนที่ (`state.gis`) ไม่มีช่องกรอกมือ (ตัวเลขเชื่อถือได้ เพราะ server คำนวณจาก OSRM + haversine เอง) ถ้ายังไม่มี `state.gis` แสดงบรรทัดเชิญชวนให้ไปวิเคราะห์จากแผนที่ก่อน

## สถาปัตยกรรม (ทาง A — derived-only, ไม่เก็บลง state)

ทั้งสองค่าเป็นค่าอนุพันธ์จากข้อมูลที่ `state.gis` มีอยู่แล้ว (`straightKm`, `roadKm`, `travelTimeRatio`) จึง**คำนวณสดตอนเรนเดอร์** — ไม่แก้ schema, ไม่แตะ `sanitizeGis`, ไม่มี migration, แถวเก่า round-trip เหมือนเดิมทุก byte

### หน่วยที่เพิ่ม/แก้

1. **`lib/gis.ts`** (pure, framework-free — คงข้อห้าม import `lib/scoring.ts`)
   - `displacementRatio(straightKm, roadKm): number | null` — คืน `straightKm / roadKm` ปัด 2 ตำแหน่ง; null เมื่อค่าไม่ finite หรือ `roadKm <= 0` หรือ `straightKm <= 0.05` (สอดคล้อง guard ของ `computeRcr`)
   - `FUTURE_INDICATOR_IDS = ["F1", "F2"] as const` + type `FutureIndicatorResult = { id, title, value, valueLabel, severity, score, maxScore, explain }`
   - `futureIndicators(gis): FutureIndicatorResult[]` — ใช้ `primaryRoute(gis)` (เส้นทางไปที่ว่าการอำเภอ/ศาลากลาง):
     - F1: value = `displacementRatio(route.straightKm, route.roadKm)`; **severity มาจาก `rcrSeverity(route.circuityRatio)` เดิม** (single source of truth — DR เป็นเพียงมุมมองกลับของ RCR จึงไม่สร้างตาราง band ใหม่ให้ drift ได้); score = severity, maxScore = 4
     - F2: value = `route.travelTimeRatio`; severity = `ttrSeverity(...)` เดิม; score = severity, maxScore = 4
     - explain ใช้ explainer ไทยแนวเดียวกับ `explainRcrTh`/`explainTtrTh` (F1 มี explainer ใหม่มุม "การกระจัด": เช่น "ระยะเส้นตรง X กม. แต่ต้องเดินทางจริง Y กม. — เส้นทางอ้อม Z%")
     - route เป็น null หรือค่าคำนวณไม่ได้ → คืน list ว่าง (UI แสดงบรรทัดเชิญชวน)
   - ตาราง band ที่แสดงใน UI ของ F1 แปลงจาก band RCR เดิม: RCR <1.3/<1.5/<1.8/<2.1/≥2.1 ⇔ DR >0.77/>0.67/>0.56/>0.48/≤0.48 (แสดงเป็นคำอธิบายเท่านั้น — ตรรกะจริงใช้ `rcrSeverity`)

2. **`components/GisSummary.tsx`** — section ใหม่ "เกณฑ์เสนอเพิ่ม (อนาคต)" ใต้ตาราง metric เดิม:
   - ป้ายชัดเจน: "ไม่นับรวมในคะแนน 100" (โทนเดียวกับ badge "คำนวณจาก GIS (v2)")
   - ตาราง 2 แถว: ชื่อเกณฑ์ / ค่าที่วัดได้ / ระดับ (0–4 + `severityLabelTh`) / คำอธิบาย
   - ไม่มี `state.gis` → ใช้บรรทัดเชิญชวนเดิมของ component (ไม่เพิ่มข้อความใหม่)
   - print: แสดงตารางตามพฤติกรรม section GIS เดิม (ซ่อนเฉพาะ `.gis-actions`)

3. **Tests — `tests/gis.test.ts`** (ไฟล์เดิม อยู่ในสคริปต์ `test` แล้ว)
   - `displacementRatio`: ค่าปกติ, ปัดทศนิยม, guard ทุกตัว (0, ติดลบ, NaN, straight ≤ 0.05)
   - `futureIndicators`: ขอบ band ทุกจุดของ F1 (ผ่าน RCR ⇔ DR) และ F2 (TTR 1.3/1.6/2.0/2.5), กรณี gis ไม่มี route หลัก → list ว่าง, สอดคล้อง severity กับ `rcrSeverity`/`ttrSeverity` เดิม

### สิ่งที่**ไม่**แตะ

`lib/scoring.ts`, `canSubmit`, flags, `lib/criteria.ts`/`INDICATOR_IDS`, `sanitizeState`/`sanitizeGis`, `/gis` route, demo totals, dashboard — คะแนนรวมและพฤติกรรมเดิมทั้งหมดคงที่

## Error handling

- ทุกฟังก์ชันใหม่เป็น null-safe ตามแบบแผนเดิมของ `lib/gis.ts` (คืน null/list ว่าง ไม่ throw)
- UI ไม่เรนเดอร์ section เมื่อ `futureIndicators` คืน list ว่าง (กัน route ที่ข้อมูลไม่ครบ)

## ทางเลือกที่พิจารณาแล้วไม่เลือก

- **B: เก็บผลลง `state.gis`** — จำเป็นต่อเมื่อ list/dashboard ต้อง aggregate ซึ่งยังไม่มีความต้องการ (YAGNI)
- **C: เพิ่มเป็น indicator ใน `criteria.ts` maxScore 0** — บิดเบือน `INDICATOR_IDS`/scoring engine ที่ spec คุม
