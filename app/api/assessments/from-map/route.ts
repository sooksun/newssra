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
import { haversineM } from "@/lib/map/morphology";
import {
  assessmentForSchoolYear,
  listProvinces,
  resolveSchoolProvince,
  saveAssessmentFromMapAtomic,
  schoolAssessmentMaster,
} from "@/lib/repo";
import type { GisAnalysis } from "@/lib/types";

export const dynamic = "force-dynamic";

// ต้องตรงกับค่าใน app/api/assessments/[id]/gis/route.ts — กันพิกัดโรงเรียนอื่นปนกับแบบประเมินนี้
// (ทั้งสอง route ยังคง const แยกกันเพราะไม่มีจุด import กลางที่ปลอดภัยสำหรับ route-level constant นี้)
const MAX_ASSESSMENT_RELOCATION_M = 10_000;

/** parse body แบบปลอดภัย — JSON ผิดรูปแบบ/ไม่ใช่ object → null (route คืน 400) */
async function readJsonObject(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asNum(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
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

    // จังหวัดของจุดวิเคราะห์ — จังหวัดจริงจากทะเบียนโรงเรียนก่อน (แม่นสำหรับอำเภอชายขอบ) ชนะเสมอเมื่อพบ
    // แต่ fallback ศาลากลางที่ใกล้ที่สุดต้องอิง "จุดที่กำลังวิเคราะห์" (body.center) ไม่ใช่พิกัดโรงเรียนที่ลงทะเบียนไว้
    // — เหมือน /gis (ผู้ใช้อาจลากหมุด/ค้นหาไปยังจุดอื่นก่อนกดบันทึกจากแผนที่) ถ้าพิกัดใน body ใช้ไม่ได้
    // ค่อย fallback ไปที่พิกัดทะเบียนโรงเรียนแทน (ตัวประมวลผลกลางด้านล่างจะ 400 คำขอนี้เองอยู่แล้ว)
    const rawCenter = (body.center && typeof body.center === "object" ? body.center : {}) as Record<string, unknown>;
    const centerLat = asNum(rawCenter.lat);
    const centerLng = asNum(rawCenter.lng);
    const centerValid = centerLat >= -90 && centerLat <= 90 && centerLng >= -180 && centerLng <= 180;

    const provinces = await listProvinces();
    const province = await resolveSchoolProvince(provinces, {
      schoolCode: guard.user.schoolCode,
      enteredProvince: master.province,
      lat: centerValid ? centerLat : master.lat,
      lng: centerValid ? centerLng : master.lng,
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

    const syncUnitLocation = body.syncUnitLocation === true;

    // การปรับพิกัดโรงเรียนในแบบฟอร์ม (syncUnitLocation) ต้องมีเพดานระยะห่างเหมือน /gis — กันจุดวิเคราะห์
    // ที่ห่างจากพิกัดเดิมของแบบร่างปีนี้เกินไปเผลอไปทับพิกัดโรงเรียนอื่น (แถวที่ยื่นแล้วไม่แตะอยู่แล้ว จึงข้ามได้)
    // อ่านแบบไม่ผูก transaction เดียวกับ saveAssessmentFromMapAtomic — แข่งกับการบันทึกพร้อมกันได้ (ยอมรับความเสี่ยงนี้
    // เพราะเป็นแค่การ์ดความสมเหตุสมผลของข้อมูล ไม่ใช่กติกาความถูกต้องเชิงธุรกิจที่ต้อง atomic)
    if (syncUnitLocation) {
      const currentYearRow = await assessmentForSchoolYear(guard.user.schoolCode, year);
      if (currentYearRow && !currentYearRow.state.submitted) {
        const unitLat = Number.parseFloat(currentYearRow.state.unit.lat);
        const unitLng = Number.parseFloat(currentYearRow.state.unit.lng);
        const hasUnitCoords = Number.isFinite(unitLat) && Number.isFinite(unitLng) && (unitLat !== 0 || unitLng !== 0);
        const distanceFromUnitM = hasUnitCoords ? haversineM(unitLat, unitLng, gis.center.lat, gis.center.lng) : null;
        if (distanceFromUnitM !== null && distanceFromUnitM > MAX_ASSESSMENT_RELOCATION_M) {
          return NextResponse.json(
            {
              error:
                `พิกัดที่ส่งมาห่างจากพิกัดโรงเรียนในแบบฟอร์มประมาณ ${(distanceFromUnitM / 1000).toFixed(1)} กม. ` +
                "ระบบไม่บันทึกเพื่อกันข้อมูลโรงเรียนอื่นปนกับแบบประเมินนี้",
            },
            { status: 409 },
          );
        }
      }
    }

    const result = await saveAssessmentFromMapAtomic({
      ownerUserId: guard.user.source === "local" ? guard.user.uid : null,
      schoolCode: guard.user.schoolCode,
      year,
      initialState,
      gis,
      syncUnitLocation,
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
