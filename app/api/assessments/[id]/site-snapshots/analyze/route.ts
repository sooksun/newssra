import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAssessment, saveAssessment } from "@/lib/repo";
import { requireAssessmentAccess } from "@/lib/api-auth";
import { terrainAnalyzeRateLimiter } from "@/lib/rate-limit";
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

  // จำกัดอัตราต่อผู้ใช้ — แต่ละครั้งส่งภาพชุด 3D ทั้งหมดเข้า Gemini ผ่าน OpenRouter (มีค่าใช้จ่าย) ดู terrainAnalyzeRateLimiter
  const rlKey = `terrain-analyze:${guard.user.uid}`;
  const status = terrainAnalyzeRateLimiter.check(rlKey);
  if (status.blocked) {
    return NextResponse.json(
      { error: "เรียกวิเคราะห์ AI ถี่เกินไป กรุณาลองใหม่ภายหลัง" },
      { status: 429, headers: { "Retry-After": String(status.retryAfterSec) } },
    );
  }
  terrainAnalyzeRateLimiter.fail(rlKey); // นับคำขอนี้เข้าโควตา

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
