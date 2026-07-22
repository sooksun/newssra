# Design: AI วิเคราะห์ภูมิประเทศจากภาพ 3D (แนะค่าลักษณะที่ตั้ง)

วันที่: 2026-07-23 · สถานะ: อนุมัติดีไซน์แล้ว (รอ implementation plan)
Provider: **OpenRouter + Google Gemini 2.5 Flash** (OpenAI-compatible, เรียกด้วย fetch ตรง)

## เป้าหมาย

หลังผู้ใช้จับภาพ 3D 9 มุมของที่ตั้งโรงเรียนเสร็จ ให้ **Claude vision วิเคราะห์ภาพทั้ง 9 อัตโนมัติ** แล้ว**แนะค่า "ลักษณะที่ตั้ง" (`settingType`)** — เกาะ / ภูเขาสูง / หุบเขา / เชิงเขา / พื้นราบห่างไกล / อื่นๆ — พร้อมเหตุผลภาษาไทยและระดับความมั่นใจ ผู้ใช้กด "ใช้ค่านี้" เพื่อเติมช่องลักษณะที่ตั้ง เป็นสัญญาณที่สองคู่กับที่ GIS แนะอยู่แล้ว (`suggestSettingTypeFromGis`)

นี่คือ AI integration ตัวแรกของแอป (เดิมไม่มี AI ใดๆ)

## ข้อตัดสินใจหลัก (ยืนยันกับผู้ใช้แล้ว)

1. **AI แนะค่า `settingType` เท่านั้น** — ไม่แตะคะแนน/จุดตัด (`settingType` เป็นข้อมูลประกอบ ไม่คิดคะแนนอยู่แล้ว)
2. **วิเคราะห์อัตโนมัติหลังจับภาพเสร็จ** — ไม่มีปุ่มแยก; client เรียกต่อจาก `/site-snapshots` สำเร็จ
3. **แนะนำ ไม่ทับ** — เติม `settingType` เฉพาะเมื่อผู้ใช้กด "ใช้ค่านี้" (ไม่เขียนทับค่าที่ผู้ใช้เลือกเอง — ตามหลักเดิมของ fillBlankUnitFromMaster)

## สถาปัตยกรรม

### 1. AI layer (`lib/ai/terrainAnalysis.ts`, server-only)

- **Provider: OpenRouter (OpenAI-compatible) + Google Gemini 2.5 Flash** — เรียกด้วย `fetch` ตรงไป `https://openrouter.ai/api/v1/chat/completions` (ไม่เพิ่ม SDK dependency; แอปยิง fetch ตรงไป OSRM/Nominatim อยู่แล้ว), เรียกฝั่ง server เท่านั้น key ไม่รั่วไป client
- Env ใหม่ **`OPENROUTER_API_KEY`** (เพิ่มใน `.env.production.example` + `docs/DEPLOY.md`); ถ้าไม่ตั้ง → route คืน error สุภาพ ไม่ crash (เหมือน legacy tables ที่อาจไม่มี)
- โมเดล **`google/gemini-2.5-flash`** (อ่านจาก env `AI_TERRAIN_MODEL`, default นี้) — คุมต้นทุนได้; Auth ผ่าน `Authorization: Bearer ${OPENROUTER_API_KEY}` (+ optional `HTTP-Referer`/`X-Title` สำหรับ ranking ของ OpenRouter, ไม่บังคับ)
- **Structured output** บังคับ schema ผ่าน `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }` (`additionalProperties: false`):
  ```
  { settingType: enum ["เกาะ","ภูเขาสูง","หุบเขา","เชิงเขา","พื้นราบห่างไกล","อื่น ๆ"],
    rationale: string,           // เหตุผลภาษาไทย ≤ 500 ตัวอักษร
    confidence: enum ["high","medium","low"] }
  ```
  (Gemini 2.5 Flash รองรับ vision + structured outputs บน OpenRouter)
- **รูปแบบ vision (OpenAI-compatible):** `messages: [{ role:"user", content: [ {type:"text", text:<prompt>}, {type:"image_url", image_url:{url:"data:image/jpeg;base64,…"}} × 9 ] }]` — ภาพเป็น data URL จาก Buffer เรียงตามมุม (บน/ใกล้4ทิศ/ไกล4ทิศ) โดยมี label มุมนำหน้าแต่ละภาพในข้อความ
- prompt (ไทย): อธิบายเกณฑ์ให้สอดคล้อง landform legend เดิม (ภูเขา สพฐ. ≥600 ม., เนินเขา ~150–600 ม., ฯลฯ จาก `lib/landform-legend.ts`), สั่งวิเคราะห์**เฉพาะภูมิประเทศ ห้ามระบุตัวบุคคล** (PDPA — ภาพเป็นภูมิทัศน์ดาวเทียม ไม่มีคนอยู่แล้ว)
- ฟังก์ชัน `analyzeTerrainFromImages(images: {buffer, viewLabel, mimeType}[]): Promise<TerrainSuggestion>` — **จัดการทุก error แบบ null-safe**: rate-limit (429), auth (401 = key ผิด/ไม่มี), เนื้อหาถูกบล็อก/ตอบไม่ตรง schema, network/timeout — throw `TerrainAnalysisError` (มี `code`) ให้ route แปลงเป็น HTTP status; parse `choices[0].message.content` เป็น JSON แล้ว validate `settingType` อยู่ใน `SETTING_TYPES` เสมอ (ไม่เชื่อ freeform) — แยกส่วน **parse+validate เป็น pure function** (`parseTerrainResponse(raw: unknown)`) เพื่อ unit-test โดยไม่ยิงเครือข่าย

### 2. ชนิดข้อมูล + sanitize + preserve

- `lib/types.ts`: เพิ่ม `TerrainSuggestion { settingType: SettingType; rationale: string; confidence: "high"|"medium"|"low"; analyzedAt: string }` และ **optional** `UnitInfo.settingSuggestion?: TerrainSuggestion` (optional → แถวเก่า round-trip ไม่งอก key)
- `lib/state.ts`:
  - `makeBlankState` ไม่ใส่ `settingSuggestion`
  - `sanitizeState`: `cleanSettingSuggestion(raw)` — settingType ต้องอยู่ใน `SETTING_TYPES` (ไม่งั้นทิ้ง key), confidence ใน 3 ค่า, rationale cap 500, analyzedAt cap 40; set เฉพาะเมื่อ valid
  - `preserveServerOwned`: `settingSuggestion` เป็น **server-owned** เหมือน `siteSnapshots` (delete จาก client ก่อน แล้วยกจาก DB ถ้ามี) — client แก้เองไม่ได้ผ่าน autosave

### 3. Route (`POST /api/assessments/[id]/site-snapshots/analyze`)

- `requireAssessmentAccess`; **409 หลัง submit**
- อ่าน `state.unit.siteSnapshots` (ต้องมี ≥1 ภาพ ไม่งั้น 400 "ยังไม่มีภาพ") → `readSiteSnapshot` ทุกไฟล์ → `analyzeTerrainFromImages` → validate → เก็บ `state.unit.settingSuggestion` ผ่าน `saveAssessment` → คืน `{ suggestion }`
- error map: `TerrainAnalysisError` code → 401 (key/auth) / 429 (rate-limit) / 422 (เนื้อหาถูกบล็อก/ตอบไม่ตรง schema) / 502 (upstream OpenRouter) / 500 (อื่น); ไม่แตะ state เมื่อ error

### 4. Client (`CesiumMap.tsx`)

- หลัง `/site-snapshots` คืน 201 → set สถานะ "กำลังวิเคราะห์ภูมิประเทศด้วย AI…" → `POST /analyze` → **ไม่ว่าจะสำเร็จหรือล้ม** navigate `/assessment/{id}#unitPanel` (ภาพครบเสมอ; ถ้า AI ล้มก็แค่ไม่มีคำแนะนำ — แสดง toast/inline error สั้น ๆ ก่อน navigate ก็ได้ แต่ไม่บล็อก)
- ปุ่มจับภาพ label progress เดิม + เพิ่มสเต็ป "วิเคราะห์…" ต่อท้าย 9/9

### 5. แสดงผล + รับค่า (`UnitPanel.tsx`)

- ใต้บล็อก "ลักษณะที่ตั้ง" (ใกล้ gallery) แสดง `<SettingSuggestionCard>` เมื่อ `unit.settingSuggestion`:
  - "🤖 AI แนะนำลักษณะที่ตั้ง: **{settingType}** (ความมั่นใจ {high→สูง/medium→ปานกลาง/low→ต่ำ})" + rationale + วันเวลา
  - ปุ่ม **"ใช้ค่านี้"** → `onChange("settingType", suggestion.settingType)` (เติมค่า, ผู้ใช้แก้ทีหลังได้); ถ้า `settingType` ตรงกับที่แนะอยู่แล้ว → แสดง "ตรงกับที่เลือกไว้" แทนปุ่ม
  - เป็น presentational (ทดสอบด้วย renderToStaticMarkup); ซ่อนตอน print
- คู่กับกล่อง GIS-แนะนำเดิมใน GisSummary (คนละที่ คนละสัญญาณ — ไม่ชนกัน)

## Error handling

- AI ทุก error → route คืน status ที่เหมาะสม, state เดิมไม่เปลี่ยน, client แสดงข้อความไทยสั้น ๆ ไม่บล็อกการใช้งานฟอร์ม
- ไม่มี key / dev ไม่ได้ตั้ง → 401 พร้อมข้อความ "ยังไม่ได้ตั้งค่า AI (OPENROUTER_API_KEY)"; แอปส่วนอื่นทำงานปกติ
- `settingSuggestion` null-safe ทุกจุด (optional field)

## สิ่งที่ไม่แตะ

`lib/scoring.ts`, `canSubmit`, คะแนน 100, flow จับภาพเดิม (`/site-snapshots` POST/GET ไม่เปลี่ยน — แค่มี `/analyze` เพิ่ม), `lib/gis.ts`

## ทางเลือกที่พิจารณาแล้วไม่เลือก

- **ผูก AI เข้าใน POST `/site-snapshots`** — ปุ่มจับภาพช้าขึ้นหลายวินาที (รอ vision) และ AI ล่มลากการจับภาพล้มด้วย; แยก endpoint ปลอดภัยกว่า
- **background job + polling** — เกินจำเป็น แอปไม่มี job infra (Docker Compose ธรรมดา)
- **AI เติม settingType อัตโนมัติ** — เสี่ยงทับดุลยพินิจผู้ประเมิน; แนะนำ+กดรับ สอดคล้องหลักเดิม

## ข้อควรรู้ (จะย้ำใน spec)

- **ค่าใช้จ่าย**: จับภาพซ้ำ = เรียก AI ใหม่ (Gemini 2.5 Flash vision 9 ภาพ — ราคาถูกกว่ารุ่น frontier มาก); โมเดลอ่านจาก env `AI_TERRAIN_MODEL` (default `google/gemini-2.5-flash`) เผื่อสลับรุ่น; log การเรียกทุกครั้ง
- **PDPA**: prompt สั่งวิเคราะห์เฉพาะภูมิประเทศ ห้ามระบุ/อนุมานตัวบุคคล
- **ความปลอดภัย key**: `OPENROUTER_API_KEY` อ่านฝั่ง server เท่านั้น (route + lib/ai) — ห้าม import จาก client component

## Testing

- `lib/ai/terrainAnalysis.test.ts` (unit, no network): ทดสอบ `parseTerrainResponse` (pure) — ผลตอบที่ settingType นอก enum → throw/ทิ้ง, confidence ผิดค่า → ทิ้ง, rationale ยาวเกิน → cap, JSON ผิดรูป → error; และ `cleanSettingSuggestion` ใน state.ts
- `tests/state.test.ts`: sanitize + preserve ของ `settingSuggestion` (server-owned, ไม่งอก key, client แก้ไม่ได้)
- `components/SettingSuggestionCard.test.tsx`: มี/ไม่มี suggestion, ปุ่ม "ใช้ค่านี้", กรณีตรงกับค่าที่เลือกแล้ว
- Integration (`assessment-security.test.mts`): `/analyze` 409 หลัง submit + scoping (mock ตัว AI call ด้วย `mock.module` เพื่อไม่ยิงเครือข่ายจริง — คืน suggestion คงที่)
