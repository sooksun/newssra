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
