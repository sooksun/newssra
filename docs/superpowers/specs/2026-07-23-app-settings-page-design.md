# Design: หน้าตั้งค่าระบบ (แสดง/ซ่อน ช่องค้นหาบนแผนที่)

วันที่: 2026-07-23 · สถานะ: อนุมัติดีไซน์แล้ว (รอ implementation plan)

## เป้าหมาย

ให้ **admin** ตั้งค่าส่วนกลางของระบบได้จากหน้าเว็บ โดยค่าแรกคือ **แสดง/ซ่อน ช่องค้นหาสถานที่** บนแผนที่ 3 มิติ (`.map-search` ใน `CesiumMap.tsx`) — ตั้งครั้งเดียวมีผลกับผู้ใช้ทุกคน (เช่นช่วง pilot ที่ไม่อยากให้โรงเรียนย้ายหมุดเอง)

โครงสร้างรองรับ toggle เพิ่มในอนาคตโดยไม่ต้องแก้ schema แต่**ตอนนี้มีรายการเดียว** (YAGNI)

## ข้อตัดสินใจหลัก (ยืนยันกับผู้ใช้แล้ว)

1. **ค่าส่วนกลางของระบบ** — ไม่ใช่ค่าต่อผู้ใช้; admin เท่านั้นที่ตั้งได้ (เหมือน `/admin/users`)
2. **โครง key/value รองรับหลาย toggle** — เพิ่ม toggle ใหม่ = เพิ่ม key ใน allowlist ไม่ต้องแก้ตาราง
3. **ค่าเริ่มต้น = แสดงช่องค้นหา** — ระบบที่ใช้งานอยู่ต้องไม่เปลี่ยนพฤติกรรมหลัง deploy จนกว่า admin จะสั่งซ่อน

## สถาปัตยกรรม

### 1. เก็บค่า — ตาราง `app_settings`

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key   VARCHAR(64)  NOT NULL PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

สร้างใน `lib/db.ts#init()` แบบ `CREATE TABLE IF NOT EXISTS` (แบบเดียวกับ `assessments`/`users`) — **ไม่ seed แถวใด ๆ**; ไม่มีแถว = ใช้ค่า default จาก allowlist

### 2. Allowlist ของ toggle — `lib/settings.ts` (pure, client-safe)

```ts
export interface AppSettingDef {
  key: string;          // เช่น "map.showPlaceSearch"
  label: string;        // ป้ายไทยในหน้า admin
  description: string;  // คำอธิบายใต้ป้าย
  defaultValue: boolean;
}
export const APP_SETTING_DEFS: readonly AppSettingDef[];   // ตอนนี้มี 1 รายการ
export type AppSettings = Record<string, boolean>;          // key → ค่าที่ผ่าน default แล้ว
export function isAppSettingKey(key: string): boolean;      // ตรวจ key กับ allowlist
export function parseSettingValue(raw: string | undefined, def: boolean): boolean; // "1"→true, "0"→false, อื่น/ไม่มี→def
export function resolveAppSettings(rows: Record<string, string>): AppSettings;     // เติม default ให้ key ที่ยังไม่มีแถว
```

รายการเดียวตอนนี้: `{ key: "map.showPlaceSearch", label: "แสดงช่องค้นหาสถานที่บนแผนที่", description: "ปิดเพื่อไม่ให้ผู้ใช้ค้นหา/ย้ายจุดวิเคราะห์ด้วยการค้นหา (ยังลากหมุดได้ตามปกติ)", defaultValue: true }`

pure ล้วน — ไม่ import `lib/db.ts`/`lib/repo.ts` จึง unit-test ได้โดยไม่ต้องมี DB และ client component ใช้ค่า `label`/`description` ได้

### 3. Repo — `lib/settings-repo.ts` (server-only)

- `getAppSettings(): Promise<AppSettings>` — `SELECT setting_key, setting_value FROM app_settings` แล้วส่งผ่าน `resolveAppSettings`; **ถ้า query ล้มเหลว (ตารางหาย/DB มีปัญหา) → คืนค่า default ทั้งชุด** (try/catch + `console.error`) เพื่อไม่ให้หน้าแผนที่ล่ม — แบบเดียวกับ `schoolLocationByCode` ที่ห่อ legacy table ไว้
- `setAppSetting(key: string, value: boolean): Promise<void>` — `INSERT ... ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`; เก็บเป็น `"1"`/`"0"`

### 4. API — `PATCH /api/admin/settings`

- `requireApiRole("admin")` (route อื่นใน `app/api/admin/*` ใช้ pattern เดียวกัน)
- body: `{ key: string, value: boolean }` — `key` ต้องผ่าน `isAppSettingKey` ไม่งั้น **400**; `value` ต้องเป็น boolean ไม่งั้น 400
- สำเร็จ → `{ settings: AppSettings }` (ค่าล่าสุดทั้งชุด ให้ client sync ได้)
- `export const dynamic = "force-dynamic"`

### 5. หน้า admin — `app/admin/settings/page.tsx` + `components/SettingsAdmin.tsx`

- page (server): `requireRole("admin")` → `getAppSettings()` → ส่งลง client component
- `SettingsAdmin.tsx` (client): วนแสดง `APP_SETTING_DEFS` เป็นแถว มี label + description + สวิตช์ (checkbox); เปลี่ยนแล้ว **บันทึกทันที** ผ่าน `PATCH` (optimistic update + ถ้า error ให้ย้อนค่ากลับพร้อมข้อความไทย)
- เพิ่มลิงก์ **"ตั้งค่าระบบ"** ในเมนูหลักข้าง ๆ "จัดการผู้ใช้" — แสดงเฉพาะ `role === "admin"` (ที่เดียวกับที่ลิงก์ `/admin/users` ถูกเรนเดอร์)

### 6. การใช้ค่าในแผนที่

- `app/map/page.tsx` (server) เรียก `getAppSettings()` แล้วส่ง `showPlaceSearch={settings["map.showPlaceSearch"]}` → `CesiumMapLoader` → `CesiumMap` (prop ใหม่ `showPlaceSearch: boolean`)
- ใน `CesiumMap.tsx` ครอบบล็อก `.map-search` (ช่องค้นหา + dropdown ผลลัพธ์ + ปุ่มยืนยันพิกัดที่ผูกกับการค้นหา) ด้วยเงื่อนไข `showPlaceSearch ? ... : null` — **ไม่เรนเดอร์เลย** ไม่ใช่ซ่อนด้วย CSS
- ค่ามาจาก server ตั้งแต่ SSR จึงไม่มีอาการช่องค้นหาโผล่แล้วหายไป
- ฟีเจอร์อื่นของแผนที่ (ลากหมุด, จับภาพ 3D, บันทึกลงแบบประเมิน, วาด polygon) ไม่ถูกกระทบ

## Error handling

- อ่านค่าไม่ได้ → default (แสดงช่องค้นหา) + log; หน้าแผนที่ยังใช้งานได้
- PATCH: key ไม่รู้จัก/value ผิดชนิด → 400 พร้อมข้อความไทย; ไม่ใช่ admin → 403 (จาก guard); DB ล้ม → 500
- client: บันทึกไม่สำเร็จ → ย้อนสวิตช์กลับ + แสดงข้อความ ไม่ทำให้หน้าค้าง

## สิ่งที่ไม่แตะ

`lib/scoring.ts`, แบบประเมิน/คะแนน, flow จับภาพ+AI, ระบบ auth เดิม — ฟีเจอร์นี้แตะเฉพาะการแสดงผลช่องค้นหาและเพิ่มหน้า admin ใหม่

## ทางเลือกที่พิจารณาแล้วไม่เลือก

- **เก็บใน `.env`** — เปลี่ยนค่าต้อง restart container, admin ตั้งเองไม่ได้ ผิดโจทย์ "หน้าตั้งค่า"
- **เก็บใน localStorage** — เป็นค่าต่อเครื่อง ไม่ใช่ค่าส่วนกลาง admin คุมทั้งระบบไม่ได้
- **คอลัมน์ boolean เฉพาะกิจ** — เพิ่ม toggle ใหม่ต้องแก้ schema ทุกครั้ง; key/value ยืดหยุ่นกว่าโดยไม่ซับซ้อนขึ้นจริง

## Testing

- `lib/settings.test.ts` (unit, no DB): `parseSettingValue` (`"1"`/`"0"`/ค่าแปลก/undefined → default), `isAppSettingKey` (key จริง/ปลอม), `resolveAppSettings` (เติม default ครบทุก key, แถวที่ไม่อยู่ใน allowlist ถูกละทิ้ง)
- `components/SettingsAdmin.test.tsx` (renderToStaticMarkup): แสดงครบทุก def, สวิตช์สะท้อนค่าที่รับมา (เปิด/ปิด)
- Integration (`tests/integration/`): `PATCH /api/admin/settings` ผ่าน route handler จริง — (ก) admin ตั้งค่าสำเร็จและค่าถูกเขียนลงตารางจริง, (ข) role `school` → 403, (ค) key นอก allowlist → 400. ใช้ `actAs` จาก `_setup.mts` เหมือนไฟล์ integration อื่น; เทสต์เขียน key จริง (`map.showPlaceSearch`) จึงต้อง **ลบแถวนั้นทิ้งใน `after()`** (`DELETE FROM app_settings WHERE setting_key = 'map.showPlaceSearch'`) เพื่อคืนระบบสู่ค่า default
