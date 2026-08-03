import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAssessment, mutateAssessmentStateAtomic } from "@/lib/repo";
import { requireAssessmentAccess } from "@/lib/api-auth";
import { deleteEvidenceFile, saveEvidenceFile, sniffMimeType } from "@/lib/uploads";
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
  const guard = await requireAssessmentAccess(assessmentId);
  if (!guard.ok) return guard.response;

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
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // ตรวจชนิดไฟล์จริงจาก magic bytes ของเนื้อไฟล์ (ไม่เชื่อ Content-Type ที่ client ส่ง — ปลอมได้)
    // แล้วเก็บชนิดที่ตรวจพบเป็นค่าจริง เพื่อกันไฟล์อันตรายที่ปลอมส่วนหัวเป็นภาพ/PDF
    const detectedType = sniffMimeType(buffer);
    if (!detectedType) {
      return NextResponse.json(
        { error: "เนื้อไฟล์ไม่ตรงกับชนิดที่รองรับ (รองรับเฉพาะภาพ JPEG/PNG/WebP หรือ PDF จริงเท่านั้น)" },
        { status: 400 },
      );
    }

    const savedFile = await saveEvidenceFile(assessmentId, indicatorId, file.name, detectedType, buffer);

    // อ่าน state สดใต้ล็อกแล้วต่อไฟล์เข้ากับรายการล่าสุด — ระหว่างอ่านไฟล์เข้าหน่วยความจำ+เขียนดิสก์
    // (หลายร้อย ms ต่อไฟล์ 10MB) ผู้ใช้อาจ autosave ฟอร์มไปแล้ว หรืออัปโหลดอีกไฟล์คู่ขนาน
    // การเขียนทั้งก้อนจากสำเนาเก่าจะทำให้คำตอบที่เพิ่งกรอก/ไฟล์ที่เพิ่งแนบหายไปเงียบ ๆ
    const stored = await mutateAssessmentStateAtomic(assessmentId, (current) => {
      const latestFiles = current.evidence[indicatorId]?.files ?? [];
      if (latestFiles.length >= MAX_FILES_PER_INDICATOR) return null; // มีคำขออื่นแนบจนเต็มไปก่อนแล้ว
      return {
        ...current,
        evidence: {
          ...current.evidence,
          [indicatorId]: { ...current.evidence[indicatorId], files: [...latestFiles, savedFile] },
        },
      };
    });
    if (!stored.found) return NextResponse.json({ error: "ไม่พบแบบประเมิน" }, { status: 404 });
    if (!stored.applied) {
      await deleteEvidenceFile(assessmentId, indicatorId, savedFile.id); // ไม่ได้บันทึก metadata → ไม่ทิ้งไฟล์กำพร้า
      return NextResponse.json(
        { error: `แนบไฟล์ได้สูงสุด ${MAX_FILES_PER_INDICATOR} ไฟล์ต่อตัวชี้วัด` },
        { status: 400 },
      );
    }

    return NextResponse.json({ file: savedFile }, { status: 201 });
  } catch (error) {
    console.error("[api] evidence upload failed:", error);
    return NextResponse.json({ error: "อัปโหลดไฟล์ไม่สำเร็จ" }, { status: 500 });
  }
}
