import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { buildForestAnalysis, type ForestLegalLayer } from "@/lib/forest-layers";
import { computeForestStatusLayer, forestTypeAtPoint } from "@/lib/map/forest-status";
import { loadForestStatusAround } from "@/lib/map/forest-status-load";
import { forestTypeLayerFromCode } from "@/lib/map/forest-type";

export const dynamic = "force-dynamic";

const TH_LAT_MIN = 5.0;
const TH_LAT_MAX = 21.0;
const TH_LNG_MIN = 97.0;
const TH_LNG_MAX = 106.0;

/**
 * GET /api/forest-status?lat=&lng=
 * คำนวณชั้นจาก data/forest-status/cells (ถ้ามี)
 * ชุดที่ติดตั้งจาก RFD NRF = แนวเขตป่าสงวน (กฎหมาย) — ระบุ layerRole ชัด
 */
export async function GET(request: NextRequest) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const sp = request.nextUrl.searchParams;
  const lat = Number(sp.get("lat"));
  const lng = Number(sp.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "ต้องระบุ lat,lng" }, { status: 400 });
  }
  if (lat < TH_LAT_MIN || lat > TH_LAT_MAX || lng < TH_LNG_MIN || lng > TH_LNG_MAX) {
    return NextResponse.json({ error: "พิกัดนอกประเทศไทย" }, { status: 400 });
  }

  // โหลดสองชั้นแยกกัน — คนละความหมาย ห้ามรวม polygon เข้าด้วยกัน
  //   สภาพป่าจริง (rfd-forest-cover) = "ตอนนี้เป็นป่าไหม"
  //   แนวเขตป่าสงวน (rfd-national-reserved-forest) = "อยู่ในเขตประกาศตามกฎหมายไหม"
  const [coverDoc, legalDoc] = await Promise.all([
    loadForestStatusAround(lat, lng, 5_000, { authority: "rfd-forest-cover" }),
    loadForestStatusAround(lat, lng, 5_000, { authority: "rfd-national-reserved-forest" }),
  ]);
  const doc = coverDoc ?? legalDoc;
  if (!doc) {
    return NextResponse.json({
      available: false,
      status: null,
      type: null,
      legal: null,
      forestAnalysis: null,
      message:
        "ยังไม่มีชั้นป่าใน data/forest-status — รัน scripts/install-rfd-forest-cover.py (สภาพป่า) " +
        "และ scripts/install-rfd-nrf.py (แนวเขตป่าสงวน) หลังดาวน์โหลด shapefile กรมป่าไม้",
    });
  }

  // ชั้น A มาจากชุดสภาพป่าจริงเสมอเมื่อมี — ถ้ายังไม่ได้ติดตั้ง ค่อยถอยไปใช้แนวเขตกฎหมาย
  const status = computeForestStatusLayer(lat, lng, doc);
  const at = forestTypeAtPoint(lat, lng, doc.features);
  const type =
    doc.authority === "rfd-forest-cover"
      ? forestTypeLayerFromCode(at?.typeCode, at?.typeLabelTh, {
          dataSource: doc.dataSource,
          attribution: doc.attribution,
        })
      : null;

  // แนวเขตป่าสงวน RFD → legal authoritative (คำนวณจากชุดกฎหมายโดยตรง ไม่ใช่จากชั้นสภาพป่า)
  const legalStatus = legalDoc ? computeForestStatusLayer(lat, lng, legalDoc) : null;
  const legalAt = legalDoc ? forestTypeAtPoint(lat, lng, legalDoc.features) : null;
  let legal: ForestLegalLayer | null = null;
  if (legalDoc && legalStatus) {
    const status = legalStatus;
    const at = legalAt;
    const inside = status.inside === 1;
    legal = {
      inside: status.inside,
      distanceM: status.distanceM,
      protectedArea: 0,
      reserveForest: inside ? 1 : 0,
      zones:
        inside && at?.typeLabelTh
          ? [
              {
                name: at.typeLabelTh,
                kind: "national_reserved_forest",
                relation: "in",
                distanceM: 0,
              },
            ]
          : status.distanceM !== null && status.distanceM <= 1000
            ? [
                {
                  name: at?.typeLabelTh || "ป่าสงวนแห่งชาติ (ใกล้เคียง)",
                  kind: "national_reserved_forest",
                  relation: "near" as const,
                  distanceM: status.distanceM,
                },
              ]
            : [],
      authority: "authoritative",
      dataSource: legalDoc.dataSource,
      attribution: legalDoc.attribution,
    };
  }

  const forestAnalysis = buildForestAnalysis({
    status,
    type,
    legal,
    calculatedAt: new Date().toISOString(),
  });

  return NextResponse.json({
    available: true,
    status,
    type,
    legal,
    forestAnalysis,
    yearBe: doc.yearBe,
    layerRole: doc.layerRole ?? null,
    authority: doc.authority,
    attribution: doc.attribution,
    note:
      doc.authority === "rfd-national-reserved-forest"
        ? "ยังไม่ได้ติดตั้งชั้นสภาพพื้นที่ป่าจริง — ค่าสถานภาพด้านบนมาจากแนวเขตป่าสงวนแห่งชาติ (กฎหมายโดยประมาณ)"
        : null,
  });
}
