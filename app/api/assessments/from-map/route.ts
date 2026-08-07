// POST /api/assessments/from-map — บันทึกผลวิเคราะห์ GIS จากแผนที่ 3 มิติ ลงแบบประเมิน
//
// เจ้าของแถวปลายทางต้องมาจากสิ่งที่ผู้เรียกมีสิทธิ์อยู่แล้วเสมอ ไม่เคยรับ schoolCode ดิบจาก body:
//   role school          → (schoolCode จาก session, ปีปัจจุบัน) — assessmentId ใน body ถูกเพิกเฉย กัน "ปลอมเจ้าของ"
//   role admin/ssra_admin → ต้องระบุ assessmentId ที่เปิดอยู่ แล้วใช้โรงเรียนเจ้าของแถวนั้น + ปีของแถวนั้น
//                           (ผู้ดูแลแก้แบบประเมินใดก็ได้ผ่าน PUT อยู่แล้ว จึงไม่ใช่การเพิ่มสิทธิ์ใหม่)
// สร้างใหม่ (created) / ปรับปรุงฉบับร่างเดิม (updated) / คืนฉบับที่ยื่นแล้วแบบอ่านอย่างเดียว (locked) แบบ atomic ทั้งก้อน
// (ดู lib/repo.ts#saveAssessmentFromMapAtomic — transaction เดียวคุมทั้งสร้าง/ปรับปรุง/ล็อก + คำตอบมิติ 3)

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { currentBuddhistYear } from "@/lib/assessment-year";
import { requireApiUser } from "@/lib/api-auth";
import { canAccessAssessment } from "@/lib/auth";
import { MAX_ASSESSMENT_RELOCATION_M } from "@/lib/gis";
import { buildGisFromMapRequest, GisRequestError } from "@/lib/gis-request";
import { prefillMapAssessmentState } from "@/lib/map-assessment";
import { haversineM } from "@/lib/map/morphology";
import {
  assessmentForSchoolYear,
  getAssessment,
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

function asNum(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

export async function POST(request: NextRequest) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const body = await readJsonObject(request);
  if (!body) {
    return NextResponse.json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  // เจ้าของแถวที่จะบันทึกลง — ต้องมาจากสิ่งที่ผู้เรียก "มีสิทธิ์อยู่แล้ว" เท่านั้น ไม่รับ schoolCode ดิบจาก body
  //   role school → เอาจาก session (เหมือนเดิมทุกประการ; assessmentId ใน body ถูกเพิกเฉย กันปลอมเจ้าของ)
  //   role admin/ssra_admin → ต้องระบุ assessmentId ที่เปิดอยู่ แล้วใช้ "โรงเรียนเจ้าของแถวนั้น"
  //     (ผู้ดูแลแก้แบบประเมินใดก็ได้ผ่าน PUT อยู่แล้ว การเปิดให้บันทึกจากแผนที่จึงไม่เพิ่มสิทธิ์ใหม่)
  let schoolCode: string;
  let year: string;
  let ownerUserId: number | null;

  if (guard.user.role === "school") {
    if (!guard.user.schoolCode) {
      return NextResponse.json({ error: "บัญชีนี้ยังไม่ผูกกับรหัสโรงเรียน" }, { status: 403 });
    }
    schoolCode = guard.user.schoolCode;
    year = currentBuddhistYear();
    ownerUserId = guard.user.source === "local" ? guard.user.uid : null;
  } else {
    const assessmentId = Number(body.assessmentId);
    if (!Number.isInteger(assessmentId) || assessmentId <= 0) {
      return NextResponse.json(
        { error: "ผู้ดูแลต้องเปิดแบบประเมินที่ต้องการบันทึก (ระบุ assessmentId) ก่อน" },
        { status: 400 },
      );
    }
    const target = await getAssessment(assessmentId);
    if (!target) {
      return NextResponse.json({ error: "ไม่พบแบบประเมินที่ระบุ" }, { status: 404 });
    }
    if (!canAccessAssessment(guard.user, target.ownerSchoolCode)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงแบบประเมินนี้" }, { status: 403 });
    }
    if (!target.ownerSchoolCode) {
      return NextResponse.json({ error: "แบบประเมินนี้ยังไม่ผูกกับรหัสโรงเรียน" }, { status: 422 });
    }
    schoolCode = target.ownerSchoolCode;
    year = target.state.unit.year || currentBuddhistYear();
    // ไม่เปลี่ยนเจ้าของแถว — ผู้ดูแลบันทึกแทน ไม่ใช่รับช่วงความเป็นเจ้าของ
    ownerUserId = null;
  }

  try {
    const master = await schoolAssessmentMaster(schoolCode);
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
      schoolCode,
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
        provinceName: province?.name ?? master.province,
        provinceAvgElev: province && Number.isFinite(province.avgElev) ? province.avgElev : null,
        now: new Date().toISOString(),
        previousAreaSummary: undefined,
      }));
    } catch (err) {
      if (err instanceof GisRequestError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    const syncUnitLocation = body.syncUnitLocation === true;

    // การปรับพิกัดโรงเรียนในแบบฟอร์ม (syncUnitLocation) ต้องมีเพดานระยะห่างเหมือน /gis — กันจุดวิเคราะห์
    // ที่ห่างจากพิกัดเดิมของแบบร่างปีนี้เกินไปเผลอไปทับพิกัดโรงเรียนอื่น (แถวที่ยื่นแล้วไม่แตะอยู่แล้ว จึงข้ามได้)
    // อ่านแบบไม่ผูก transaction เดียวกับ saveAssessmentFromMapAtomic — แข่งกับการบันทึกพร้อมกันได้ (ยอมรับความเสี่ยงนี้
    // เพราะเป็นแค่การ์ดความสมเหตุสมผลของข้อมูล ไม่ใช่กติกาความถูกต้องเชิงธุรกิจที่ต้อง atomic)
    if (syncUnitLocation) {
      const currentYearRow = await assessmentForSchoolYear(schoolCode, year);
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
      ownerUserId,
      schoolCode,
      year,
      initialState,
      gis,
      syncUnitLocation,
      // จังหวัดที่ใช้เติมฟิลด์ว่างของฉบับร่างเดิมต้องตรงกับที่ route resolve ไว้แล้ว (ชนะเมื่อพบ) — เหมือนที่แบบใหม่
      // (initialState จาก prefillMapAssessmentState) ได้ province มาจาก master.province เป็นค่าเริ่มต้นอยู่แล้ว
      master: { ...master, province: province?.name ?? master.province },
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
