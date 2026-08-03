// AI วิเคราะห์ภูมิประเทศจากภาพ 3D — server-only (เรียก OpenRouter ด้วย fetch; ห้าม import จาก client)
// Provider: OpenRouter (OpenAI-compatible) + Google Gemini 2.5 Flash
import { SETTING_TYPES } from "../types";
import type { SettingType } from "../types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash";
// เพดานเวลารอ OpenRouter — คำขอหนึ่งครั้งแบกภาพ base64 ได้ถึง 10 รูป จึงตั้งไว้กว้างพอสำหรับกรณีปกติ
// แต่ต้องมีเพดาน: ถ้า upstream ค้าง fetch จะรอไม่จำกัดและกิน request slot ของเซิร์ฟเวอร์ทิ้งไว้เฉย ๆ
const REQUEST_TIMEOUT_MS = 90_000;
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    // AbortSignal.timeout โยน TimeoutError — แยกข้อความให้ผู้ใช้รู้ว่าเป็นการหมดเวลา ไม่ใช่ต่อไม่ติด
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new TerrainAnalysisError("upstream", `วิเคราะห์ AI ใช้เวลานานเกิน ${REQUEST_TIMEOUT_MS / 1000} วินาที`);
    }
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

  if (!data || typeof data !== "object") {
    throw new TerrainAnalysisError("bad-content", "รูปแบบผลลัพธ์จาก OpenRouter ไม่ถูกต้อง");
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
