# newssra — ระบบคัดกรองสถานศึกษาพื้นที่ลักษณะพิเศษ (พ.ส.ศ.)

เว็บแอปภาษาไทยสำหรับให้สถานศึกษา **ประเมินตนเอง** เพื่อคัดกรองสิทธิ์รับเงินเพิ่มพิเศษสำหรับครูที่ปฏิบัติงานในสถานศึกษาพื้นที่ลักษณะพิเศษ (พ.ส.ศ. เดือนละ 2,000 บาท)

โรงเรียนกรอก **ข้อเท็จจริงดิบ** (จำนวนนักเรียน ระยะทาง เวลาเดินทาง ฯลฯ) ระบบแปลงเป็นคะแนนให้เอง ผู้ใช้ไม่ต้องกรอกคะแนนโดยตรง

## จุดตัดคะแนน

คะแนนรวม 100 คะแนน จาก 5 ด้าน ถ่วงน้ำหนัก **30 / 10 / 30 / 20 / 10**

| คะแนนรวม | ระดับ | ผล |
| --- | --- | --- |
| ≥ 70 | ระดับ 3 — ยุ่งยากมากที่สุด | **ได้รับเงินเพิ่ม** |
| 60–69 | ระดับ 2 | ขึ้นทะเบียน แต่ยังไม่ได้รับเงิน |
| 50–59 | ระดับ 1 | ขึ้นทะเบียน แต่ยังไม่ได้รับเงิน |
| < 50 | — | ไม่เข้าเกณฑ์ |

เอกสารเกณฑ์ฉบับอ้างอิง: [`docs/ข้อเสนอเกณฑ์และตัวชี้วัด-พสศ-v1.md`](docs/ข้อเสนอเกณฑ์และตัวชี้วัด-พสศ-v1.md)

## ความสามารถหลัก

- **แบบประเมิน 15 ตัวชี้วัด** (1.1–5.2) พร้อมคำอธิบาย/เกณฑ์คะแนนในป๊อปอัป "?" ทุกตัวชี้วัด บันทึกอัตโนมัติแบบ debounce 800 ms
- **คำนวณคะแนนสองชั้น** — ฝั่ง client คำนวณให้เห็นทันที ฝั่ง server คำนวณซ้ำเป็นค่าที่เชื่อถือได้ทุกครั้งที่บันทึก
- **Validation flags** (V00, V02–V04, V06, V07, V09, V11–V20) เตือนข้อมูลที่ขัดแย้งกัน — ระดับ `block` จะกันไม่ให้ส่งแบบประเมิน
- **แนบหลักฐาน** ต่อตัวชี้วัด (JPEG/PNG/WebP/PDF, 10 MB/ไฟล์, 10 ไฟล์/ตัวชี้วัด) เก็บไฟล์จริงบนดิสก์ เก็บเฉพาะ metadata ใน DB
- **แผนที่ 3 มิติ `/map`** (CesiumJS แบบไม่ต้องใช้ key) — ค้นหาสถานที่ ลากหมุด เลือกเส้นทาง วัดความสูงสะสม นับอาคาร/ประมาณประชากรในรัศมีหรือพื้นที่ที่วาด
- **GIS scoring (v2)** — พิสูจน์ความห่างไกลจากแผนที่: Road Circuity Ratio, Travel Time Ratio, Effective Distance, ความเร็วเฉลี่ย, ความสูงสะสม แล้วส่งค่าที่ได้เข้าไปให้คะแนนด้าน 3 อัตโนมัติ
- **ส่งแบบประเมิน** ออกเลขที่อ้างอิงเรียงลำดับไม่ซ้ำ `พสศ-{ปี}-{NNNN}` (บังคับด้วย unique index + retry)
- **แดชบอร์ด** สรุปผลรวม/ฮิสโทแกรม/ค่าเฉลี่ยรายด้าน คำนวณสดจาก state จริงทุกแถว
- **หน้า feedback** รวบรวมความเห็นผู้มีส่วนได้ส่วนเสียรายตัวชี้วัด (เห็นด้วย / เห็นด้วยแต่ควรปรับ / ไม่เห็นด้วย)
- **พิมพ์เป็นแบบฟอร์มราชการ** — CSS `@media print` แปลงหน้าจอเป็นฟอร์มมีหัวข้อสี เส้นประกรอกข้อมูล และช่องลงนาม
- **ผู้ใช้ 3 บทบาท** — `admin` (ดู/แก้ทั้งหมด + จัดการผู้ใช้), `ssra_admin` (ดู/แก้ทั้งหมด), `school` (เห็นเฉพาะของโรงเรียนตนเอง)

## เทคโนโลยี

Next.js 16 (App Router) · TypeScript strict · React 19 · MySQL 8 (`mysql2`) · CesiumJS · CSS ล้วน (ไม่มี framework) · ไม่มี ORM / ไม่มี state library

## เริ่มต้นใช้งาน (Development)

ต้องมี Node.js 20+ และ MySQL (Laragon ก็ได้)

```bash
git clone <repo> && cd newssra
npm install
cp .env.example .env.local     # แก้ค่าฐานข้อมูลตามเครื่อง
npm run db:init                # สร้าง database + ตาราง (idempotent)
npm run dev                    # เปิด http://localhost:3000
```

บัญชีเริ่มต้น (สร้างอัตโนมัติเมื่อเชื่อมต่อ DB ครั้งแรก) — `admin` / `admin123` และ `ssra_admin` / `ssra123` บน development
โรงเรียนเข้าสู่ระบบด้วย **รหัสโรงเรียน 8 หลัก** จากตาราง `user` เดิม (ระบบจะย้ายไปเป็นรหัสผ่านแบบ hash ให้อัตโนมัติเมื่อ login สำเร็จครั้งแรก)

> ทดลองเร็ว ๆ: สร้างแบบประเมินใหม่ แล้วกด **"เติมตัวอย่าง ▾"** เลือกโปรไฟล์ตัวอย่าง 5 แบบ
> คะแนนที่ควรได้ — boundary-pass = 70, severe-remote = 98, borderline-review = 68, level1-notpaid = 55, urban-fail = 12

## คำสั่งที่ใช้บ่อย

```bash
npm run dev               # dev server :3000
npm run build             # production build + type-check (ใช้ตรวจว่าโค้ดยังคอมไพล์ผ่าน)
npm run start             # เสิร์ฟ production build
npm test                  # unit tests — ไม่ต้องใช้ DB
npm run test:integration  # integration tests — ต้องมี MySQL จริงจาก .env.local (ข้ามให้เองถ้าต่อไม่ได้)
npm run db:init           # สร้าง database + ตาราง
npm run users:migrate     # ย้ายบัญชีโรงเรียนจากตาราง legacy เป็น hash
npm run buildings:import  # โหลด footprint อาคารทั้งประเทศล่วงหน้า (ครั้งเดียว ~30–90 นาที, resume ได้)
npm run borders:fetch     # ดึงแนวชายแดนไทยจาก OpenStreetMap มาสร้าง public/geo/sea-borders.json ใหม่
npm run format            # จัดรูปแบบโค้ดด้วย Prettier
```

⚠️ **อย่ารัน `npm run build` ขณะที่ `npm run dev` ทำงานอยู่ในโฟลเดอร์เดียวกัน** — ทั้งคู่เขียน `.next/` ทับกันแล้ว cache พัง (อาการ: `Cannot find module './NNN.js'`) ถ้าเจอให้ปิด dev server ลบ `.next/` แล้วเริ่มใหม่

⚠️ **อย่ารัน `npm audit fix --force`** — จะ "แก้" advisory ของ `postcss` ด้วยการดาวน์เกรด Next เป็น 9.x โปรเจกต์ pin ไว้แล้วผ่าน `overrides` ใน `package.json`

## การทดสอบ

```
tests/scoring.test.ts    เครื่องคิดคะแนนบริสุทธิ์ (lib/scoring.ts, lib/criteria.ts)
tests/gis.test.ts        เครื่อง GIS — RCR/TTR/Effective Distance, ทุกขอบ severity band, flags V11–V20
tests/auth.test.ts       hash/verify รหัสผ่าน + sign/verify session + canAccessAssessment
tests/rate-limit.test.ts RateLimiter ของหน้า login + clientIp
tests/state.test.ts      allowlist ของ sanitizeState (ตัด key แปลกปลอม, migrate feedback เดิม)
tests/uploads.test.ts    กัน path traversal + ตรวจ magic bytes + save/read/delete จริง
lib/map/geometry.test.ts pointInPolygon / polygonArea และเพื่อน ๆ
lib/map/borders.test.ts  ตรวจไฟล์แนวชายแดน — เส้นเดียวต่อประเทศ, ความยาวคลาดจากตัวเลขทางการ < 5%,
                         ความละเอียด median < 700 ม., จุดสามแดนบรรจบกัน
tests/integration/       route handler จริงยิงใส่ MySQL จริง (login, การจำกัดสิทธิ์เข้าถึงแบบประเมิน)
```

`npm test` ต้องเขียวเสมอเมื่อแก้ `lib/scoring.ts` หรือ `lib/criteria.ts` (คะแนนของ demo ถูก assert เป็นค่าคงที่)

## โครงสร้างโปรเจกต์

```
app/                  หน้า + API routes (App Router)
  api/assessments/    list / create / get / put / delete / submit / gis / evidence
  api/admin/users/    จัดการผู้ใช้ (admin เท่านั้น)
  api/buildings/      นับ footprint อาคารจาก map_buildings
  map/                แผนที่ 3 มิติ (Cesium)
  dashboard/          แดชบอร์ดวิเคราะห์
  feedback/           สรุปความเห็นผู้มีส่วนได้ส่วนเสีย
components/           React components (AssessmentForm เป็นเจ้าของ state + autosave)
lib/
  types.ts            ชนิดข้อมูลกลาง + INDICATOR_IDS + AssessmentState
  criteria.ts         แหล่งความจริงเดียวของเกณฑ์/คะแนนเต็ม/ตัวเลือก/หลักฐานที่ต้องแนบ
  scoring.ts          เครื่องคิดคะแนนบริสุทธิ์ (ใช้ร่วมกัน client + server)
  gis.ts              เครื่อง GIS บริสุทธิ์ (RCR/TTR/severity/Auto GIS Score)
  state.ts            makeBlankState / sanitizeState (allowlist เข้มงวด)
  db.ts               mysql2 pool แบบ lazy — ห้ามต่อ DB ตอน module top level
  repo.ts             SQL ทั้งหมดของตาราง assessments
  auth.ts             scrypt hash + HMAC-signed session cookie
  map/                ไลบรารีฝั่งแผนที่ (terrain, morphology, geometry, ค้นหาสถานที่, อาคาร)
db/schema.sql         สคีมาฐานข้อมูล
scripts/              init-db, copy-cesium, import-buildings, migrate-legacy-users
docs/                 เกณฑ์ พ.ส.ศ., คู่มือ deploy, บันทึกการย้ายระบบยืนยันตัวตน
legacy/               ต้นแบบเดิม (localStorage) — ไว้อ้างอิงเท่านั้น ไม่ได้ compile
```

## การตั้งค่า (Environment)

ดูรายละเอียดครบใน [`.env.example`](.env.example) — สรุปตัวสำคัญ

| ตัวแปร | จำเป็น | หมายเหตุ |
| --- | --- | --- |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | ✅ | ค่าเริ่มต้นตรงกับ Laragon |
| `AUTH_SECRET` | ✅ บน production | ต้องยาว ≥ 16 ตัว **ถ้าไม่ตั้งบน production แอปจะ fail ทันที** (fail-closed) |
| `SEED_ADMIN_PASSWORD` / `SEED_SSRA_PASSWORD` | — | ถ้าไม่ตั้งบน production ระบบจะสุ่มรหัสผ่านแข็งแรงแล้ว log ให้ครั้งเดียว |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | — | เปิด Google Places autocomplete + ภาพถ่ายดาวเทียม (ถ้าไม่มีจะ fallback ไป Nominatim/Esri) |
| `NEXT_PUBLIC_CESIUM_ION_TOKEN` | — | อัปเกรด terrain/imagery เป็น Cesium ion |
| `NEXT_PUBLIC_OSRM_URL` | — | ค่าเริ่มต้นใช้ demo server สาธารณะ — production ควร self-host |

`.env.local` = development · `.env.production` = production (ทั้งคู่ gitignored)

## Deploy

Docker Compose (แอป host port 9950 → container :3000 + MySQL 8.4) — คู่มือเต็มพร้อมกรณีชี้ไปที่ MySQL บน host: [`docs/DEPLOY.md`](docs/DEPLOY.md)

```bash
cp .env.production.example .env.production   # ตั้ง AUTH_SECRET จริง!
docker compose up -d --build
```

ตรวจสุขภาพระบบ: `GET /api/health` (มี probe ตรวจ DB ด้วย)

เอกสารประกอบอื่น — [`docs/PRODUCTION-READINESS.md`](docs/PRODUCTION-READINESS.md), [`docs/AUTH-MIGRATION.md`](docs/AUTH-MIGRATION.md), [`docs/RESEARCH-community-classification.md`](docs/RESEARCH-community-classification.md)

## กฎสำคัญของโดเมน (ห้ามละเมิด)

- ผู้ใช้กรอก **ข้อมูลดิบ** เท่านั้น — ห้ามเพิ่มช่องให้พิมพ์คะแนนตรง ๆ และห้ามเชื่อคะแนนที่ client คำนวณ (server คำนวณซ้ำเสมอ)
- สภาพปกติ = 0 คะแนน ไม่มีคะแนนฐานแถมที่ไหนทั้งสิ้น
- ช่วงคะแนนใช้รูปแบบ "เกิน a – ไม่เกิน b" (ขอบล่างไม่รวม ขอบบนรวม) ต่อเนื่องกันไม่ทับซ้อนไม่มีช่องว่าง เปอร์เซ็นต์ทศนิยม 2 ตำแหน่ง
- **PDPA** — เก็บข้อมูลนักเรียนเป็นยอดรวมเท่านั้น ห้ามเก็บ/รับรายชื่อนักเรียนรายบุคคล (เชื้อชาติ ความยากจน ความพิการ สถานะทะเบียนราษฎร์ เป็นข้อมูลอ่อนไหว) ใช้ utf8mb4 ทุกที่
- ธง V01, V05, V08, V10 **จงใจไม่ implement** เพราะต้องใช้ข้อมูลที่แอปไม่ได้เก็บ (ฐานข้อมูลนักเรียนกลาง, GPS ในรูป, ทะเบียนกลาง, การจำแนกเนื้อหาไฟล์) — อย่าทำของปลอมขึ้นมา

## ข้อจำกัดที่ทราบ

- Session เป็น stateless cookie อายุ 7 วัน → การปิดบัญชีมีผลตอน login ครั้งถัดไป
- Rate limit ของหน้า login เก็บใน process → รีเซ็ตเมื่อรีสตาร์ต และไม่แชร์ข้ามอินสแตนซ์ (ถ้า scale out ต้องเปลี่ยนไปใช้ store กลาง)
- ตาราง `user` เดิมเก็บรหัสผ่าน plaintext (5–6 ตัว) — อ่านอย่างเดียว ไม่เคยเขียน และย้ายเป็น scrypt แบบ lazy เมื่อ login สำเร็จ
- รูปวงหลายเหลี่ยมของอาคารที่คืนมาเป็นสี่เหลี่ยมสังเคราะห์ที่ปรับขนาดตามพื้นที่จริง (เก็บรูปจริงของอาคาร 18 ล้านหลังจะกินพื้นที่หลาย GB) เพราะเครื่องมือใช้แค่ **นับ** อาคาร → ประมาณประชากร

## แหล่งข้อมูลภายนอก

| ข้อมูล | แหล่ง | สัญญาอนุญาต |
| --- | --- | --- |
| แนวชายแดนไทย–เพื่อนบ้าน (`public/geo/sea-borders.json`) | OpenStreetMap ผ่าน Overpass API | **ODbL 1.0** — ต้องแสดงเครดิต "© OpenStreetMap contributors" (แอปแสดงไว้ใต้สวิตช์เปิด/ปิดแนวชายแดนในหน้า `/map`) |
| ความสูงภูมิประเทศ | Terrarium terrain (AWS Open Data) | เปิดให้ใช้ฟรี |
| ภาพถ่ายดาวเทียม | Esri World Imagery (ค่าเริ่มต้น) หรือ Google/Cesium ion ถ้าใส่ key | ตามเงื่อนไขผู้ให้บริการ |
| เส้นทางถนน/เวลาเดินทาง | OSRM | BSD-2 |
| Footprint อาคาร | Microsoft Building Footprints | ODbL |

---

ข้อความ UI และคำศัพท์เฉพาะทางทั้งหมดเป็นภาษาไทย — เมื่อเพิ่มฟีเจอร์ใหม่ให้ใช้คำให้ตรงกับเอกสารเกณฑ์
รายละเอียดเชิงสถาปัตยกรรมสำหรับผู้พัฒนา (และสำหรับ Claude Code) อยู่ใน [`CLAUDE.md`](CLAUDE.md)
