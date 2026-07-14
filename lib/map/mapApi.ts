// ชั้นเครือข่ายของแผนที่ 3 มิติ — รวม fetch ที่ CesiumMap ใช้ (OSRM route, /api/buildings, /api/provinces/nearest)
// ให้เป็นฟังก์ชันบริสุทธิ์ (ไม่มี React state) ที่ "โยน error เมื่อไม่สำเร็จ" — ผู้เรียกใน CesiumMap เป็นผู้จับ
// แล้วแสดงให้ผู้ใช้ผ่าน state error ของตัวเอง (routeErr / buildingsErr / ฯลฯ)
// แยกออกมาเพื่อลดขนาด CesiumMap.tsx และเลิกเขียนโค้ดเรียก OSRM ซ้ำสองที่

const OSRM_ROUTE_BASE = "https://router.project-osrm.org/route/v1/driving";

/** เส้นทางหนึ่งเส้นจาก OSRM — coords เป็น [lng,lat][] ตามรูปแบบ GeoJSON */
export interface OsrmRoute {
  coords: [number, number][];
  distanceM: number;
  durationS: number;
}

interface OsrmResponse {
  code?: string;
  routes?: { geometry: { coordinates: [number, number][] }; distance: number; duration: number }[];
}

/**
 * ดึงเส้นทางรถยนต์ OSRM จาก (fromLng,fromLat) → (toLng,toLat)
 * ตั้ง alternatives > 1 เพื่อขอเส้นทางสำรอง; คืนอย่างน้อย 1 เส้น หรือโยน Error เมื่อหาเส้นทางไม่ได้
 * (OSRM demo server สาธารณะ ฟรี ไม่ต้องมี key — ไม่รับประกัน uptime ระดับ production ใช้ประกอบการแสดงผลเท่านั้น)
 */
export async function fetchOsrmRoutes(
  fromLng: number,
  fromLat: number,
  toLng: number,
  toLat: number,
  opts: { alternatives?: number; signal?: AbortSignal } = {},
): Promise<OsrmRoute[]> {
  const alt = opts.alternatives && opts.alternatives > 1 ? `&alternatives=${opts.alternatives}` : "";
  const url = `${OSRM_ROUTE_BASE}/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson&steps=false${alt}`;
  const res = await fetch(url, opts.signal ? { signal: opts.signal } : {});
  const data = (await res.json()) as OsrmResponse;
  const routes = data.routes ?? [];
  if (data.code !== "Ok" || routes.length === 0) {
    throw new Error("ไม่พบเส้นทางรถยนต์");
  }
  return routes.map((r) => ({ coords: r.geometry.coordinates, distanceM: r.distance, durationS: r.duration }));
}

export interface BuildingFeature {
  lat: number;
  lng: number;
  ring: [number, number][];
}

export interface BuildingsResult {
  features: BuildingFeature[];
  truncated: boolean;
  /** จำนวนอาคารสะสมในแต่ละรัศมีที่ขอผ่าน ringRadiiM (ว่างถ้าไม่ได้ขอ) — นับก่อนตัดจำนวน features */
  ringCounts: { radiusM: number; buildingCount: number }[];
  /** จำนวนอาคารในรูปที่วาด (นับฝั่ง server จากชุดเต็ม ไม่ถูกตัดด้วยลิมิต features); null = ไม่ได้ส่ง polygon */
  polygonCount: number | null;
}

/** ดึงผังอาคารรอบพิกัด (รัศมีเมตร) จาก /api/buildings — โยน Error เมื่อ server ตอบ error หรือไม่มี features
 *  ส่ง ringRadiiM เพื่อขอจำนวนอาคารสะสมต่อวงรัศมี (เช่น [500,1000,1500]) มาพร้อมกันในคำขอเดียว
 *  ส่ง polygon ([lat,lng][]) เพื่อให้ server นับอาคารในรูปจากชุดเต็ม (แม่นในพื้นที่หนาแน่นที่อาคารเกินลิมิต render) */
export async function fetchBuildings(
  lat: number,
  lng: number,
  radiusM: number,
  signal?: AbortSignal,
  ringRadiiM: number[] = [],
  polygon: [number, number][] = [],
): Promise<BuildingsResult> {
  const ringsParam = ringRadiiM.length ? `&rings=${ringRadiiM.join(",")}` : "";
  const polyParam =
    polygon.length >= 3 ? `&poly=${polygon.map(([la, ln]) => `${la},${ln}`).join(",")}` : "";
  const res = await fetch(
    `/api/buildings?lat=${lat}&lng=${lng}&radius=${radiusM}${ringsParam}${polyParam}`,
    signal ? { signal } : {},
  );
  const data = (await res.json()) as {
    error?: string;
    features?: BuildingFeature[];
    truncated?: boolean;
    ringCounts?: { radiusM: number; buildingCount: number }[];
    polygonCount?: number | null;
  };
  if (data.error || !data.features) {
    throw new Error(data.error ?? "โหลดข้อมูลผังอาคารไม่สำเร็จ");
  }
  return {
    features: data.features,
    truncated: Boolean(data.truncated),
    ringCounts: data.ringCounts ?? [],
    polygonCount: data.polygonCount ?? null,
  };
}

/** จังหวัด (ศาลากลาง) ที่ใกล้พิกัดที่สุด — โครงตรงกับ MapProvince ใน CesiumMap (ใช้แบบ structural typing) */
export interface NearestProvince {
  name: string;
  lat: number;
  lng: number;
  avgElev: number;
}

export interface NearestProvinceResult {
  province: NearestProvince | null;
  householdSize: number | null;
}

/** หาจังหวัดของพิกัด + ขนาดครัวเรือนเฉลี่ย จาก /api/provinces/nearest — โยน Error เมื่อ !ok
 *  - provinceHint: ชื่อจังหวัดของจุดนั้นจาก geocode/reverse-geocode (ถ้ามี) → server ใช้ก่อนเป็นอันดับแรก
 *    เพื่อให้จังหวัด "ตามตำแหน่งที่ค้น/ลากไป" จริง ไม่ใช่ยึดจังหวัดของโรงเรียนที่ล็อกอินอยู่
 *  - assessmentId: โหมดวิเคราะห์แบบประเมิน → fallback จับจากทะเบียนโรงเรียนเจ้าของ (แม่นกว่าศาลากลางใกล้สุด) */
export async function fetchNearestProvince(
  lat: number,
  lng: number,
  opts: { assessmentId?: number; provinceHint?: string; signal?: AbortSignal } = {},
): Promise<NearestProvinceResult> {
  const assessmentParam = opts.assessmentId ? `&assessment=${opts.assessmentId}` : "";
  const provinceParam = opts.provinceHint ? `&province=${encodeURIComponent(opts.provinceHint)}` : "";
  const res = await fetch(
    `/api/provinces/nearest?lat=${lat}&lng=${lng}${assessmentParam}${provinceParam}`,
    opts.signal ? { signal: opts.signal } : {},
  );
  if (!res.ok) throw new Error("หาจังหวัดที่ใกล้ที่สุดไม่สำเร็จ");
  const data = (await res.json()) as NearestProvinceResult;
  return { province: data.province ?? null, householdSize: data.householdSize ?? null };
}
