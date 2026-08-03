import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAssessment, mutateAssessmentStateAtomic } from "@/lib/repo";
import { requireAssessmentAccess } from "@/lib/api-auth";
import { deleteEvidenceFile, FILE_ID_PATTERN, readEvidenceFile } from "@/lib/uploads";
import { INDICATOR_IDS } from "@/lib/types";
import type { IndicatorId } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; indicatorId: string; fileId: string }> };

function parseAssessmentId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseIndicatorId(raw: string): IndicatorId | null {
  return (INDICATOR_IDS as readonly string[]).includes(raw) ? (raw as IndicatorId) : null;
}

// ดูไฟล์ (แสดง/ดาวน์โหลด) — ตรวจกับ state ก่อนเสมอว่าไฟล์นี้ผูกกับแบบประเมิน+ตัวชี้วัดนี้จริง
export async function GET(_request: NextRequest, { params }: Ctx) {
  const { id: rawId, indicatorId: rawIndicatorId, fileId } = await params;
  const assessmentId = parseAssessmentId(rawId);
  const indicatorId = parseIndicatorId(rawIndicatorId);
  if (!assessmentId || !indicatorId || !FILE_ID_PATTERN.test(fileId)) {
    return NextResponse.json({ error: "รหัสไม่ถูกต้อง" }, { status: 400 });
  }
  const guard = await requireAssessmentAccess(assessmentId);
  if (!guard.ok) return guard.response;

  try {
    const record = await getAssessment(assessmentId);
    const meta = record?.state.evidence[indicatorId]?.files.find((f) => f.id === fileId);
    if (!record || !meta) return NextResponse.json({ error: "ไม่พบไฟล์" }, { status: 404 });

    const buffer = await readEvidenceFile(assessmentId, indicatorId, fileId);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": meta.mimeType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(meta.originalName)}`,
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("[api] read evidence file failed:", error);
    return NextResponse.json({ error: "อ่านไฟล์ไม่สำเร็จ" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { id: rawId, indicatorId: rawIndicatorId, fileId } = await params;
  const assessmentId = parseAssessmentId(rawId);
  const indicatorId = parseIndicatorId(rawIndicatorId);
  if (!assessmentId || !indicatorId || !FILE_ID_PATTERN.test(fileId)) {
    return NextResponse.json({ error: "รหัสไม่ถูกต้อง" }, { status: 400 });
  }
  const guard = await requireAssessmentAccess(assessmentId);
  if (!guard.ok) return guard.response;

  try {
    const record = await getAssessment(assessmentId);
    if (!record) return NextResponse.json({ error: "ไม่พบแบบประเมิน" }, { status: 404 });

    const files = record.state.evidence[indicatorId]?.files ?? [];
    if (!files.some((f) => f.id === fileId)) {
      return NextResponse.json({ error: "ไม่พบไฟล์" }, { status: 404 });
    }

    await deleteEvidenceFile(assessmentId, indicatorId, fileId);

    // อ่าน state สดใต้ล็อกแล้วตัดเฉพาะไฟล์นี้ออก — ไม่เขียนทั้งก้อนจากสำเนาที่อ่านไว้ตอนต้นคำขอ
    // (autosave ของฟอร์มอาจ commit ไปแล้วระหว่างนี้ การเขียนทับจะย้อนคำตอบที่เพิ่งกรอกกลับไป)
    const stored = await mutateAssessmentStateAtomic(assessmentId, (current) => {
      const latestFiles = current.evidence[indicatorId]?.files ?? [];
      return {
        ...current,
        evidence: {
          ...current.evidence,
          [indicatorId]: { ...current.evidence[indicatorId], files: latestFiles.filter((f) => f.id !== fileId) },
        },
      };
    });
    if (!stored.found) return NextResponse.json({ error: "ไม่พบแบบประเมิน" }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api] delete evidence file failed:", error);
    return NextResponse.json({ error: "ลบไฟล์ไม่สำเร็จ" }, { status: 500 });
  }
}
