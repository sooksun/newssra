export type LngLat = [number, number];

export interface ThaiSharedBorder {
  name: string;
  nameTh: string;
  label: LngLat;
  chains: LngLat[][];
  pointCount: number;
}

export interface SharedBordersDoc {
  attribution: string;
  borders: ThaiSharedBorder[];
}

const BORDER_ORDER = ["Myanmar", "Laos", "Cambodia", "Malaysia"];

/**
 * แนวชายแดนถูกคำนวณไว้ล่วงหน้าโดย `scripts/fetch-borders.mjs` (ดึงจาก OpenStreetMap
 * ผ่าน Overpass API แล้วลดรูป) ฟังก์ชันนี้จึงมีหน้าที่แค่ตรวจความถูกต้องของไฟล์ที่โหลดมา
 * — ทิ้งพิกัดที่ไม่ใช่ตัวเลขจำกัด และเส้นที่สั้นเกินกว่าจะวาดได้ เพื่อไม่ให้ Cesium พังกลางทาง
 */
export function parseSharedBorders(raw: unknown): SharedBordersDoc {
  const doc = (raw ?? {}) as Record<string, unknown>;
  const attribution = typeof doc.attribution === "string" ? doc.attribution : "";
  const list = Array.isArray(doc.borders) ? doc.borders : [];

  const borders = list.flatMap((entry): ThaiSharedBorder[] => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name : "";
    const nameTh = typeof item.nameTh === "string" ? item.nameTh : name;
    const label = toLngLat(item.label);
    if (!name || !label) return [];

    const chains = (Array.isArray(item.chains) ? item.chains : []).flatMap(
      (chain): LngLat[][] => {
        const points = (Array.isArray(chain) ? chain : [])
          .map(toLngLat)
          .filter((point): point is LngLat => point !== null);
        return points.length >= 2 ? [points] : [];
      },
    );
    if (chains.length === 0) return [];

    return [
      {
        name,
        nameTh,
        label,
        chains,
        pointCount: chains.reduce((sum, chain) => sum + chain.length, 0),
      },
    ];
  });

  borders.sort((a, b) => {
    const ai = BORDER_ORDER.indexOf(a.name);
    const bi = BORDER_ORDER.indexOf(b.name);
    if (ai !== -1 || bi !== -1) {
      return (
        (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi)
      );
    }
    return a.name.localeCompare(b.name);
  });

  return { attribution, borders };
}

function toLngLat(raw: unknown): LngLat | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const lng = Number(raw[0]);
  const lat = Number(raw[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return [lng, lat];
}
