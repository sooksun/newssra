import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAssessment, saveAssessment } from "@/lib/repo";
import { saveEvidenceFile } from "@/lib/uploads";
import { isAllowedMimeType, MAX_FILE_SIZE, MAX_FILES_PER_INDICATOR } from "@/lib/upload-constants";
import { INDICATOR_IDS } from "@/lib/types";
import type { IndicatorId } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; indicatorId: string }> };

function parseAssessmentId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseIndicatorId(raw: string): IndicatorId | null {
  return (INDICATOR_IDS as readonly string[]).includes(raw) ? (raw as IndicatorId) : null;
}

// อัปโหลดไฟล์หลักฐาน 1 ไฟล์ต่อคำขอ — ฝั่ง client วนอัปโหลดทีละไฟล์เมื่อเลือกหลายไฟล์พร้อมกัน
export async function POST(request: NextRequest, { params }: Ctx) {
  const { id: rawId, indicatorId: rawIndicatorId } = await params;
  const assessmentId = parseAssessmentId(rawId);
  const indicatorId = parseIndicatorId(rawIndicatorId);
  if (!assessmentId || !indicatorId) {
    return NextResponse.json({ error: "รหัสไม่ถูกต้อง" }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "ไม่พบไฟล์ที่อัปโหลด" }, { status: 400 });
  }
  if (!isAllowedMimeType(file.type)) {
    return NextResponse.json({ error: "รองรับเฉพาะไฟล์ภาพ (JPEG/PNG/WebP) หรือ PDF เท่านั้น" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "ไฟล์ใหญ่เกินไป (สูงสุด 10MB ต่อไฟล์)" }, { status: 400 });
  }

  try {
    const record = await getAssessment(assessmentId);
    if (!record) return NextResponse.json({ error: "ไม่พบแบบประเมิน" }, { status: 404 });

    const currentFiles = record.state.evidence[indicatorId]?.files ?? [];
    if (currentFiles.length >= MAX_FILES_PER_INDICATOR) {
      return NextResponse.json(
        { error: `แนบไฟล์ได้สูงสุด ${MAX_FILES_PER_INDICATOR} ไฟล์ต่อตัวชี้วัด` },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const savedFile = await saveEvidenceFile(assessmentId, indicatorId, file.name, file.type, buffer);

    const nextState = {
      ...record.state,
      evidence: {
        ...record.state.evidence,
        [indicatorId]: {
          ...record.state.evidence[indicatorId],
          files: [...currentFiles, savedFile],
        },
      },
    };
    await saveAssessment(assessmentId, nextState);

    return NextResponse.json({ file: savedFile }, { status: 201 });
  } catch (error) {
    console.error("[api] evidence upload failed:", error);
    return NextResponse.json({ error: "อัปโหลดไฟล์ไม่สำเร็จ" }, { status: 500 });
  }
}
