# AI Terrain Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** หลังจับภาพ 3D 9 มุมเสร็จ ให้ AI (OpenRouter + Gemini 2.5 Flash) วิเคราะห์ภาพอัตโนมัติแล้วแนะค่า `settingType` พร้อมเหตุผล ผู้ใช้กด "ใช้ค่านี้" เพื่อเติมช่องลักษณะที่ตั้ง

**Architecture:** เพิ่ม AI layer (`lib/ai/terrainAnalysis.ts`) เรียก OpenRouter chat-completions ด้วย `fetch` ตรง (ไม่เพิ่ม dependency), structured JSON output; เก็บผลใน `state.unit.settingSuggestion` (optional, server-owned เหมือน `siteSnapshots`); route `/analyze` แยกต่างหาก; client เรียกต่อจากจับภาพก่อน navigate; แสดง `SettingSuggestionCard` ใน UnitPanel

**Tech Stack:** Next.js 16 + TypeScript strict, OpenRouter REST (OpenAI-compatible, `fetch`), node:test + tsx, mysql2 (integration). ไม่มี npm dependency ใหม่

## Global Constraints

- Provider: **OpenRouter** endpoint `https://openrouter.ai/api/v1/chat/completions`, model default `google/gemini-2.5-flash` (อ่านจาก env `AI_TERRAIN_MODEL`), auth `Authorization: Bearer ${OPENROUTER_API_KEY}`
- Env: `OPENROUTER_API_KEY` (จำเป็น), `AI_TERRAIN_MODEL` (ไม่บังคับ) — เพิ่มใน `.env.production.example` + `docs/DEPLOY.md`
- AI เรียก **ฝั่ง server เท่านั้น** — `lib/ai/*` ห้าม import จาก client component; ห้าม key รั่วไป client
- Structured output ผ่าน `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }` ; schema: `{ settingType: enum(SETTING_TYPES), rationale: string, confidence: enum(["high","medium","low"]) }`, `additionalProperties: false`
- `settingType` ที่คืนต้องอยู่ใน `SETTING_TYPES` (`["เกาะ","ภูเขาสูง","หุบเขา","เชิงเขา","พื้นราบห่างไกล","อื่น ๆ"]`) เสมอ — ไม่เชื่อ freeform
- `state.unit.settingSuggestion` เป็น **server-owned**: PUT autosave preserve จาก DB; `makeBlankState` ไม่ใส่ key; POST หลัง submit → **409**
- AI แนะนำเท่านั้น — เติม `settingType` เฉพาะเมื่อผู้ใช้กด "ใช้ค่านี้" (ไม่ทับอัตโนมัติ)
- ไม่กระทบ scoring/canSubmit/คะแนน 100/flow จับภาพเดิม
- PDPA: prompt สั่งวิเคราะห์เฉพาะภูมิประเทศ ห้ามระบุ/อนุมานตัวบุคคล
- ห้ามรัน `npm run build` ขณะ dev server รันอยู่

---

## File Structure

- `lib/ai/terrainAnalysis.ts` (สร้าง) — `TerrainSuggestionResult` + `parseTerrainResponse` (pure) + `analyzeTerrainFromImages` (fetch OpenRouter) + `TerrainAnalysisError`
- `lib/ai/terrainAnalysis.test.ts` (สร้าง) — unit ของ `parseTerrainResponse` (no network)
- `lib/types.ts` (แก้) — `TerrainSuggestion` + `UnitInfo.settingSuggestion?`
- `lib/state.ts` (แก้) — `cleanSettingSuggestion` + sanitize + `preserveServerOwned`
- `app/api/assessments/[id]/site-snapshots/analyze/route.ts` (สร้าง) — POST วิเคราะห์
- `components/map/CesiumMap.tsx` (แก้) — เรียก `/analyze` ต่อจากจับภาพ
- `components/SettingSuggestionCard.tsx` (สร้าง) — การ์ดแนะนำ + ปุ่มใช้ค่า
- `components/SettingSuggestionCard.test.tsx` (สร้าง) — render test
- `components/UnitPanel.tsx` (แก้) — วางการ์ดใต้ "ลักษณะที่ตั้ง"
- `app/globals.css` (แก้) — สไตล์การ์ด + ซ่อน print
- tests: `tests/state.test.ts` (แก้), `tests/integration/assessment-security.test.mts` (แก้), `package.json` (เพิ่มไฟล์เทสต์ใหม่ + `.env.production.example`/DEPLOY)

---

### Task 1: AI layer — parse + analyze (`lib/ai/terrainAnalysis.ts`)

**Files:**
- Create: `lib/ai/terrainAnalysis.ts`
- Create: `lib/ai/terrainAnalysis.test.ts`
- Modify: `package.json` (เพิ่มไฟล์เทสต์ใน `test` script)

**Interfaces:**
- Consumes: `SETTING_TYPES`/`SettingType` จาก `lib/types.ts`
- Produces:
  - `interface TerrainSuggestionResult { settingType: SettingType; rationale: string; confidence: "high" | "medium" | "low" }`
  - `type TerrainErrorCode = "no-key" | "rate-limit" | "auth" | "bad-content" | "upstream" | "unknown"`
  - `class TerrainAnalysisError extends Error { code: TerrainErrorCode }`
  - `function parseTerrainResponse(raw: unknown): TerrainSuggestionResult` (throws `TerrainAnalysisError("bad-content")` เมื่อ invalid)
  - `interface TerrainImageInput { buffer: Buffer; viewLabel: string; mimeType: string }`
  - `async function analyzeTerrainFromImages(images: TerrainImageInput[]): Promise<TerrainSuggestionResult>`

- [ ] **Step 1: เขียน failing test (`lib/ai/terrainAnalysis.test.ts`)**

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseTerrainResponse, TerrainAnalysisError } from "./terrainAnalysis";

describe("parseTerrainResponse", () => {
  test("ผลถูกต้อง → คืนค่า", () => {
    const out = parseTerrainResponse({
      settingType: "ภูเขาสูง",
      rationale: "ภาพแสดงยอดเขาสูงชันล้อมรอบ",
      confidence: "high",
    });
    assert.equal(out.settingType, "ภูเขาสูง");
    assert.equal(out.confidence, "high");
    assert.ok(out.rationale.includes("ยอดเขา"));
  });
  test("settingType นอก enum → throw bad-content", () => {
    assert.throws(
      () => parseTerrainResponse({ settingType: "ดาวอังคาร", rationale: "x", confidence: "high" }),
      (e: unknown) => e instanceof TerrainAnalysisError && e.code === "bad-content",
    );
  });
  test("confidence ผิดค่า → throw bad-content", () => {
    assert.throws(
      () => parseTerrainResponse({ settingType: "เกาะ", rationale: "x", confidence: "สูงมาก" }),
      (e: unknown) => e instanceof TerrainAnalysisError && e.code === "bad-content",
    );
  });
  test("rationale ยาวเกิน 500 → cap", () => {
    const out = parseTerrainResponse({ settingType: "หุบเขา", rationale: "ก".repeat(800), confidence: "low" });
    assert.equal(out.rationale.length, 500);
  });
  test("ไม่ใช่ object / ขาด field → throw bad-content", () => {
    assert.throws(() => parseTerrainResponse(null), (e: unknown) => e instanceof TerrainAnalysisError);
    assert.throws(() => parseTerrainResponse({ settingType: "เกาะ" }), (e: unknown) => e instanceof TerrainAnalysisError);
  });
});
```

- [ ] **Step 2: รัน test ให้ fail**

Run: `node --import tsx --test lib/ai/terrainAnalysis.test.ts`
Expected: FAIL — Cannot find module './terrainAnalysis'

- [ ] **Step 3: implement `lib/ai/terrainAnalysis.ts`**

```ts
// AI วิเคราะห์ภูมิประเทศจากภาพ 3D — server-only (เรียก OpenRouter ด้วย fetch; ห้าม import จาก client)
// Provider: OpenRouter (OpenAI-compatible) + Google Gemini 2.5 Flash
import { SETTING_TYPES } from "./../types";
import type { SettingType } from "./../types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash";
const CONFIDENCE_VALUES = ["high", "medium", "low"] as const;
type Confidence = (typeof CONFIDENCE_VALUES)[number];

export interface TerrainSuggestionResult {
  settingType: SettingType;
  rationale: string;
  confidence: Confidence;
}

export type TerrainErrorCode = "no-key" | "rate-limit" | "auth" | "bad-content" | "upstream" | "unknown";

export class TerrainAnalysisError extends Error {
  constructor(
    public readonly code: TerrainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TerrainAnalysisError";
  }
}

export interface TerrainImageInput {
  buffer: Buffer;
  viewLabel: string;
  mimeType: string;
}

/** parse + validate ผลจากโมเดล (pure) — คืน result หรือ throw TerrainAnalysisError("bad-content") */
export function parseTerrainResponse(raw: unknown): TerrainSuggestionResult {
  if (!raw || typeof raw !== "object") {
    throw new TerrainAnalysisError("bad-content", "ผลวิเคราะห์ไม่ใช่วัตถุ JSON");
  }
  const obj = raw as Record<string, unknown>;
  const settingType = typeof obj.settingType === "string" ? obj.settingType : "";
  if (!(SETTING_TYPES as readonly string[]).includes(settingType)) {
    throw new TerrainAnalysisError("bad-content", "settingType ไม่อยู่ในค่าที่รองรับ");
  }
  const confidence = typeof obj.confidence === "string" ? obj.confidence : "";
  if (!(CONFIDENCE_VALUES as readonly string[]).includes(confidence)) {
    throw new TerrainAnalysisError("bad-content", "confidence ไม่ถูกต้อง");
  }
  const rationale = (typeof obj.rationale === "string" ? obj.rationale : "").slice(0, 500);
  return { settingType: settingType as SettingType, rationale, confidence: confidence as Confidence };
}

const SYSTEM_PROMPT = `คุณเป็นผู้เชี่ยวชาญวิเคราะห์ภูมิประเทศจากภาพถ่ายดาวเทียม/ภาพ 3 มิติ
งานของคุณ: ดูภาพมุมต่าง ๆ ของที่ตั้งโรงเรียนแล้วจำแนก "ลักษณะที่ตั้ง" เป็นหนึ่งใน:
- "เกาะ": พื้นที่ล้อมรอบด้วยน้ำ
- "ภูเขาสูง": ภูเขาสูงชัน (โดยประมาณ ≥ 600 ม. ตามเกณฑ์ สพฐ.) ล้อมรอบ/เป็นที่ตั้ง
- "หุบเขา": พื้นที่ต่ำระหว่างภูเขา มีเขาขนาบสองข้าง
- "เชิงเขา": ลาดเชิงเขา/เนินเขา (~150–600 ม.) ไม่เข้าเกตภูเขาสูง
- "พื้นราบห่างไกล": ที่ราบ ไม่มีภูเขาเด่น แต่ห่างไกลชุมชน
- "อื่น ๆ": เมื่อไม่เข้าเกณฑ์ข้างต้นชัดเจน
วิเคราะห์เฉพาะลักษณะภูมิประเทศเท่านั้น ห้ามระบุหรืออนุมานตัวบุคคลใด ๆ (หลัก PDPA)
ตอบเป็น JSON ตาม schema ที่กำหนด rationale เป็นภาษาไทยสั้น ๆ อธิบายเหตุผล`;

function toDataUrl(img: TerrainImageInput): string {
  return `data:${img.mimeType};base64,${img.buffer.toString("base64")}`;
}

export async function analyzeTerrainFromImages(images: TerrainImageInput[]): Promise<TerrainSuggestionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new TerrainAnalysisError("no-key", "ยังไม่ได้ตั้งค่า AI (OPENROUTER_API_KEY)");
  }
  const model = process.env.AI_TERRAIN_MODEL || DEFAULT_MODEL;

  const userContent: unknown[] = [
    { type: "text", text: "ภาพมุมต่าง ๆ ของที่ตั้งโรงเรียน (เรียงตามมุม) — จำแนกลักษณะที่ตั้ง:" },
  ];
  for (const img of images) {
    userContent.push({ type: "text", text: `มุม: ${img.viewLabel}` });
    userContent.push({ type: "image_url", image_url: { url: toDataUrl(img) } });
  }

  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "terrain_suggestion",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            settingType: { type: "string", enum: [...SETTING_TYPES] },
            rationale: { type: "string" },
            confidence: { type: "string", enum: [...CONFIDENCE_VALUES] },
          },
          required: ["settingType", "rationale", "confidence"],
        },
      },
    },
  };

  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new TerrainAnalysisError("upstream", e instanceof Error ? e.message : "เชื่อมต่อ OpenRouter ไม่สำเร็จ");
  }

  if (res.status === 401 || res.status === 403) {
    throw new TerrainAnalysisError("auth", "คีย์ OpenRouter ไม่ถูกต้องหรือไม่มีสิทธิ์");
  }
  if (res.status === 429) {
    throw new TerrainAnalysisError("rate-limit", "เรียกใช้ AI ถี่เกินไป กรุณาลองใหม่ภายหลัง");
  }
  if (!res.ok) {
    throw new TerrainAnalysisError("upstream", `OpenRouter ตอบกลับสถานะ ${res.status}`);
  }

  let data: { choices?: { message?: { content?: string } }[] };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw new TerrainAnalysisError("bad-content", "อ่านผลจาก OpenRouter ไม่ได้");
  }
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new TerrainAnalysisError("bad-content", "โมเดลไม่ได้ตอบเนื้อหา");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new TerrainAnalysisError("bad-content", "ผลวิเคราะห์ไม่ใช่ JSON ที่ถูกต้อง");
  }
  return parseTerrainResponse(parsed);
}
```

หมายเหตุ: import path ใช้ `./../types` (จาก `lib/ai/` ขึ้นไป `lib/`); ตรวจว่า tsconfig alias `@/lib/types` ก็ใช้ได้ — ถ้าไฟล์อื่นใน repo ใช้ `@/lib/...` ให้ใช้ `@/lib/types` เพื่อความสม่ำเสมอ (implementer เลือกตามที่ build ผ่าน)

- [ ] **Step 4: เพิ่มไฟล์เทสต์ใน package.json**

ใน `package.json` `test` script เพิ่ม `lib/ai/terrainAnalysis.test.ts` (ก่อน `components/map/MapPanelToggle.test.tsx`)

- [ ] **Step 5: รัน test ให้ผ่าน**

Run: `npm test`
Expected: PASS ทั้งหมด (รวม 5 case ใหม่)

- [ ] **Step 6: Commit**

```bash
git add lib/ai/terrainAnalysis.ts lib/ai/terrainAnalysis.test.ts package.json
git commit -m "feat: add OpenRouter terrain analysis AI layer"
```

---

### Task 2: ชนิด `TerrainSuggestion` + sanitize + preserve (`lib/types.ts`, `lib/state.ts`)

**Files:**
- Modify: `lib/types.ts` (เพิ่ม `TerrainSuggestion` ~หลัง `SnapshotFile`; ฟิลด์ใน `UnitInfo` ~บรรทัด 96)
- Modify: `lib/state.ts` (`cleanSettingSuggestion` + sanitize + `preserveServerOwned`)
- Modify: `tests/state.test.ts` (เพิ่ม test)

**Interfaces:**
- Consumes: `SETTING_TYPES`/`SettingType` (`lib/types.ts`), `cleanString` (`lib/state.ts`)
- Produces:
  - `interface TerrainSuggestion { settingType: SettingType; rationale: string; confidence: "high"|"medium"|"low"; analyzedAt: string }`
  - `UnitInfo.settingSuggestion?: TerrainSuggestion`
  - พฤติกรรม sanitize + preserve ของ `settingSuggestion`

- [ ] **Step 1: เพิ่มชนิดใน `lib/types.ts`**

หลัง `SnapshotFile` (ก่อน/หลัง `EvidenceInfo` ก็ได้ — วางใกล้ `SnapshotFile`) เพิ่ม:

```ts
/** คำแนะนำลักษณะที่ตั้งจาก AI (วิเคราะห์ภาพ 3D) — server-owned, optional (แถวเก่าไม่งอก key) */
export interface TerrainSuggestion {
  settingType: SettingType;
  /** เหตุผลภาษาไทย */
  rationale: string;
  confidence: "high" | "medium" | "low";
  analyzedAt: string;
}
```

ใน `UnitInfo` หลัง `siteSnapshots?: SnapshotFile[];` (บรรทัด ~96) เพิ่ม:

```ts
  /** คำแนะนำลักษณะที่ตั้งจาก AI (server-owned) — optional เพื่อให้แถวเก่า round-trip ไม่งอก key */
  settingSuggestion?: TerrainSuggestion;
```

- [ ] **Step 2: เขียน failing test ใน `tests/state.test.ts`**

เพิ่ม describe block ต่อท้าย (ปรับ import ให้มี `preserveServerOwned` ถ้ายังไม่มี — ดูว่า import เดิมมีหรือยัง):

```ts
describe("settingSuggestion — คำแนะนำ AI (server-owned)", () => {
  const sug = (over = {}) => ({
    settingType: "ภูเขาสูง",
    rationale: "ยอดเขาสูงชันล้อมรอบ",
    confidence: "high",
    analyzedAt: "2026-07-23T00:00:00.000Z",
    ...over,
  });

  test("แถวไม่มี settingSuggestion → sanitize ไม่งอก key", () => {
    const s = sanitizeState({ unit: { name: "รร" } });
    assert.equal("settingSuggestion" in s.unit, false);
  });

  test("sanitize รับค่าถูกต้อง + ตัด settingType นอก enum ทิ้ง", () => {
    const ok = sanitizeState({ unit: { settingSuggestion: sug() } });
    assert.equal(ok.unit.settingSuggestion?.settingType, "ภูเขาสูง");
    const bad = sanitizeState({ unit: { settingSuggestion: sug({ settingType: "ดาวอังคาร" }) } });
    assert.equal("settingSuggestion" in bad.unit, false);
    const badConf = sanitizeState({ unit: { settingSuggestion: sug({ confidence: "x" }) } });
    assert.equal("settingSuggestion" in badConf.unit, false);
  });

  test("preserveServerOwned — settingSuggestion มาจาก DB, client แก้ไม่ได้", () => {
    const existing = makeBlankState();
    existing.unit.settingSuggestion = sug();
    const incoming = makeBlankState();
    incoming.unit.settingSuggestion = sug({ rationale: "ปลอม", settingType: "เกาะ" });
    const merged = preserveServerOwned(incoming, existing);
    assert.equal(merged.unit.settingSuggestion?.rationale, "ยอดเขาสูงชันล้อมรอบ");
    assert.equal(merged.unit.settingSuggestion?.settingType, "ภูเขาสูง");
  });

  test("preserveServerOwned — existing ไม่มี key → ไม่งอก key", () => {
    const merged = preserveServerOwned(makeBlankState(), makeBlankState());
    assert.equal("settingSuggestion" in merged.unit, false);
  });
});
```

- [ ] **Step 3: รัน test ให้ fail**

Run: `node --import tsx --test tests/state.test.ts`
Expected: FAIL — sanitize/preserve ยังไม่จัดการ `settingSuggestion`

- [ ] **Step 4: implement ใน `lib/state.ts`**

เพิ่ม `cleanSettingSuggestion` หลัง `cleanSnapshotFiles` (บรรทัด ~101):

```ts
const CONFIDENCE_SET = ["high", "medium", "low"] as const;

/** ตรวจ metadata คำแนะนำ AI — คืน undefined เมื่อ settingType/confidence ไม่ถูกต้อง (กันปลอม) */
function cleanSettingSuggestion(value: unknown): TerrainSuggestion | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const settingType = cleanString(v.settingType, 32);
  if (!(SETTING_TYPES as readonly string[]).includes(settingType)) return undefined;
  const confidence = cleanString(v.confidence, 10);
  if (!(CONFIDENCE_SET as readonly string[]).includes(confidence)) return undefined;
  return {
    settingType: settingType as SettingType,
    rationale: cleanString(v.rationale, 500),
    confidence: confidence as TerrainSuggestion["confidence"],
    analyzedAt: cleanString(v.analyzedAt, 40),
  };
}
```

เพิ่ม import ที่ต้นไฟล์: type `TerrainSuggestion` จาก `./types` (เข้ากลุ่ม import types เดิม)

ในบล็อก sanitize ของ `unit` — หลังบล็อก `siteSnapshots` (บรรทัด ~140) เพิ่ม:

```ts
  const rawSuggestion = (rawUnit as Record<string, unknown>).settingSuggestion;
  const cleanedSuggestion = cleanSettingSuggestion(rawSuggestion);
  if (cleanedSuggestion) state.unit.settingSuggestion = cleanedSuggestion;
```

ใน `preserveServerOwned` — หลังบล็อก `siteSnapshots` (บรรทัด ~227, ก่อน `return merged`) เพิ่ม:

```ts
  delete merged.unit.settingSuggestion;
  if (existing.unit.settingSuggestion) {
    merged.unit = { ...merged.unit, settingSuggestion: existing.unit.settingSuggestion };
  }
```

(หมายเหตุ: `merged.unit` ถูก shallow-copy แล้วที่บรรทัด `{ ...incoming, unit: { ...incoming.unit }, evidence }` จึง delete/set ได้ปลอดภัย)

- [ ] **Step 5: รัน test ให้ผ่าน**

Run: `npm test`
Expected: PASS ทั้งหมด (รวม 4 case ใหม่ + เทสต์ preserve/sanitize เดิมยังเขียว)

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/state.ts tests/state.test.ts
git commit -m "feat: add settingSuggestion to unit state (sanitize + server-owned)"
```

---

### Task 3: Route วิเคราะห์ (`POST .../site-snapshots/analyze`)

**Files:**
- Create: `app/api/assessments/[id]/site-snapshots/analyze/route.ts`
- Modify: `tests/integration/assessment-security.test.mts` (409 หลัง submit; mock AI)

**Interfaces:**
- Consumes: `requireAssessmentAccess` (`lib/api-auth`), `getAssessment`/`saveAssessment` (`lib/repo`), `readSiteSnapshot` (`lib/uploads`), `analyzeTerrainFromImages`/`TerrainAnalysisError` (`lib/ai/terrainAnalysis`), `TerrainSuggestion` (`lib/types`)
- Produces: `POST` คืน `{ suggestion: TerrainSuggestion }` (200)

- [ ] **Step 1: เขียน route**

สร้าง `app/api/assessments/[id]/site-snapshots/analyze/route.ts`:

```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAssessment, saveAssessment } from "@/lib/repo";
import { requireAssessmentAccess } from "@/lib/api-auth";
import { readSiteSnapshot } from "@/lib/uploads";
import { analyzeTerrainFromImages, TerrainAnalysisError } from "@/lib/ai/terrainAnalysis";
import type { TerrainImageInput } from "@/lib/ai/terrainAnalysis";
import type { TerrainSuggestion } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function parseAssessmentId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const ERROR_STATUS: Record<string, number> = {
  "no-key": 401,
  auth: 401,
  "rate-limit": 429,
  "bad-content": 422,
  upstream: 502,
  unknown: 500,
};

export async function POST(_request: NextRequest, { params }: Ctx) {
  const { id: rawId } = await params;
  const assessmentId = parseAssessmentId(rawId);
  if (!assessmentId) return NextResponse.json({ error: "รหัสไม่ถูกต้อง" }, { status: 400 });

  const guard = await requireAssessmentAccess(assessmentId);
  if (!guard.ok) return guard.response;

  const record = await getAssessment(assessmentId);
  if (!record) return NextResponse.json({ error: "ไม่พบแบบประเมิน" }, { status: 404 });
  if (record.state.submitted) {
    return NextResponse.json({ error: "แบบประเมินถูกยื่นแล้ว วิเคราะห์ใหม่ไม่ได้" }, { status: 409 });
  }

  const snapshots = record.state.unit.siteSnapshots ?? [];
  if (snapshots.length === 0) {
    return NextResponse.json({ error: "ยังไม่มีภาพให้วิเคราะห์ — จับภาพก่อน" }, { status: 400 });
  }

  let images: TerrainImageInput[];
  try {
    images = await Promise.all(
      snapshots.map(async (s) => ({
        buffer: await readSiteSnapshot(assessmentId, s.id),
        viewLabel: s.viewLabel,
        mimeType: s.mimeType,
      })),
    );
  } catch (error) {
    console.error("[api] read snapshots for analyze failed:", error);
    return NextResponse.json({ error: "อ่านภาพไม่สำเร็จ" }, { status: 500 });
  }

  try {
    const result = await analyzeTerrainFromImages(images);
    const suggestion: TerrainSuggestion = { ...result, analyzedAt: new Date().toISOString() };
    const nextState = {
      ...record.state,
      unit: { ...record.state.unit, settingSuggestion: suggestion },
    };
    await saveAssessment(assessmentId, nextState);
    return NextResponse.json({ suggestion });
  } catch (error) {
    if (error instanceof TerrainAnalysisError) {
      return NextResponse.json({ error: error.message }, { status: ERROR_STATUS[error.code] ?? 500 });
    }
    console.error("[api] terrain analyze failed:", error);
    return NextResponse.json({ error: "วิเคราะห์ภาพไม่สำเร็จ" }, { status: 500 });
  }
}
```

- [ ] **Step 2: เขียน integration test (409 หลัง submit + mock AI)**

เปิด `tests/integration/assessment-security.test.mts` อ่านว่าใช้ `mock.module` จาก node:test อย่างไร (ไฟล์นี้ mock `next/headers` อยู่แล้ว). เพิ่ม test ที่:
- mock `@/lib/ai/terrainAnalysis` (หรือ `../../lib/ai/terrainAnalysis` ตาม path ที่ไฟล์ route import) ให้ `analyzeTerrainFromImages` คืน suggestion คงที่ `{ settingType: "ภูเขาสูง", rationale: "mock", confidence: "high" }` — เพื่อไม่ยิงเครือข่ายจริง
- ทดสอบ POST `analyze/route.ts` บนแบบประเมินที่ **submitted แล้ว** → คาด **409** (ตรงกับ pattern 409 ของ site-snapshots ที่มีอยู่แล้วในไฟล์นี้ — คัดลอกโครงมาปรับ path เป็น `.../analyze`)

ถ้า `mock.module` กับ AI layer ทำได้ยากในไฟล์นี้ (เพราะ setup mock เฉพาะ next/headers) ให้ทดสอบเฉพาะ **409 submit-lock** (ซึ่ง return ก่อนเรียก AI จึงไม่ต้อง mock) — เพียงพอสำหรับ security gate; ระบุใน report ว่าเลือกทางไหน

- [ ] **Step 3: รัน integration + unit**

Run: `npm test` → Expected: PASS
Run: `npm run test:integration` → Expected: PASS (รวม 409 ใหม่); SKIP ได้เฉพาะเมื่อ MySQL ไม่พร้อม (รายงาน)

- [ ] **Step 4: ตรวจ build (ถ้า dev server ไม่ได้รัน)**

Run: `npm run build`
Expected: build สำเร็จ ไม่มี type error

- [ ] **Step 5: Commit**

```bash
git add "app/api/assessments/[id]/site-snapshots/analyze" tests/integration/assessment-security.test.mts
git commit -m "feat: add terrain analysis route (POST site-snapshots/analyze)"
```

---

### Task 4: การ์ดแนะนำใน UnitPanel (`SettingSuggestionCard`)

**Files:**
- Create: `components/SettingSuggestionCard.tsx`
- Create: `components/SettingSuggestionCard.test.tsx`
- Modify: `components/UnitPanel.tsx` (วางใต้บล็อก "ลักษณะที่ตั้ง")
- Modify: `app/globals.css` (สไตล์ + print hide)
- Modify: `package.json` (เพิ่มไฟล์เทสต์)

**Interfaces:**
- Consumes: `TerrainSuggestion` (`lib/types`), `SettingType` (`lib/types`)
- Produces: `<SettingSuggestionCard suggestion={TerrainSuggestion} current={SettingType | ""} onUse={(t: SettingType) => void} />`

- [ ] **Step 1: เขียน failing test (`components/SettingSuggestionCard.test.tsx`)**

```tsx
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import SettingSuggestionCard from "./SettingSuggestionCard";
import type { TerrainSuggestion } from "@/lib/types";

const sug: TerrainSuggestion = {
  settingType: "ภูเขาสูง",
  rationale: "ภาพแสดงยอดเขาสูงชันล้อมรอบทุกด้าน",
  confidence: "high",
  analyzedAt: "2026-07-23T00:00:00.000Z",
};

describe("SettingSuggestionCard", () => {
  test("แสดง settingType + เหตุผล + ระดับความมั่นใจไทย", () => {
    const html = renderToStaticMarkup(<SettingSuggestionCard suggestion={sug} current="" onUse={() => {}} />);
    assert.match(html, /ภูเขาสูง/);
    assert.match(html, /ยอดเขาสูงชัน/);
    assert.match(html, /สูง/); // high → สูง
  });
  test("current ตรงกับที่แนะ → ไม่มีปุ่ม 'ใช้ค่านี้' (แสดงว่าตรงแล้ว)", () => {
    const html = renderToStaticMarkup(<SettingSuggestionCard suggestion={sug} current="ภูเขาสูง" onUse={() => {}} />);
    assert.doesNotMatch(html, /ใช้ค่านี้/);
    assert.match(html, /ตรงกับที่เลือกไว้/);
  });
  test("current ต่าง → มีปุ่ม 'ใช้ค่านี้'", () => {
    const html = renderToStaticMarkup(<SettingSuggestionCard suggestion={sug} current="เกาะ" onUse={() => {}} />);
    assert.match(html, /ใช้ค่านี้/);
  });
});
```

- [ ] **Step 2: รัน test ให้ fail**

Run: `node --import tsx --test components/SettingSuggestionCard.test.tsx`
Expected: FAIL — Cannot find module './SettingSuggestionCard'

- [ ] **Step 3: implement `components/SettingSuggestionCard.tsx`**

```tsx
"use client";

import type { SettingType, TerrainSuggestion } from "@/lib/types";

interface Props {
  suggestion: TerrainSuggestion;
  current: SettingType | "";
  onUse: (t: SettingType) => void;
}

const CONFIDENCE_TH: Record<TerrainSuggestion["confidence"], string> = {
  high: "สูง",
  medium: "ปานกลาง",
  low: "ต่ำ",
};

export default function SettingSuggestionCard({ suggestion, current, onUse }: Props) {
  const matches = current === suggestion.settingType;
  return (
    <div className="setting-suggestion">
      <p className="setting-suggestion-head">
        🤖 AI แนะนำลักษณะที่ตั้ง: <strong>{suggestion.settingType}</strong>{" "}
        <span className="setting-suggestion-conf">(ความมั่นใจ {CONFIDENCE_TH[suggestion.confidence]})</span>
      </p>
      {suggestion.rationale ? <p className="setting-suggestion-why">{suggestion.rationale}</p> : null}
      {matches ? (
        <span className="setting-suggestion-matched">✓ ตรงกับที่เลือกไว้</span>
      ) : (
        <button type="button" className="ghost-btn setting-suggestion-use" onClick={() => onUse(suggestion.settingType)}>
          ใช้ค่านี้
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: วางใน UnitPanel**

ใน `components/UnitPanel.tsx` เพิ่ม import:

```tsx
import SettingSuggestionCard from "./SettingSuggestionCard";
```

ในบล็อก `.unit-setting` (หลัง segmented options ของ settingType, ก่อนปิด `.unit-setting`) เพิ่ม:

```tsx
        {unit.settingSuggestion ? (
          <SettingSuggestionCard
            suggestion={unit.settingSuggestion}
            current={unit.settingType}
            onUse={(t) => onChange("settingType", t)}
          />
        ) : null}
```

(`onChange` เป็น prop เดิมของ UnitPanel — signature `<K extends keyof UnitInfo>(key: K, value: UnitInfo[K])`; `onChange("settingType", t)` ตรงชนิด)

- [ ] **Step 5: เพิ่มสไตล์ + ซ่อน print ใน `app/globals.css`**

```css
.setting-suggestion { margin-top: 10px; padding: 10px 12px; border: 1px solid var(--border, #dcdce3); border-radius: 8px; background: var(--surface-2, #f7f7fb); }
.setting-suggestion-head { margin: 0; font-size: 14px; }
.setting-suggestion-conf { color: var(--muted, #667); font-size: 12px; }
.setting-suggestion-why { margin: 4px 0 8px; font-size: 13px; color: var(--muted, #445); }
.setting-suggestion-matched { font-size: 13px; color: #1a7f37; }
@media print { .setting-suggestion { display: none; } }
```

- [ ] **Step 6: เพิ่มไฟล์เทสต์ใน package.json**

ใน `test` script เพิ่ม `components/SettingSuggestionCard.test.tsx`

- [ ] **Step 7: รัน test + build**

Run: `npm test` → Expected: PASS (รวม 3 case ใหม่)
Run: `npm run build` (ถ้า dev server ไม่ได้รัน) → Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add components/SettingSuggestionCard.tsx components/SettingSuggestionCard.test.tsx components/UnitPanel.tsx app/globals.css package.json
git commit -m "feat: show AI setting suggestion card in UnitPanel"
```

---

### Task 5: เรียก `/analyze` ต่อจากจับภาพ (`CesiumMap.tsx`) + docs

**Files:**
- Modify: `components/map/CesiumMap.tsx` (ใน `captureSiteSnapshots`, บรรทัด ~1992–1997)
- Modify: `.env.production.example` (เพิ่ม `OPENROUTER_API_KEY`, `AI_TERRAIN_MODEL`)
- Modify: `docs/DEPLOY.md` (บันทึกตัวแปร AI)

**Interfaces:**
- Consumes: route `/analyze` (Task 3)
- Produces: UI เท่านั้น

- [ ] **Step 1: เพิ่มการเรียก analyze ใน `captureSiteSnapshots`**

ใน `components/map/CesiumMap.tsx` แทนบล็อกหลังอัปโหลดสำเร็จ (บรรทัด ~1992–1997) จากเดิม:

```tsx
      const res = await fetch(`/api/assessments/${targetId}/site-snapshots`, { method: "POST", body: fd });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "อัปโหลดภาพไม่สำเร็จ");
      }
      window.location.assign(`/assessment/${targetId}#unitPanel`);
```

เป็น:

```tsx
      const res = await fetch(`/api/assessments/${targetId}/site-snapshots`, { method: "POST", body: fd });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "อัปโหลดภาพไม่สำเร็จ");
      }
      // วิเคราะห์ภูมิประเทศด้วย AI ต่อทันที — ถ้าล้มเหลวก็ยังไปหน้าแบบประเมิน (ภาพครบแล้ว)
      setCaptureProgress(SNAPSHOT_VIEWS.length);
      setAnalyzing(true);
      try {
        await fetch(`/api/assessments/${targetId}/site-snapshots/analyze`, { method: "POST" });
      } catch {
        /* เงียบ — คำแนะนำ AI เป็นส่วนเสริม */
      } finally {
        setAnalyzing(false);
      }
      window.location.assign(`/assessment/${targetId}#unitPanel`);
```

เพิ่ม state ใกล้ `capturing` (บรรทัด ~480):

```tsx
  const [analyzing, setAnalyzing] = useState(false);
```

- [ ] **Step 2: อัปเดตข้อความปุ่มให้บอกสถานะวิเคราะห์**

หาปุ่มจับภาพ (ที่ใช้ `capturing`/`captureProgress` — บรรทัด ~2311 บริเวณ label) ปรับ label ให้เมื่อ `analyzing` แสดง "กำลังวิเคราะห์ภูมิประเทศด้วย AI…" และ disabled เมื่อ `capturing || analyzing`. อ่านโค้ดปุ่มจริงแล้วปรับ: เงื่อนไข disabled เดิม `disabled={capturing || Boolean(assessment.submitted)}` → `disabled={capturing || analyzing || Boolean(assessment.submitted)}`; label:

```tsx
{capturing
  ? `กำลังจับภาพ ${captureProgress}/${SNAPSHOT_VIEWS.length}…`
  : analyzing
    ? "กำลังวิเคราะห์ภูมิประเทศด้วย AI…"
    : "📸 จับภาพ 3D ยืนยันที่ตั้ง"}
```

- [ ] **Step 3: อัปเดต env example + DEPLOY**

ใน `.env.production.example` เพิ่มท้ายไฟล์:

```
# AI วิเคราะห์ภูมิประเทศจากภาพ 3D (OpenRouter + Gemini 2.5 Flash) — ถ้าไม่ตั้ง ฟีเจอร์นี้จะปิดอย่างสุภาพ
OPENROUTER_API_KEY=
# ไม่บังคับ — เปลี่ยนรุ่นโมเดล (ค่าเริ่มต้น google/gemini-2.5-flash)
# AI_TERRAIN_MODEL=google/gemini-2.5-flash
```

ใน `docs/DEPLOY.md` เพิ่มบรรทัดใต้ส่วนตั้งค่า `.env.production` (ใกล้ที่อธิบายตัวแปรอื่น): อธิบายว่า `OPENROUTER_API_KEY` เปิดฟีเจอร์ AI แนะลักษณะที่ตั้งจากภาพ 3D; ไม่ตั้งก็ได้ (ฟีเจอร์อื่นทำงานปกติ) — ปุ่มจับภาพยังทำงาน แค่ไม่มีคำแนะนำ AI

- [ ] **Step 4: ตรวจ build**

Run: `npm run build` (dev server ต้องไม่รัน) → Expected: PASS ไม่มี type error

- [ ] **Step 5: Commit**

```bash
git add components/map/CesiumMap.tsx .env.production.example docs/DEPLOY.md
git commit -m "feat: auto-run AI terrain analysis after snapshot capture"
```

---

### Task 6: ยืนยัน end-to-end

**Files:**
- แก้เฉพาะเมื่อพบ defect

- [ ] **Step 1: ชุดเทสต์ครบ**

Run: `npm test` → Expected: ทุกไฟล์ PASS, 0 fail
Run: `npm run test:integration` → Expected: PASS (รวม analyze 409); SKIP เฉพาะ MySQL ไม่พร้อม

- [ ] **Step 2: build**

Run: `npm run build` → Expected: PASS

- [ ] **Step 3: ยืนยันบน dev server (ต้องมี OPENROUTER_API_KEY ใน .env.local)**

ตั้ง `OPENROUTER_API_KEY` ใน `.env.local`, เปิด dev server, login โรงเรียนที่มีแบบประเมิน (เช่น 57030129), เปิด `/map?assessment=ID`, กด "จับภาพ 3D" → หลัง 9/9 เห็น "กำลังวิเคราะห์…" → เด้งไป `/assessment/ID#unitPanel` → ในหัวข้อ "ลักษณะที่ตั้ง" เห็นการ์ด "🤖 AI แนะนำ…" พร้อมปุ่ม "ใช้ค่านี้"; กดปุ่ม → ช่อง settingType ถูกเลือกตามค่าที่แนะ; ไม่มี error ใน console

- [ ] **Step 4: ยืนยันกรณีไม่มี key (graceful)**

เอา `OPENROUTER_API_KEY` ออกจาก `.env.local` (restart dev), จับภาพใหม่ → analyze คืน 401 (เงียบฝั่ง client), ยังเด้งไปหน้าแบบประเมิน มีภาพครบ ไม่มีการ์ดแนะนำ ไม่มี error ค้าง

- [ ] **Step 5: Commit (เฉพาะถ้ามีแก้)**

```bash
git commit -m "fix: close AI terrain analysis acceptance gaps"
```

---

## Completion Criteria

- จับภาพเสร็จ → AI วิเคราะห์อัตโนมัติ → การ์ดแนะ `settingType` + เหตุผล + ความมั่นใจ ใน UnitPanel; ปุ่ม "ใช้ค่านี้" เติมค่า (ไม่ทับอัตโนมัติ)
- `settingSuggestion` server-owned (PUT preserve), แถวเก่าไม่งอก key, `settingType` validate ใน SETTING_TYPES เสมอ
- ไม่มี key → 401 สุภาพ, แอปส่วนอื่นทำงานปกติ; POST หลัง submit → 409
- AI เรียกฝั่ง server เท่านั้น (key ไม่รั่ว), ไม่เพิ่ม npm dependency, ไม่กระทบคะแนน/flow เดิม
- unit + integration + build เขียวทั้งหมด
