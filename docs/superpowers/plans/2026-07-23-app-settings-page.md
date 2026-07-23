# Admin Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้ admin เปิด/ปิด "ช่องค้นหาสถานที่" บนแผนที่ 3 มิติได้จากหน้า `/admin/settings` โดยเป็นค่าส่วนกลางของระบบ

**Architecture:** ตาราง `app_settings` แบบ key/value (สร้างใน `lib/db.ts#init()`), allowlist ของ toggle เป็น pure module (`lib/settings.ts`) ที่ทั้ง server และ client ใช้ร่วมกัน, repo server-only อ่าน/เขียนค่า (fallback เป็น default เมื่อ DB ล้ม), route `PATCH /api/admin/settings` (admin เท่านั้น), หน้า admin ใหม่, และ `app/map/page.tsx` ส่งค่าลง `CesiumMap` เพื่อไม่เรนเดอร์บล็อกค้นหาเมื่อปิด

**Tech Stack:** Next.js 16 App Router, TypeScript strict, mysql2, node:test + tsx. ไม่มี npm dependency ใหม่

## Global Constraints

- ค่าเป็น **ค่าส่วนกลางของระบบ** — `admin` เท่านั้นที่ตั้งได้ (`ssra_admin`/`school` เข้าไม่ได้)
- **ค่าเริ่มต้น = แสดงช่องค้นหา** (`defaultValue: true`) — ไม่ seed แถวใด ๆ; ไม่มีแถว = ใช้ default เพื่อให้ระบบที่ใช้งานอยู่ไม่เปลี่ยนพฤติกรรมหลัง deploy
- ตาราง: `app_settings (setting_key VARCHAR(64) PK, setting_value VARCHAR(255) NOT NULL, updated_at TIMESTAMP)` — `CREATE TABLE IF NOT EXISTS` ใน `lib/db.ts#init()` แบบเดียวกับ `SCHEMA_SQL`/`USERS_SCHEMA_SQL`
- ค่าที่เก็บเป็นสตริง `"1"` / `"0"` เท่านั้น
- key แรกและ key เดียวตอนนี้: **`map.showPlaceSearch`**
- `lib/settings.ts` ต้อง **pure/client-safe** (ห้าม import `lib/db.ts`/`lib/repo.ts`/`node:*`) เพราะ client component ใช้ `label`/`description`
- อ่านค่าล้มเหลว (DB/ตารางมีปัญหา) → คืน default ทั้งชุด + `console.error` — หน้าแผนที่ต้องไม่ล่ม
- `PATCH` key นอก allowlist → **400**; `value` ไม่ใช่ boolean → 400; ไม่ใช่ admin → 403 (จาก guard)
- เมื่อปิด: บล็อกค้นหา **ไม่ถูกเรนเดอร์เลย** (ไม่ใช่ซ่อนด้วย CSS); การลากหมุด/จับภาพ/บันทึกยังทำงานปกติ
- ห้ามแตะ scoring/แบบประเมิน/flow AI; ห้ามรัน `npm run build` ขณะ dev server รันอยู่

---

## File Structure

- `lib/settings.ts` (สร้าง) — allowlist + parse/resolve (pure)
- `lib/settings.test.ts` (สร้าง) — unit ของ pure module
- `lib/db.ts` (แก้) — `SETTINGS_SCHEMA_SQL` + เรียกใน `init()`
- `lib/settings-repo.ts` (สร้าง) — `getAppSettings`/`setAppSetting` (server-only)
- `app/api/admin/settings/route.ts` (สร้าง) — `PATCH`
- `app/admin/settings/page.tsx` (สร้าง) — หน้า admin (server)
- `components/SettingsAdmin.tsx` (สร้าง) — สวิตช์ (client)
- `components/SettingsAdmin.test.tsx` (สร้าง) — render test
- `app/page.tsx` (แก้) — ลิงก์ "ตั้งค่าระบบ" (admin เท่านั้น)
- `app/map/page.tsx`, `components/map/CesiumMapLoader.tsx`, `components/map/CesiumMap.tsx` (แก้) — ส่ง/ใช้ `showPlaceSearch`
- `app/globals.css` (แก้) — สไตล์หน้าตั้งค่า
- `tests/integration/admin-settings.test.mts` (สร้าง) + `package.json` (เพิ่มไฟล์เทสต์ใหม่ทั้ง `test` และ `test:integration`)

---

### Task 1: Allowlist + parse (pure) — `lib/settings.ts`

**Files:**
- Create: `lib/settings.ts`
- Create: `lib/settings.test.ts`
- Modify: `package.json` (เพิ่มไฟล์เทสต์ใน `test` script)

**Interfaces:**
- Produces:
  - `interface AppSettingDef { key: string; label: string; description: string; defaultValue: boolean }`
  - `const APP_SETTING_DEFS: readonly AppSettingDef[]`
  - `const SETTING_MAP_SHOW_PLACE_SEARCH = "map.showPlaceSearch"`
  - `type AppSettings = Record<string, boolean>`
  - `function isAppSettingKey(key: string): boolean`
  - `function parseSettingValue(raw: string | undefined, def: boolean): boolean`
  - `function resolveAppSettings(rows: Record<string, string>): AppSettings`

- [ ] **Step 1: เขียน failing test (`lib/settings.test.ts`)**

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  APP_SETTING_DEFS,
  SETTING_MAP_SHOW_PLACE_SEARCH,
  isAppSettingKey,
  parseSettingValue,
  resolveAppSettings,
} from "./settings";

describe("APP_SETTING_DEFS", () => {
  test("มี key ช่องค้นหา และ default = แสดง (true)", () => {
    const def = APP_SETTING_DEFS.find((d) => d.key === SETTING_MAP_SHOW_PLACE_SEARCH);
    assert.ok(def, "ต้องมี def ของ map.showPlaceSearch");
    assert.equal(def!.defaultValue, true);
    assert.ok(def!.label.trim().length > 0);
    assert.ok(def!.description.trim().length > 0);
  });
  test("key ไม่ซ้ำกัน", () => {
    const keys = APP_SETTING_DEFS.map((d) => d.key);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("isAppSettingKey", () => {
  test("key จริงผ่าน, key ปลอมไม่ผ่าน", () => {
    assert.equal(isAppSettingKey(SETTING_MAP_SHOW_PLACE_SEARCH), true);
    assert.equal(isAppSettingKey("map.hackMe"), false);
    assert.equal(isAppSettingKey(""), false);
  });
});

describe("parseSettingValue", () => {
  test('"1" → true, "0" → false', () => {
    assert.equal(parseSettingValue("1", true), true);
    assert.equal(parseSettingValue("0", true), false);
    assert.equal(parseSettingValue("0", false), false);
  });
  test("ค่าแปลก/undefined → ใช้ default", () => {
    assert.equal(parseSettingValue(undefined, true), true);
    assert.equal(parseSettingValue(undefined, false), false);
    assert.equal(parseSettingValue("yes", true), true);
    assert.equal(parseSettingValue("", false), false);
  });
});

describe("resolveAppSettings", () => {
  test("ไม่มีแถวเลย → ได้ default ครบทุก key", () => {
    const out = resolveAppSettings({});
    for (const def of APP_SETTING_DEFS) assert.equal(out[def.key], def.defaultValue);
  });
  test('แถว "0" ทับ default', () => {
    const out = resolveAppSettings({ [SETTING_MAP_SHOW_PLACE_SEARCH]: "0" });
    assert.equal(out[SETTING_MAP_SHOW_PLACE_SEARCH], false);
  });
  test("แถวที่ไม่อยู่ใน allowlist ถูกละทิ้ง", () => {
    const out = resolveAppSettings({ "some.unknown": "1" });
    assert.equal("some.unknown" in out, false);
  });
});
```

- [ ] **Step 2: รัน test ให้ fail**

Run: `node --import tsx --test lib/settings.test.ts`
Expected: FAIL — Cannot find module './settings'

- [ ] **Step 3: implement `lib/settings.ts`**

```ts
// ค่าตั้งค่าส่วนกลางของระบบ (admin ตั้ง มีผลทุกคน) — pure/client-safe
// ห้าม import lib/db.ts / lib/repo.ts / node:* เพราะ client component ใช้ label/description ด้วย
// เพิ่ม toggle ใหม่ = เพิ่ม entry ใน APP_SETTING_DEFS (ไม่ต้องแก้ schema — ตารางเป็น key/value)

export interface AppSettingDef {
  key: string;
  /** ป้ายไทยในหน้าตั้งค่า */
  label: string;
  /** คำอธิบายใต้ป้าย */
  description: string;
  /** ค่าที่ใช้เมื่อยังไม่มีแถวในตาราง */
  defaultValue: boolean;
}

export const SETTING_MAP_SHOW_PLACE_SEARCH = "map.showPlaceSearch";

export const APP_SETTING_DEFS: readonly AppSettingDef[] = [
  {
    key: SETTING_MAP_SHOW_PLACE_SEARCH,
    label: "แสดงช่องค้นหาสถานที่บนแผนที่",
    description:
      "ปิดเพื่อไม่ให้ผู้ใช้ค้นหาสถานที่เพื่อย้ายจุดวิเคราะห์ (ยังลากหมุดแดงบนแผนที่ได้ตามปกติ)",
    defaultValue: true,
  },
];

/** key → ค่าที่ผ่าน default แล้ว */
export type AppSettings = Record<string, boolean>;

export function isAppSettingKey(key: string): boolean {
  return APP_SETTING_DEFS.some((d) => d.key === key);
}

/** เก็บในฐานข้อมูลเป็น "1"/"0" — ค่าอื่นหรือไม่มีแถว ให้ใช้ default */
export function parseSettingValue(raw: string | undefined, def: boolean): boolean {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return def;
}

/** เติม default ให้ทุก key ใน allowlist และละทิ้งแถวที่ไม่รู้จัก */
export function resolveAppSettings(rows: Record<string, string>): AppSettings {
  const out: AppSettings = {};
  for (const def of APP_SETTING_DEFS) {
    out[def.key] = parseSettingValue(rows[def.key], def.defaultValue);
  }
  return out;
}
```

- [ ] **Step 4: เพิ่มไฟล์เทสต์ใน package.json**

ใน `package.json` `test` script (รายการไฟล์แบบ glob-free) เพิ่ม `lib/settings.test.ts` ต่อท้ายก่อน `components/map/MapPanelToggle.test.tsx`

- [ ] **Step 5: รัน test ให้ผ่าน**

Run: `npm test`
Expected: PASS ทั้งหมด (รวม 8 case ใหม่)

- [ ] **Step 6: Commit**

```bash
git add lib/settings.ts lib/settings.test.ts package.json
git commit -m "feat: add app settings allowlist and value parsing"
```

---

### Task 2: ตาราง + repo — `lib/db.ts`, `lib/settings-repo.ts`

**Files:**
- Modify: `lib/db.ts` (เพิ่ม `SETTINGS_SCHEMA_SQL` หลัง `USERS_SCHEMA_SQL` ~บรรทัด 72; เรียกใน `init()` หลัง `await pool.query(USERS_SCHEMA_SQL)` ~บรรทัด 98)
- Create: `lib/settings-repo.ts`

**Interfaces:**
- Consumes: `resolveAppSettings`, `AppSettings` (`lib/settings.ts` — Task 1); `getPool` (`lib/db.ts`)
- Produces:
  - `async function getAppSettings(): Promise<AppSettings>`
  - `async function setAppSetting(key: string, value: boolean): Promise<void>`

- [ ] **Step 1: เพิ่ม schema ใน `lib/db.ts`**

หลัง `USERS_SCHEMA_SQL` (ปิดท้ายด้วย `` `; `` ที่บรรทัด ~72) เพิ่ม:

```ts
// ค่าตั้งค่าส่วนกลางแบบ key/value (admin ตั้งจาก /admin/settings) — ไม่ seed แถว; ไม่มีแถว = ใช้ default ใน lib/settings.ts
export const SETTINGS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(64) NOT NULL,
  setting_value VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;
```

ใน `init()` หลังบรรทัด `await pool.query(USERS_SCHEMA_SQL);` เพิ่ม:

```ts
    await pool.query(SETTINGS_SCHEMA_SQL);
```

- [ ] **Step 2: implement `lib/settings-repo.ts`**

```ts
// อ่าน/เขียนค่าตั้งค่าส่วนกลาง — server-only (แตะ MySQL); ค่าที่คืนผ่าน default แล้วเสมอ
import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";
import { resolveAppSettings } from "./settings";
import type { AppSettings } from "./settings";

interface SettingRow extends RowDataPacket {
  setting_key: string;
  setting_value: string;
}

/**
 * คืนค่าตั้งค่าทั้งชุด (เติม default ให้ key ที่ยังไม่มีแถว)
 * อ่านไม่ได้ (DB/ตารางมีปัญหา) → คืน default ทั้งชุด เพื่อไม่ให้หน้าที่เรียกใช้ล่ม
 */
export async function getAppSettings(): Promise<AppSettings> {
  try {
    const pool = await getPool();
    const [rows] = await pool.query<SettingRow[]>("SELECT setting_key, setting_value FROM app_settings");
    const map: Record<string, string> = {};
    for (const r of rows) map[r.setting_key] = r.setting_value;
    return resolveAppSettings(map);
  } catch (error) {
    console.error("[settings] read failed — ใช้ค่าเริ่มต้นแทน:", error);
    return resolveAppSettings({});
  }
}

/** เขียนค่าเดียว (upsert) — เก็บเป็น "1"/"0"; ผู้เรียกต้อง validate key กับ allowlist มาก่อน */
export async function setAppSetting(key: string, value: boolean): Promise<void> {
  const pool = await getPool();
  await pool.query(
    `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, value ? "1" : "0"],
  );
}
```

- [ ] **Step 3: ตรวจว่าตารางถูกสร้างจริง**

Run: `npm run db:init`
Expected: จบโดยไม่ error (สคริปต์นี้เรียก init เดียวกับแอป)

ตรวจตารางมีจริง — รันสคริปต์ตรวจชั่วคราวหรือใช้ client MySQL ใดก็ได้ ตัวอย่างด้วย node (วางไฟล์ชั่วคราวแล้วลบทิ้งหลังตรวจ):

```
SHOW TABLES LIKE 'app_settings';
```
Expected: คืน 1 แถว

- [ ] **Step 4: รัน test + build**

Run: `npm test` → Expected: PASS (ยังไม่มีเทสต์ใหม่ในสเต็ปนี้ แต่ต้องไม่พัง)
Run: `npm run build` (เฉพาะเมื่อ dev server ไม่ได้รัน) → Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts lib/settings-repo.ts
git commit -m "feat: add app_settings table and settings repo"
```

---

### Task 3: API — `PATCH /api/admin/settings`

**Files:**
- Create: `app/api/admin/settings/route.ts`
- Create: `tests/integration/admin-settings.test.mts`
- Modify: `package.json` (เพิ่มไฟล์ integration ใน `test:integration` script)

**Interfaces:**
- Consumes: `requireApiRole` (`lib/api-auth`), `isAppSettingKey` (`lib/settings` — Task 1), `getAppSettings`/`setAppSetting` (`lib/settings-repo` — Task 2)
- Produces: `PATCH /api/admin/settings` → `{ settings: AppSettings }` (200)

- [ ] **Step 1: เขียน failing integration test**

**อ่าน `tests/integration/assessment-security.test.mts` ก่อน** เพื่อลอกโครงจริง (บรรทัดแรกต้อง import `./_setup.mts`; ชื่อ helper อาจต่างเล็กน้อย — ใช้ของจริงในไฟล์นั้น: `actAs`, `jsonRequest`, ตัวแปร `DB` ที่ใช้ skip เมื่อ MySQL ไม่พร้อม, และรายการ `SESSIONS`). ถ้า `SESSIONS` ยังไม่มี session บทบาท `admin` ให้เพิ่มหนึ่งตัวโดยลอกรูปแบบ session อื่นในไฟล์เดียวกัน

โครงที่ต้องได้ (เติม import/ชื่อ helper ให้ตรงกับไฟล์อ้างอิง):

```ts
import "./_setup.mts";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import * as settingsRoute from "../../app/api/admin/settings/route";
import { getAppSettings } from "../../lib/settings-repo";
import { getPool } from "../../lib/db";
import { SETTING_MAP_SHOW_PLACE_SEARCH } from "../../lib/settings";
// + actAs / jsonRequest / DB / SESSIONS จาก _setup.mts ตามที่ไฟล์อ้างอิงใช้

const URL_SETTINGS = "http://localhost/api/admin/settings";

describe("PATCH /api/admin/settings", { skip: !DB }, () => {
  after(async () => {
    // คืนระบบสู่ค่า default (ไม่มีแถว = แสดงช่องค้นหา)
    const pool = await getPool();
    await pool.query("DELETE FROM app_settings WHERE setting_key = ?", [SETTING_MAP_SHOW_PLACE_SEARCH]);
  });

  test("admin ปิดค่าได้จริง และค่าถูกเขียนลงตาราง", async () => {
    await actAs(SESSIONS.admin);
    const res = await settingsRoute.PATCH(
      jsonRequest(NextRequest, URL_SETTINGS, {
        method: "PATCH",
        body: { key: SETTING_MAP_SHOW_PLACE_SEARCH, value: false },
      }),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { settings: Record<string, boolean> };
    assert.equal(body.settings[SETTING_MAP_SHOW_PLACE_SEARCH], false);
    const reread = await getAppSettings();
    assert.equal(reread[SETTING_MAP_SHOW_PLACE_SEARCH], false);
  });

  test("บทบาทโรงเรียนถูกปฏิเสธ (403)", async () => {
    await actAs(SESSIONS.schoolA);
    const res = await settingsRoute.PATCH(
      jsonRequest(NextRequest, URL_SETTINGS, {
        method: "PATCH",
        body: { key: SETTING_MAP_SHOW_PLACE_SEARCH, value: true },
      }),
    );
    assert.equal(res.status, 403);
  });

  test("key นอก allowlist → 400", async () => {
    await actAs(SESSIONS.admin);
    const res = await settingsRoute.PATCH(
      jsonRequest(NextRequest, URL_SETTINGS, { method: "PATCH", body: { key: "map.hackMe", value: true } }),
    );
    assert.equal(res.status, 400);
  });
});
```

- [ ] **Step 2: เพิ่มไฟล์ใน `test:integration` script**

ใน `package.json` `test:integration` (รายการไฟล์ชัดเจน) เพิ่ม `tests/integration/admin-settings.test.mts`

- [ ] **Step 3: รัน test ให้ fail**

Run: `npm run test:integration`
Expected: FAIL — route module ไม่มี (หรือ SKIP ทั้งไฟล์ถ้า MySQL ไม่พร้อม — ถ้า skip ให้เปิด MySQL ก่อน)

- [ ] **Step 4: implement route**

สร้าง `app/api/admin/settings/route.ts`:

```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireApiRole } from "@/lib/api-auth";
import { getAppSettings, setAppSetting } from "@/lib/settings-repo";
import { isAppSettingKey } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  const guard = await requireApiRole("admin");
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const key = typeof obj.key === "string" ? obj.key : "";
  if (!isAppSettingKey(key)) {
    return NextResponse.json({ error: "ไม่รู้จักค่าตั้งค่านี้" }, { status: 400 });
  }
  if (typeof obj.value !== "boolean") {
    return NextResponse.json({ error: "ค่าต้องเป็น true/false" }, { status: 400 });
  }

  try {
    await setAppSetting(key, obj.value);
    const settings = await getAppSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    console.error("[api] update setting failed:", error);
    return NextResponse.json({ error: "บันทึกค่าตั้งค่าไม่สำเร็จ" }, { status: 500 });
  }
}
```

- [ ] **Step 5: รัน test ให้ผ่าน**

Run: `npm run test:integration`
Expected: PASS ทั้งหมด (รวม 3 case ใหม่); SKIP ได้เฉพาะเมื่อ MySQL ไม่พร้อม (ให้รายงาน)

Run: `npm test` → Expected: PASS (ไม่กระทบ)

- [ ] **Step 6: Commit**

```bash
git add "app/api/admin/settings" tests/integration/admin-settings.test.mts package.json
git commit -m "feat: add admin settings PATCH route"
```

---

### Task 4: หน้า admin + ลิงก์เมนู

**Files:**
- Create: `components/SettingsAdmin.tsx`
- Create: `components/SettingsAdmin.test.tsx`
- Create: `app/admin/settings/page.tsx`
- Modify: `app/page.tsx` (เพิ่มลิงก์ ~บรรทัด 135-139)
- Modify: `app/globals.css` (สไตล์)
- Modify: `package.json` (เพิ่มไฟล์เทสต์ใน `test`)

**Interfaces:**
- Consumes: `APP_SETTING_DEFS`, `AppSettings` (`lib/settings` — Task 1); `getAppSettings` (`lib/settings-repo` — Task 2); `PATCH /api/admin/settings` (Task 3); `requireRole` (`lib/auth`), `UserMenu`, `ROLE_LABELS`
- Produces: `<SettingsAdmin initialSettings={AppSettings} />`

- [ ] **Step 1: เขียน failing test (`components/SettingsAdmin.test.tsx`)**

```tsx
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import SettingsAdmin from "./SettingsAdmin";
import { APP_SETTING_DEFS, SETTING_MAP_SHOW_PLACE_SEARCH } from "@/lib/settings";

describe("SettingsAdmin", () => {
  test("แสดงครบทุกรายการใน allowlist พร้อมป้าย/คำอธิบาย", () => {
    const html = renderToStaticMarkup(
      <SettingsAdmin initialSettings={{ [SETTING_MAP_SHOW_PLACE_SEARCH]: true }} />,
    );
    for (const def of APP_SETTING_DEFS) {
      assert.ok(html.includes(def.label), `ต้องมีป้าย: ${def.label}`);
      assert.ok(html.includes(def.description), `ต้องมีคำอธิบาย: ${def.key}`);
    }
  });
  test("ค่าเปิด → checkbox ถูกติ๊ก", () => {
    const html = renderToStaticMarkup(
      <SettingsAdmin initialSettings={{ [SETTING_MAP_SHOW_PLACE_SEARCH]: true }} />,
    );
    assert.match(html, /checked=""/);
  });
  test("ค่าปิด → checkbox ไม่ถูกติ๊ก", () => {
    const html = renderToStaticMarkup(
      <SettingsAdmin initialSettings={{ [SETTING_MAP_SHOW_PLACE_SEARCH]: false }} />,
    );
    assert.doesNotMatch(html, /checked=""/);
  });
});
```

- [ ] **Step 2: รัน test ให้ fail**

Run: `node --import tsx --test components/SettingsAdmin.test.tsx`
Expected: FAIL — Cannot find module './SettingsAdmin'

- [ ] **Step 3: implement `components/SettingsAdmin.tsx`**

```tsx
"use client";

// หน้าตั้งค่าส่วนกลาง (admin) — เปลี่ยนสวิตช์แล้วบันทึกทันที; ถ้าบันทึกไม่สำเร็จให้ย้อนค่ากลับ
import { useState } from "react";
import { APP_SETTING_DEFS } from "@/lib/settings";
import type { AppSettings } from "@/lib/settings";

interface Props {
  initialSettings: AppSettings;
}

export default function SettingsAdmin({ initialSettings }: Props) {
  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState("");

  async function toggle(key: string, next: boolean) {
    const prev = settings[key];
    setSettings((s) => ({ ...s, [key]: next })); // optimistic
    setSavingKey(key);
    setErr("");
    setSaved("");
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { settings?: AppSettings; error?: string };
      if (!res.ok) throw new Error(data.error || "บันทึกไม่สำเร็จ");
      if (data.settings) setSettings(data.settings);
      setSaved("บันทึกแล้ว");
    } catch (e) {
      setSettings((s) => ({ ...s, [key]: prev })); // ย้อนกลับเมื่อพลาด
      setErr(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="settings-admin">
      {APP_SETTING_DEFS.map((def) => (
        <div key={def.key} className="settings-row">
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings[def.key] ?? def.defaultValue}
              disabled={savingKey === def.key}
              onChange={(e) => toggle(def.key, e.target.checked)}
            />
            <span className="settings-label">{def.label}</span>
          </label>
          <p className="settings-desc">{def.description}</p>
        </div>
      ))}
      {err ? <p className="settings-err">{err}</p> : null}
      {saved && !err ? <p className="settings-saved">{saved}</p> : null}
    </div>
  );
}
```

- [ ] **Step 4: implement `app/admin/settings/page.tsx`**

โครงลอกจาก `app/admin/users/page.tsx` (header/brand/UserMenu เหมือนกัน):

```tsx
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings-repo";
import { ROLE_LABELS } from "@/lib/types";
import SettingsAdmin from "@/components/SettingsAdmin";
import UserMenu from "@/components/UserMenu";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const admin = await requireRole("admin");
  const settings = await getAppSettings();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">พศ</div>
          <div>
            <p className="eyebrow">ระบบคัดกรองสถานศึกษาพื้นที่ลักษณะพิเศษ</p>
            <h1>ตั้งค่าระบบ</h1>
          </div>
        </div>
        <div className="top-actions">
          <Link className="ghost-btn" href="/">
            ← รายการแบบประเมิน
          </Link>
          <UserMenu name={admin.name} roleLabel={ROLE_LABELS[admin.role]} />
        </div>
      </header>

      <main className="home-main">
        <div className="home-head">
          <div>
            <h2>ค่าตั้งค่าส่วนกลาง</h2>
            <p>ค่าเหล่านี้มีผลกับผู้ใช้ทุกคนในระบบ — เปลี่ยนแล้วบันทึกทันที</p>
          </div>
        </div>
        <SettingsAdmin initialSettings={settings} />
      </main>
    </div>
  );
}
```

- [ ] **Step 5: เพิ่มลิงก์เมนูใน `app/page.tsx`**

แทนบล็อกลิงก์ admin เดิม (บรรทัด ~135-139):

```tsx
          {user.role === "admin" ? (
            <Link className="ghost-btn" href="/admin/users">
              จัดการผู้ใช้
            </Link>
          ) : null}
```

ด้วย:

```tsx
          {user.role === "admin" ? (
            <>
              <Link className="ghost-btn" href="/admin/users">
                จัดการผู้ใช้
              </Link>
              <Link className="ghost-btn" href="/admin/settings">
                ตั้งค่าระบบ
              </Link>
            </>
          ) : null}
```

- [ ] **Step 6: เพิ่มสไตล์ใน `app/globals.css`**

```css
/* ---------- ตั้งค่าระบบ (admin) ---------- */
.settings-admin {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 12px;
}

.settings-row {
  padding: 12px 14px;
  border: 1px solid var(--border, #dcdce3);
  border-radius: 8px;
  background: var(--surface, #fff);
}

.settings-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.settings-label {
  font-weight: 600;
  font-size: 15px;
}

.settings-desc {
  margin: 6px 0 0 24px;
  font-size: 13px;
  color: var(--muted, #667);
}

.settings-err {
  color: #c0392b;
  font-size: 13px;
  margin: 0;
}

.settings-saved {
  color: #1a7f37;
  font-size: 13px;
  margin: 0;
}
```

- [ ] **Step 7: เพิ่มไฟล์เทสต์ใน package.json + รัน**

ใน `test` script เพิ่ม `components/SettingsAdmin.test.tsx`

Run: `npm test` → Expected: PASS (รวม 3 case ใหม่)
Run: `npm run build` (เฉพาะเมื่อ dev server ไม่ได้รัน) → Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add components/SettingsAdmin.tsx components/SettingsAdmin.test.tsx "app/admin/settings" app/page.tsx app/globals.css package.json
git commit -m "feat: add admin settings page with map search toggle"
```

---

### Task 5: ใช้ค่าในแผนที่ (ซ่อนช่องค้นหาจริง)

**Files:**
- Modify: `app/map/page.tsx` (อ่านค่า + ส่ง prop ที่ `<CesiumMapLoader ...>` ~บรรทัด 195-203)
- Modify: `components/map/CesiumMapLoader.tsx` (ส่งต่อ prop)
- Modify: `components/map/CesiumMap.tsx` (ครอบบล็อก `.map-search` ~บรรทัด 2083)

**Interfaces:**
- Consumes: `getAppSettings` (`lib/settings-repo` — Task 2), `SETTING_MAP_SHOW_PLACE_SEARCH` (`lib/settings` — Task 1)
- Produces: prop `showPlaceSearch: boolean` บน `CesiumMapLoader` และ `CesiumMap`

- [ ] **Step 1: อ่านค่าแล้วส่ง prop ใน `app/map/page.tsx`**

เพิ่ม import:

```ts
import { getAppSettings } from "@/lib/settings-repo";
import { SETTING_MAP_SHOW_PLACE_SEARCH } from "@/lib/settings";
```

ในฟังก์ชัน page (ก่อน return JSX) เพิ่ม:

```ts
  const appSettings = await getAppSettings();
  const showPlaceSearch = appSettings[SETTING_MAP_SHOW_PLACE_SEARCH];
```

แล้วเพิ่ม prop ที่ `<CesiumMapLoader ...>`:

```tsx
        showPlaceSearch={showPlaceSearch}
```

- [ ] **Step 2: ส่งต่อใน `components/map/CesiumMapLoader.tsx`**

อ่านไฟล์ก่อน — มันประกาศ props แล้วส่งต่อให้ `CesiumMap` ทั้งชุด เพิ่ม `showPlaceSearch: boolean;` ใน interface props และส่งต่อลง `<CesiumMap ... showPlaceSearch={showPlaceSearch} />` ตามรูปแบบ prop อื่น (เช่น `canSaveAssessment`)

- [ ] **Step 3: ครอบบล็อกค้นหาใน `components/map/CesiumMap.tsx`**

เพิ่ม `showPlaceSearch: boolean;` ใน interface props ของ `CesiumMap` และรับใน destructuring ของคอมโพเนนต์ (ตามรูปแบบ prop อื่น)

ที่บล็อก `<div className="map-search">` (~บรรทัด 2083) — อ่านโค้ดจริงเพื่อดูขอบเขตของบล็อก (มีช่อง input, spinner, dropdown `.map-search-results`, และปุ่มยืนยันพิกัดที่อยู่ในบล็อกเดียวกัน) แล้วครอบทั้งบล็อกด้วยเงื่อนไข:

```tsx
        {showPlaceSearch ? (
          <div className="map-search">
            {/* ...เนื้อหาเดิมทั้งหมดของบล็อก... */}
          </div>
        ) : null}
```

**สำคัญ:** ครอบเฉพาะบล็อกค้นหา — ห้ามครอบปุ่มจับภาพ 3D, ปุ่มบันทึกลงแบบประเมิน, แผงวิเคราะห์, หรือปุ่มเข็มทิศ/ย่อแผง

- [ ] **Step 4: ตรวจ build**

Run: `npm run build` (dev server ต้องไม่รัน)
Expected: PASS ไม่มี type error (prop ใหม่ต้องถูกส่งครบทั้ง 3 ชั้น)

Run: `npm test` → Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/map/page.tsx components/map/CesiumMapLoader.tsx components/map/CesiumMap.tsx
git commit -m "feat: hide map place search when the setting is off"
```

---

### Task 6: ยืนยัน end-to-end บนเบราว์เซอร์

**Files:**
- แก้เฉพาะเมื่อพบ defect

- [ ] **Step 1: ชุดเทสต์ + build**

Run: `npm test` → Expected: ทุกไฟล์ PASS, 0 fail
Run: `npm run test:integration` → Expected: PASS (รวม admin-settings); SKIP เฉพาะเมื่อ MySQL ไม่พร้อม
Run: `npm run build` → Expected: PASS

- [ ] **Step 2: ยืนยันสิทธิ์และการทำงานบน dev server**

เปิด dev server แล้วทดสอบตามลำดับ:

1. login เป็น **admin** → หน้าแรกต้องเห็นปุ่ม **"ตั้งค่าระบบ"** ข้างปุ่ม "จัดการผู้ใช้"
2. เปิด `/admin/settings` → เห็นสวิตช์ "แสดงช่องค้นหาสถานที่บนแผนที่" สถานะ **เปิด** (ค่าเริ่มต้น)
3. เปิด `/map` (แท็บ/หน้าต่างเดียวกันก็ได้) → **เห็นช่องค้นหา**
4. กลับไป `/admin/settings` กดปิดสวิตช์ → ขึ้น "บันทึกแล้ว"
5. เปิด `/map` ใหม่ → **ไม่มีช่องค้นหาแล้ว** (ตรวจ DOM: `document.querySelector(".map-search")` ต้องเป็น `null`) และปุ่มจับภาพ 3D/แผงวิเคราะห์ยังอยู่ครบ
6. เปิดสวิตช์กลับ → `/map` เห็นช่องค้นหาอีกครั้ง
7. login เป็นบัญชี **โรงเรียน** → หน้าแรกต้อง **ไม่เห็น** ปุ่ม "ตั้งค่าระบบ"; เปิด `/admin/settings` ตรง ๆ ต้องถูกปฏิเสธ (redirect/ไม่พบ ตามพฤติกรรมของ `requireRole`)

- [ ] **Step 3: คืนค่าเริ่มต้น**

หลังทดสอบ ให้เปิดสวิตช์กลับเป็น **แสดงช่องค้นหา** (ค่าเริ่มต้นของระบบ)

- [ ] **Step 4: Commit (เฉพาะถ้ามีแก้)**

```bash
git commit -m "fix: close admin settings acceptance gaps"
```

---

## Completion Criteria

- admin เปิด/ปิดช่องค้นหาได้จาก `/admin/settings` มีผลกับผู้ใช้ทุกคนทันทีที่โหลดหน้าแผนที่ใหม่
- ปิดแล้วบล็อกค้นหาไม่ถูกเรนเดอร์เลย; ฟีเจอร์อื่นของแผนที่ทำงานปกติ
- ไม่มีแถวในตาราง = แสดงช่องค้นหา (ระบบเดิมไม่เปลี่ยนพฤติกรรมหลัง deploy)
- role อื่นเข้าหน้า/เรียก API ไม่ได้ (403); key นอก allowlist → 400
- อ่านค่าล้มเหลว → default ไม่ทำให้หน้าแผนที่ล่ม
- unit + integration + build เขียวทั้งหมด
