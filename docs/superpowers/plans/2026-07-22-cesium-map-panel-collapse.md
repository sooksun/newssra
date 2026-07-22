# Cesium Map Panel Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มปุ่มซ่อนแผงข้อมูล Cesium ทั้งหมดและปุ่มลอยสำหรับเปิดกลับ เพื่อเพิ่มพื้นที่มองเห็นแผนที่โดยรักษาสถานะข้อมูลเดิม

**Architecture:** ใช้ local React state ใน `CesiumMap` เป็นเจ้าของสถานะเปิด/ปิด และแยกปุ่มควบคุมแบบ controlled component เพื่อทดสอบ accessibility markup ได้โดยไม่ผูกกับ Cesium viewer เมื่อย่อจะไม่ render `<aside>` แต่ state การค้นหา/GIS ทั้งหมดยังคงอยู่ใน `CesiumMap`; CSS วางปุ่มเปิดกลับเป็น floating control ที่มุมซ้ายบน

**Tech Stack:** Next.js 16, React 19, TypeScript strict, CSS, Node test runner, `react-dom/server`

## Global Constraints

- หน้า `/map` ต้องเริ่มต้นด้วยแผงสถานะขยายทุกครั้งที่เข้าใหม่หรือรีเฟรช
- ปุ่มทั้งสองต้องมีพื้นที่กดไม่น้อยกว่า 44 × 44 พิกเซล พร้อม `aria-expanded`, `aria-controls`, `aria-label` และ `title` ภาษาไทย
- ห้ามใช้ `localStorage` หรือสร้าง Cesium viewer ใหม่เมื่อย่อ/ขยาย
- ห้ามแก้ logic แนวชายแดน การค้นหา เส้นทาง GIS อาคาร หรือการประเมิน
- ต้องรักษาการแก้ไขที่มีอยู่แล้วใน `components/map/CesiumMap.tsx`, `app/globals.css` และ `package.json`

## File Structure

- Create `components/map/MapPanelToggle.tsx`: ปุ่ม controlled สำหรับสถานะขยายและย่อ พร้อม accessibility contract
- Create `components/map/MapPanelToggle.test.tsx`: ตรวจ markup ของปุ่มทั้งสองสถานะด้วย server rendering
- Create `tests/map-panel-collapse.test.ts`: regression contract ว่า `CesiumMap` เชื่อม state/panel/toggle และ CSS มีขนาด/ตำแหน่งที่กำหนด
- Modify `components/map/CesiumMap.tsx`: เก็บ `panelExpanded`, แสดง/ซ่อน `<aside>`, เชื่อมปุ่ม toggle
- Modify `app/globals.css`: จัดหัวแผง ปุ่มย่อ ปุ่มลอย และ focus state
- Modify `package.json`: เพิ่ม test ใหม่สองไฟล์ในคำสั่ง `npm test` โดยไม่เปลี่ยน script อื่น

---

### Task 1: Collapsible Cesium Information Panel

**Files:**
- Create: `components/map/MapPanelToggle.tsx`
- Create: `components/map/MapPanelToggle.test.tsx`
- Create: `tests/map-panel-collapse.test.ts`
- Modify: `components/map/CesiumMap.tsx:1-60, 410-440, 1850-1895, 2320-2340`
- Modify: `app/globals.css:2082-2120`
- Modify: `package.json:8-18`

**Interfaces:**
- Consumes: React `useState`, existing `.map-stage` and `.map-panel` layout
- Produces: `MapPanelToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }): JSX.Element`, panel id `cesium-map-panel`, state `panelExpanded: boolean`

- [x] **Step 1: Write the failing component test**

Create `components/map/MapPanelToggle.test.tsx`:

```tsx
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
```

- [x] **Step 2: Write the failing integration contract test**

Create `tests/map-panel-collapse.test.ts`:

```ts
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
  assert.match(css, /\.map-panel-toggle\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
  assert.match(css, /\.map-panel-toggle-expand\s*\{[^}]*position:\s*absolute;[^}]*top:\s*16px;[^}]*left:\s*16px;/s);
  assert.match(css, /\.map-panel-toggle:focus-visible/);
});
```

Append both files to the existing explicit `test` script in `package.json` without changing any other package script:

```json
"test": "node --import tsx --test tests/scoring.test.ts tests/gis.test.ts tests/auth.test.ts tests/rate-limit.test.ts tests/state.test.ts tests/uploads.test.ts tests/map-panel-collapse.test.ts lib/map/geometry.test.ts lib/map/borders.test.ts components/map/MapPanelToggle.test.tsx"
```

- [x] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
node --import tsx --test components/map/MapPanelToggle.test.tsx tests/map-panel-collapse.test.ts
```

Expected: FAIL because `MapPanelToggle.tsx`, `panelExpanded`, panel id, and the new CSS selectors do not exist

- [x] **Step 4: Write the minimal toggle implementation**

Create `components/map/MapPanelToggle.tsx`:

```tsx
type MapPanelToggleProps = {
  expanded: boolean;
  onToggle: () => void;
};

export default function MapPanelToggle({ expanded, onToggle }: MapPanelToggleProps) {
  const label = expanded ? "ย่อแผงข้อมูล" : "ขยายแผงข้อมูล";

  return (
    <button
      type="button"
      className={`map-panel-toggle ${expanded ? "map-panel-toggle-collapse" : "map-panel-toggle-expand"}`}
      aria-expanded={expanded}
      aria-controls="cesium-map-panel"
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <span aria-hidden="true">{expanded ? "‹" : "›"}</span>
    </button>
  );
}
```

- [x] **Step 5: Wire the state into CesiumMap**

Import `MapPanelToggle` with the other local components, add `const [panelExpanded, setPanelExpanded] = useState(true);` beside the existing UI state declarations, and change only the successful panel wrapper to this structure while keeping the existing body unchanged:

```tsx
{status === "error" ? (
  <div className="map-panel map-panel-error">
    <strong>เปิดแผนที่ 3 มิติไม่สำเร็จ</strong>
    <span>{errMsg}</span>
  </div>
) : panelExpanded ? (
  <aside id="cesium-map-panel" className="map-panel">
    <div className="map-panel-heading">
      <div>
        <h2 className="map-panel-title">แผนที่ 3 มิติ (Cesium)</h2>
        <p className="map-panel-sub">{national ? "มุมมองทั้งประเทศ" : center.name}</p>
      </div>
      <MapPanelToggle expanded onToggle={() => setPanelExpanded(false)} />
    </div>
    {/* Existing body begins with .map-coord and stays unchanged. */}
  </aside>
) : (
  <MapPanelToggle expanded={false} onToggle={() => setPanelExpanded(true)} />
)}
```

- [x] **Step 6: Add the panel control styles**

Add after the existing `.map-panel` block:

```css
.map-panel-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.map-panel-heading > div {
  min-width: 0;
}

.map-panel-toggle {
  min-width: 44px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid #c7d7f0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.96);
  color: var(--blue);
  box-shadow: var(--shadow);
  cursor: pointer;
  font-size: 28px;
  line-height: 1;
  z-index: 6;
}

.map-panel-toggle:hover {
  background: #eff6ff;
  border-color: #93c5fd;
}

.map-panel-toggle:focus-visible {
  outline: 3px solid rgba(37, 99, 235, 0.35);
  outline-offset: 2px;
}

.map-panel-toggle-collapse {
  flex: 0 0 auto;
  margin-top: -6px;
  box-shadow: none;
}

.map-panel-toggle-expand {
  position: absolute;
  top: 16px;
  left: 16px;
}
```

- [x] **Step 7: Run focused tests and verify GREEN**

Run `node --import tsx --test components/map/MapPanelToggle.test.tsx tests/map-panel-collapse.test.ts`.

Expected: 4 tests pass, 0 fail

- [x] **Step 8: Run formatting checks and the complete automated suite**

Run:

```powershell
npx prettier --write components/map/MapPanelToggle.tsx components/map/MapPanelToggle.test.tsx tests/map-panel-collapse.test.ts components/map/CesiumMap.tsx app/globals.css package.json
npm test
npm run format:check
npm run build
```

Expected: formatter exits 0; all unit tests pass; format check exits 0; production build exits 0. Stop any existing `next dev` process using this checkout before `npm run build`, per repository instructions.

- [x] **Step 9: Verify the real page in a browser**

Start the development server on the single intended port and sign in with an available local test account. At desktop width verify:

1. `/map` opens with the information panel visible
2. “ย่อแผงข้อมูล” hides the entire panel and reveals more map area
3. The floating “ขยายแผงข้อมูล” button appears at the top-left and does not overlap the right-side compass
4. Expanding restores the panel with the same search text and GIS state
5. Tab and Enter/Space operate both controls with a visible focus ring

Repeat near 390 × 844 and capture screenshots of expanded and collapsed states.

- [ ] **Step 10: Review the scoped diff and commit only feature files**

Run:

```powershell
git diff -- components/map/MapPanelToggle.tsx components/map/MapPanelToggle.test.tsx tests/map-panel-collapse.test.ts components/map/CesiumMap.tsx app/globals.css package.json
git status --short
```

Confirm the diff retains the pre-existing border attribution changes, then commit only the feature files without staging unrelated workspace files:

```powershell
git add -- components/map/MapPanelToggle.tsx components/map/MapPanelToggle.test.tsx tests/map-panel-collapse.test.ts components/map/CesiumMap.tsx app/globals.css package.json
git commit -m "feat: collapse Cesium map information panel"
```
