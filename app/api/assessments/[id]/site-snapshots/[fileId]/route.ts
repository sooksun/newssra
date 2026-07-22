import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAssessment } from "@/lib/repo";
import { requireAssessmentAccess } from "@/lib/api-auth";
import { FILE_ID_PATTERN, readSiteSnapshot } from "@/lib/uploads";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; fileId: string }> };

function parseAssessmentId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_request: NextRequest, { params }: Ctx) {
  const { id: rawId, fileId } = await params;
  const assessmentId = parseAssessmentId(rawId);
  if (!assessmentId || !FILE_ID_PATTERN.test(fileId)) {
    return NextResponse.json({ error: "รหัสไม่ถูกต้อง" }, { status: 400 });
  }
  const guard = await requireAssessmentAccess(assessmentId);
  if (!guard.ok) return guard.response;

  try {
    const record = await getAssessment(assessmentId);
    const meta = record?.state.unit.siteSnapshots?.find((f) => f.id === fileId);
    if (!record || !meta) return NextResponse.json({ error: "ไม่พบไฟล์" }, { status: 404 });

    const buffer = await readSiteSnapshot(assessmentId, fileId);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": meta.mimeType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(meta.originalName)}`,
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("[api] read site snapshot failed:", error);
    return NextResponse.json({ error: "อ่านไฟล์ไม่สำเร็จ" }, { status: 500 });
  }
}
