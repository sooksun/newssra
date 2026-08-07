import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { boxAround, featuresInBox } from "@/lib/map/forest-polygons";
import { loadForestStatusAround } from "@/lib/map/forest-status-load";

export const dynamic = "force-dynamic";

const TH_LAT_MIN = 5.0;
const TH_LAT_MAX = 21.0;
const TH_LNG_MIN = 97.0;
const TH_LNG_MAX = 106.0;

const RADIUS_MIN_M = 1_000;
const RADIUS_MAX_M = 10_000;
const RADIUS_DEFAULT_M = 10_000;

/**
 * GET /api/forest-status/polygons?lat=&lng=&radius=
 * geometry ของชั้น "สภาพพื้นที่ป่าจริง" (rfd-forest-cover) สำหรับวาดบนแผนที่เท่านั้น
 *
 * แยกจาก /api/forest-status ตั้งใจ: route นั้นถูกเรียกทุกครั้งที่ย้ายหมุด
 * ถ้ายัด geometry รวมเข้าไป payload จะบวมทุกครั้งแม้ผู้ใช้ไม่ได้เปิดชั้นนี้
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

  const radiusRaw = Number(sp.get("radius"));
  const radiusM = Number.isFinite(radiusRaw)
    ? Math.min(RADIUS_MAX_M, Math.max(RADIUS_MIN_M, radiusRaw))
    : RADIUS_DEFAULT_M;

  const doc = await loadForestStatusAround(lat, lng, radiusM, { authority: "rfd-forest-cover" });
  if (!doc) {
    // ไม่ได้ติดตั้งชุดข้อมูล — ตอบเป็นสถานะ ไม่ใช่ error เพื่อให้ชั้นอื่นบนแผนที่ทำงานต่อได้
    return NextResponse.json({
      available: false,
      features: [],
      message:
        "ยังไม่ได้ติดตั้งชั้นสภาพพื้นที่ป่า — รัน scripts/install-rfd-forest-cover.py (ดู data/forest-status/README.md)",
    });
  }

  const features = featuresInBox(doc.features, boxAround(lat, lng, radiusM));

  return NextResponse.json({
    available: true,
    yearBe: doc.yearBe,
    attribution: doc.attribution,
    dataSource: doc.dataSource,
    radiusM,
    features,
  });
}
