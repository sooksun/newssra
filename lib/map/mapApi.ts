// ชั้นเครือข่ายของแผนที่ 3 มิติ — รวม fetch ที่ CesiumMap ใช้ (OSRM route, /api/buildings, /api/provinces/nearest)
// ให้เป็นฟังก์ชันบริสุทธิ์ (ไม่มี React state) ที่ "โยน error เมื่อไม่สำเร็จ" — ผู้เรียกใน CesiumMap เป็นผู้จับ
// แล้วแสดงให้ผู้ใช้ผ่าน state error ของตัวเอง (routeErr / buildingsErr / ฯลฯ)
// แยกออกมาเพื่อลดขนาด CesiumMap.tsx และเลิกเขียนโค้ดเรียก OSRM ซ้ำสองที่

// OSRM host — ตั้งค่าได้ผ่าน NEXT_PUBLIC_OSRM_URL (เช่น instance ของตัวเองที่ self-host)
// ค่าเริ่มต้นคือ demo server สาธารณะ (ฟรี ไม่ต้องมี key แต่ไม่รับประกัน uptime ระดับ production
// — สำหรับใช้งานจริงควร self-host แล้วชี้มาที่ instance นั้น). ตัดผ่านฝั่ง client จึงต้อง NEXT_PUBLIC_*
const OSRM_BASE = (process.env.NEXT_PUBLIC_OSRM_URL || "https://router.project-osrm.org").replace(/\/+$/, "");
const OSRM_ROUTE_BASE = `${OSRM_BASE}/route/v1/driving`;

// host ของ OSRM ที่รัน profile "เดินเท้า" — ไม่มีค่าเริ่มต้นโดยเจตนา (ปิดฟีเจอร์ถ้าไม่ตั้ง)
//
// ทำไมไม่ default: โรงเรียนพื้นที่ห่างไกลจำนวนหนึ่งเข้าถึงได้ด้วยการ "ขับรถถึงปลายถนน แล้วเดินต่อ"
// ซึ่งต้องใช้กราฟเดินเท้าที่ profile รถมองไม่เห็น — แต่ instance สาธารณะที่ให้บริการ profile นี้
// (เช่น routing.openstreetmap.de) มีเงื่อนไขห้ามใช้งานระดับ production เหมือน OSRM demo
// จึงให้ผู้ดูแลชี้ไป instance ของตัวเองอย่างชัดแจ้ง แทนการแอบยิงบริการชุมชนโดยผู้ใช้ไม่รู้ตัว
//
// ⚠️ ระวัง: OSRM demo (router.project-osrm.org) ตอบ /route/v1/foot/ ด้วยกราฟรถคันเดิม — ดูเหมือนสำเร็จ
// แต่ค่าที่ได้ผิด (วัดจริงได้ 0.5 ม.) ห้ามชี้ค่านี้ไปที่ demo server เด็ดขาด
const OSRM_FOOT_BASE = (process.env.NEXT_PUBLIC_OSRM_FOOT_URL || "").trim().replace(/\/+$/, "");
const OSRM_FOOT_PROFILE = (process.env.NEXT_PUBLIC_OSRM_FOOT_PROFILE || "foot").trim();

/** เปิดใช้การต่อช่วงเดินเท้าได้หรือไม่ (ต้องตั้ง NEXT_PUBLIC_OSRM_FOOT_URL ก่อน) */
export function footRoutingEnabled(): boolean {
  return OSRM_FOOT_BASE.length > 0;
}

/** เพดานเวลารอต่อคำขอ — ปลายทางเป็นบริการภายนอก/เซิร์ฟเวอร์เองที่ไม่มี SLA ถ้าไม่มีเพดาน สปินเนอร์
 *  บนแผนที่จะหมุนค้างไม่รู้จบแทนที่จะแจ้ง error ให้ผู้ใช้กดลองใหม่ */
const OSRM_TIMEOUT_MS = 20_000;
const API_TIMEOUT_MS = 30_000; // /api/buildings อาจต้องนำเข้า quadkey ใหม่ในคำขอแรกของพื้นที่นั้น

/** รวม signal ของผู้เรียก (ยกเลิกเมื่อ effect ถูก cleanup) เข้ากับ timeout — ตัวใดมาก่อนชนะ
 *  ใช้ AbortSignal.any ที่มีใน browser สมัยใหม่ทุกตัวที่ Cesium รองรับอยู่แล้ว */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** เส้นทางหนึ่งเส้นจาก OSRM — coords เป็น [lng,lat][] ตามรูปแบบ GeoJSON */
export interface OsrmRoute {
  coords: [number, number][];
  distanceM: number;
  durationS: number;
  /**
   * ระยะที่ OSRM ย้ายจุดปลายทางที่เราขอ ไปเกาะถนนที่ใกล้ที่สุด (เมตร)
   *
   * สำคัญกับระบบนี้เป็นพิเศษ: โรงเรียนพื้นที่ห่างไกลบางแห่งไม่มีถนนเข้าถึงเลย OSRM จะ snap ไปไกลหลายกิโลเมตร
   * แล้วคืนเส้นทางที่ดู "สำเร็จ" ทั้งที่ไปจบคนละที่ ระยะ/เวลาที่ได้จึงไม่ใช่ของโรงเรียนแห่งนั้น
   * null = อ่านค่าไม่ได้จากคำตอบ (เช่น server ไม่ส่ง waypoints มา)
   */
  destSnapM: number | null;
  /** พิกัด [lng,lat] ของจุดที่เส้นทางไปจบจริง — ใช้เป็นจุดเริ่มของช่วงเดินเท้าเมื่อรถไปไม่ถึงโรงเรียน */
  destSnapLngLat: [number, number] | null;
}

interface OsrmResponse {
  code?: string;
  routes?: { geometry: { coordinates: [number, number][] }; distance: number; duration: number }[];
  waypoints?: { distance?: number; location?: [number, number] }[];
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
  const res = await fetch(url, { signal: withTimeout(opts.signal, OSRM_TIMEOUT_MS) });
  // ต้องเช็คสถานะก่อน .json(): เซิร์ฟเวอร์เส้นทางที่ throttle/ล่มมักตอบ HTML (502/503) ซึ่งจะกลายเป็น
  // SyntaxError ที่อ่านไม่รู้เรื่องแทนข้อความบอกสาเหตุจริง
  if (!res.ok) throw new Error(`เซิร์ฟเวอร์เส้นทางตอบกลับสถานะ ${res.status}`);
  let data: OsrmResponse;
  try {
    data = (await res.json()) as OsrmResponse;
  } catch {
    throw new Error("เซิร์ฟเวอร์เส้นทางตอบกลับรูปแบบที่อ่านไม่ได้");
  }
  const routes = data.routes ?? [];
  if (data.code !== "Ok" || routes.length === 0) {
    throw new Error("ไม่พบเส้นทางรถยนต์");
  }
  // waypoint สุดท้าย = ปลายทางที่เราขอ (โรงเรียน) — ระยะของมันคือระยะที่ OSRM ย้ายจุดไปเกาะถนน
  // ค่านี้เท่ากันทุกเส้นทางในคำตอบเดียวกัน เพราะ waypoint เป็นของคำขอ ไม่ใช่ของแต่ละเส้นทาง
  const waypoints = data.waypoints ?? [];
  const last = waypoints.length > 0 ? waypoints[waypoints.length - 1] : undefined;
  const destSnap = last?.distance;
  const destSnapM = typeof destSnap === "number" && Number.isFinite(destSnap) ? destSnap : null;
  const loc = last?.location;
  const destSnapLngLat: [number, number] | null =
    Array.isArray(loc) && loc.length >= 2 && Number.isFinite(loc[0]) && Number.isFinite(loc[1])
      ? [loc[0], loc[1]]
      : null;
  return routes.map((r) => ({
    coords: r.geometry.coordinates,
    distanceM: r.distance,
    durationS: r.duration,
    destSnapM,
    destSnapLngLat,
  }));
}

/** ช่วงเดินเท้าต่อท้ายเส้นทางรถ — จากจุดที่ถนนไปสุด ถึงตัวโรงเรียน */
export interface FootLeg {
  coords: [number, number][];
  distanceM: number;
  durationS: number;
  /** ระยะที่กราฟเดินเท้า snap ปลายทางไปจากโรงเรียน — บอกว่า "เดินถึงจริงไหม" */
  destSnapM: number | null;
}

/**
 * หาเส้นทางเดินเท้าจากจุดปลายถนน → โรงเรียน
 *
 * คืน null เมื่อยังไม่ได้ตั้งค่า host เดินเท้า หรือหาเส้นทางไม่ได้ — ตั้งใจไม่โยน error เพราะนี่เป็น
 * ข้อมูลเสริม การหาไม่เจอต้องไม่ทำให้เส้นทางรถที่ได้มาแล้วใช้ไม่ได้ไปด้วย
 */
export async function fetchFootLeg(
  fromLng: number,
  fromLat: number,
  toLng: number,
  toLat: number,
  signal?: AbortSignal,
): Promise<FootLeg | null> {
  if (!footRoutingEnabled()) return null;
  const url =
    `${OSRM_FOOT_BASE}/route/v1/${OSRM_FOOT_PROFILE}/${fromLng},${fromLat};${toLng},${toLat}` +
    `?overview=full&geometries=geojson&steps=false`;
  try {
    const res = await fetch(url, { signal: withTimeout(signal, OSRM_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = (await res.json()) as OsrmResponse;
    const route = (data.routes ?? [])[0];
    if (data.code !== "Ok" || !route) return null;
    const last = (data.waypoints ?? []).slice(-1)[0];
    const snap = last?.distance;
    return {
      coords: route.geometry.coordinates,
      distanceM: route.distance,
      durationS: route.duration,
      destSnapM: typeof snap === "number" && Number.isFinite(snap) ? snap : null,
    };
  } catch {
    return null;
  }
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
  const polyParam = polygon.length >= 3 ? `&poly=${polygon.map(([la, ln]) => `${la},${ln}`).join(",")}` : "";
  const res = await fetch(`/api/buildings?lat=${lat}&lng=${lng}&radius=${radiusM}${ringsParam}${polyParam}`, {
    signal: withTimeout(signal, API_TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as {
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
  const res = await fetch(`/api/provinces/nearest?lat=${lat}&lng=${lng}${assessmentParam}${provinceParam}`, {
    signal: withTimeout(opts.signal, API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error("หาจังหวัดที่ใกล้ที่สุดไม่สำเร็จ");
  const data = (await res.json()) as NearestProvinceResult;
  return { province: data.province ?? null, householdSize: data.householdSize ?? null };
}
