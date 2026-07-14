export type LngLat = [number, number];

export interface BorderCountry {
  name: string;
  nameTh: string;
  isThailand: boolean;
  label: LngLat;
  rings: LngLat[][];
}

export interface ThaiSharedBorder {
  name: string;
  nameTh: string;
  label: LngLat;
  chains: LngLat[][];
  segmentCount: number;
}

interface ThaiSegment {
  ringIndex: number;
  pointIndex: number;
  a: LngLat;
  b: LngLat;
}

const BORDER_ORDER = ["Myanmar", "Laos", "Cambodia", "Malaysia"];

function coordKey([lng, lat]: LngLat): string {
  return `${lng.toFixed(6)},${lat.toFixed(6)}`;
}

function normalizedSegmentKey(a: LngLat, b: LngLat): string {
  const ka = coordKey(a);
  const kb = coordKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function isValidCoord(point: LngLat): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function isValidSegment(a: LngLat, b: LngLat): boolean {
  return isValidCoord(a) && isValidCoord(b) && (a[0] !== b[0] || a[1] !== b[1]);
}

function chainThaiSegments(segments: ThaiSegment[]): LngLat[][] {
  const chains: LngLat[][] = [];
  let current: LngLat[] = [];
  let currentRing = -1;
  let nextIndex = -1;

  const flush = () => {
    if (current.length >= 2) chains.push(current);
    current = [];
  };

  for (const segment of segments) {
    const continues = segment.ringIndex === currentRing && segment.pointIndex === nextIndex;
    if (!continues) {
      flush();
      currentRing = segment.ringIndex;
      current = [segment.a, segment.b];
    } else {
      current.push(segment.b);
    }
    nextIndex = segment.pointIndex + 1;
  }
  flush();

  return chains;
}

export function deriveThaiSharedBorders(countries: BorderCountry[]): ThaiSharedBorder[] {
  const thailand = countries.find((country) => country.isThailand || country.name === "Thailand");
  if (!thailand) return [];

  const thaiSegments = new Map<string, ThaiSegment>();
  thailand.rings.forEach((ring, ringIndex) => {
    for (let pointIndex = 0; pointIndex < ring.length - 1; pointIndex += 1) {
      const a = ring[pointIndex];
      const b = ring[pointIndex + 1];
      if (!isValidSegment(a, b)) continue;
      thaiSegments.set(normalizedSegmentKey(a, b), { ringIndex, pointIndex, a, b });
    }
  });

  const sharedBorders = countries.flatMap((country): ThaiSharedBorder[] => {
    if (country === thailand || country.isThailand) return [];

    const matched = new Map<string, ThaiSegment>();
    for (const ring of country.rings) {
      for (let i = 0; i < ring.length - 1; i += 1) {
        const a = ring[i];
        const b = ring[i + 1];
        if (!isValidSegment(a, b)) continue;
        const thaiSegment = thaiSegments.get(normalizedSegmentKey(a, b));
        if (!thaiSegment) continue;
        matched.set(`${thaiSegment.ringIndex}:${thaiSegment.pointIndex}`, thaiSegment);
      }
    }

    const segments = [...matched.values()].sort(
      (a, b) => a.ringIndex - b.ringIndex || a.pointIndex - b.pointIndex,
    );
    if (segments.length === 0) return [];

    return [
      {
        name: country.name,
        nameTh: country.nameTh,
        label: country.label,
        chains: chainThaiSegments(segments),
        segmentCount: segments.length,
      },
    ];
  });

  return sharedBorders.sort((a, b) => {
    const ai = BORDER_ORDER.indexOf(a.name);
    const bi = BORDER_ORDER.indexOf(b.name);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
    return a.name.localeCompare(b.name);
  });
}
