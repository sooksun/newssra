// ── ค้นหาสถานที่ (client-side) — พอร์ตจากโปรเจกต์ geotech ──────────────────────
// ที่มา: D:\laragon\www\geotech\client\src\lib\{googleMaps,mapServices}.ts
// ใช้ Google Places Autocomplete (JS SDK) แสดงรายการผลลัพธ์ให้เลือก แล้วค่อยแปลง
// place_id → พิกัดตอนผู้ใช้เลือก (แม่นกว่าการ geocode คำเดียวแบบเดิม) — fallback เป็น Nominatim
// ทำงานฝั่งเบราว์เซอร์ล้วน (Nominatim รองรับ CORS) จึงไม่ต้องมี server route
// แปลงจาก Vite: import.meta.env.VITE_GOOGLE_MAPS_API_KEY → process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

// ── typings ขั้นต่ำของ Google Maps JS SDK เท่าที่ใช้ (เลี่ยงการเพิ่ม dep @types/google.maps) ──
type LatLngFns = { lat: () => number; lng: () => number };
interface AutocompletePrediction {
  description: string;
  place_id: string;
}
interface AutocompleteService {
  getPlacePredictions(
    request: { input: string; language?: string; componentRestrictions?: { country: string } },
    callback: (predictions: AutocompletePrediction[] | null, status: string) => void,
  ): void;
}
interface AddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}
interface GeocoderResult {
  geometry: { location: LatLngFns };
  address_components?: AddressComponent[];
}
interface Geocoder {
  geocode(request: { placeId?: string; address?: string }): Promise<{ results: GeocoderResult[] }>;
}
interface GoogleMapsApi {
  maps: {
    places: {
      AutocompleteService: new () => AutocompleteService;
      PlacesServiceStatus: { OK: string };
    };
    Geocoder: new () => Geocoder;
  };
}

declare global {
  interface Window {
    google?: GoogleMapsApi;
  }
}

// ── ตัวโหลด Google Maps JavaScript API แบบ singleton (โหลดสคริปต์ครั้งเดียวต่อหน้า) ──
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const CALLBACK_NAME = "__newssraGoogleMapsReady";
let loaderPromise: Promise<GoogleMapsApi> | null = null;

export function isGoogleMapsConfigured(): boolean {
  return Boolean(API_KEY && API_KEY.trim());
}

export function loadGoogleMaps(): Promise<GoogleMapsApi> {
  if (!API_KEY || !API_KEY.trim()) {
    return Promise.reject(new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ยังไม่ได้ตั้งค่า"));
  }
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps โหลดได้เฉพาะฝั่งเบราว์เซอร์"));
  }
  if (window.google?.maps) {
    return Promise.resolve(window.google);
  }
  if (loaderPromise) return loaderPromise;

  const promise: Promise<GoogleMapsApi> = new Promise((resolve, reject) => {
    (window as unknown as Record<string, () => void>)[CALLBACK_NAME] = () => {
      if (window.google?.maps) resolve(window.google);
      else reject(new Error("Google Maps SDK โหลดไม่สำเร็จ"));
    };
    const script = document.createElement("script");
    const params = new URLSearchParams({
      key: API_KEY.trim(),
      libraries: "places,geometry",
      language: "th",
      region: "TH",
      callback: CALLBACK_NAME,
      loading: "async",
      v: "weekly",
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () =>
      reject(new Error("โหลด Google Maps script ไม่สำเร็จ (ตรวจสอบเครือข่ายหรือ API key)"));
    document.head.appendChild(script);
  });

  loaderPromise = promise.catch((error: Error) => {
    loaderPromise = null; // ให้ลองใหม่ได้ในครั้งถัดไป
    throw error;
  });
  return loaderPromise;
}

// ── ค้นหาสถานที่ (Google Places autocomplete → Nominatim fallback) ────────────
export interface PlaceHit {
  name: string;
  lat: number;
  lng: number;
  placeId?: string;
  /** ชื่อจังหวัดจาก address components ของผลค้นหา (ถ้ามี) — ใช้จับคู่จังหวัดของจุดที่ค้นเจอให้ตรงตำแหน่งจริง */
  province?: string;
}

let googleGeocoderAvailable = true; // ปิดถาวรเมื่อพบว่า key/สิทธิ์ใช้ไม่ได้ (REQUEST_DENIED ฯลฯ)

async function autocompleteGoogle(gmaps: GoogleMapsApi, q: string): Promise<PlaceHit[]> {
  const svc = new gmaps.maps.places.AutocompleteService();
  const preds = await new Promise<AutocompletePrediction[]>((resolve, reject) => {
    svc.getPlacePredictions(
      { input: q, language: "th", componentRestrictions: { country: "th" } },
      (p, status) => {
        if (status === gmaps.maps.places.PlacesServiceStatus.OK && p) resolve(p);
        else reject(new Error(String(status)));
      },
    );
  });
  // ยังไม่มีพิกัด (lat/lng = NaN) — จะแปลงจาก place_id ตอนผู้ใช้เลือก
  return preds.slice(0, 6).map((p) => ({ name: p.description, lat: NaN, lng: NaN, placeId: p.place_id }));
}

// ดึงชื่อจังหวัดจาก address components ของ Google (administrative_area_level_1) — language=th → คืนชื่อไทย
function googleProvince(components?: AddressComponent[]): string | undefined {
  const p = components?.find((c) => c.types.includes("administrative_area_level_1"));
  return p?.long_name;
}

async function resolvePlaceId(
  gmaps: GoogleMapsApi,
  placeId: string,
): Promise<{ lat: number; lng: number; province?: string }> {
  const geocoder = new gmaps.maps.Geocoder();
  const { results } = await geocoder.geocode({ placeId });
  const loc = results[0].geometry.location;
  return { lat: loc.lat(), lng: loc.lng(), province: googleProvince(results[0].address_components) };
}

interface NominatimAddress {
  province?: string;
  state?: string;
}
function nominatimProvince(addr?: NominatimAddress): string | undefined {
  return addr?.province || addr?.state || undefined;
}

export async function geocodeNominatim(q: string): Promise<PlaceHit[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&accept-language=th&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const data = (await res.json()) as Array<{ display_name: string; lat: string; lon: string; address?: NominatimAddress }>;
  return data.map((d) => ({
    name: d.display_name,
    lat: Number(d.lat),
    lng: Number(d.lon),
    province: nominatimProvince(d.address),
  }));
}

/** จังหวัดของพิกัดใด ๆ จาก Nominatim reverse geocoding (keyless, CORS) — คืน null ถ้าหาไม่ได้ (ใช้ตอนลากหมุด) */
export async function reverseProvince(lat: number, lng: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&accept-language=th&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as { address?: NominatimAddress };
    return nominatimProvince(data.address) ?? null;
  } catch {
    return null;
  }
}

// ค้นหา: ลอง Google ก่อน (แม่นกว่า) ไม่ได้ค่อย Nominatim — คืนผลลัพธ์ + แหล่งที่ใช้
export async function searchPlaces(q: string): Promise<{ results: PlaceHit[]; source: string }> {
  if (q.trim().length < 3) return { results: [], source: "Google Maps" };
  let results: PlaceHit[] = [];
  let source = "Google Maps";
  if (googleGeocoderAvailable && isGoogleMapsConfigured()) {
    try {
      const gmaps = await loadGoogleMaps();
      results = await autocompleteGoogle(gmaps, q);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("REQUEST_DENIED") || msg.includes("ApiNotActivated") || msg.includes("not authorized")) {
        googleGeocoderAvailable = false;
      }
      results = [];
    }
  }
  if (results.length === 0) {
    results = await geocodeNominatim(q);
    source = "OpenStreetMap";
  }
  return { results, source };
}

// เลือกผลลัพธ์ → คืนพิกัด + จังหวัด (แปลง place_id ถ้าจำเป็น)
export async function resolvePlaceHit(r: PlaceHit): Promise<{ lat: number; lng: number; province?: string } | null> {
  let lat = r.lat;
  let lng = r.lng;
  let province = r.province;
  if (r.placeId && (!Number.isFinite(lat) || !Number.isFinite(lng))) {
    try {
      const gmaps = await loadGoogleMaps();
      const resolved = await resolvePlaceId(gmaps, r.placeId);
      lat = resolved.lat;
      lng = resolved.lng;
      province = resolved.province ?? province;
    } catch {
      const hit = (await geocodeNominatim(r.name))[0];
      if (hit) {
        lat = hit.lat;
        lng = hit.lng;
        province = hit.province ?? province;
      }
    }
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, province };
}
