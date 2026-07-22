import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAssessment, saveAssessment } from "@/lib/repo";
import { requireAssessmentAccess } from "@/lib/api-auth";
import { deleteAllSiteSnapshots, saveSiteSnapshot, sniffMimeType } from "@/lib/uploads";
import { isAllowedMimeType, MAX_FILE_SIZE, MAX_SITE_SNAPSHOTS } from "@/lib/upload-constants";
import { SNAPSHOT_VIEWS } from "@/lib/map/snapshotViews";
import type { SnapshotFile } from "@/lib/types";

export const dynamic = "force-dynamic";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

type Ctx = { params: Promise<{ id: string }> };

function parseAssessmentId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// อัปโหลดภาพ snapshot ทั้งชุด (แทนที่ชุดเดิมทั้งหมด) — field "files" หลายไฟล์ + "viewKeys" (JSON array) จับคู่ตามลำดับ
export async function POST(request: NextRequest, { params }: Ctx) {
  const { id: rawId } = await params;
  const assessmentId = parseAssessmentId(rawId);
  if (!assessmentId) return NextResponse.json({ error: "รหัสไม่ถูกต้อง" }, { status: 400 });

  const guard = await requireAssessmentAccess(assessmentId);
  if (!guard.ok) return guard.response;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "ไม่พบไฟล์ภาพ" }, { status: 400 });
  if (files.length > MAX_SITE_SNAPSHOTS) {
    return NextResponse.json({ error: `แนบภาพได้สูงสุด ${MAX_SITE_SNAPSHOTS} ภาพ` }, { status: 400 });
  }

  let viewKeys: string[] = [];
  try {
    const raw = formData.get("viewKeys");
    viewKeys = typeof raw === "string" ? (JSON.parse(raw) as string[]) : [];
  } catch {
    viewKeys = [];
  }

  const record = await getAssessment(assessmentId);
  if (!record) return NextResponse.json({ error: "ไม่พบแบบประเมิน" }, { status: 404 });
  if (record.state.submitted) {
    return NextResponse.json({ error: "แบบประเมินถูกยื่นแล้ว แก้ไขภาพไม่ได้" }, { status: 409 });
  }

  // ตรวจทุกไฟล์ก่อน (เฉพาะภาพ; ไม่รับ PDF), แล้วค่อยเขียน — atomic: ถ้าพลาดกลางทางลบที่เพิ่งเขียนทิ้ง
  const buffers: { buffer: Buffer; mime: string; name: string; viewKey: string; viewLabel: string }[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "ไฟล์ใหญ่เกินไป (สูงสุด 10MB ต่อภาพ)" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const detected = sniffMimeType(buffer);
    if (!detected || !detected.startsWith("image/") || !isAllowedMimeType(detected)) {
      return NextResponse.json({ error: "รองรับเฉพาะไฟล์ภาพ (JPEG/PNG/WebP) เท่านั้น" }, { status: 400 });
    }
    const viewKey = viewKeys[i] ?? "";
    const view = SNAPSHOT_VIEWS.find((v) => v.key === viewKey);
    buffers.push({
      buffer,
      mime: detected,
      name: `${viewKey || "view"}${EXT_BY_MIME[detected] ?? ".jpg"}`,
      viewKey: view?.key ?? "",
      viewLabel: view?.label ?? "",
    });
  }

  try {
    await deleteAllSiteSnapshots(assessmentId); // แทนที่ชุดเดิมทั้งหมด
    const saved: SnapshotFile[] = [];
    for (const b of buffers) {
      const meta = await saveSiteSnapshot(assessmentId, b.name, b.mime, b.buffer);
      saved.push({ ...meta, viewKey: b.viewKey, viewLabel: b.viewLabel });
    }
    const nextState = { ...record.state, unit: { ...record.state.unit, siteSnapshots: saved } };
    await saveAssessment(assessmentId, nextState);
    return NextResponse.json({ files: saved }, { status: 201 });
  } catch (error) {
    console.error("[api] site snapshot upload failed:", error);
    return NextResponse.json({ error: "บันทึกภาพไม่สำเร็จ" }, { status: 500 });
  }
}
