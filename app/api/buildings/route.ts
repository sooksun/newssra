import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { buildingsRateLimiter } from "@/lib/rate-limit";
import { fetchBuildingFootprints } from "@/lib/map/msBuildings";

export const dynamic = "force-dynamic";

const DEFAULT_RADIUS_M = 2000;
const MAX_RADIUS_M = 5000;
const MAX_POLY_VERTICES = 2000; // กัน poly ยักษ์ที่ทำ pointInPolygon ทำงานหนักเกินเหตุ

// กรอบประเทศไทย (เผื่อขอบ) — ข้อมูลผังอาคารที่ระบบใช้ครอบคลุมเฉพาะไทย พิกัดนอกกรอบนี้ปฏิเสธทันที
// กันการไล่พิกัดทั่วโลกเพื่อกระตุ้นการนำเข้า quadkey ใหม่โดยไม่จำเป็น
const TH_LAT_MIN = 5.0;
const TH_LAT_MAX = 21.0;
const TH_LNG_MIN = 97.0;
const TH_LNG_MAX = 106.0;

function inThailand(lat: number, lng: number): boolean {
  return lat >= TH_LAT_MIN && lat <= TH_LAT_MAX && lng >= TH_LNG_MIN && lng <= TH_LNG_MAX;
}

// ผังอาคาร (Microsoft Global ML Building Footprints) รอบพิกัดที่ระบุ — ใช้ประกอบแผนที่ 3 มิติ
// v2: ตอบจากตาราง map_buildings ใน MySQL (~ร้อย ms) — quadkey ที่ยังไม่เคยนำเข้าจ่ายราคาสตรีมครั้งเดียวตลอดชีพ
// (pre-warm ทั้งประเทศ: npm run buildings:import) — ดู lib/map/msBuildings.ts
export async function GET(request: NextRequest) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  // จำกัดอัตราต่อผู้ใช้ — กันการกระตุ้นการนำเข้า quadkey ใหม่รัว ๆ (ดู buildingsRateLimiter)
  const rlKey = `buildings:${guard.user.uid}`;
  const status = buildingsRateLimiter.check(rlKey);
  if (status.blocked) {
    return NextResponse.json(
      { error: "เรียกข้อมูลผังอาคารถี่เกินไป กรุณารอสักครู่" },
      { status: 429, headers: { "Retry-After": String(status.retryAfterSec) } },
    );
  }
  buildingsRateLimiter.fail(rlKey); // นับคำขอนี้เข้าโควตา

  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const radiusParam = Number(searchParams.get("radius"));
  const radius = Math.min(
    Number.isFinite(radiusParam) && radiusParam > 0 ? radiusParam : DEFAULT_RADIUS_M,
    MAX_RADIUS_M,
  );
  // รัศมีที่ต้องการนับจำนวนอาคารสะสม (สำหรับตารางประมาณประชากร) — เช่น "500,1000,1500,2000"
  const ringRadiiM = (searchParams.get("rings") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= radius);

  // ขอบเขตรูปที่ผู้ใช้วาด (นับอาคารในรูปให้แม่นจากชุดเต็ม ฝั่ง server) — flat "lat,lng,lat,lng,…"
  const polyNums = (searchParams.get("poly") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  const polygon: [number, number][] = [];
  for (let i = 0; i + 1 < polyNums.length && polygon.length < MAX_POLY_VERTICES; i += 2) {
    const plat = polyNums[i];
    const plng = polyNums[i + 1];
    if (plat >= -90 && plat <= 90 && plng >= -180 && plng <= 180) polygon.push([plat, plng]);
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "พิกัดไม่ถูกต้อง" }, { status: 400 });
  }
  if (!inThailand(lat, lng)) {
    return NextResponse.json({ error: "พิกัดอยู่นอกขอบเขตประเทศไทย" }, { status: 400 });
  }

  try {
    const result = await fetchBuildingFootprints(lat, lng, radius, ringRadiiM, polygon);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api] buildings fetch failed:", error);
    return NextResponse.json({ error: "โหลดข้อมูลผังอาคารไม่สำเร็จ" }, { status: 502 });
  }
}
