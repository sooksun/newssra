// วิเคราะห์ภูมิประเทศจากกริดความสูง (slope / TPI / จำแนก landform) — พอร์ตจาก GeoCommunity Classifier
// กริด: ความสูงจริง (เมตร) ขนาด n×n, row 0 = เหนือสุด, col 0 = ตะวันตกสุด

export interface Bbox {
  north: number;
  south: number;
  west: number;
  east: number;
}

export interface Morphology {
  minElev: number;
  maxElev: number;
  meanElev: number;
  relief: number;
  meanSlopePct: number;
  maxSlopePct: number;
  lddClass: string;
  tpi: number; // จุดกลาง − ค่าเฉลี่ยขอบ (บวก=ยอด/สัน, ลบ=ก้นหุบเขา)
  tpiRatio: number;
  landformTh: string; // ชุมชนบนภูเขาสูง/บนภูเขา/ในหุบเขา/เชิงเขา(ที่ลาดเชิงเขา)/บนเนินเขา/บนพื้นราบ
  landformEn: string; // HighMountain / Mountain / Valley / Foothill / Hills / Plains
  provinceName: string | null;
  provinceAvgElev: number; // เกณฑ์ความสูงเฉลี่ยจังหวัด (ม.)
  local1000Elev: number | null; // ความสูงสุดในรัศมี 1,000 ม. รอบจุดตั้ง (null = ไม่ได้ส่ง bbox มาให้คำนวณ)
  /** ความสูงสุดตามเส้นทาง 5 กม.สุดท้าย — ใช้จำแนก landform ภูเขา/หุบเขา/เชิงเขา */
  routeTailMaxElev: number | null;
  /**
   * ความสูงสุดตลอดเส้นทางทั้งเส้น (เช่น ศาลากลาง → โรงเรียน) — เกต SSRA "ผ่านเนิน/ภูเขา"
   * ไม่ใช้จำแนก landform (ใช้ routeTailMaxElev); null = ยังไม่สุ่ม
   */
  routeFullMaxElev: number | null;
  classificationMethod: "route" | "fallback" | "highMountain"; // ใช้เกณฑ์ไหนจำแนก landform — แสดงเพื่อความโปร่งใส
}

export interface MorphologyOptions {
  // ความสูงเฉลี่ยจังหวัด (เมตร) จากตาราง province ของ DB (lib/repo.ts#listProvinces + nearestProvince) — ใช้เป็นเกณฑ์
  // ข้อ 2 ในการจำแนกภูเขา/หุบเขา; ไม่ส่งมา/null (หา DB ไม่พบ) → ถือว่า avgElev = 0 (ใช้เกณฑ์ความสูงสัมบูรณ์ ≥500 ม. อย่างเดียว)
  provinceOverride?: { name: string; avgElev: number } | null;
  // ขอบเขตพื้นที่ของกริด (ใช้คำนวณ local1000Elev ผ่าน highestInRadius) — ไม่ส่งมา = ข้ามการคำนวณนี้
  bbox?: Bbox;
  // ความสูงสุดตามเส้นทางรถยนต์ 5 กม.สุดท้าย (จาก sampleCesiumPoints บนเส้นทาง OSRM)
  // undefined/null = ไม่มีข้อมูลเส้นทาง → ใช้เกณฑ์เดิม (slope/TPI) แทน
  routeTailMaxElev?: number | null;
  /** @deprecated ใช้ routeTailMaxElev — เก็บไว้ชั่วคราวให้ call site เก่า */
  routeMaxElev?: number | null;
  /** ความสูงสุดตลอดเส้นทางทั้งเส้น (SSRA) — ไม่กระทบ landform */
  routeFullMaxElev?: number | null;
}

// ระยะทางบนพื้นโลกระหว่าง 2 พิกัด (สูตร haversine)
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ตัดเฉพาะช่วงท้ายของเส้นทาง (นับระยะถอยหลังจากจุดหมายปลายทาง) — ใช้เช็คภูมิประเทศ "5 กม.สุดท้าย" ของเส้นทางรถยนต์
// coordinates: [lng, lat][] ตามรูปแบบ GeoJSON ของ OSRM, เรียงจากต้นทางไปปลายทาง
// เส้นทางทั้งหมดสั้นกว่า distanceM → คืนทั้งเส้นทาง
export function lastRouteSegment(coordinates: [number, number][], distanceM: number): [number, number][] {
  if (coordinates.length < 2) return coordinates;
  let cum = 0;
  for (let i = coordinates.length - 1; i > 0; i--) {
    const [lngA, latA] = coordinates[i];
    const [lngB, latB] = coordinates[i - 1];
    cum += haversineM(latA, lngA, latB, lngB);
    if (cum >= distanceM) return coordinates.slice(i - 1);
  }
  return coordinates;
}

// ชั้นความลาดชันมาตรฐานกรมพัฒนาที่ดิน (LDD)
export function lddClassLabel(slopePct: number): string {
  if (slopePct <= 2) return "A: ราบเรียบ (0–2%)";
  if (slopePct <= 5) return "B: ลอนลาดเล็กน้อย (2–5%)";
  if (slopePct <= 12) return "C: ลอนลาด (5–12%)";
  if (slopePct <= 20) return "D: ลอนชัน (12–20%)";
  if (slopePct <= 35) return "E: เนินเขา/ลาดชันสูง (20–35%)";
  return "F: ภูเขา/ลาดชันเชิงซ้อน (>35%)";
}

// ── เกณฑ์จำแนก landform (export เพื่อ UI legend / ทดสอบ — อย่าเปลี่ยนโดยไม่ผ่าน product sign-off) ─
// ภูเขาสูง = 1,000 ม. (ชั้นบนของแอป + ชั้นสูง HRDI) — ไม่ใช่ 600 ม. ของนิยาม "ภูเขา" ในคู่มือ สพฐ.
/** meanElev ≥ ค่านี้ → ป้าย "ชุมชนบนภูเขาสูง" (HighMountain) */
export const MORPHOLOGY_HIGH_MOUNTAIN_M = 1000;
/** เกณฑ์ความสูงขั้นต่ำ (ม.) — "สูง" ถ้า > ค่านี้ หรือ > ความสูงเฉลี่ยจังหวัด */
export const MORPHOLOGY_HIGHLAND_MIN_M = 500;
/** รัศมีรอบจุดตั้ง (ม.) ที่ใช้เช็คความสูงสุด local */
export const MORPHOLOGY_LOCAL_HIGH_RADIUS_M = 1000;
/** ระยะเส้นทางช่วงท้าย (ม.) ที่ใช้เช็คความสูงสุดตามเส้นทาง */
export const MORPHOLOGY_ROUTE_CHECK_DISTANCE_M = 5000;

const HIGH_MOUNTAIN_M = MORPHOLOGY_HIGH_MOUNTAIN_M;
const VALLEY_RATIO = -0.15; // tpiRatio ≤ นี้ = ก้นหุบเขา (ใช้เฉพาะตอน fallback ไม่มีข้อมูลเส้นทาง)
const VALLEY_ABS_M = -15; // และ tpi ต้อง ≤ นี้ (ม.) ด้วย กัน noise ตอน relief เล็ก
const HIGHLAND_MIN_M = MORPHOLOGY_HIGHLAND_MIN_M;
const LOCAL_HIGH_RADIUS_M = MORPHOLOGY_LOCAL_HIGH_RADIUS_M;
const ROUTE_CHECK_DISTANCE_M = MORPHOLOGY_ROUTE_CHECK_DISTANCE_M;

// "สูง" ถ้าเกิน 500 ม. จากระดับน้ำทะเล หรือเกินความสูงเฉลี่ยจังหวัด (แล้วแต่ว่าเกณฑ์ไหนถึงก่อน) — ใช้ทั้งจุดตั้งและเส้นทาง
function isHigh(elev: number, provinceAvgElev: number): boolean {
  return elev > HIGHLAND_MIN_M || elev > provinceAvgElev;
}

// คำนวณความลาดชัน + TPI จากกริดความสูง แล้วจำแนกประเภทชุมชนตามภูมิประเทศ
//
// เกณฑ์จำแนก (ยกเว้นภูเขาสูงที่คงเกณฑ์เดิม) พิจารณา 2 ปัจจัยร่วมกัน:
//   local1000Elev = ความสูงสุดในรัศมี 1,000 ม. รอบจุดตั้ง (ผ่าน options.bbox + highestInRadius)
//   routeMaxElev  = ความสูงสุดตามเส้นทางรถยนต์ 5 กม.สุดท้าย (options.routeMaxElev จาก sampleCesiumPoints)
//   ภูเขา   = localสูง และ routeสูง (ต้องขึ้นเขาทั้งที่ตั้งและเส้นทางเข้าถึง)
//   เชิงเขา = localสูง แต่ route ไม่สูง (จุดสูงแต่เข้าถึงด้วยถนนพื้นราบ = ที่ลาดเชิงเขา)
//   หุบเขา  = local ไม่สูง แต่ routeสูง (ต้องข้ามภูเขามาก่อนถึงหุบต่ำ)
//   (local ไม่สูง และ route ไม่สูง → ไม่เข้าเกณฑ์ภูเขา/หุบเขา/เชิงเขาใดๆ ใช้ความลาดชันแบ่ง Hills/Plains เหมือนเดิม)
// ถ้า options.routeMaxElev เป็น undefined/null (ยังไม่มีข้อมูลเส้นทาง) → fallback ใช้เกณฑ์เดิม (TPI + ความลาดชัน)
//
// - actualWidthM : ความกว้างพื้นที่จริง (เมตร) ที่กริดครอบคลุม
// ค่าที่คืนเป็นค่าดิบ (ยังไม่ปัด) — ให้ผู้เรียกปัดตอนแสดงผลเอง
export function morphologyFromGrid(
  grid: Float32Array | number[],
  n: number,
  actualWidthM: number,
  options: MorphologyOptions = {},
): Morphology {
  const {
    provinceOverride,
    bbox,
    routeTailMaxElev: routeTailOpt = null,
    routeMaxElev: routeMaxLegacy = null,
    routeFullMaxElev = null,
  } = options;
  const routeTailMaxElev = routeTailOpt ?? routeMaxLegacy ?? null;
  // ⚠️ ตัวอย่างความสูงบางจุดอาจเป็น NaN (ไทล์ DEM โหลดไม่สำเร็จ) — ต้องกรองทิ้ง ไม่ถือเป็น 0
  let minElev = Infinity;
  let maxElev = -Infinity;
  let sum = 0;
  let finiteCnt = 0;
  for (let k = 0; k < grid.length; k++) {
    const v = grid[k];
    if (!Number.isFinite(v)) continue;
    if (v < minElev) minElev = v;
    if (v > maxElev) maxElev = v;
    sum += v;
    finiteCnt += 1;
  }
  // ถ้าสุ่ม DEM ล้มเหลวมากเกินไป (>10% หรือไม่มีเลย) → โยน error ให้ผู้เรียกแสดงข้อความจริง แทนการปั้นค่า
  if (finiteCnt === 0 || grid.length - finiteCnt > grid.length * 0.1) {
    throw new Error("ข้อมูลความสูง (DEM) ไม่ครบ — สุ่มไทล์ล้มเหลวบางส่วน จึงวิเคราะห์ภูมิประเทศไม่ได้");
  }
  const meanElev = sum / finiteCnt;
  const relief = maxElev - minElev;

  // ความลาดชัน (central difference) + ค่าสูงสุด — ข้ามเซลล์ที่ stencil มี NaN
  const cellM = actualWidthM / (n - 1);
  let slopeSum = 0;
  let slopeMax = 0;
  let cnt = 0;
  for (let i = 1; i < n - 1; i++) {
    for (let j = 1; j < n - 1; j++) {
      const xr = grid[i * n + (j + 1)];
      const xl = grid[i * n + (j - 1)];
      const yd = grid[(i + 1) * n + j];
      const yu = grid[(i - 1) * n + j];
      if (!Number.isFinite(xr) || !Number.isFinite(xl) || !Number.isFinite(yd) || !Number.isFinite(yu)) continue;
      const dzdx = (xr - xl) / (2 * cellM);
      const dzdy = (yd - yu) / (2 * cellM);
      const slope = Math.sqrt(dzdx * dzdx + dzdy * dzdy) * 100; // rise/run เป็น %
      slopeSum += slope;
      if (slope > slopeMax) slopeMax = slope;
      cnt += 1;
    }
  }
  const meanSlopePct = cnt ? slopeSum / cnt : 0;

  // TPI = ความสูงจุดกลาง − ค่าเฉลี่ยของขอบพื้นที่ (ริง) — ใช้เฉพาะเซลล์ที่มีค่าจริง
  const mid = Math.floor(n / 2);
  const centerRaw = grid[mid * n + mid];
  let ringSum = 0;
  let ringCnt = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      if (i === 0 || j === 0 || i === n - 1 || j === n - 1) {
        const rv = grid[i * n + j];
        if (!Number.isFinite(rv)) continue;
        ringSum += rv;
        ringCnt += 1;
      }
  const ringMean = ringCnt ? ringSum / ringCnt : NaN;
  // จุดกลาง NaN → ใช้ค่าเฉลี่ยริงแทน (TPI = 0), ริง NaN → TPI = 0
  const centerElev = Number.isFinite(centerRaw) ? centerRaw : Number.isFinite(ringMean) ? ringMean : meanElev;
  const tpi = Number.isFinite(ringMean) ? centerElev - ringMean : 0;
  const tpiRatio = relief > 0 ? tpi / relief : 0;

  const provinceAvgElev = provinceOverride?.avgElev ?? 0;
  const local1000Elev = bbox ? highestInRadius(grid, n, actualWidthM, bbox, LOCAL_HIGH_RADIUS_M).hiElev : null;

  let landformTh: string;
  let landformEn: string;
  let classificationMethod: Morphology["classificationMethod"];

  if (meanElev >= HIGH_MOUNTAIN_M) {
    // ภูเขาสูง = อยู่สูงเฉลี่ย ≥1000 ม. (รวมที่ราบสูง/ไหล่เขาสูง) — คงเกณฑ์เดิม ไม่ว่าจะมีข้อมูลเส้นทางหรือไม่
    landformTh = "ชุมชนบนภูเขาสูง";
    landformEn = "HighMountain";
    classificationMethod = "highMountain";
  } else if (routeTailMaxElev !== null && local1000Elev !== null) {
    // เกณฑ์ใหม่: ความสูงรอบจุดตั้ง (1,000 ม.) ร่วมกับความสูงตามเส้นทางรถยนต์ (5 กม.สุดท้าย)
    const localHigh = isHigh(local1000Elev, provinceAvgElev);
    const routeHigh = isHigh(routeTailMaxElev, provinceAvgElev);
    classificationMethod = "route";
    if (localHigh && routeHigh) {
      landformTh = "ชุมชนบนภูเขา";
      landformEn = "Mountain";
    } else if (localHigh) {
      // จุดตั้งสูงแต่เส้นทางเข้าถึงยังไม่สูงตลอด 5 กม.สุดท้าย → เชิงเขา/ที่ลาดเชิงเขา
      landformTh = "ชุมชนเชิงเขา/ที่ลาดเชิงเขา";
      landformEn = "Foothill";
    } else if (routeHigh) {
      // ต้องผ่านเส้นทางที่สูงมาก่อน แต่จุดตั้งเองอยู่ต่ำ → หุบเขา
      landformTh = "ชุมชนในหุบเขา";
      landformEn = "Valley";
    } else if (meanSlopePct < 5) {
      landformTh = "ชุมชนบนพื้นราบ";
      landformEn = "Plains";
    } else {
      landformTh = "ชุมชนบนเนินเขา";
      landformEn = "Hills";
    }
  } else {
    // Fallback: ยังไม่มีข้อมูลเส้นทาง (โหลดไม่เสร็จ/ไม่พบจังหวัด/OSRM ล้มเหลว) → เกณฑ์เดิม (TPI + ความลาดชัน)
    classificationMethod = "fallback";
    const highEnough = meanElev >= HIGHLAND_MIN_M && meanElev >= provinceAvgElev;
    // หุบเขา = จุดกลางต่ำกว่าขอบชัดเจน (ทั้งสัดส่วนและค่าสัมบูรณ์) — กัน noise ตอน relief เล็ก
    const isValley = tpiRatio <= VALLEY_RATIO && tpi <= VALLEY_ABS_M;
    if (isValley) {
      landformTh = "ชุมชนในหุบเขา";
      landformEn = "Valley";
    } else if (meanSlopePct < 5) {
      landformTh = "ชุมชนบนพื้นราบ";
      landformEn = "Plains";
    } else if (meanSlopePct < 12) {
      landformTh = "ชุมชนบนเนินเขา";
      landformEn = "Hills";
    } else if (!highEnough) {
      landformTh = "ชุมชนเชิงเขา/ที่ลาดเชิงเขา";
      landformEn = "Foothill";
    } else {
      landformTh = "ชุมชนบนภูเขา";
      landformEn = "Mountain";
    }
  }

  return {
    minElev,
    maxElev,
    meanElev,
    relief,
    meanSlopePct,
    maxSlopePct: slopeMax,
    lddClass: lddClassLabel(meanSlopePct),
    tpi,
    tpiRatio,
    landformTh,
    landformEn,
    provinceName: provinceOverride?.name ?? null,
    provinceAvgElev,
    local1000Elev,
    routeTailMaxElev,
    routeFullMaxElev: routeFullMaxElev ?? null,
    classificationMethod,
  };
}

/** ค่าสูงสุดจากลำดับความสูง (ข้าม NaN) — ใช้กับผล sampleCesiumPoints ตามเส้นทาง */
export function maxFiniteElev(heights: ArrayLike<number>): number | null {
  let max = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    if (Number.isFinite(h) && h > max) max = h;
  }
  return Number.isFinite(max) ? max : null;
}

export interface HighPoint {
  hiElev: number;
  hiLat: number;
  hiLng: number;
  hiDistM: number; // ระยะจากจุดกึ่งกลาง (ม.)
}

// หาจุดสูงสุดภายในรัศมี radiusM จากจุดกึ่งกลางกริด (ตัดเฉพาะเซลล์ในวงกลม)
export function highestInRadius(
  grid: Float32Array | number[],
  n: number,
  actualWidthM: number,
  bbox: Bbox,
  radiusM: number,
): HighPoint {
  const cellM = actualWidthM / (n - 1);
  const c = (n - 1) / 2;
  let hiElev = -Infinity;
  let hiI = Math.floor(n / 2);
  let hiJ = Math.floor(n / 2);
  for (let i = 0; i < n; i += 1) {
    const dz = (i - c) * cellM;
    for (let j = 0; j < n; j += 1) {
      const dx = (j - c) * cellM;
      if (dx * dx + dz * dz > radiusM * radiusM) continue; // นอกรัศมี → ข้าม
      const e = grid[i * n + j];
      if (!Number.isFinite(e)) continue; // ตัวอย่างล้มเหลว → ข้าม
      if (e > hiElev) {
        hiElev = e;
        hiI = i;
        hiJ = j;
      }
    }
  }
  if (!Number.isFinite(hiElev)) hiElev = 0;
  const hiDistM = Math.hypot((hiJ - c) * cellM, (hiI - c) * cellM);
  const hiLat = bbox.north + (bbox.south - bbox.north) * (hiI / (n - 1));
  const hiLng = bbox.west + (bbox.east - bbox.west) * (hiJ / (n - 1));
  return { hiElev, hiLat, hiLng, hiDistM };
}
