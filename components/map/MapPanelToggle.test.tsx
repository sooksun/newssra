import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import MapPanelToggle from "./MapPanelToggle";

test("expanded toggle announces that it collapses the panel", () => {
  const html = renderToStaticMarkup(<MapPanelToggle expanded onToggle={() => undefined} />);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /aria-controls="cesium-map-panel"/);
  assert.match(html, /aria-label="ย่อแผงข้อมูล"/);
  assert.match(html, /map-panel-toggle-collapse/);
});

test("collapsed toggle announces that it expands the panel", () => {
  const html = renderToStaticMarkup(<MapPanelToggle expanded={false} onToggle={() => undefined} />);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="cesium-map-panel"/);
  assert.match(html, /aria-label="ขยายแผงข้อมูล"/);
  assert.match(html, /map-panel-toggle-expand/);
});
