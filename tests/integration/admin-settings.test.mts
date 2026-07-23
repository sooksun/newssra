// PATCH /api/admin/settings — ค่าตั้งค่าส่วนกลาง (admin เท่านั้น)
// ครอบ: admin เขียนค่าได้จริง, บทบาทอื่นถูกปฏิเสธ 403, key นอก allowlist 400
import "./_setup.mts";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { actAs, dbAvailable, jsonRequest, rawExec, rawQuery, SESSIONS } from "./_setup.mts";
import { SETTING_MAP_SHOW_PLACE_SEARCH } from "../../lib/settings.ts";

const URL_SETTINGS = "http://localhost/api/admin/settings";

let DB = false;
before(async () => {
  DB = await dbAvailable();
});

// คืนระบบสู่ค่า default (ไม่มีแถว = แสดงช่องค้นหา) — เทสต์นี้เขียน key จริง
after(async () => {
  if (!DB) return;
  await rawExec("DELETE FROM app_settings WHERE setting_key = ?", [SETTING_MAP_SHOW_PLACE_SEARCH]);
});

describe("PATCH /api/admin/settings", () => {
  test("admin ปิดค่าได้จริง และค่าถูกเขียนลงตาราง", async (t) => {
    if (!DB) return t.skip("MySQL ไม่พร้อม");
    const { NextRequest } = await import("next/server");
    const route = await import("../../app/api/admin/settings/route.ts");

    await actAs(SESSIONS.admin);
    const res = await route.PATCH(
      jsonRequest(NextRequest, URL_SETTINGS, {
        method: "PATCH",
        body: { key: SETTING_MAP_SHOW_PLACE_SEARCH, value: false },
      }),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { settings: Record<string, boolean> };
    assert.equal(body.settings[SETTING_MAP_SHOW_PLACE_SEARCH], false);

    const rows = await rawQuery<{ setting_value: string }>(
      "SELECT setting_value FROM app_settings WHERE setting_key = ?",
      [SETTING_MAP_SHOW_PLACE_SEARCH],
    );
    assert.equal(rows[0]?.setting_value, "0", "ค่าต้องถูกเขียนลงตารางจริง");
  });

  test("บทบาทโรงเรียนถูกปฏิเสธ (403)", async (t) => {
    if (!DB) return t.skip("MySQL ไม่พร้อม");
    const { NextRequest } = await import("next/server");
    const route = await import("../../app/api/admin/settings/route.ts");

    await actAs(SESSIONS.schoolA);
    const res = await route.PATCH(
      jsonRequest(NextRequest, URL_SETTINGS, {
        method: "PATCH",
        body: { key: SETTING_MAP_SHOW_PLACE_SEARCH, value: true },
      }),
    );
    assert.equal(res.status, 403);
  });

  test("key นอก allowlist → 400", async (t) => {
    if (!DB) return t.skip("MySQL ไม่พร้อม");
    const { NextRequest } = await import("next/server");
    const route = await import("../../app/api/admin/settings/route.ts");

    await actAs(SESSIONS.admin);
    const res = await route.PATCH(
      jsonRequest(NextRequest, URL_SETTINGS, { method: "PATCH", body: { key: "map.hackMe", value: true } }),
    );
    assert.equal(res.status, 400);
  });
});
