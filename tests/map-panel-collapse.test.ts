import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync("components/map/CesiumMap.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");

test("Cesium map panel starts expanded and exposes both toggle states", () => {
  assert.match(component, /const \[panelExpanded, setPanelExpanded\] = useState\(true\)/);
  assert.match(component, /id="cesium-map-panel"/);
  assert.match(component, /panelExpanded \?/);
  assert.match(component, /expanded=\{false\}/);
});

test("floating expand control stays tappable at the map top-left", () => {
  assert.match(css, /\.map-panel-toggle\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/);
  assert.match(css, /\.map-panel-toggle-expand\s*\{[^}]*position:\s*absolute;[^}]*top:\s*16px;[^}]*left:\s*16px;/);
  assert.match(css, /\.map-panel-toggle:focus-visible/);
});
