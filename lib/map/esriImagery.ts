export const ESRI_WORLD_IMAGERY_BASE_URL =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";
export const ESRI_WORLD_IMAGERY_TILE_URL = `${ESRI_WORLD_IMAGERY_BASE_URL}/tile/{z}/{y}/{x}`;
export const ESRI_MAX_REQUEST_LEVEL = 20;
export const ESRI_MIN_PROBE_LEVEL = 14;

export interface EsriImageryAvailability {
  status: "ready" | "unknown";
  maxAvailableLevel: number | null;
  checkedLevels: number[];
}

function webMercatorTile(lat: number, lng: number, level: number) {
  const n = 2 ** level;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

async function hasEsriTile(level: number, lat: number, lng: number, signal?: AbortSignal): Promise<boolean | null> {
  const { x, y } = webMercatorTile(lat, lng, level);
  const url = `${ESRI_WORLD_IMAGERY_BASE_URL}/tilemap/${level}/${y}/${x}/1/1?f=json`;
  const response = await fetch(url, { signal, cache: "force-cache" });
  if (!response.ok) return null;
  const body = (await response.json()) as { data?: number[]; valid?: boolean };
  if (body.valid === false || !Array.isArray(body.data) || body.data.length === 0) return null;
  return body.data.some((value) => value === 1);
}

export async function probeEsriImageryAvailability(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<EsriImageryAvailability> {
  const checkedLevels: number[] = [];

  try {
    for (let level = ESRI_MAX_REQUEST_LEVEL; level >= ESRI_MIN_PROBE_LEVEL; level--) {
      checkedLevels.push(level);
      const available = await hasEsriTile(level, lat, lng, signal);
      if (available === true) return { status: "ready", maxAvailableLevel: level, checkedLevels };
    }
    return { status: "ready", maxAvailableLevel: null, checkedLevels };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { status: "unknown", maxAvailableLevel: null, checkedLevels };
  }
}
