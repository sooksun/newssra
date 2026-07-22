// POST /api/assessments/from-map — บันทึกผลวิเคราะห์ GIS จากแผนที่ 3 มิติ ลงแบบประเมิน "ปีปัจจุบัน" ของโรงเรียนผู้เรียก
// ต่างจาก POST /api/assessments/[id]/gis (ผูกกับ assessment id ที่มีอยู่แล้ว): endpoint นี้ผูกกับ (schoolCode, ปีปัจจุบัน)
// จาก session เท่านั้น — ไม่รับ schoolCode/assessmentId จาก client เด็ดขาด กัน "ปลอมเจ้าของ"
// สร้างใหม่ (created) / ปรับปรุงฉบับร่างเดิม (updated) / คืนฉบับที่ยื่นแล้วแบบอ่านอย่างเดียว (locked) แบบ atomic ทั้งก้อน
// (ดู lib/repo.ts#saveAssessmentFromMapAtomic — transaction เดียวคุมทั้งสร้าง/ปรับปรุง/ล็อก + คำตอบมิติ 3)

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { currentBuddhistYear } from "@/lib/assessment-year";
import { requireApiRole } from "@/lib/api-auth";
import { buildGisFromMapRequest, GisRequestError } from "@/lib/gis-request";
import { prefillMapAssessmentState } from "@/lib/map-assessment";
import {
  listProvinces,
  resolveSchoolProvince,
  saveAssessmentFromMapAtomic,
  schoolAssessmentMaster,
} from "@/lib/repo";
import type { GisAnalysis } from "@/lib/types";

export const dynamic = "force-dynamic";

/** parse body แบบปลอดภัย — JSON ผิดรูปแบบ/ไม่ใช่ object → null (route คืน 400) */
async function readJsonObject(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireApiRole("school");
  if (!guard.ok) return guard.response;
  if (!guard.user.schoolCode) {
    return NextResponse.json({ error: "บัญชีนี้ยังไม่ผูกกับรหัสโรงเรียน" }, { status: 403 });
  }

  const body = await readJsonObject(request);
  if (!body) {
    return NextResponse.json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  try {
    const year = currentBuddhistYear();
    const master = await schoolAssessmentMaster(guard.user.schoolCode);
    if (!master) {
      return NextResponse.json({ error: "ไม่พบข้อมูลพิกัดโรงเรียน" }, { status: 422 });
    }

    // จังหวัดของจุดวิเคราะห์ — จังหวัดจริงจากทะเบียนโรงเรียนก่อน (แม่นสำหรับอำเภอชายขอบ) แล้ว fallback ตามลำดับเดียวกับ /gis
    const provinces = await listProvinces();
    const province = await resolveSchoolProvince(provinces, {
      schoolCode: guard.user.schoolCode,
      enteredProvince: master.province,
      lat: master.lat,
      lng: master.lng,
    });
    const initialState = prefillMapAssessmentState(master, year);

    // คำนวณเส้นทาง + clamp + finalize ผ่านตัวประมวลผลกลางเดียวกับ /gis — บังคับต้องมีเส้นทางศาลากลางจังหวัดที่ใช้ได้
    let gis: GisAnalysis;
    let droppedRoutes: string[];
    try {
      ({ gis, droppedRoutes } = buildGisFromMapRequest(body, {
        schoolCode: guard.user.schoolCode,
        provinceName: province?.name ?? master.province,
        provinceAvgElev: province && Number.isFinite(province.avgElev) ? province.avgElev : null,
        now: new Date().toISOString(),
        previousAreaSummary: undefined,
        previouslyApplied: false,
        requireProvinceRoute: true,
      }));
    } catch (err) {
      if (err instanceof GisRequestError) {
        const status = err.code === "NO_VALID_ROUTE" ? 422 : 400;
        return NextResponse.json({ error: err.message }, { status });
      }
      throw err;
    }

    const result = await saveAssessmentFromMapAtomic({
      ownerUserId: guard.user.source === "local" ? guard.user.uid : null,
      schoolCode: guard.user.schoolCode,
      year,
      initialState,
      gis,
      syncUnitLocation: body.syncUnitLocation === true,
    });

    return NextResponse.json(
      { assessmentId: result.assessmentId, action: result.action, gis: result.state.gis, droppedRoutes },
      { status: result.action === "created" ? 201 : 200 },
    );
  } catch (error) {
    console.error("[api] save assessment from map failed:", error);
    return NextResponse.json({ error: "บันทึกแบบประเมินจากแผนที่ไม่สำเร็จ" }, { status: 500 });
  }
}
