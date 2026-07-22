export type RouteCoordinate = [number, number];

export interface RouteElevationPoint {
  lng: number;
  lat: number;
  elevationM: number;
}

export interface RouteElevationProfile {
  schoolElevationM: number | null;
  highestPoint: RouteElevationPoint | null;
}

export function sampleRouteCoordinates(coords: readonly RouteCoordinate[], maxCount: number): RouteCoordinate[] {
  if (!Number.isInteger(maxCount) || maxCount < 2) {
    throw new RangeError("maxCount must be an integer of at least 2");
  }
  if (coords.length <= maxCount) return coords.map(([lng, lat]) => [lng, lat]);

  return Array.from({ length: maxCount }, (_, index) => {
    const sourceIndex = Math.round((index * (coords.length - 1)) / (maxCount - 1));
    const [lng, lat] = coords[sourceIndex];
    return [lng, lat];
  });
}

export function buildRouteElevationProfile(
  coords: readonly RouteCoordinate[],
  heights: ArrayLike<number>,
): RouteElevationProfile {
  let highestPoint: RouteElevationPoint | null = null;
  const pairedLength = Math.min(coords.length, heights.length);

  for (let index = 0; index < pairedLength; index += 1) {
    const elevationM = heights[index];
    if (!Number.isFinite(elevationM)) continue;
    if (!highestPoint || elevationM > highestPoint.elevationM) {
      highestPoint = { lng: coords[index][0], lat: coords[index][1], elevationM };
    }
  }

  const schoolIndex = coords.length - 1;
  const schoolHeight = schoolIndex >= 0 && schoolIndex < heights.length ? heights[schoolIndex] : Number.NaN;
  return {
    schoolElevationM: Number.isFinite(schoolHeight) ? schoolHeight : null,
    highestPoint,
  };
}

export function formatElevationMeters(value: number): string {
  return `${Math.round(value).toLocaleString("th-TH")} ม.`;
}
