// POST /api/assessments/[id]/gis — บันทึกผลวิเคราะห์ GIS ลงแบบประเมิน (ช่องทางเดียวที่เขียน state.gis ได้)
// หลักการ: client ส่ง "วัตถุดิบดิบ" (พิกัด, ระยะ/เวลา OSRM, ความสูงที่สุ่มจากเบราว์เซอร์) เท่านั้น
// server เป็นผู้คำนวณระยะเส้นตรง + RCR/TTR/Effective Distance/ความเร็ว + Auto GIS Score เองทั้งหมด
// (ค่า ratio ที่ client คำนวณมาแสดงผลจะถูกทิ้ง — กันการปลอมคะแนน ตามกติกา "server เป็นแหล่งความจริง")

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAssessmentAccess } from "@/lib/api-auth";
import {
  buildRouteAnalysis,
  cleanAreaSummary,
  clampGisPayload,
  deriveD3Responses,
  finalizeGisAnalysis,
  routePhysicsIssue,
  suggestSettingTypeFromGis,
  MAX_GIS_ROUTES,
} from "@/lib/gis";
import type { RawGisRouteInput } from "@/lib/gis";
import { haversineM } from "@/lib/map/morphology";
import { getAssessment, listProvinces, resolveSchoolProvince, saveAssessment } from "@/lib/repo";
import { GIS_DESTINATION_TYPES } from "@/lib/types";
import type { AssessmentState, GisAnalysis, GisDestinationType, GisRouteAnalysis } from "@/lib/types";

export const dynamic = "force-dynamic";

const CENTER_SYNC_TOLERANCE_M = 50;
const MAX_ASSESSMENT_RELOCATION_M = 10_000;

type Ctx = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function asNum(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

/** แปลง entry ดิบจาก payload เป็น RawGisRouteInput (ยังไม่ validate ตัวเลข — buildRouteAnalysis เป็นคนตัดสิน) */
function toRawRoute(item: unknown): RawGisRouteInput | null {
  if (!item || typeof item !== "object") return null;
  const r = item as Record<string, unknown>;
  const destinationType = (GIS_DESTINATION_TYPES as readonly string[]).includes(r.destinationType as string)
    ? (r.destinationType as GisDestinationType)
    : "other";
  return {
    destinationType,
    destinationName: typeof r.destinationName === "string" ? r.destinationName.slice(0, 200) : "",
    destLat: asNum(r.destLat),
    destLng: asNum(r.destLng),
    roadDistanceM: asNum(r.roadDistanceM),
    durationS: asNum(r.durationS),
    elevationGainM: typeof r.elevationGainM === "number" && Number.isFinite(r.elevationGainM) ? r.elevationGainM : null,
    elevationLossM: typeof r.elevationLossM === "number" && Number.isFinite(r.elevationLossM) ? r.elevationLossM : null,
    selected: r.selected === true,
  };
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: "รหัสไม่ถูกต้อง" }, { status: 400 });
  const guard = await requireAssessmentAccess(id);
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  const rawCenter = (body.center && typeof body.center === "object" ? body.center : {}) as Record<string, unknown>;
  const lat = asNum(rawCenter.lat);
  const lng = asNum(rawCenter.lng);
  if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) {
    return NextResponse.json({ error: "พิกัดศูนย์กลางไม่ถูกต้อง" }, { status: 400 });
  }

  try {
    const existing = await getAssessment(id);
    if (!existing) return NextResponse.json({ error: "ไม่พบแบบประเมิน" }, { status: 404 });

    // แบบประเมินที่ยื่นแล้วมีเลขที่อ้างอิงผูกกับคะแนน ณ วันยื่น — ห้ามเขียนผล GIS ทับ (กันคะแนน desync)
    if (existing.state.submitted) {
      return NextResponse.json(
        { error: `แบบประเมินนี้ยื่นแล้ว (เลขที่ ${existing.state.submitted.ref}) ไม่สามารถบันทึกผล GIS ทับได้` },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const syncUnitLocation = body.syncUnitLocation === true;
    const unitLat = Number.parseFloat(existing.state.unit.lat);
    const unitLng = Number.parseFloat(existing.state.unit.lng);
    const hasUnitCoords = Number.isFinite(unitLat) && Number.isFinite(unitLng) && (unitLat !== 0 || unitLng !== 0);
    const distanceFromUnitM = hasUnitCoords ? haversineM(unitLat, unitLng, lat, lng) : null;
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
    if (
      distanceFromUnitM !== null &&
      distanceFromUnitM > CENTER_SYNC_TOLERANCE_M &&
      !syncUnitLocation
    ) {
      return NextResponse.json(
        { error: "พิกัด GIS ไม่ตรงกับพิกัดในแบบฟอร์ม กรุณายืนยันการอัปเดตพิกัดโรงเรียนก่อนบันทึก" },
        { status: 409 },
      );
    }

    // คำนวณเส้นทางใหม่จากวัตถุดิบดิบทีละเส้น + ตัดเส้นที่ผิดฟิสิกส์ทิ้งพร้อมเหตุผล
    const rawRoutes = Array.isArray(body.routes) ? body.routes.slice(0, MAX_GIS_ROUTES) : [];
    const routes: GisRouteAnalysis[] = [];
    const droppedRoutes: string[] = [];
    for (const item of rawRoutes) {
      const raw = toRawRoute(item);
      if (!raw) continue;
      const route = buildRouteAnalysis(lat, lng, raw, now);
      if (!route) {
        droppedRoutes.push(`เส้นทางไป${raw.destinationName || "จุดหมาย"}: ข้อมูลระยะทาง/เวลา/พิกัดใช้ไม่ได้`);
        continue;
      }
      const issue = routePhysicsIssue(route.roadDistanceKm, route.straightDistanceKm, route.averageSpeedKmh);
      if (issue) {
        droppedRoutes.push(`เส้นทางไป${route.destinationName || "จุดหมาย"}: ${issue}`);
        continue;
      }
      routes.push(route);
    }

    // จังหวัดของจุดวิเคราะห์ — ใช้จังหวัดจริงจากทะเบียนโรงเรียนก่อน (แม่นสำหรับอำเภอชายขอบ เช่น อ.ฝาง เชียงใหม่)
    // แล้ว fallback เป็นจังหวัดที่กรอก → ศาลากลางที่ใกล้ที่สุด; เก็บลง state เพื่อให้ธง V11 ตรวจแบบ pure ได้
    const provinces = await listProvinces();
    const near = await resolveSchoolProvince(provinces, {
      schoolCode: existing.ownerSchoolCode,
      enteredProvince: existing.state.unit.province,
      lat,
      lng,
    });

    const source = rawCenter.source === "unit" || rawCenter.source === "search" ? rawCenter.source : "map-pin";
    const draft: GisAnalysis = {
      center: {
        lat,
        lng,
        source,
        confirmedAt: now,
        nearestProvinceName: near?.name ?? "",
      },
      elevation: (body.elevation && typeof body.elevation === "object"
        ? (body.elevation as GisAnalysis["elevation"])
        : null),
      routes,
      autoScore: null,
      appliedToResponses: false,
      savedAt: now,
    };

    // ข้อสรุปพื้นที่ (จากการวาด polygon): ใช้ค่าที่ส่งมา ถ้าไม่ส่งมาก็คงของเดิมไว้ (ปุ่ม 2 ปุ่มไม่เขียนทับกัน)
    const incomingArea = cleanAreaSummary(body.areaSummary);
    if (incomingArea) draft.areaSummary = incomingArea;
    else if (existing.state.gis?.areaSummary) draft.areaSummary = existing.state.gis.areaSummary;

    // clamp แล้ว finalize จุดเดียว: provinceAvgElev → autoScore → communityClass
    const clamped = clampGisPayload(draft);
    if (!clamped) return NextResponse.json({ error: "ข้อมูล GIS ไม่ถูกต้อง" }, { status: 400 });

    const gis = finalizeGisAnalysis(clamped, {
      provinceAvgElev: near && Number.isFinite(near.avgElev) ? near.avgElev : null,
      calculatedAt: now,
    });

    // apply = นำค่าที่ derive ได้เขียนลง responses มิติ 3 → เอนจินคะแนนเดิมคิดต่อเองทั้งหมด (scoring v2)
    const derived = body.apply === true ? deriveD3Responses(gis) : null;
    const willApply = derived !== null && Object.keys(derived).length > 0;
    // การบันทึกแบบไม่ apply (เช่น ปุ่มส่งข้อสรุปพื้นที่) ต้องไม่ลบสถานะ "เคย apply แล้ว" ที่เคยตั้งไว้
    gis.appliedToResponses = willApply || existing.state.scoringVersion === "v2-gis";

    // เมื่อ apply คะแนน v2 และผู้ใช้ยังไม่ระบุลักษณะที่ตั้ง — แนะนำจาก GIS (ไม่ทับค่าที่มีอยู่)
    let unit = existing.state.unit;
    const syncedUnitLocation = syncUnitLocation && (!hasUnitCoords || (distanceFromUnitM ?? 0) > CENTER_SYNC_TOLERANCE_M);
    if (syncedUnitLocation) {
      unit = { ...unit, lat: lat.toFixed(6), lng: lng.toFixed(6) };
    }

    let suggestedSettingType: string | null = null;
    if (willApply && !unit.settingType) {
      const suggested = suggestSettingTypeFromGis(gis);
      if (suggested) {
        unit = { ...unit, settingType: suggested };
        suggestedSettingType = suggested;
      }
    }

    const nextState: AssessmentState = {
      ...existing.state,
      unit,
      gis,
      ...(willApply
        ? {
            responses: { ...existing.state.responses, ...derived },
            scoringVersion: "v2-gis" as const,
          }
        : {}),
    };

    const summary = await saveAssessment(id, nextState);
    if (!summary) return NextResponse.json({ error: "ไม่พบแบบประเมิน" }, { status: 404 });

    return NextResponse.json({
      gis,
      applied: willApply,
      summary,
      ...(droppedRoutes.length ? { droppedRoutes } : {}),
      ...(suggestedSettingType ? { suggestedSettingType } : {}),
      ...(syncedUnitLocation ? { syncedUnitLocation: true } : {}),
    });
  } catch (error) {
    console.error("[api] save gis analysis failed:", error);
    return NextResponse.json({ error: "บันทึกผลวิเคราะห์ไม่สำเร็จ" }, { status: 500 });
  }
}
