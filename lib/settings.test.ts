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
