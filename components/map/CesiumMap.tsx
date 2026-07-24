"use client";

// แผนที่ 3 มิติ (Cesium) แบบ keyless — พอร์ตแบบตัดทอนจากหน้า CesiumMap3DTab ของ GeoCommunity Classifier
// ใช้ terrain Terrarium (AWS Open Data) + ภาพถ่าย Esri World Imagery โดยไม่ต้องมี token
// โหลดผ่าน dynamic import (ssr:false) เท่านั้น — cesium เป็น browser-only

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Viewer,
  BoundingSphere,
  Cartesian3,
  Cartographic,
  Color,
  ConstantPositionProperty,
  Credit,
  CustomDataSource,
  DiscardMissingTileImagePolicy,
  Google2DImageryProvider,
  HeadingPitchRange,
  HeightReference,
  ImageryLayer,
  IonWorldImageryStyle,
  Math as CesiumMath,
  Matrix4,
  PolylineDashMaterialProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  LabelStyle,
  Cartesian2,
  createWorldImageryAsync,
} from "cesium";
import type { Entity, ImageryProvider, TerrainProvider } from "cesium";
import {
  configureCesium,
  googleMapsApiKey,
  preferredImagerySource,
  type MapImagerySource,
} from "@/lib/map/cesium-config";
import { createTerrariumTerrainProvider, sampleCesiumGrid, sampleCesiumPoints } from "@/lib/map/cesiumTerrain";
import {
  ESRI_MAX_REQUEST_LEVEL,
  ESRI_WORLD_IMAGERY_BASE_URL,
  ESRI_WORLD_IMAGERY_TILE_URL,
  probeEsriImageryAvailability,
} from "@/lib/map/esriImagery";
import {
  haversineM,
  lastRouteSegment,
  maxFiniteElev,
  morphologyFromGrid,
  type Bbox,
  type Morphology,
} from "@/lib/map/morphology";
import { pointInPolygon, polygonAreaM2, polygonCentroid, polygonBoundingRadiusM } from "@/lib/map/geometry";
import { parseSharedBorders, type SharedBordersDoc } from "@/lib/map/borders";
import { fetchBuildings, fetchNearestProvince, fetchOsrmRoutes } from "@/lib/map/mapApi";
import { searchPlaces, resolvePlaceHit, reverseProvince, type PlaceHit } from "@/lib/map/placeSearch";
import {
  buildRouteElevationProfile,
  formatElevationMeters,
  formatRouteHighestLabel,
  routeElevationSampleCoordinates,
  type RouteElevationProfile,
} from "@/lib/map/routeElevation";
import {
  buildRouteAnalysis,
  computeAutoGisScore,
  computeCommunityClass,
  derive32Severity,
  elevationGainLoss,
  MAX_ASSESSMENT_RELOCATION_M,
  settlementClass,
  type SettlementTone,
} from "@/lib/gis";
import { landformAppLabelNoteTh, officialElevBandTh } from "@/lib/landform-legend";
import LandformLegendTip from "@/components/LandformLegendTip";
import GisAssessmentPanel, { GisDestAddBar, MAX_GIS_DESTINATIONS } from "@/components/map/GisAssessmentPanel";
import MapPanelToggle from "@/components/map/MapPanelToggle";
import type { MapAssessmentSaveAction, MapAssessmentSaveResponse } from "@/lib/map-assessment";
import { GIS_DESTINATION_LABELS } from "@/lib/types";
import type { GisAnalysis, GisAreaSummary, GisDestinationType, GisRouteAnalysis } from "@/lib/types";
import { overviewFitRangeM, SNAPSHOT_VIEWS } from "@/lib/map/snapshotViews";
import { captureCurrentView, dataUrlToBlob, waitForTilesLoaded } from "@/lib/map/snapshotCapture";

// ── ค่าคงที่การวิเคราะห์ ──────────────────────────────────────────────────
// รัศมีวิเคราะห์ภูมิประเทศรอบจุดตั้งโรงเรียน (เส้นรัศมีจริง วัดจากจุดศูนย์กลางแบบวงกลม ไม่ใช่ขอบสี่เหลี่ยม)
const ANALYSIS_RADIUS_KM = 2;
// กรอบสี่เหลี่ยมจัตุรัสที่แนบในวงกลมรัศมี ANALYSIS_RADIUS_KM พอดี (ด้าน = รัศมี × √2)
// ทำให้ทุกจุดในกริดที่สุ่ม รวมถึงมุมสี่เหลี่ยม ห่างจากจุดศูนย์กลางไม่เกิน ANALYSIS_RADIUS_KM กม.จริง
const AREA_KM = ANALYSIS_RADIUS_KM * Math.SQRT2;
const GRID_N = 41;
const ANALYSIS_WIDTH_M = AREA_KM * 1000;
const KEYLESS_SAMPLE_LEVEL = 14;
const VERTICAL_EXAGGERATION = 2.0;
const ANALYSIS_TIMEOUT_MS = 25_000;
const CENTER_SYNC_TOLERANCE_M = 50;
// Esri World Imagery: ระดับภาพจริงต่างกันตามพื้นที่ (เมืองใหญ่ ~L19–20, ชนบท/ภูเขา ~L17–18)
// เกินระดับที่มีจริง Esri จะตอบ tile เทา "Map data not yet available" เป็น JPEG ปกติ (HTTP 200)
// จึงต้องใช้ DiscardMissingTileImagePolicy และ probe tilemap รายพิกัดเพื่อไม่ render ภาพขยายเกินจริงโดยไม่บอกผู้ใช้
// tile ชนบทลึก (L21 แถวบ้านจะตี เชียงราย) ที่ทราบแน่ว่าเป็น placeholder — ใช้เป็นภาพอ้างอิงของ discard policy
const ESRI_MISSING_TILE_URL = `${ESRI_WORLD_IMAGERY_BASE_URL}/tile/21/927815/1629415`;
// ความคลาดเคลื่อนระดับพิกเซลของ globe: ค่าน้อย = ขอ tile ละเอียดขึ้น = ภาพคมเมื่อ zoom เข้าใกล้ (ค่า default 2)
const GLOBE_SSE = 1.0;
// การจับภาพ 3D: เรนเดอร์ละเอียดขึ้นและรอไทล์นานขึ้น เพราะภาพนิ่ง 9 ใบถูกส่งให้ AI วิเคราะห์ภูมิประเทศ
// (คุณภาพสำคัญกว่าเวลาไม่กี่วินาที) — ค่าเหล่านี้ใช้เฉพาะช่วงจับภาพ แล้วคืนค่าเดิมทันที
// scale 1.5 ไม่ใช่ 2: ภาพทั้ง 9 ใบถูกแปลงเป็น base64 ส่งเข้า OpenRouter ต่อ ถ้าใหญ่เกินไปคำขอจะอืด/ถูกปฏิเสธ
const SNAPSHOT_RESOLUTION_SCALE = 1.5;
const SNAPSHOT_TILE_WAIT_MS = 9000;
const SNAPSHOT_TILE_STABLE_TICKS = 3;
// มุมภาพรวมครอบสองจุด: ระยะกล้อง = รัศมี BoundingSphere × ตัวคูณนี้ (2.4 = เห็นทั้งสองจุดพร้อมขอบพอเหมาะ)
// เผื่อกรณีอ่าน fov ของกล้องไม่ได้ (เช่น frustum ไม่ใช่ perspective) — ใช้ตัวคูณกว้างพอสำหรับจอแนวนอนทั่วไป
const SNAPSHOT_OVERVIEW_FALLBACK_FACTOR = 3.4;
const IMAGERY_LAYER_OPTIONS = {
  maximumAnisotropy: 16,
  brightness: 1.02,
  contrast: 1.04,
  saturation: 1.03,
};

// เส้นทางรถยนต์ OSRM ย้ายไป lib/map/mapApi.ts (fetchOsrmRoutes) — ใช้ร่วมกันหลายจุดในไฟล์นี้
// ── ค้นหาชื่อสถานที่: Google Places Autocomplete (JS SDK) + fallback Nominatim ฝั่ง client — ดู lib/map/placeSearch.ts ──
const PLACE_SEARCH_MIN_CHARS = 3; // Autocomplete เริ่มค้นเมื่อพิมพ์ครบ 3 ตัวอักษร (ตาม geotech)
const PLACE_SEARCH_DEBOUNCE_MS = 450;
// ── ผังอาคาร (Microsoft Building Footprints ผ่าน /api/buildings) ─────────────
// พื้นที่คำนวณประชากรตอนนี้มาจาก polygon ที่ผู้ใช้วาดเอง (ไม่ใช่รัศมีคงที่) — จำกัดจำนวนจุดวาดสูงสุด
const MAX_POLYGON_VERTICES = 10;
// มิเรอร์ MAX_RADIUS_M ฝั่ง server (app/api/buildings/route.ts) กันขอรัศมีเกินที่ server ยอมรับ
const MAX_RADIUS_M_CLIENT = 5000;
// ── วงรัศมีนับประชากรรอบจุดวิเคราะห์ (เมตร) — ใช้ประกอบการจำแนกประเภทชุมชน ──
const RING_RADII_M = [500, 1000, 1500] as const;
const RING_COLORS = ["#22c55e", "#eab308", "#ef4444"] as const; // เขียว/เหลือง/แดง ไล่จากในออกนอก
// ── เช็คความสูงตามเส้นทาง 5 กม.สุดท้าย (เกณฑ์จำแนกภูเขา/หุบเขา/เชิงเขา) ─────────
const ROUTE_CHECK_DISTANCE_M = 5000;
const MAX_ROUTE_SAMPLE_POINTS = 40; // จำกัดจำนวนจุดสุ่มความสูงตามเส้นทาง กันขอ tile terrain มากเกินไป
// ── โหมดวิเคราะห์แบบประเมิน (GIS) ──────────────────────────────────────────────
// สุ่มความสูงสะสมทั้งเส้นทาง (ไม่ใช่แค่ 5 กม.สุดท้าย) — 120 จุด ≈ 1 จุด/500 ม. ที่ระยะ 60 กม.
// พอสำหรับ band ความสูงสะสมขั้น 100 ม. โดยไม่ยิงขอ tile terrain มากเกินไป
// UI แผง/จุดหมาย → components/map/GisAssessmentPanel.tsx (MAX_GIS_DESTINATIONS อยู่ที่นั่น)
const MAX_GAIN_SAMPLE_POINTS = 120;
const RED_FLAG_ICON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 44"><path d="M9 41V4" stroke="white" stroke-width="5" stroke-linecap="round"/><path d="M9 5h22l-6 8 6 8H9z" fill="#dc2626" stroke="white" stroke-width="2" stroke-linejoin="round"/><circle cx="9" cy="41" r="3" fill="#7f1d1d" stroke="white" stroke-width="2"/></svg>',
)}`;

// ลดจำนวนจุดแบบกระจายสม่ำเสมอ (ไม่เอาแค่ N ตัวแรก) — ใช้กับจุดตามเส้นทางที่อาจมีหนาแน่นไม่เท่ากัน
function downsample<T>(arr: T[], maxCount: number): T[] {
  if (arr.length <= maxCount) return arr;
  const step = arr.length / maxCount;
  const out: T[] = [];
  for (let i = 0; i < maxCount; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

// พิกัดวงกลม [lng,lat][] รอบจุดศูนย์กลาง รัศมี radiusM (เมตร) — ใช้วาดวงรัศมีเป็น polyline บนภูมิประเทศ
function circleCoords(lat: number, lng: number, radiusM: number, segments = 96): [number, number][] {
  const dLatBase = radiusM / 110540;
  const dLngBase = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  const pts: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * 2 * Math.PI;
    pts.push([lng + dLngBase * Math.sin(t), lat + dLatBase * Math.cos(t)]);
  }
  return pts;
}

// ── แนวชายแดนไทยกับประเทศเพื่อนบ้าน (คำนวณไว้ล่วงหน้าใน public/geo/sea-borders.json) ──
let bordersCache: SharedBordersDoc | null = null;
let bordersPromise: Promise<SharedBordersDoc> | null = null;
async function loadBorders(): Promise<SharedBordersDoc> {
  if (bordersCache) return bordersCache;
  if (!bordersPromise) {
    bordersPromise = fetch("/geo/sea-borders.json")
      .then((r) => {
        if (!r.ok) throw new Error(`โหลดแนวชายแดนไม่สำเร็จ (HTTP ${r.status})`);
        return r.json();
      })
      .then((doc: unknown) => {
        bordersCache = parseSharedBorders(doc);
        return bordersCache;
      })
      .catch((e) => {
        bordersPromise = null; // ให้ลองใหม่คำขอถัดไป
        throw e;
      });
  }
  return bordersPromise;
}

function fmtKm(distanceM: number): string {
  return distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)} กม.` : `${Math.round(distanceM)} ม.`;
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที`;
}

interface ImageryStatus {
  source: MapImagerySource;
  label: string;
  detail: string;
  tone: "muted" | "ok" | "warn";
  nativeMaxLevel: number | null;
  credit: string;
}

export interface MapCenter {
  lat: number;
  lng: number;
  name: string;
}

export interface MapProvince {
  name: string;
  lat: number;
  lng: number;
  avgElev: number;
}

// เส้นทางทางเลือกหนึ่งเส้น (จาก OSRM alternatives) — coords เป็น [lng,lat][] ตามรูปแบบ GeoJSON ของ OSRM
interface RouteAlt {
  coords: [number, number][];
  distanceM: number;
  durationS: number;
}

/** โหมดวิเคราะห์แบบประเมิน — ส่งมาจาก app/map/page.tsx เมื่อเปิดด้วย ?assessment=ID (ผ่านการตรวจสิทธิ์แล้ว) */
export interface MapAssessment {
  id: number;
  name: string;
  /** พิกัดที่อยู่ในแบบฟอร์ม ณ ตอนเปิดหน้า ใช้กันการบันทึกผล GIS ของจุดอื่นลงแบบประเมินผิดฉบับ */
  unitCenter: MapCenter | null;
  /** ยื่นแล้ว → ห้ามบันทึกผล GIS ทับ (server ก็กันซ้ำอีกชั้นด้วย 409) */
  submitted: boolean;
  existingGis: GisAnalysis | null;
  /** ปีของแบบประเมินฉบับที่กำลังเปิดดูอยู่ (unit.year) — อาจไม่ใช่ปีปัจจุบันถ้าเปิดด้วย ?assessment=ID ของปีอื่น */
  year: string;
}

/** ฉบับ "ปีปัจจุบัน" ของโรงเรียน — คำนวณแยกจาก assessment ที่เปิดดูเสมอ (แม้ ?assessment=ID จะชี้ไปปีอื่น)
 *  ใช้กำหนดว่าปุ่มบันทึกใน GisAssessmentPanel ล็อกหรือไม่ เพราะปุ่มบันทึกเขียนลงฉบับปีปัจจุบันเสมอ */
export interface MapCurrentYearAssessment {
  year: string;
  submitted: boolean;
}

/** จุดหมายวิเคราะห์เส้นทางที่ผู้ใช้เพิ่มเอง (จากช่องค้นหา) — เส้นทาง center→จุดหมาย */
interface GisDestination {
  key: string;
  destinationType: GisDestinationType;
  name: string;
  lat: number;
  lng: number;
  route: RouteAlt | null;
  gain: { gainM: number; lossM: number } | null;
  error: string;
}

interface Props {
  center: MapCenter;
  /** admin/ssra_admin ไม่ผูกกับโรงเรียนเดียว → เปิดมุมมองทั้งประเทศ ไม่วิเคราะห์อัตโนมัติ */
  national: boolean;
  /** จังหวัดที่ใกล้ที่สุด (พิกัดศาลากลาง + ความสูงเฉลี่ยจริงจาก DB) — null ถ้าหา DB ไม่ได้/ตารางไม่มี */
  province: MapProvince | null;
  /** ขนาดครัวเรือนเฉลี่ยของจังหวัด (คน/ครัวเรือน) จาก master_viledges — ใช้ประมาณประชากรจากจำนวนอาคารในตารางรัศมี */
  householdSize: number | null;
  /** โหมดวิเคราะห์แบบประเมิน — null = แผนที่ standalone แบบเดิมทุกประการ */
  assessment: MapAssessment | null;
  /** เฉพาะบัญชีโรงเรียนที่มีรหัสจึงบันทึกลงแบบประเมินปีปัจจุบันได้ (ปุ่มบันทึกครั้งเดียว) */
  canSaveAssessment: boolean;
  /** ฉบับปีปัจจุบันของโรงเรียน แยกจาก assessment ที่เปิดดู — null = ยังไม่มีฉบับปีปัจจุบัน (ปุ่มบันทึกจะ "สร้าง" ให้) */
  currentYearAssessment: MapCurrentYearAssessment | null;
  /** ค่าตั้งค่าส่วนกลาง (/admin/settings) — false = ซ่อนช่องค้นหาสถานที่ (ยังลากหมุดแดงย้ายจุดวิเคราะห์ได้) */
  showPlaceSearch: boolean;
}

const fmt = (v: number) => Math.round(v).toLocaleString("th-TH");

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function bboxAround(lat: number, lng: number, areaKm: number): Bbox {
  const half = (areaKm * 1000) / 2;
  const dLat = half / 111320;
  const dLng = half / (111320 * Math.cos((lat * Math.PI) / 180));
  return { north: lat + dLat, south: lat - dLat, west: lng - dLng, east: lng + dLng };
}

function imageryLabel(source: MapImagerySource): string {
  if (source === "google") return "Google Maps Satellite";
  if (source === "ion") return "Cesium ion World Imagery";
  return "Esri World Imagery";
}

function imageryCredit(source: MapImagerySource): string {
  if (source === "google") return "Google Maps Platform";
  if (source === "ion") return "Cesium ion / Bing Maps";
  return "Esri World Imagery";
}

function initialImageryStatus(source: MapImagerySource, national: boolean): ImageryStatus {
  if (source !== "esri") {
    return {
      source,
      label: `ภาพถ่าย: ${imageryLabel(source)}`,
      detail: "ใช้ provider ความละเอียดสูงที่ตั้งค่าไว้",
      tone: "ok",
      nativeMaxLevel: null,
      credit: imageryCredit(source),
    };
  }

  return {
    source,
    label: "ภาพถ่าย: Esri World Imagery",
    detail: national ? "ระดับภาพขึ้นกับพื้นที่" : "กำลังตรวจระดับภาพจริงของพื้นที่นี้",
    tone: "muted",
    nativeMaxLevel: null,
    credit: imageryCredit(source),
  };
}

function createEsriImageryLayer(maximumLevel = ESRI_MAX_REQUEST_LEVEL): ImageryLayer {
  return new ImageryLayer(
    new UrlTemplateImageryProvider({
      url: ESRI_WORLD_IMAGERY_TILE_URL,
      maximumLevel,
      credit: new Credit("Imagery: Esri World Imagery · Maxar, Earthstar Geographics"),
      tileDiscardPolicy: new DiscardMissingTileImagePolicy({
        missingImageUrl: ESRI_MISSING_TILE_URL,
        pixelsToCheck: [
          new Cartesian2(0, 0),
          new Cartesian2(120, 120),
          new Cartesian2(200, 20),
          new Cartesian2(20, 200),
          new Cartesian2(200, 200),
        ],
      }),
    }),
    IMAGERY_LAYER_OPTIONS,
  );
}

function createBaseImageryLayer(source: MapImagerySource, esriMaxLevel = ESRI_MAX_REQUEST_LEVEL): ImageryLayer {
  if (source === "google") {
    const key = googleMapsApiKey();
    if (key) {
      const provider = Google2DImageryProvider.fromUrl({
        key,
        mapType: "satellite",
        language: "th-TH",
        region: "TH",
      }) as Promise<unknown> as Promise<ImageryProvider>;
      return ImageryLayer.fromProviderAsync(provider, IMAGERY_LAYER_OPTIONS);
    }
  }

  if (source === "ion") {
    return ImageryLayer.fromProviderAsync(
      createWorldImageryAsync({ style: IonWorldImageryStyle.AERIAL }),
      IMAGERY_LAYER_OPTIONS,
    );
  }

  return createEsriImageryLayer(esriMaxLevel);
}

export default function CesiumMap({
  center: centerProp,
  national: nationalProp,
  province: provinceProp,
  householdSize: householdSizeProp,
  assessment,
  canSaveAssessment,
  currentYearAssessment,
  showPlaceSearch,
}: Props) {
  // center/national/province/householdSize เริ่มจาก props แต่เก็บเป็น state เพื่อให้ "ยืนยันใช้พิกัดใหม่"
  // ย้ายจุดวิเคราะห์ได้ (recompute ทุกอย่างที่ผูกกับ center รวมถึงหาจังหวัด/ศาลากลางต้นทางใหม่)
  const [center, setCenter] = useState<MapCenter>(centerProp);
  const [national, setNational] = useState(nationalProp);
  const [province, setProvince] = useState<MapProvince | null>(provinceProp);
  const [householdSize, setHouseholdSize] = useState<number | null>(householdSizeProp);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const terrainRef = useRef<TerrainProvider | null>(null);
  const pinDsRef = useRef<CustomDataSource | null>(null);
  const polygonDsRef = useRef<CustomDataSource | null>(null);
  const routeDsRef = useRef<CustomDataSource | null>(null);
  const buildingsDsRef = useRef<CustomDataSource | null>(null);
  const ringsDsRef = useRef<CustomDataSource | null>(null); // วงรัศมี 500/1000/1500 ม. รอบจุดวิเคราะห์
  const bordersDsRef = useRef<CustomDataSource | null>(null); // แนวชายแดน + ป้ายชื่อประเทศ
  const routeCoordsRef = useRef<[number, number][] | null>(null); // [lng,lat][] เก็บไว้ให้ runAnalysis สุ่มความสูง 5 กม.สุดท้าย
  const imageryLayerRef = useRef<ImageryLayer | null>(null);
  const esriMaxLevelRef = useRef(ESRI_MAX_REQUEST_LEVEL);
  const drawHandlerRef = useRef<ScreenSpaceEventHandler | null>(null);
  // ── ลากหมุดจุดวิเคราะห์บนแผนที่ ──
  const dragHandlerRef = useRef<ScreenSpaceEventHandler | null>(null);
  const centerPinRef = useRef<Entity | null>(null); // อ้างอิงหมุดแดง (จุดวิเคราะห์) เพื่อย้ายตำแหน่งระหว่างลาก
  const draggingPinRef = useRef(false);
  const dragLatLngRef = useRef<{ lat: number; lng: number } | null>(null);
  const searchDsRef = useRef<CustomDataSource | null>(null); // หมุดค้นหาชั่วคราว แยกจาก pinDs (หมุดโรงเรียน)
  const compassNeedleRef = useRef<HTMLDivElement | null>(null); // อัปเดต transform ตรงๆ ทุกเฟรม ไม่ผ่าน React state
  const autoRunRef = useRef(false); // วิเคราะห์อัตโนมัติครั้งเดียวต่อจุด — รีเซ็ตเป็น false เมื่อยืนยันพิกัดใหม่

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [panelExpanded, setPanelExpanded] = useState(true);
  const [errMsg, setErrMsg] = useState("");
  const [terrainReady, setTerrainReady] = useState(false);
  const [analysis, setAnalysis] = useState<Morphology | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisErr, setAnalysisErr] = useState("");
  const [imageryStatus, setImageryStatus] = useState<ImageryStatus>(() =>
    initialImageryStatus(preferredImagerySource(), national),
  );
  const [route, setRoute] = useState<{ distanceM: number; durationS: number } | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeErr, setRouteErr] = useState("");
  // เส้นทางทางเลือกจาก OSRM (alternatives) + เส้นที่ผู้ใช้เลือกไว้ — ผู้ใช้กดปุ่มสลับได้ และ routeCoordsRef ใช้เส้นที่เลือก
  const [routeAlternatives, setRouteAlternatives] = useState<RouteAlt[]>([]);
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0);
  // true เมื่อ "ลองแล้ว" เส้นทางเสร็จสิ้น (สำเร็จ/ล้มเหลว/ไม่มีจังหวัดอ้างอิง) — ใช้ให้ auto-run วิเคราะห์ครั้งแรกรอข้อมูลเส้นทางก่อน
  const [routeSettled, setRouteSettled] = useState(false);
  const [buildingsLoading, setBuildingsLoading] = useState(false);
  const [buildingsErr, setBuildingsErr] = useState("");
  // พื้นที่คำนวณประชากร: ผู้ใช้วาด polygon เอง (คลิกบนโลก) แทนรัศมีคงที่แบบเดิม
  const [drawing, setDrawing] = useState(false);
  const [polygonVertices, setPolygonVertices] = useState<[number, number][]>([]); // [lat,lng][], สูงสุด MAX_POLYGON_VERTICES จุด
  const [polygonClosed, setPolygonClosed] = useState(false);
  const [polygonPopulation, setPolygonPopulation] = useState<{
    buildingCount: number;
    estPopulation: number | null;
    truncated: boolean;
    // ข้อสรุปพื้นที่หลังประมวลผลผังอาคาร (คำนวณจาก polygon ที่วาด)
    areaKm2: number;
    buildingDensityPerKm2: number;
    popDensityPerKm2: number | null;
  } | null>(null);
  // วงรัศมีนับประชากรรอบจุดวิเคราะห์ (อัตโนมัติเมื่อมีจุด) — จำนวนอาคาร/ประชากรสะสมในแต่ละวง + ประเภทชุมชนที่ได้
  const [ringStats, setRingStats] = useState<
    { radiusM: number; buildingCount: number; population: number | null; densityPerKm2: number | null }[] | null
  >(null);
  const [ringSettlement, setRingSettlement] = useState<{
    label: string;
    tone: SettlementTone;
    hint: string;
    densityPerKm2: number;
  } | null>(null);
  const [ringsLoading, setRingsLoading] = useState(false);
  const [ringsErr, setRingsErr] = useState("");
  const [showBorders, setShowBorders] = useState(true); // แสดงแนวชายแดน + ชื่อประเทศ
  const [bordersErr, setBordersErr] = useState("");
  const [bordersCredit, setBordersCredit] = useState(""); // เครดิตแหล่งข้อมูล (ODbL บังคับให้แสดง)
  // ค้นหาชื่อสถานที่: Google Places Autocomplete → เลือกผลลัพธ์ → บินกล้องไปจุดนั้น + ปักหมุดชั่วคราว (ไม่ผูกกับ state โรงเรียน/polygon)
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeSearchErr, setPlaceSearchErr] = useState("");
  const [searchResults, setSearchResults] = useState<PlaceHit[]>([]);
  const [searchSource, setSearchSource] = useState("Google Maps");
  const [searching, setSearching] = useState(false);
  // พิกัดที่ค้นเจอและเลือกไว้ (ปักหมุดชั่วคราวแล้ว) รอผู้ใช้กด "ยืนยันใช้พิกัดใหม่นี้" เพื่อย้ายจุดวิเคราะห์
  const [pickedCoord, setPickedCoord] = useState<MapCenter | null>(null);
  const [confirming, setConfirming] = useState(false); // กำลังย้ายจุด + หาจังหวัดต้นทางใหม่
  const searchSeqRef = useRef(0); // กันผลค้นหาที่ตอบช้ามาทับผลของคำค้นล่าสุด (out-of-order)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ── โหมดวิเคราะห์แบบประเมิน (assessment != null) — state ทั้งหมดเป็นส่วนเพิ่ม ไม่แตะพฤติกรรมเดิม ──
  const gisDsRef = useRef<CustomDataSource | null>(null); // หมุด/เส้นทางจุดหมายวิเคราะห์ (แยกจาก routeDs)
  // ที่มาของพิกัดศูนย์กลางปัจจุบัน — ส่งไปกับผลบันทึกเพื่อความโปร่งใส ("unit" = พิกัดจากแบบประเมิน)
  const centerSourceRef = useRef<"unit" | "search" | "map-pin">("unit");
  const pickedProvinceRef = useRef<string | undefined>(undefined); // จังหวัดของผลค้นหาที่เลือกไว้ (จาก geocode)
  const [gisDestinations, setGisDestinations] = useState<GisDestination[]>([]);
  const [pickedDestType, setPickedDestType] = useState<GisDestinationType>("district_office");
  const [addingDest, setAddingDest] = useState(false);
  // ความสูงสะสมของเส้นทางหลัก (ศาลากลาง→จุดวิเคราะห์ เส้นที่เลือก) — null = ยังไม่ได้/สุ่มไม่สำเร็จ
  const [mainRouteGain, setMainRouteGain] = useState<{ gainM: number; lossM: number } | null>(null);
  const [routeElevationProfile, setRouteElevationProfile] = useState<RouteElevationProfile | null>(null);
  const [routeElevationStatus, setRouteElevationStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [savingGis, setSavingGis] = useState(false);
  const [gisSaveErr, setGisSaveErr] = useState("");
  // จับภาพ 3D ยืนยันที่ตั้ง (9 มุม) แล้วอัปโหลดเข้าแบบประเมินที่เปิดอยู่
  const [capturing, setCapturing] = useState(false);
  const [captureProgress, setCaptureProgress] = useState(0);
  const [captureErr, setCaptureErr] = useState("");
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  // ผลบันทึกครั้งล่าสุด (created/updated/locked) — ใช้แสดงข้อความยืนยันก่อน redirect ไปหน้าแบบประเมิน
  const [saveAction, setSaveAction] = useState<MapAssessmentSaveAction | null>(null);
  const assessmentUnitCenter = assessment?.unitCenter ?? null;
  const distanceFromFormCenterM = useMemo(() => {
    if (!assessmentUnitCenter) return null;
    return haversineM(center.lat, center.lng, assessmentUnitCenter.lat, assessmentUnitCenter.lng);
  }, [assessmentUnitCenter, center.lat, center.lng]);
  const centerDiffersFromForm =
    Boolean(assessment) &&
    (!assessmentUnitCenter || (distanceFromFormCenterM !== null && distanceFromFormCenterM > CENTER_SYNC_TOLERANCE_M));
  const centerMoveTooFar =
    Boolean(assessmentUnitCenter) &&
    distanceFromFormCenterM !== null &&
    distanceFromFormCenterM > MAX_ASSESSMENT_RELOCATION_M;
  const centerMoveTooFarMessage = centerMoveTooFar
    ? `พิกัดที่เลือกอยู่ห่างจากพิกัดในแบบฟอร์มประมาณ ${(distanceFromFormCenterM! / 1000).toFixed(1)} กม. ระบบไม่บันทึกเพื่อกันข้อมูลโรงเรียนอื่นปนกับแบบประเมินนี้`
    : "";

  const replaceEsriImageryLayer = useCallback(
    (maximumLevel: number) => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed() || esriMaxLevelRef.current === maximumLevel) return;

      const previousLayer = imageryLayerRef.current;
      const nextLayer = createEsriImageryLayer(maximumLevel);
      if (previousLayer && viewer.imageryLayers.contains(previousLayer)) {
        viewer.imageryLayers.remove(previousLayer, true);
      }
      viewer.imageryLayers.add(nextLayer, 0);
      imageryLayerRef.current = nextLayer;
      esriMaxLevelRef.current = maximumLevel;
      viewer.scene.requestRender();
    },
    [assessment?.id],
  );

  // ── สร้าง Viewer ครั้งเดียว ─────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    configureCesium();

    let viewer: Viewer;
    try {
      viewer = new Viewer(container, {
        animation: false,
        timeline: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        baseLayerPicker: false,
        infoBox: false,
        selectionIndicator: false,
        // false = เรนเดอร์ตาม devicePixelRatio ของจอ (จอ HiDPI จะคมขึ้นชัดเจน; default true = เรนเดอร์ที่ CSS px จึงดูเบลอ)
        useBrowserRecommendedResolution: false,
        baseLayer: false,
        // จำเป็นสำหรับ canvas.toDataURL() ตอนจับภาพ 3D — ไม่เปิด buffer จะถูกล้างก่อนอ่าน ได้ภาพว่างเปล่า
        contextOptions: { webgl: { preserveDrawingBuffer: true } },
      });
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setStatus("error");
      return;
    }
    viewerRef.current = viewer;
    const imagerySource = preferredImagerySource();
    const imageryLayer = createBaseImageryLayer(imagerySource, ESRI_MAX_REQUEST_LEVEL);
    viewer.imageryLayers.add(imageryLayer, 0);
    imageryLayerRef.current = imageryLayer;
    esriMaxLevelRef.current = ESRI_MAX_REQUEST_LEVEL;
    setImageryStatus(initialImageryStatus(imagerySource, national));

    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.verticalExaggeration = VERTICAL_EXAGGERATION;
    // คุณภาพการเรนเดอร์เมื่อ zoom เข้าใกล้พิกัด: ขอ tile ภาพ/ภูมิประเทศละเอียดขึ้น + ลบรอยหยักขอบเขา
    viewer.scene.globe.maximumScreenSpaceError = GLOBE_SSE;
    viewer.scene.globe.tileCacheSize = 1000; // เก็บ tile ละเอียดไว้มากขึ้น → ไม่เบลอซ้ำตอนหมุน/เลื่อนกล้อง
    try {
      viewer.scene.msaaSamples = 4; // MSAA 4x (ต้อง WebGL2) — ลดขอบหยักของสันเขา
    } catch {
      /* บาง GPU/บริบทไม่รองรับ MSAA — ข้ามไป ไม่กระทบการทำงาน */
    }

    const pinDs = new CustomDataSource("pin");
    void viewer.dataSources.add(pinDs);
    pinDsRef.current = pinDs;

    const polygonDs = new CustomDataSource("polygon");
    void viewer.dataSources.add(polygonDs);
    polygonDsRef.current = polygonDs;

    const routeDs = new CustomDataSource("route");
    void viewer.dataSources.add(routeDs);
    routeDsRef.current = routeDs;

    const buildingsDs = new CustomDataSource("buildings");
    void viewer.dataSources.add(buildingsDs);
    buildingsDsRef.current = buildingsDs;

    const searchDs = new CustomDataSource("search");
    void viewer.dataSources.add(searchDs);
    searchDsRef.current = searchDs;

    const gisDs = new CustomDataSource("gisDest");
    void viewer.dataSources.add(gisDs);
    gisDsRef.current = gisDs;

    const ringsDs = new CustomDataSource("rings");
    void viewer.dataSources.add(ringsDs);
    ringsDsRef.current = ringsDs;

    const bordersDs = new CustomDataSource("borders");
    void viewer.dataSources.add(bordersDs);
    bordersDsRef.current = bordersDs;

    // เข็มทิศทิศเหนือ: อัปเดต transform ตรงๆ ทุกเฟรม (ไม่ผ่าน React state — กล้องหมุนได้ทุก frame ระหว่างลากกล้อง)
    const updateCompass = () => {
      const el = compassNeedleRef.current;
      if (!el) return;
      const headingDeg = CesiumMath.toDegrees(viewer.camera.heading);
      el.style.transform = `rotate(${-headingDeg}deg)`;
    };
    viewer.scene.postRender.addEventListener(updateCompass);

    setStatus("ready");

    let cancelled = false;
    // keyless → Terrarium provider (ไม่มี ion). มี token → ปล่อยให้ผู้ใช้ต่อยอดเป็น World Terrain เองภายหลัง
    Promise.resolve(createTerrariumTerrainProvider())
      .then((provider) => {
        if (cancelled || viewer.isDestroyed()) return;
        viewer.terrainProvider = provider;
        terrainRef.current = provider;
        setTerrainReady(true);
      })
      .catch(() => {
        if (!cancelled) setAnalysisErr("โหลด terrain ไม่สำเร็จ");
      });

    return () => {
      cancelled = true;
      terrainRef.current = null;
      pinDsRef.current = null;
      polygonDsRef.current = null;
      routeDsRef.current = null;
      buildingsDsRef.current = null;
      searchDsRef.current = null;
      gisDsRef.current = null;
      ringsDsRef.current = null;
      bordersDsRef.current = null;
      imageryLayerRef.current = null;
      viewerRef.current = null;
      drawHandlerRef.current?.destroy();
      drawHandlerRef.current = null;
      if (!viewer.isDestroyed()) viewer.scene.postRender.removeEventListener(updateCompass);
      if (!viewer.isDestroyed()) viewer.destroy();
    };
  }, []);

  // ── ตรวจระดับภาพถ่ายจริงของ Esri ณ พิกัดโรงเรียน ─────────────────────────────
  useEffect(() => {
    const imagerySource = preferredImagerySource();
    if (imagerySource !== "esri") {
      setImageryStatus(initialImageryStatus(imagerySource, national));
      return;
    }

    if (national) {
      setImageryStatus({
        source: "esri",
        label: "ภาพถ่าย: Esri World Imagery",
        detail: "ระดับภาพขึ้นกับพื้นที่",
        tone: "muted",
        nativeMaxLevel: null,
        credit: imageryCredit("esri"),
      });
      replaceEsriImageryLayer(ESRI_MAX_REQUEST_LEVEL);
      return;
    }

    const controller = new AbortController();
    setImageryStatus({
      source: "esri",
      label: "ภาพถ่าย: Esri World Imagery",
      detail: "กำลังตรวจระดับภาพจริงของพื้นที่นี้",
      tone: "muted",
      nativeMaxLevel: null,
      credit: imageryCredit("esri"),
    });

    void probeEsriImageryAvailability(center.lat, center.lng, controller.signal).then((availability) => {
      if (controller.signal.aborted) return;

      const nativeMaxLevel = availability.maxAvailableLevel;
      if (availability.status === "unknown") {
        setImageryStatus({
          source: "esri",
          label: "ภาพถ่าย: Esri World Imagery",
          detail: "ตรวจระดับภาพไม่ได้ ใช้ fallback ของ Esri",
          tone: "muted",
          nativeMaxLevel: null,
          credit: imageryCredit("esri"),
        });
        replaceEsriImageryLayer(ESRI_MAX_REQUEST_LEVEL);
        return;
      }

      if (nativeMaxLevel === null) {
        setImageryStatus({
          source: "esri",
          label: "ภาพถ่าย: Esri World Imagery",
          detail: "ไม่พบ tile ภาพถ่ายละเอียดในพื้นที่นี้",
          tone: "warn",
          nativeMaxLevel: null,
          credit: imageryCredit("esri"),
        });
        replaceEsriImageryLayer(ESRI_MAX_REQUEST_LEVEL);
        return;
      }

      const isOverzoomed = nativeMaxLevel < ESRI_MAX_REQUEST_LEVEL;
      setImageryStatus({
        source: "esri",
        label: "ภาพถ่าย: Esri World Imagery",
        detail: isOverzoomed
          ? `ภาพจริงถึง L${nativeMaxLevel}; ซูมลึกกว่านี้เป็นภาพขยาย`
          : `ภาพจริงถึง L${nativeMaxLevel}`,
        tone: isOverzoomed ? "warn" : "ok",
        nativeMaxLevel,
        credit: imageryCredit("esri"),
      });
      replaceEsriImageryLayer(nativeMaxLevel);
    });

    return () => controller.abort();
  }, [center.lat, center.lng, national, replaceEsriImageryLayer]);

  // ── หมุดโรงเรียน เมื่อพร้อม เปลี่ยนพิกัด หรือโหลดระดับความสูงเสร็จ ──────────────
  useEffect(() => {
    const pinDs = pinDsRef.current;
    if (!pinDs || status !== "ready") return;

    pinDs.entities.removeAll();
    centerPinRef.current = null;
    if (!national) {
      const schoolElevationText =
        routeElevationProfile?.schoolElevationM != null
          ? `ระดับความสูง ${formatElevationMeters(routeElevationProfile.schoolElevationM)}`
          : routeElevationStatus === "loading" || routeElevationStatus === "idle"
            ? "กำลังอ่านระดับความสูง…"
            : "ไม่พบข้อมูลระดับความสูง";
      // id "center-pin" ใช้ระบุหมุดตอน pick เพื่อเริ่มลาก; เก็บ entity ไว้ที่ centerPinRef เพื่อย้ายตำแหน่งระหว่างลาก
      centerPinRef.current = pinDs.entities.add({
        id: "center-pin",
        position: Cartesian3.fromDegrees(center.lng, center.lat),
        billboard: {
          image: RED_FLAG_ICON,
          width: 36,
          height: 44,
          verticalOrigin: VerticalOrigin.BOTTOM,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: `${center.name}\n${schoolElevationText}`,
          font: "600 14px 'Sarabun', sans-serif",
          fillColor: Color.WHITE,
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineColor: Color.fromCssColorString("#111827"),
          outlineWidth: 3,
          showBackground: true,
          backgroundColor: Color.fromCssColorString("#b91c1c").withAlpha(0.88),
          backgroundPadding: new Cartesian2(9, 6),
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -48),
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
  }, [center.lat, center.lng, center.name, national, status, routeElevationProfile, routeElevationStatus]);

  // แยกกล้องจาก effect ของหมุด เพื่อไม่ให้กล้องบินซ้ำตอน terrain ส่งค่าความสูงกลับมา
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status !== "ready") return;
    if (national) {
      // มุมมองทั้งประเทศจากด้านบน
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(center.lng, center.lat, 1_500_000),
        orientation: { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 },
        duration: 1.2,
      });
    } else {
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(center.lng, center.lat - 0.03, 4200),
        orientation: { heading: 0, pitch: CesiumMath.toRadians(-38), roll: 0 },
        duration: 1.4,
      });
    }
  }, [center.lat, center.lng, national, status]);

  // ── ดึงเส้นทางรถยนต์จากศาลากลางจังหวัดมาจุดวิเคราะห์ (OSRM demo server สาธารณะ ฟรี ไม่ต้องมี key) ──
  // หมายเหตุ: เป็น demo server ของ OSRM ไม่รับประกัน uptime ระดับ production — ใช้เพื่อแสดงผลประกอบเท่านั้น
  // ขอ alternatives=3 เพื่อให้ผู้ใช้เลือกเส้นทางเองได้ (ปุ่มเส้นทาง 1/2/3) — ส่วนการวาดอยู่ใน effect แยกด้านล่าง
  useEffect(() => {
    if (status !== "ready") return;

    setRoute(null);
    setRouteErr("");
    setRouteSettled(false);
    routeCoordsRef.current = null;
    setRouteAlternatives([]);
    setSelectedRouteIdx(0);

    if (national || !province) {
      setRouteSettled(true); // ไม่มีจังหวัดอ้างอิง/มุมมองทั้งประเทศ → ไม่มีเส้นทางให้ลอง ถือว่า "ลองแล้ว" ทันที
      return;
    }

    const controller = new AbortController();
    setRouteLoading(true);
    fetchOsrmRoutes(province.lng, province.lat, center.lng, center.lat, { alternatives: 3, signal: controller.signal })
      .then((alts) => {
        if (controller.signal.aborted) return;
        setRouteAlternatives(alts);
        setSelectedRouteIdx(0);
        routeCoordsRef.current = alts[0].coords; // เส้นแรกเป็นค่าเริ่มต้นให้ runAnalysis สุ่มความสูง 5 กม.สุดท้าย
        setRoute({ distanceM: alts[0].distanceM, durationS: alts[0].durationS });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setRouteErr(e instanceof Error ? e.message : "โหลดเส้นทางรถยนต์ไม่สำเร็จ");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setRouteLoading(false);
          setRouteSettled(true);
        }
      });

    return () => controller.abort();
  }, [center.lat, center.lng, national, province?.lat, province?.lng, province?.name, status]);

  // ── วาดหมุดศาลากลาง + เส้นทางทางเลือกทั้งหมด (เส้นที่เลือก = น้ำเงินเข้ม/หนา, เส้นอื่น = เทาจาง) ──
  useEffect(() => {
    const routeDs = routeDsRef.current;
    if (!routeDs || status !== "ready") return;
    routeDs.entities.removeAll();
    if (national || !province) return;

    // หมุดศาลากลางจังหวัด (ต้นทางเส้นทาง)
    routeDs.entities.add({
      position: Cartesian3.fromDegrees(province.lng, province.lat),
      point: {
        pixelSize: 10,
        color: Color.fromCssColorString("#2563eb"),
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        heightReference: HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: `ศาลากลางจังหวัด${province.name}`,
        font: "600 13px 'Sarabun', sans-serif",
        fillColor: Color.WHITE,
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.fromCssColorString("#111827"),
        outlineWidth: 3,
        showBackground: true,
        backgroundColor: Color.fromCssColorString("#2563eb").withAlpha(0.85),
        backgroundPadding: new Cartesian2(8, 5),
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -16),
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    // วาดเส้นอื่นก่อน (จาง) แล้วค่อยวาดเส้นที่เลือกทับ (เข้ม) เพื่อให้เส้นที่เลือกอยู่บนสุด
    routeAlternatives.forEach((alt, i) => {
      if (i === selectedRouteIdx) return;
      routeDs.entities.add({
        polyline: {
          positions: alt.coords.map(([lng, lat]) => Cartesian3.fromDegrees(lng, lat)),
          clampToGround: true,
          width: 4,
          material: Color.fromCssColorString("#94a3b8").withAlpha(0.55),
        },
      });
    });
    const sel = routeAlternatives[selectedRouteIdx];
    // เส้นที่เลือก: clampToGround แนบผิวภูมิประเทศ (ground polyline) — มองเห็นบนผิวเสมอและไม่ "จม"
    // (เคยลองยกลอยเหนือพื้นแล้วกลับถูกภูมิประเทศด้านหน้าบังจนหาย เพราะ polyline ปิด depth-test ไม่ได้ — จึงใช้ clampToGround)
    if (sel) {
      routeDs.entities.add({
        polyline: {
          positions: sel.coords.map(([lng, lat]) => Cartesian3.fromDegrees(lng, lat)),
          clampToGround: true,
          width: 6,
          material: Color.fromCssColorString("#2563eb").withAlpha(0.95),
        },
      });
    }

    const highestPoint = routeElevationProfile?.highestPoint;
    if (sel && highestPoint) {
      routeDs.entities.add({
        id: "route-highest-point",
        position: Cartesian3.fromDegrees(highestPoint.lng, highestPoint.lat),
        billboard: {
          image: RED_FLAG_ICON,
          width: 36,
          height: 44,
          verticalOrigin: VerticalOrigin.BOTTOM,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: formatRouteHighestLabel(highestPoint.elevationM),
          font: "600 13px 'Sarabun', sans-serif",
          fillColor: Color.WHITE,
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineColor: Color.fromCssColorString("#111827"),
          outlineWidth: 3,
          showBackground: true,
          backgroundColor: Color.fromCssColorString("#b91c1c").withAlpha(0.88),
          backgroundPadding: new Cartesian2(8, 5),
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -48),
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }

    // โหมดวิเคราะห์แบบประเมิน: วาดเส้นตรงทางอากาศ (เส้นประสีเหลืองอำพัน) เทียบกับเส้นทางถนนจริง
    // เพื่อให้เห็นความคดเคี้ยว (RCR = ระยะถนน ÷ ระยะเส้นตรง) ด้วยตาเปล่า — FR-05 ของ PRD
    if (assessment) {
      const straightM = haversineM(province.lat, province.lng, center.lat, center.lng);
      routeDs.entities.add({
        polyline: {
          positions: [
            Cartesian3.fromDegrees(province.lng, province.lat),
            Cartesian3.fromDegrees(center.lng, center.lat),
          ],
          clampToGround: true,
          width: 3,
          material: new PolylineDashMaterialProperty({
            color: Color.fromCssColorString("#f59e0b").withAlpha(0.95),
            dashLength: 16,
          }),
        },
      });
      routeDs.entities.add({
        position: Cartesian3.fromDegrees((province.lng + center.lng) / 2, (province.lat + center.lat) / 2),
        label: {
          text: `ระยะตรง ${fmtKm(straightM)}`,
          font: "600 12px 'Sarabun', sans-serif",
          fillColor: Color.WHITE,
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineColor: Color.fromCssColorString("#78350f"),
          outlineWidth: 3,
          showBackground: true,
          backgroundColor: Color.fromCssColorString("#f59e0b").withAlpha(0.8),
          backgroundPadding: new Cartesian2(7, 4),
          verticalOrigin: VerticalOrigin.BOTTOM,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
  }, [
    routeAlternatives,
    selectedRouteIdx,
    province,
    national,
    status,
    assessment,
    center.lat,
    center.lng,
    routeElevationProfile,
  ]);

  // ── วาด polygon เอง: จับคลิกบนโลกระหว่างโหมดวาด (ไม่ผูก handler ตอนไม่ได้วาด กันชนกับกล้อง) ──
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status !== "ready" || !drawing) return;

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click: { position: Cartesian2 }) => {
      setPolygonVertices((prev) => {
        if (prev.length >= MAX_POLYGON_VERTICES) return prev;
        const cartesian = viewer.scene.pickPosition(click.position);
        if (!cartesian) return prev; // คลิกพลาดพื้นโลก/ภูมิประเทศ — ข้าม
        const carto = Cartographic.fromCartesian(cartesian);
        // คลิกเฉียดขอบฟ้า/นอกโลก pickPosition อาจคืนพิกัดที่แปลงเป็น NaN — ต้องกันไม่ให้เข้า vertex
        // ไม่งั้น Cesium crash ("cartesian has a NaN component") ตอนวาด polygon และพื้นที่คำนวณเป็น NaN
        if (!carto || !Number.isFinite(carto.latitude) || !Number.isFinite(carto.longitude)) return prev;
        const lat = CesiumMath.toDegrees(carto.latitude);
        const lng = CesiumMath.toDegrees(carto.longitude);
        return [...prev, [lat, lng]];
      });
    }, ScreenSpaceEventType.LEFT_CLICK);
    drawHandlerRef.current = handler;

    return () => {
      handler.destroy();
      drawHandlerRef.current = null;
    };
  }, [status, drawing]);

  // ── ย้ายจุดวิเคราะห์ไปพิกัดใหม่: หาจังหวัด/ศาลากลางต้นทางใหม่ → ย้าย center → คำนวณใหม่ทั้งหมด ──
  // ใช้ร่วมกันทั้งปุ่ม "ยืนยันใช้พิกัดใหม่นี้" (จากการค้นหา) และการลากหมุดบนแผนที่
  const confirmingRef = useRef(false); // กันเรียกซ้ำระหว่างกำลังย้าย (เช่น ลากหมุดรัว ๆ)
  const applyNewCenter = useCallback(async (name: string, lat: number, lng: number, provinceHint?: string) => {
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    setConfirming(true);
    // หาจังหวัดของจุดใหม่ ให้ "ตรงกับตำแหน่งจริงที่ย้ายไป" — ใช้จังหวัดจาก geocode ของผลค้นหา (ถ้ามี)
    // ไม่งั้น reverse-geocode จากพิกัด (กรณีลากหมุด) แล้วส่งเป็น hint ให้ server จับคู่
    // (server fallback: ทะเบียนโรงเรียนเจ้าของแบบประเมิน → ศาลากลางที่ใกล้ที่สุด)
    const hint = provinceHint ?? (await reverseProvince(lat, lng)) ?? undefined;
    let nextProvince: MapProvince | null = null;
    let nextHousehold: number | null = null;
    try {
      const data = await fetchNearestProvince(lat, lng, { assessmentId: assessment?.id, provinceHint: hint });
      nextProvince = data.province ?? null;
      nextHousehold = data.householdSize ?? null;
    } catch {
      // หาจังหวัดไม่ได้ → ปล่อย null (เส้นทางจะไม่มีต้นทาง แต่การวิเคราะห์ภูมิประเทศยังทำงานด้วยเกณฑ์สำรอง)
    }

    // รีเซ็ตผล/สถานะเดิมที่ผูกกับจุดเก่า แล้ว set state ก้อนเดียว (React batch หลัง await) ให้ effect ที่ผูกกับ center คำนวณรอบใหม่
    autoRunRef.current = false; // เปิดให้วิเคราะห์อัตโนมัติทำงานอีกครั้งที่จุดใหม่
    setAnalysis(null);
    setAnalysisErr("");
    setRoute(null);
    setRouteErr("");
    setRouteSettled(false);
    routeCoordsRef.current = null;
    setRouteAlternatives([]);
    setSelectedRouteIdx(0);
    // ล้าง polygon ที่วาดไว้ (ผูกกับจุดเดิม) + หมุดค้นหาชั่วคราว
    setPolygonVertices([]);
    setPolygonClosed(false);
    setPolygonPopulation(null);
    searchDsRef.current?.entities.removeAll();
    // ผลวิเคราะห์แบบประเมินผูกกับจุดเดิม (เส้นทาง center→จุดหมาย) — ล้างให้คำนวณใหม่ที่จุดใหม่
    setGisDestinations([]);
    setMainRouteGain(null);
    setSaveAction(null);
    setGisSaveErr("");
    gisDsRef.current?.entities.removeAll();
    setProvince(nextProvince);
    setHouseholdSize(nextHousehold);
    setNational(false); // ออกจากมุมมองทั้งประเทศ → เข้าโหมดวิเคราะห์รอบจุด
    setCenter({ name, lat, lng });
    setPickedCoord(null); // ซ่อนปุ่มยืนยัน (ถ้ามี)
    setConfirming(false);
    confirmingRef.current = false;
  }, []);

  // ── ลากหมุดจุดวิเคราะห์ (เฉพาะโหมดโรงเรียน ไม่อยู่ระหว่างวาด polygon) ──
  // กดหมุดแดงค้าง → ลากไปตำแหน่งใหม่ → ปล่อย → ย้ายจุดวิเคราะห์ + คำนวณใหม่ (ผ่าน applyNewCenter)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status !== "ready" || national || drawing) return;
    const scene = viewer.scene;
    const handler = new ScreenSpaceEventHandler(scene.canvas);

    const toLatLng = (screenPos: Cartesian2) => {
      // pickPosition = เกาะภูมิประเทศจริง; ถ้าพลาด (ขอบโลก/ท้องฟ้า) ใช้ ellipsoid เป็นสำรอง
      const cart = scene.pickPosition(screenPos) ?? viewer.camera.pickEllipsoid(screenPos, scene.globe.ellipsoid);
      if (!cart) return null;
      const carto = Cartographic.fromCartesian(cart);
      return { lat: CesiumMath.toDegrees(carto.latitude), lng: CesiumMath.toDegrees(carto.longitude) };
    };

    handler.setInputAction((e: { position: Cartesian2 }) => {
      const picked = scene.pick(e.position) as { id?: Entity | string } | undefined;
      const id = picked && typeof picked.id === "object" ? picked.id.id : picked?.id;
      if (id === "center-pin") {
        draggingPinRef.current = true;
        scene.screenSpaceCameraController.enableInputs = false; // ล็อกกล้องระหว่างลาก
        scene.canvas.style.cursor = "grabbing";
      }
    }, ScreenSpaceEventType.LEFT_DOWN);

    handler.setInputAction((e: { endPosition: Cartesian2 }) => {
      if (!draggingPinRef.current) return;
      const ll = toLatLng(e.endPosition);
      if (!ll) return;
      dragLatLngRef.current = ll;
      if (centerPinRef.current) {
        centerPinRef.current.position = new ConstantPositionProperty(Cartesian3.fromDegrees(ll.lng, ll.lat));
      }
      scene.requestRender();
    }, ScreenSpaceEventType.MOUSE_MOVE);

    const endDrag = () => {
      if (!draggingPinRef.current) return;
      draggingPinRef.current = false;
      scene.screenSpaceCameraController.enableInputs = true;
      scene.canvas.style.cursor = "";
      const ll = dragLatLngRef.current;
      dragLatLngRef.current = null;
      if (ll) {
        centerSourceRef.current = "map-pin";
        const nextName = assessment ? assessment.name : `หมุดที่เลื่อน (${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)})`;
        void applyNewCenter(nextName, ll.lat, ll.lng);
      }
    };
    handler.setInputAction(endDrag, ScreenSpaceEventType.LEFT_UP);

    dragHandlerRef.current = handler;
    return () => {
      handler.destroy();
      dragHandlerRef.current = null;
      draggingPinRef.current = false;
      if (!viewer.isDestroyed()) {
        scene.screenSpaceCameraController.enableInputs = true;
        scene.canvas.style.cursor = "";
      }
    };
  }, [status, national, drawing, applyNewCenter, assessment]);

  // ── วาด polygon เอง: render จุด/เส้น/รูปที่วาดไว้บนแผนที่ ─────────────────────
  useEffect(() => {
    const polygonDs = polygonDsRef.current;
    if (!polygonDs || status !== "ready") return;

    polygonDs.entities.removeAll();
    if (polygonVertices.length === 0) return;

    polygonVertices.forEach(([lat, lng], i) => {
      polygonDs.entities.add({
        position: Cartesian3.fromDegrees(lng, lat),
        point: {
          pixelSize: 10,
          color: Color.fromCssColorString("#16a34a"),
          outlineColor: Color.WHITE,
          outlineWidth: 2,
          heightReference: HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: String(i + 1),
          font: "600 12px 'Sarabun', sans-serif",
          fillColor: Color.WHITE,
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineColor: Color.fromCssColorString("#111827"),
          outlineWidth: 3,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -14),
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    });

    if (polygonVertices.length >= 2) {
      const chain = polygonClosed ? [...polygonVertices, polygonVertices[0]] : polygonVertices;
      polygonDs.entities.add({
        polyline: {
          positions: chain.map(([lat, lng]) => Cartesian3.fromDegrees(lng, lat)),
          clampToGround: true,
          width: 3,
          material: Color.fromCssColorString("#16a34a").withAlpha(0.9),
        },
      });
    }

    if (polygonClosed && polygonVertices.length >= 3) {
      polygonDs.entities.add({
        polygon: {
          hierarchy: polygonVertices.map(([lat, lng]) => Cartesian3.fromDegrees(lng, lat)),
          material: Color.fromCssColorString("#16a34a").withAlpha(0.2),
          outline: true,
          outlineColor: Color.fromCssColorString("#15803d"),
          heightReference: HeightReference.CLAMP_TO_GROUND,
        },
      });
    }
  }, [polygonVertices, polygonClosed, status]);

  const handleUndoVertex = useCallback(() => {
    setPolygonVertices((prev) => prev.slice(0, -1));
    setPolygonClosed(false);
    setPolygonPopulation(null);
    setBuildingsErr("");
  }, []);

  const handleClearPolygon = useCallback(() => {
    setDrawing(false);
    setPolygonVertices([]);
    setPolygonClosed(false);
    setPolygonPopulation(null);
    setBuildingsErr("");
    polygonDsRef.current?.entities.removeAll();
    buildingsDsRef.current?.entities.removeAll();
  }, []);

  // ── ค้นหาชื่อสถานที่ (พอร์ตจาก geotech): Autocomplete แบบ debounce, กันผลตอบช้ามาทับด้วย searchSeqRef ──
  const runSearch = useCallback(async (q: string) => {
    const myId = ++searchSeqRef.current;
    if (q.trim().length < PLACE_SEARCH_MIN_CHARS) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    setPlaceSearchErr("");
    try {
      const { results, source } = await searchPlaces(q);
      if (searchSeqRef.current !== myId) return; // มีคำค้นใหม่กว่าแล้ว → ทิ้งผลนี้
      setSearchSource(source);
      setSearchResults(results);
    } catch {
      if (searchSeqRef.current === myId) setSearchResults([]);
    } finally {
      if (searchSeqRef.current === myId) setSearching(false);
    }
  }, []);

  const onSearchChange = useCallback(
    (v: string) => {
      setPlaceQuery(v);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(() => void runSearch(v), PLACE_SEARCH_DEBOUNCE_MS);
    },
    [runSearch],
  );

  // เลือกผลลัพธ์ → แปลงเป็นพิกัด (place_id → geocode) แล้วบินกล้องไป + ปักหมุดชั่วคราว
  const pickResult = useCallback(async (r: PlaceHit) => {
    const title = r.name.split(",")[0];
    setPlaceQuery(title);
    setSearchResults([]);
    setPlaceSearchErr("");
    const coord = await resolvePlaceHit(r);
    if (!coord) {
      setPlaceSearchErr("แปลงพิกัดสถานที่ไม่สำเร็จ");
      return;
    }
    pickedProvinceRef.current = coord.province; // จำจังหวัดของผลค้นหา ไว้ส่งตอนยืนยันย้ายจุด
    const viewer = viewerRef.current;
    const searchDs = searchDsRef.current;
    if (!viewer || !searchDs) return;
    const { lat, lng } = coord;
    searchDs.entities.removeAll();
    searchDs.entities.add({
      position: Cartesian3.fromDegrees(lng, lat),
      point: {
        pixelSize: 12,
        color: Color.fromCssColorString("#7c3aed"),
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        heightReference: HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: title,
        font: "600 13px 'Sarabun', sans-serif",
        fillColor: Color.WHITE,
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.fromCssColorString("#111827"),
        outlineWidth: 3,
        showBackground: true,
        backgroundColor: Color.fromCssColorString("#7c3aed").withAlpha(0.85),
        backgroundPadding: new Cartesian2(8, 5),
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -16),
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(lng, lat - 0.03, 4200),
      orientation: { heading: 0, pitch: CesiumMath.toRadians(-38), roll: 0 },
      duration: 1.4,
    });
    // จำพิกัดที่เลือกไว้ เพื่อโชว์ปุ่ม "ยืนยันใช้พิกัดใหม่นี้" (ยังไม่ย้ายจุดวิเคราะห์จนกว่าจะกดยืนยัน)
    setPickedCoord({ name: title, lat, lng });
  }, []);

  const confirmPickedCoord = useCallback(() => {
    if (!pickedCoord || confirming) return;
    centerSourceRef.current = "search";
    const nextName = assessment ? assessment.name : pickedCoord.name;
    void applyNewCenter(nextName, pickedCoord.lat, pickedCoord.lng, pickedProvinceRef.current);
  }, [pickedCoord, confirming, applyNewCenter, assessment]);

  // เก็บกวาด timer ค้นหาเมื่อ unmount
  useEffect(
    () => () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    },
    [],
  );

  // ── เข็มทิศ: คลิกเพื่อหันกล้องกลับทิศเหนือโดยไม่เปลี่ยนตำแหน่ง/มุมก้ม ──
  const resetNorth = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.camera.flyTo({
      destination: viewer.camera.position,
      orientation: { heading: 0, pitch: viewer.camera.pitch, roll: 0 },
      duration: 0.5,
    });
  }, []);

  // ── ผังอาคาร (Microsoft Global ML Building Footprints) ในพื้นที่ polygon ที่วาดเอง ──
  useEffect(() => {
    const viewer = viewerRef.current;
    const buildingsDs = buildingsDsRef.current;
    if (!viewer || !buildingsDs || status !== "ready") return;

    buildingsDs.entities.removeAll();
    setBuildingsErr("");
    setPolygonPopulation(null);
    // พื้นที่เปลี่ยน → ข้อสรุปที่บันทึกไว้ไม่ตรงกับที่แสดงแล้ว (การบันทึกรวมอยู่ในปุ่มเดียวของกล่อง GIS)
    setSaveAction(null);

    if (national || !polygonClosed || polygonVertices.length < 3) return;

    const centroid = polygonCentroid(polygonVertices);
    const boundingRadius = Math.min(
      Math.ceil(polygonBoundingRadiusM(polygonVertices, centroid) + 50),
      MAX_RADIUS_M_CLIENT,
    );

    const controller = new AbortController();
    setBuildingsLoading(true);
    fetchBuildings(centroid[0], centroid[1], boundingRadius, controller.signal, [], polygonVertices)
      .then((data) => {
        if (controller.signal.aborted) return;
        // วาดเฉพาะอาคารที่อยู่ในรูปที่วาดจริง (point-in-polygon จากจุดศูนย์กลางอาคาร) — ไม่ render อาคารนอกรูปที่ดึงมาด้วย
        let renderedEnclosed = 0;
        for (const feature of data.features) {
          if (!pointInPolygon([feature.lat, feature.lng], polygonVertices)) continue;
          renderedEnclosed += 1;
          const positions = feature.ring.map(([lng, lat]) => Cartesian3.fromDegrees(lng, lat));
          buildingsDs.entities.add({
            polygon: {
              hierarchy: positions,
              material: Color.fromCssColorString("#0ea5e9").withAlpha(0.35),
              outline: true,
              outlineColor: Color.fromCssColorString("#0369a1"),
              heightReference: HeightReference.CLAMP_TO_GROUND,
            },
          });
        }
        // นับจำนวนจริงจากค่าที่ server นับจากชุดเต็ม (data.features ถูกจำกัดจำนวนเพื่อ render จึงนับเองต่ำกว่าจริง
        // ในพื้นที่เมืองหนาแน่น → เคยตันที่ 3000 แล้วจำแนกเป็นชนบทผิด) — ใช้ค่าที่ render ได้เป็น fallback เท่านั้น
        const enclosedCount = data.polygonCount ?? renderedEnclosed;
        const estPopulation = householdSize !== null ? Math.round(enclosedCount * householdSize) : null;
        // ข้อสรุปพื้นที่: พื้นที่จริงของ polygon ที่วาด → ความหนาแน่นอาคาร/ประชากร (กัน ÷0 เมื่อพื้นที่เล็กมาก)
        const areaKm2 = polygonAreaM2(polygonVertices) / 1_000_000;
        const safeArea = areaKm2 > 0.0001 ? areaKm2 : null;
        setPolygonPopulation({
          buildingCount: enclosedCount,
          estPopulation,
          truncated: Boolean(data.truncated),
          areaKm2,
          buildingDensityPerKm2: safeArea !== null ? Math.round(enclosedCount / safeArea) : 0,
          popDensityPerKm2: safeArea !== null && estPopulation !== null ? Math.round(estPopulation / safeArea) : null,
        });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setBuildingsErr(e instanceof Error ? e.message : "โหลดข้อมูลผังอาคารไม่สำเร็จ");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBuildingsLoading(false);
      });

    return () => controller.abort();
  }, [polygonClosed, polygonVertices, status, national, householdSize]);

  // ── วงรัศมี 500/1000/1500 ม. รอบจุดวิเคราะห์: นับอาคาร/ประชากรสะสมต่อวง + จำแนกประเภทชุมชน ──
  useEffect(() => {
    const ringsDs = ringsDsRef.current;
    if (!ringsDs || status !== "ready") return;
    ringsDs.entities.removeAll();
    setRingStats(null);
    setRingSettlement(null);
    setRingsErr("");
    if (national) return;

    // วาดวงกลม 3 วง (บนภูมิประเทศ) + ป้ายระยะ — วาดทันที ไม่ต้องรอข้อมูลอาคาร
    RING_RADII_M.forEach((r, i) => {
      const coords = circleCoords(center.lat, center.lng, r);
      ringsDs.entities.add({
        polyline: {
          positions: coords.map(([lng, lat]) => Cartesian3.fromDegrees(lng, lat)),
          clampToGround: true,
          width: 2,
          material: new PolylineDashMaterialProperty({
            color: Color.fromCssColorString(RING_COLORS[i]).withAlpha(0.9),
            dashLength: 12,
          }),
        },
      });
      // ป้ายระยะที่ขอบด้านเหนือของแต่ละวง
      ringsDs.entities.add({
        position: Cartesian3.fromDegrees(center.lng, center.lat + r / 110540),
        label: {
          text: r >= 1000 ? `${r / 1000} กม.` : `${r} ม.`,
          font: "600 11px 'Sarabun', sans-serif",
          fillColor: Color.WHITE,
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineColor: Color.fromCssColorString("#111827"),
          outlineWidth: 3,
          showBackground: true,
          backgroundColor: Color.fromCssColorString(RING_COLORS[i]).withAlpha(0.85),
          backgroundPadding: new Cartesian2(6, 3),
          verticalOrigin: VerticalOrigin.BOTTOM,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    });

    const controller = new AbortController();
    setRingsLoading(true);
    const maxRadius = RING_RADII_M[RING_RADII_M.length - 1];
    fetchBuildings(center.lat, center.lng, maxRadius, controller.signal, [...RING_RADII_M])
      .then((data) => {
        if (controller.signal.aborted) return;
        // จับคู่ ringCounts (จำนวนสะสม) กับรัศมีที่ขอ — server คืนตามที่ส่งไป
        const byRadius = new Map(data.ringCounts.map((rc) => [rc.radiusM, rc.buildingCount]));
        const stats = RING_RADII_M.map((r) => {
          const buildingCount = byRadius.get(r) ?? 0;
          const population = householdSize !== null ? Math.round(buildingCount * householdSize) : null;
          const areaKm2 = Math.PI * (r / 1000) ** 2; // พื้นที่วงกลมสะสม
          const densityPerKm2 = population !== null && areaKm2 > 0 ? Math.round(population / areaKm2) : null;
          return { radiusM: r, buildingCount, population, densityPerKm2 };
        });
        setRingStats(stats);
        // ประเภทชุมชนจากความหนาแน่นประชากรของวงนอกสุด (พื้นที่ตัวแทนของชุมชนโดยรวมรอบจุด)
        const outer = stats[stats.length - 1];
        if (outer.densityPerKm2 !== null) {
          setRingSettlement({ ...settlementClass(outer.densityPerKm2), densityPerKm2: outer.densityPerKm2 });
        }
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setRingsErr(e instanceof Error ? e.message : "โหลดข้อมูลอาคารสำหรับวงรัศมีไม่สำเร็จ");
      })
      .finally(() => {
        if (!controller.signal.aborted) setRingsLoading(false);
      });

    return () => controller.abort();
  }, [center.lat, center.lng, national, householdSize, status]);

  // ── แนวชายแดนประเทศเพื่อนบ้าน + ป้ายชื่อประเทศ (overlay อ้างอิง เปิด/ปิดได้) ──
  useEffect(() => {
    const bordersDs = bordersDsRef.current;
    if (!bordersDs || status !== "ready") return;
    bordersDs.entities.removeAll();
    setBordersErr("");
    if (!showBorders) return;

    let cancelled = false;
    loadBorders()
      .then((doc) => {
        if (cancelled) return;
        if (doc.borders.length === 0) {
          setBordersErr("ไม่พบชุดข้อมูลเส้นชายแดนไทยที่ใช้ร่วมกับประเทศเพื่อนบ้าน");
          return;
        }
        setBordersCredit(doc.attribution);

        const borderMaterial = Color.fromCssColorString("#f97316").withAlpha(0.96);
        for (const border of doc.borders) {
          for (const chain of border.chains) {
            bordersDs.entities.add({
              polyline: {
                positions: chain.map(([lng, lat]) => Cartesian3.fromDegrees(lng, lat)),
                clampToGround: true,
                width: 2.5,
                material: borderMaterial,
              },
            });
          }
          bordersDs.entities.add({
            position: Cartesian3.fromDegrees(border.label[0], border.label[1]),
            label: {
              text: border.nameTh,
              font: "600 13px 'Sarabun', sans-serif",
              fillColor: Color.WHITE,
              style: LabelStyle.FILL_AND_OUTLINE,
              outlineColor: Color.fromCssColorString("#0f172a"),
              outlineWidth: 3,
              showBackground: true,
              backgroundColor: Color.fromCssColorString("#0f172a").withAlpha(0.72),
              backgroundPadding: new Cartesian2(8, 4),
              verticalOrigin: VerticalOrigin.CENTER,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setBordersErr(e instanceof Error ? e.message : "โหลดแนวชายแดนไม่สำเร็จ");
      });

    return () => {
      cancelled = true;
    };
  }, [showBorders, status]);

  // ── วิเคราะห์ภูมิประเทศรอบจุด (เฉพาะโหมดโรงเรียน) ────────────────────────────
  const runAnalysis = useCallback(async () => {
    const provider = terrainRef.current;
    if (!provider || analyzing) return;
    setAnalyzing(true);
    setAnalysisErr("");
    try {
      const bbox = bboxAround(center.lat, center.lng, AREA_KM);
      const grid = await withTimeout(
        sampleCesiumGrid(provider, bbox, GRID_N, KEYLESS_SAMPLE_LEVEL),
        ANALYSIS_TIMEOUT_MS,
        "วิเคราะห์ภูมิประเทศใช้เวลานานเกินไป โปรดลองอีกครั้งเมื่อเครือข่ายพร้อม",
      );

      // ความสูงตามเส้นทาง: (1) 5 กม.สุดท้าย → จำแนก landform (2) ทั้งเส้น → เกต SSRA ชุมชน
      // สุ่มขนานกัน — ล้มเหลวทีละส่วนได้โดยไม่ทำให้วิเคราะห์หลักล้ม
      let routeTailMaxElev: number | null = null;
      let routeFullMaxElev: number | null = null;
      const routeCoords = routeCoordsRef.current;
      if (routeCoords && routeCoords.length >= 2) {
        const tailPts = downsample(lastRouteSegment(routeCoords, ROUTE_CHECK_DISTANCE_M), MAX_ROUTE_SAMPLE_POINTS).map(
          ([lng, lat]) => ({ lat, lng }),
        );
        const fullPts = routeElevationSampleCoordinates(
          routeCoords,
          [center.lng, center.lat],
          MAX_GAIN_SAMPLE_POINTS,
        ).map(([lng, lat]) => ({ lat, lng }));
        const [tailResult, fullResult] = await Promise.all([
          withTimeout(
            sampleCesiumPoints(provider, tailPts, KEYLESS_SAMPLE_LEVEL),
            ANALYSIS_TIMEOUT_MS,
            "สุ่มความสูงตามเส้นทาง (5 กม.สุดท้าย) ใช้เวลานานเกินไป",
          )
            .then((h) => maxFiniteElev(h))
            .catch(() => null as number | null),
          withTimeout(
            sampleCesiumPoints(provider, fullPts, KEYLESS_SAMPLE_LEVEL),
            ANALYSIS_TIMEOUT_MS,
            "สุ่มความสูงตามเส้นทางทั้งเส้นใช้เวลานานเกินไป",
          )
            .then((h) => maxFiniteElev(h))
            .catch(() => null as number | null),
        ]);
        routeTailMaxElev = tailResult;
        routeFullMaxElev = fullResult;
      }

      const provinceOverride = province ? { name: province.name, avgElev: province.avgElev } : null;
      const m = morphologyFromGrid(grid, GRID_N, ANALYSIS_WIDTH_M, {
        provinceOverride,
        bbox,
        routeTailMaxElev, // landform 5 กม.สุดท้าย
        routeFullMaxElev, // SSRA เกตทั้งเส้น
      });
      setAnalysis(m);
    } catch (e) {
      setAnalysisErr(e instanceof Error ? e.message : "วิเคราะห์ภูมิประเทศไม่สำเร็จ");
    } finally {
      setAnalyzing(false);
    }
  }, [center.lat, center.lng, analyzing, province]);

  // ผู้ใช้กดเลือกเส้นทางอื่น → ใช้เส้นนั้นเป็นเส้นหลัก (routeCoordsRef) + อัปเดตระยะ/เวลา แล้ววิเคราะห์ใหม่
  // (เพราะเกณฑ์ภูเขา/หุบเขาใช้ความสูง 5 กม.สุดท้ายของเส้นทางที่เลือก จึงต้องคำนวณใหม่เมื่อเปลี่ยนเส้น)
  const selectRoute = useCallback(
    (idx: number) => {
      const alt = routeAlternatives[idx];
      if (!alt || idx === selectedRouteIdx) return;
      setSelectedRouteIdx(idx);
      routeCoordsRef.current = alt.coords;
      setRoute({ distanceM: alt.distanceM, durationS: alt.durationS });
      setSaveAction(null); // เปลี่ยนเส้น → ตัวเลข GIS เปลี่ยน → ผลที่บันทึกไว้ไม่ตรงกับที่แสดงแล้ว
      if (autoRunRef.current) void runAnalysis(); // วิเคราะห์รอบแรกผ่านแล้ว → คำนวณใหม่ตามเส้นที่เลือก
    },
    [routeAlternatives, selectedRouteIdx, runAnalysis],
  );

  // วิเคราะห์อัตโนมัติเมื่อ terrain พร้อม + "ลองเส้นทางแล้ว" (โหมดโรงเรียนเท่านั้น) — รอเส้นทางก่อนเพื่อให้จำแนกครั้งแรกแม่นสุด
  useEffect(() => {
    if (national || !terrainReady || !routeSettled || autoRunRef.current) return;
    autoRunRef.current = true;
    void runAnalysis();
  }, [national, terrainReady, routeSettled, runAnalysis]);

  // ════════════════ โหมดวิเคราะห์แบบประเมิน (assessment != null) ════════════════

  // ── โปรไฟล์ความสูงของเส้นทางหลัก: ระดับโรงเรียน จุดสูงสุด และความสูงสะสม ──
  useEffect(() => {
    if (national) {
      setRouteElevationProfile(null);
      setRouteElevationStatus("idle");
      setMainRouteGain(null);
      return;
    }

    const provider = terrainRef.current;
    const selected = routeAlternatives[selectedRouteIdx];
    const selectedRoute = selected && selected.coords.length >= 2 ? selected : null;
    setRouteElevationProfile(null);
    setMainRouteGain(null);

    if (!provider || !terrainReady || (!selectedRoute && !routeSettled)) {
      setRouteElevationStatus("loading");
      return;
    }

    const sampledCoords = routeElevationSampleCoordinates(
      selectedRoute?.coords ?? [],
      [center.lng, center.lat],
      MAX_GAIN_SAMPLE_POINTS,
    );

    let cancelled = false;
    setRouteElevationStatus("loading");
    withTimeout(
      sampleCesiumPoints(
        provider,
        sampledCoords.map(([lng, lat]) => ({ lat, lng })),
        KEYLESS_SAMPLE_LEVEL,
      ),
      ANALYSIS_TIMEOUT_MS,
      "สุ่มระดับความสูงตามเส้นทางใช้เวลานานเกินไป",
    )
      .then((heights) => {
        if (cancelled) return;
        const profile = buildRouteElevationProfile(sampledCoords, heights);
        setRouteElevationProfile(profile);
        setRouteElevationStatus(profile.highestPoint ? "ready" : "error");
        setMainRouteGain(selectedRoute && profile.highestPoint ? elevationGainLoss(Array.from(heights)) : null);
      })
      .catch(() => {
        if (cancelled) return;
        setRouteElevationProfile(null);
        setRouteElevationStatus("error");
        setMainRouteGain(null);
      });
    return () => {
      cancelled = true;
    };
  }, [center.lat, center.lng, national, terrainReady, routeSettled, routeAlternatives, selectedRouteIdx]);

  // ── เพิ่มจุดหมายวิเคราะห์จากผลค้นหา: ดึงเส้นทาง OSRM center→จุดหมาย + สุ่มความสูงสะสม ──
  const addGisDestination = useCallback(
    async (name: string, lat: number, lng: number, type: GisDestinationType) => {
      if (!assessment || gisDestinations.length >= MAX_GIS_DESTINATIONS) return;
      setAddingDest(true);
      setGisSaveErr("");
      const key = `${type}-${lat.toFixed(5)}-${lng.toFixed(5)}`;
      let route: RouteAlt | null = null;
      let error = "";
      try {
        const routes = await fetchOsrmRoutes(center.lng, center.lat, lng, lat);
        route = routes[0];
      } catch {
        error = "โหลดเส้นทางไปจุดหมายไม่สำเร็จ";
      }
      let gain: { gainM: number; lossM: number } | null = null;
      const provider = terrainRef.current;
      if (route && provider) {
        try {
          const points = downsample(route.coords, MAX_GAIN_SAMPLE_POINTS).map(([lng2, lat2]) => ({
            lat: lat2,
            lng: lng2,
          }));
          const heights = await withTimeout(
            sampleCesiumPoints(provider, points, KEYLESS_SAMPLE_LEVEL),
            ANALYSIS_TIMEOUT_MS,
            "สุ่มความสูงสะสมตามเส้นทางใช้เวลานานเกินไป",
          );
          gain = elevationGainLoss(Array.from(heights));
        } catch {
          gain = null; // ไม่มีความสูงสะสมก็ยังใช้ RCR/TTR/ความเร็วได้ — ไม่ถือว่าล้มเหลว
        }
      }
      setGisDestinations((prev) =>
        prev.length >= MAX_GIS_DESTINATIONS
          ? prev
          : [...prev.filter((d) => d.key !== key), { key, destinationType: type, name, lat, lng, route, gain, error }],
      );
      setSaveAction(null);
      // จุดหมายถูกปักถาวรใน gisDs แล้ว — เก็บหมุดค้นหาชั่วคราว + กล่องยืนยันได้
      searchDsRef.current?.entities.removeAll();
      setPickedCoord(null);
      setAddingDest(false);
    },
    [assessment, gisDestinations.length, center.lat, center.lng],
  );

  const removeGisDestination = useCallback((key: string) => {
    setGisDestinations((prev) => prev.filter((d) => d.key !== key));
    setSaveAction(null);
  }, []);

  // ── เปิดแผนที่ซ้ำหลังเคยบันทึกผลไว้: กู้จุดหมายเดิมกลับมา (ดึงเส้นทาง/ความสูงใหม่ให้สด) ──
  // ข้ามศาลากลางจังหวัด — เส้นนั้นคำนวณอัตโนมัติจาก province อยู่แล้ว
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!assessment?.existingGis || restoredRef.current || status !== "ready" || national) return;
    restoredRef.current = true;
    for (const r of assessment.existingGis.routes) {
      if (r.destinationType === "province_hall") continue;
      void addGisDestination(r.destinationName, r.destLat, r.destLng, r.destinationType);
    }
  }, [assessment, status, national, addGisDestination]);

  // ── วาดหมุด/เส้นทางจุดหมายวิเคราะห์ (สีเขียวมรกต + เส้นตรงประจาง) ──
  useEffect(() => {
    const gisDs = gisDsRef.current;
    if (!gisDs || status !== "ready") return;
    gisDs.entities.removeAll();
    if (!assessment || national) return;
    gisDestinations.forEach((d) => {
      gisDs.entities.add({
        position: Cartesian3.fromDegrees(d.lng, d.lat),
        point: {
          pixelSize: 11,
          color: Color.fromCssColorString("#059669"),
          outlineColor: Color.WHITE,
          outlineWidth: 2,
          heightReference: HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: `${GIS_DESTINATION_LABELS[d.destinationType]}: ${d.name}`,
          font: "600 12px 'Sarabun', sans-serif",
          fillColor: Color.WHITE,
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineColor: Color.fromCssColorString("#064e3b"),
          outlineWidth: 3,
          showBackground: true,
          backgroundColor: Color.fromCssColorString("#059669").withAlpha(0.85),
          backgroundPadding: new Cartesian2(7, 4),
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -14),
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      if (d.route) {
        gisDs.entities.add({
          polyline: {
            positions: d.route.coords.map(([lng, lat]) => Cartesian3.fromDegrees(lng, lat)),
            clampToGround: true,
            width: 4,
            material: Color.fromCssColorString("#059669").withAlpha(0.8),
          },
        });
      }
      gisDs.entities.add({
        polyline: {
          positions: [Cartesian3.fromDegrees(center.lng, center.lat), Cartesian3.fromDegrees(d.lng, d.lat)],
          clampToGround: true,
          width: 2,
          material: new PolylineDashMaterialProperty({
            color: Color.fromCssColorString("#f59e0b").withAlpha(0.55),
            dashLength: 12,
          }),
        },
      });
    });
  }, [gisDestinations, assessment, national, status, center.lat, center.lng]);

  // ── ประกอบผลวิเคราะห์ทั้งชุด (preview ฝั่ง client) — ใช้ buildRouteAnalysis เส้นทางเดียวกับ server
  //    เพื่อให้ตัวเลขที่โชว์ตรงกับที่ server จะคำนวณตอนบันทึกเป๊ะ (server คิดใหม่เองเสมอ ไม่เชื่อค่านี้) ──
  const previewGis = useMemo<GisAnalysis | null>(() => {
    if (national) return null;
    const routes: GisRouteAnalysis[] = [];
    const sel = routeAlternatives[selectedRouteIdx];
    if (sel && province) {
      const r = buildRouteAnalysis(
        center.lat,
        center.lng,
        {
          destinationType: "province_hall",
          destinationName: `ศาลากลางจังหวัด${province.name}`,
          destLat: province.lat,
          destLng: province.lng,
          roadDistanceM: sel.distanceM,
          durationS: sel.durationS,
          elevationGainM: mainRouteGain?.gainM ?? null,
          elevationLossM: mainRouteGain?.lossM ?? null,
          selected: true,
        },
        "",
      );
      if (r) routes.push(r);
    }
    for (const d of gisDestinations) {
      if (!d.route) continue;
      const r = buildRouteAnalysis(
        center.lat,
        center.lng,
        {
          destinationType: d.destinationType,
          destinationName: d.name,
          destLat: d.lat,
          destLng: d.lng,
          roadDistanceM: d.route.distanceM,
          durationS: d.route.durationS,
          elevationGainM: d.gain?.gainM ?? null,
          elevationLossM: d.gain?.lossM ?? null,
          selected: true,
        },
        "",
      );
      if (r) routes.push(r);
    }
    if (routes.length === 0 && !analysis) return null;
    return {
      center: {
        lat: center.lat,
        lng: center.lng,
        source: centerSourceRef.current,
        confirmedAt: "",
        nearestProvinceName: province?.name ?? "",
      },
      elevation: analysis
        ? {
            schoolMarkerElevationM: routeElevationProfile?.schoolElevationM ?? null,
            meanElevationM: Math.round(analysis.meanElev),
            minElevationM: Math.round(analysis.minElev),
            maxElevationM: Math.round(analysis.maxElev),
            reliefM: Math.round(analysis.relief),
            meanSlopePct: Math.round(analysis.meanSlopePct * 10) / 10,
            maxSlopePct: Math.round(analysis.maxSlopePct * 10) / 10,
            localMaxElevation1KmM: analysis.local1000Elev === null ? null : Math.round(analysis.local1000Elev),
            slopeClass: analysis.lddClass,
            landformTh: analysis.landformTh,
            terrainConfidence: "client",
            provinceAvgElev: Number.isFinite(analysis.provinceAvgElev) ? Math.round(analysis.provinceAvgElev) : null,
            routeFullMaxElev: routeElevationProfile?.highestPoint
              ? Math.round(routeElevationProfile.highestPoint.elevationM)
              : null,
            routeTailMaxElev: analysis.routeTailMaxElev === null ? null : Math.round(analysis.routeTailMaxElev),
          }
        : null,
      routes,
      autoScore: null,
      appliedToResponses: false,
      savedAt: "",
    };
  }, [
    national,
    routeAlternatives,
    selectedRouteIdx,
    province,
    center.lat,
    center.lng,
    mainRouteGain,
    gisDestinations,
    analysis,
    routeElevationProfile,
  ]);

  const previewAuto = useMemo(() => (previewGis ? computeAutoGisScore(previewGis, "") : null), [previewGis]);
  const previewSeverity = previewGis ? derive32Severity(previewGis) : null;
  const previewCommunity = useMemo(() => (previewGis ? computeCommunityClass(previewGis, "") : null), [previewGis]);

  // ข้อสรุปพื้นที่ปัจจุบัน (จากผังอาคารที่วาด) — null ถ้ายังไม่ได้ประมวลผล/พื้นที่เป็นศูนย์
  const currentAreaSummary = useMemo<GisAreaSummary | null>(() => {
    if (!polygonPopulation || polygonPopulation.areaKm2 <= 0) return null;
    return {
      areaKm2: polygonPopulation.areaKm2,
      buildingCount: polygonPopulation.buildingCount,
      estPopulation: polygonPopulation.estPopulation,
      buildingDensityPerKm2: polygonPopulation.buildingDensityPerKm2,
      popDensityPerKm2: polygonPopulation.popDensityPerKm2,
      settlementLabel:
        polygonPopulation.popDensityPerKm2 !== null ? settlementClass(polygonPopulation.popDensityPerKm2).label : "",
      calculatedAt: "",
    };
  }, [polygonPopulation]);

  // ประกอบ payload เส้นทาง สำหรับปุ่มบันทึกครั้งเดียว (POST /api/assessments/from-map)
  const buildRoutesPayload = useCallback((): Record<string, unknown>[] => {
    const sel = routeAlternatives[selectedRouteIdx];
    const routes: Record<string, unknown>[] = [];
    if (sel && province) {
      routes.push({
        destinationType: "province_hall",
        destinationName: `ศาลากลางจังหวัด${province.name}`,
        destLat: province.lat,
        destLng: province.lng,
        roadDistanceM: sel.distanceM,
        durationS: sel.durationS,
        elevationGainM: mainRouteGain?.gainM ?? null,
        elevationLossM: mainRouteGain?.lossM ?? null,
        selected: true,
        // จุดสูงสุดของเส้นทางหลัก = ชุดตัวอย่างเดียวกับธงแดงบนแผนที่ → ค่า max ที่บันทึกตรงกับที่ผู้ใช้เห็น
        highestPoint: routeElevationProfile?.highestPoint ?? null,
      });
    }
    for (const d of gisDestinations) {
      if (!d.route) continue;
      routes.push({
        destinationType: d.destinationType,
        destinationName: d.name,
        destLat: d.lat,
        destLng: d.lng,
        roadDistanceM: d.route.distanceM,
        durationS: d.route.durationS,
        elevationGainM: d.gain?.gainM ?? null,
        elevationLossM: d.gain?.lossM ?? null,
        selected: true,
        highestPoint: null,
      });
    }
    return routes;
  }, [routeAlternatives, selectedRouteIdx, province, mainRouteGain, gisDestinations, routeElevationProfile]);

  // ── บันทึกครั้งเดียว: POST /api/assessments/from-map — server ผูกกับ (โรงเรียน, ปีปัจจุบัน) จาก session
  //    สร้าง/ปรับปรุงแบบประเมิน + กรอกข้อมูลประกอบ + คำนวณคะแนนด้านที่ 3 ให้เสมอ แล้วพาไปหน้าแบบประเมิน ──
  const saveAssessmentFromMap = useCallback(async () => {
    if (!canSaveAssessment || savingGis || !previewGis) return;
    setSavingGis(true);
    setGisSaveErr("");
    try {
      const response = await fetch("/api/assessments/from-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syncUnitLocation: centerDiffersFromForm,
          center: { lat: center.lat, lng: center.lng, source: centerSourceRef.current },
          elevation: previewGis.elevation,
          routes: buildRoutesPayload(),
          radiusSummaries: ringStats?.map((ring) => ({
            radiusM: ring.radiusM,
            buildingCount: ring.buildingCount,
            estPopulation: ring.population,
            popDensityPerKm2: ring.densityPerKm2,
          })),
          areaSummary: currentAreaSummary ?? undefined,
          dataSources: {
            terrain: "Terrarium DEM",
            routing: "OSRM",
            buildings: ringStats ? "Microsoft Building Footprints" : null,
            populationMethod: householdSize !== null ? "building-count-x-provincial-household-size" : null,
            analyzedAt: new Date().toISOString(),
          },
        }),
      });
      const data = (await response.json()) as MapAssessmentSaveResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "บันทึกข้อมูลไม่สำเร็จ");
      setSaveAction(data.action);
      window.location.assign(`/assessment/${data.assessmentId}`);
    } catch (error) {
      setGisSaveErr(error instanceof Error ? error.message : "บันทึกข้อมูลไม่สำเร็จ");
    } finally {
      setSavingGis(false);
    }
  }, [
    canSaveAssessment,
    savingGis,
    previewGis,
    center,
    centerDiffersFromForm,
    ringStats,
    currentAreaSummary,
    householdSize,
    buildRoutesPayload,
  ]);

  // ── จับภาพ 3D ยืนยันที่ตั้ง: หมุนกล้องไป 9 มุมตายตัว จับภาพแต่ละมุม แล้วอัปโหลดเข้าแบบประเมินที่เปิดอยู่ ──
  //    ทำงานเฉพาะเมื่อมี assessment?.id (ไม่สร้างแบบประเมินเอง) — คืนมุมกล้องเดิมเสมอใน finally
  const captureSiteSnapshots = useCallback(async () => {
    const viewer = viewerRef.current;
    const targetId = assessment?.id;
    if (!viewer || capturing || national || !targetId) return;
    setCapturing(true);
    setCaptureErr("");
    setCaptureProgress(0);

    const prevPos = viewer.camera.position.clone();
    const prevHeading = viewer.camera.heading;
    const prevPitch = viewer.camera.pitch;
    const prevRoll = viewer.camera.roll;
    const prevResolutionScale = viewer.resolutionScale;

    try {
      // เรนเดอร์ละเอียดขึ้น 2 เท่าเฉพาะตอนจับภาพ → ไฟล์ JPEG คมขึ้นมาก (คืนค่าเดิมใน finally)
      viewer.resolutionScale = SNAPSHOT_RESOLUTION_SCALE;

      // เล็งกล้องมาที่หมุดโรงเรียน (center) เสมอ ด้วย lookAt — หมุดจึงอยู่กึ่งกลางภาพทุกมุม ทั้งใกล้/ไกล
      // สำคัญ: ต้องเล็งที่ "ผิวภูมิประเทศจริง" ไม่ใช่ผิวทรงรี (ความสูง 0) — หมุดถูก clamp ติดพื้น ถ้าโรงเรียน
      // อยู่บนดอยสูง ~1,000 ม. การเล็งที่ความสูง 0 จะทำให้หมุดลอยเหนือจุดเล็งจนหลุดออกนอกภาพในมุมใกล้
      const pinCarto = Cartographic.fromDegrees(center.lng, center.lat);
      const terrainHeightM = viewer.scene.globe.getHeight(pinCarto);
      const pinHeightM = Number.isFinite(terrainHeightM)
        ? (terrainHeightM as number)
        : (routeElevationProfile?.schoolElevationM ?? 0);
      const pin = Cartesian3.fromDegrees(center.lng, center.lat, pinHeightM);
      const blobs: { blob: Blob; viewKey: string }[] = [];
      for (let i = 0; i < SNAPSHOT_VIEWS.length; i++) {
        const view = SNAPSHOT_VIEWS[i];
        if (view.frame === "school-and-province") {
          // มุมภาพรวมครอบทั้งโรงเรียนและศาลากลางจังหวัด — ต้องมีพิกัดศาลากลาง (province) ไม่งั้นข้ามมุมนี้ไป
          if (!province) {
            setCaptureProgress(i + 1);
            continue;
          }
          const hallCarto = Cartographic.fromDegrees(province.lng, province.lat);
          const hallHeightM = viewer.scene.globe.getHeight(hallCarto);
          const hall = Cartesian3.fromDegrees(
            province.lng,
            province.lat,
            Number.isFinite(hallHeightM) ? (hallHeightM as number) : 0,
          );
          // เล็งกึ่งกลางระหว่างสองจุด แล้วถอยกล้องด้วยระยะที่คำนวณจาก fov + aspect จริง ให้ทรงกลม (ครอบทั้งสองจุด)
          // อยู่ในเฟรมครบเสมอ — ตัวคูณตายตัวเดิมไม่พอสำหรับจอแนวนอน ทำให้จุดบน/ล่างหลุดขอบ (ดู overviewFitRangeM)
          const sphere = BoundingSphere.fromPoints([pin, hall]);
          const frustumFov = (viewer.camera.frustum as { fov?: number }).fov;
          const canvasW = viewer.canvas.clientWidth || viewer.canvas.width;
          const canvasH = viewer.canvas.clientHeight || viewer.canvas.height;
          const aspect = canvasW > 0 && canvasH > 0 ? canvasW / canvasH : 1;
          const fitRange =
            typeof frustumFov === "number" && frustumFov > 0
              ? overviewFitRangeM(sphere.radius, frustumFov, aspect)
              : sphere.radius * SNAPSHOT_OVERVIEW_FALLBACK_FACTOR;
          viewer.camera.viewBoundingSphere(
            sphere,
            new HeadingPitchRange(
              CesiumMath.toRadians(view.headingDeg),
              CesiumMath.toRadians(view.pitchDeg),
              fitRange,
            ),
          );
        } else {
          // เล็งกล้องมาที่หมุดโรงเรียนเสมอ ด้วย lookAt — หมุดจึงอยู่กึ่งกลางภาพทุกมุม ทั้งใกล้/ไกล
          viewer.camera.lookAt(
            pin,
            new HeadingPitchRange(
              CesiumMath.toRadians(view.headingDeg),
              CesiumMath.toRadians(view.pitchDeg),
              view.rangeM,
            ),
          );
        }
        // รอไทล์ของมุมใหม่ให้นิ่งจริง (เห็น tilesLoaded ติดกัน 3 รอบ) ก่อนจับภาพ — กันภาพเบลอ/ไทล์หยาบค้าง
        await waitForTilesLoaded(viewer, SNAPSHOT_TILE_WAIT_MS, SNAPSHOT_TILE_STABLE_TICKS);
        blobs.push({ blob: dataUrlToBlob(captureCurrentView(viewer)), viewKey: view.key });
        setCaptureProgress(i + 1);
      }
      // (transform ของ lookAt ถูกปลดล็อกใน finally เสมอ ก่อนคืนมุมกล้องเดิม)

      const fd = new FormData();
      for (const b of blobs) fd.append("files", b.blob, `${b.viewKey}.jpg`);
      fd.append("viewKeys", JSON.stringify(blobs.map((b) => b.viewKey)));
      const res = await fetch(`/api/assessments/${targetId}/site-snapshots`, { method: "POST", body: fd });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "อัปโหลดภาพไม่สำเร็จ");
      }
      // วิเคราะห์ภูมิประเทศด้วย AI ต่อทันที — ถ้าล้มเหลวก็ยังไปหน้าแบบประเมิน (ภาพครบแล้ว)
      setCaptureProgress(SNAPSHOT_VIEWS.length);
      setAiAnalyzing(true);
      try {
        await fetch(`/api/assessments/${targetId}/site-snapshots/analyze`, { method: "POST" });
      } catch {
        /* เงียบ — คำแนะนำ AI เป็นส่วนเสริม */
      } finally {
        setAiAnalyzing(false);
      }
      window.location.assign(`/assessment/${targetId}#unitPanel`);
    } catch (e) {
      setCaptureErr(e instanceof Error ? e.message : "จับภาพไม่สำเร็จ");
    } finally {
      if (!viewer.isDestroyed()) {
        viewer.resolutionScale = prevResolutionScale;
        // ปลดล็อก lookAt transform เผื่อ error กลางลูปทำให้ยังค้าง ก่อนคืนมุมกล้องเดิม
        viewer.camera.lookAtTransform(Matrix4.IDENTITY);
        viewer.camera.setView({
          destination: prevPos,
          orientation: { heading: prevHeading, pitch: prevPitch, roll: prevRoll },
        });
      }
      setCapturing(false);
    }
  }, [capturing, national, center, assessment, routeElevationProfile, province]);

  return (
    <div
      className="map-stage"
      data-imagery-source={imageryStatus.source}
      data-esri-native-level={imageryStatus.nativeMaxLevel ?? ""}
    >
      {/* widgets.css โหลดจาก public (คัดลอกโดย scripts/copy-cesium.mjs) — ไม่ผ่าน webpack เพื่อเลี่ยงปัญหา asset */}
      <link rel="stylesheet" href="/cesium/Widgets/widgets.css" />
      <div ref={containerRef} className="cesium-container" />

      {status === "ready" ? (
        <button
          type="button"
          className="map-compass"
          onClick={resetNorth}
          title="คลิกเพื่อหันกล้องไปทิศเหนือ"
          aria-label="ทิศเหนือ — คลิกเพื่อรีเซ็ต"
        >
          <div ref={compassNeedleRef} className="map-compass-needle">
            <span className="map-compass-n">N</span>
            <span className="map-compass-arrow" />
          </div>
        </button>
      ) : null}

      {buildingsLoading ? (
        <div className="map-processing-overlay" role="status" aria-live="polite">
          {/* ภาพโลกเคลื่อนไหวระหว่างรอประมวลผล — WebP พื้นหลังโปร่งใส (แปลงจาก animate_glob.gif ด้วย Pillow) */}
          <img src="/animate_glob.webp" alt="" aria-hidden className="map-spinner-gif" />
          <p>กรุณารอสักครู่จนกว่าจะประมวลผลเสร็จ...</p>
        </div>
      ) : null}

      {status === "error" ? (
        <div className="map-panel map-panel-error">
          <strong>เปิดแผนที่ 3 มิติไม่สำเร็จ</strong>
          <span>{errMsg}</span>
        </div>
      ) : panelExpanded ? (
        <aside id="cesium-map-panel" className="map-panel">
          <div className="map-panel-heading">
            <div>
              <h2 className="map-panel-title">แผนที่ 3 มิติ (Cesium)</h2>
              <p className="map-panel-sub">{national ? "มุมมองทั้งประเทศ" : center.name}</p>
            </div>
            <MapPanelToggle expanded onToggle={() => setPanelExpanded(false)} />
          </div>
          <div className="map-coord">
            พิกัด: {center.lat.toFixed(5)}, {center.lng.toFixed(5)}
          </div>
          {!national ? (
            <p className="map-drag-hint">💡 ลากหมุดแดงบนแผนที่เพื่อย้ายจุดวิเคราะห์ แล้วระบบจะคำนวณใหม่ให้อัตโนมัติ</p>
          ) : null}

          {showPlaceSearch ? (
            <div className="map-search">
              <input
                type="text"
                placeholder="ค้นหาสถานที่ เช่น วัดพระแก้ว, เชียงใหม่ (พิมพ์ ≥3 ตัวอักษร)"
                value={placeQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && searchResults.length > 0) {
                    e.preventDefault();
                    void pickResult(searchResults[0]); // Enter = เลือกผลลัพธ์แรก
                  } else if (e.key === "Escape") {
                    setSearchResults([]);
                  }
                }}
              />
              {searching ? <span className="map-search-spinner" aria-hidden /> : null}
              {searchResults.length > 0 ? (
                <div className="map-search-results" role="listbox">
                  <div className="map-search-source">ผลจาก {searchSource}</div>
                  {searchResults.map((r, i) => (
                    <button
                      key={`${r.placeId ?? r.name}-${i}`}
                      type="button"
                      role="option"
                      aria-selected={false}
                      className="map-search-result"
                      onClick={() => void pickResult(r)}
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {placeSearchErr ? <p className="map-note map-note-error">{placeSearchErr}</p> : null}

          {pickedCoord ? (
            <div className="map-confirm-coord">
              <div className="map-confirm-coord-info">
                <span>{assessment ? "ผลค้นหาที่เลือก" : "ย้ายจุดวิเคราะห์ไปที่"}</span>
                <strong>{pickedCoord.name}</strong>
                <em>
                  {pickedCoord.lat.toFixed(5)}, {pickedCoord.lng.toFixed(5)}
                </em>
              </div>
              {/* ปุ่ม/แถบ "เพิ่มเป็นจุดหมายวิเคราะห์" นี้ป้อนข้อมูลที่บันทึกลงฉบับ "ปีปัจจุบัน" เสมอ (ผ่านปุ่มบันทึกใน
                  GisAssessmentPanel → POST /api/assessments/from-map) จึงต้องเช็ค currentYearAssessment.submitted
                  ไม่ใช่ assessment.submitted ของฉบับที่กำลังเปิดดู (อาจเป็นปีอื่น) */}
              {assessment && !national && !currentYearAssessment?.submitted ? (
                <>
                  <p className="map-note map-confirm-coord-warning">
                    ถ้าจุดนี้คือสำนักงานเขต/สกร.อำเภอ/โรงพยาบาล ให้ใช้ปุ่ม “เพิ่มเป็นจุดหมายวิเคราะห์” ด้านล่าง
                    เพื่อไม่ให้พิกัดโรงเรียนในแบบฟอร์มถูกเปลี่ยน
                  </p>
                  <GisDestAddBar
                    pickedDestType={pickedDestType}
                    onPickedDestTypeChange={setPickedDestType}
                    addingDest={addingDest}
                    destCount={gisDestinations.length}
                    onAdd={() =>
                      void addGisDestination(pickedCoord.name, pickedCoord.lat, pickedCoord.lng, pickedDestType)
                    }
                  />
                  <div className="map-confirm-school-move">
                    <span className="map-confirm-school-label">ใช้เฉพาะกรณีต้องแก้พิกัดโรงเรียนในแบบฟอร์ม</span>
                    <button
                      type="button"
                      className="map-confirm-coord-btn map-confirm-school-btn"
                      onClick={() => void confirmPickedCoord()}
                      disabled={confirming}
                    >
                      {confirming ? "กำลังเปลี่ยนพิกัด…" : "เปลี่ยนพิกัดโรงเรียนเป็นจุดนี้"}
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="map-confirm-coord-btn"
                  onClick={() => void confirmPickedCoord()}
                  disabled={confirming}
                >
                  {confirming ? "กำลังย้ายจุด…" : "ยืนยันใช้พิกัดใหม่นี้"}
                </button>
              )}
            </div>
          ) : null}

          <div className={`map-imagery-status map-imagery-status-${imageryStatus.tone}`}>
            <span>{imageryStatus.label}</span>
            <strong>{imageryStatus.detail}</strong>
          </div>

          <label className="map-border-toggle">
            <input type="checkbox" checked={showBorders} onChange={(e) => setShowBorders(e.target.checked)} />
            <span>แสดงแนวชายแดนไทย + ชื่อประเทศเพื่อนบ้าน</span>
          </label>
          {bordersErr ? <p className="map-note map-note-error">{bordersErr}</p> : null}
          {showBorders && bordersCredit && !bordersErr ? (
            <p className="map-note map-note-credit">แนวชายแดน: {bordersCredit}</p>
          ) : null}

          {national ? (
            <p className="map-note">
              บัญชีผู้ดูแล/เจ้าหน้าที่ไม่ผูกกับโรงเรียนใดโรงเรียนหนึ่ง จึงแสดงมุมมองทั้งประเทศ —
              ผู้ใช้บทบาทโรงเรียนจะเห็นแผนที่ตั้งจุดที่โรงเรียนของตนเองพร้อมผลวิเคราะห์ภูมิประเทศ
            </p>
          ) : (
            <>
              <dl className="map-stats">
                <div>
                  <dt>เส้นทางรถยนต์จากศาลากลางจังหวัด{province?.name ? province.name : ""}</dt>
                  <dd>
                    {routeLoading
                      ? "กำลังค้นหาเส้นทาง…"
                      : routeErr
                        ? routeErr
                        : route
                          ? `${fmtKm(route.distanceM)} • ใช้เวลาประมาณ ${fmtDuration(route.durationS)}`
                          : province
                            ? "—"
                            : "ไม่พบข้อมูลจังหวัดอ้างอิง"}
                  </dd>
                </div>
              </dl>

              {routeAlternatives.length > 1 ? (
                <div className="map-route-picker">
                  <span className="map-route-picker-label">เลือกเส้นทาง ({routeAlternatives.length} เส้น)</span>
                  <div className="map-route-picker-btns">
                    {routeAlternatives.map((alt, i) => (
                      <button
                        key={i}
                        type="button"
                        className={`map-route-btn${i === selectedRouteIdx ? " map-route-btn-active" : ""}`}
                        onClick={() => selectRoute(i)}
                        title={`${fmtKm(alt.distanceM)} • ใช้เวลาประมาณ ${fmtDuration(alt.durationS)}`}
                      >
                        <strong>เส้นทาง {i + 1}</strong>
                        <em>{fmtKm(alt.distanceM)}</em>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* วงรัศมี 500/1000/1500 ม.: จำนวนอาคาร/ประชากรสะสมต่อวง + ประเภทชุมชนโดยรอบ */}
              <div className="map-rings">
                <h3 className="map-population-title">ประชากรตามวงรัศมีรอบจุด</h3>
                {ringsLoading ? (
                  <p className="map-note">กำลังนับอาคารในแต่ละวงรัศมี…</p>
                ) : ringsErr ? (
                  <p className="map-note map-note-error">{ringsErr}</p>
                ) : ringStats ? (
                  <>
                    <table className="map-rings-table">
                      <thead>
                        <tr>
                          <th>รัศมี</th>
                          <th>อาคาร</th>
                          <th>ประชากร≈</th>
                          <th>คน/ตร.กม.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ringStats.map((r, i) => (
                          <tr key={r.radiusM}>
                            <td>
                              <span className="map-ring-dot" style={{ background: RING_COLORS[i] }} />
                              {r.radiusM >= 1000 ? `${r.radiusM / 1000} กม.` : `${r.radiusM} ม.`}
                            </td>
                            <td>{r.buildingCount.toLocaleString("th-TH")}</td>
                            <td>{r.population !== null ? r.population.toLocaleString("th-TH") : "—"}</td>
                            <td>{r.densityPerKm2 !== null ? r.densityPerKm2.toLocaleString("th-TH") : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="map-note">
                      นับสะสมภายในแต่ละรัศมี จากผังอาคาร ML × ขนาดครัวเรือนเฉลี่ยจังหวัด
                      {householdSize !== null ? ` (${householdSize.toFixed(1)} คน/ครัวเรือน)` : ""} — ค่าประมาณ
                      ไม่ใช่สำมะโนจริง
                    </p>
                    {ringSettlement ? (
                      <div className={`map-area-summary map-area-summary-${ringSettlement.tone}`}>
                        <p className="map-area-summary-verdict">
                          ความหนาแน่นการตั้งถิ่นฐานโดยรอบ (แกน C · รัศมี 1.5 กม.):{" "}
                          <strong>{ringSettlement.label}</strong> — {ringSettlement.hint}
                        </p>
                        <p className="map-note">
                          แกนความหนาแน่นเท่านั้น — ไม่ใช่การจำแนกพื้นที่สูง/ห่างไกล (ดูกล่องวิเคราะห์ GIS ด้านล่าง)
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="map-note">
                    ยังไม่พบอาคารในบริเวณนี้ (พื้นที่เบาบางมาก หรือกำลังนำเข้าข้อมูลผังอาคารครั้งแรก)
                  </p>
                )}
              </div>

              {assessment && centerDiffersFromForm ? (
                <p className={`map-note ${centerMoveTooFar ? "map-note-error" : "map-note-sync"}`}>
                  {centerMoveTooFar
                    ? centerMoveTooFarMessage
                    : "พิกัดจุดโรงเรียนในแผนที่ถูกย้ายจากค่าที่อยู่ในแบบฟอร์ม ระบบจะบันทึกละติจูด/ลองจิจูดให้อัปเดตพร้อมผล GIS"}
                </p>
              ) : null}

              {!national && (canSaveAssessment || assessment) ? (
                <GisAssessmentPanel
                  assessment={
                    assessment ? { id: assessment.id, submitted: assessment.submitted, year: assessment.year } : null
                  }
                  currentYear={currentYearAssessment}
                  canSaveAssessment={canSaveAssessment}
                  previewGis={previewGis}
                  previewAuto={previewAuto}
                  previewSeverity={previewSeverity}
                  previewCommunity={previewCommunity}
                  destErrors={gisDestinations
                    .filter((d) => d.error)
                    .map((d) => ({
                      key: d.key,
                      destinationType: d.destinationType,
                      name: d.name,
                      error: d.error,
                    }))}
                  destCount={gisDestinations.length}
                  routeElevationReady={routeElevationStatus === "ready"}
                  saveState={savingGis ? "saving" : "idle"}
                  saveAction={saveAction}
                  saveErr={gisSaveErr}
                  onSave={() => void saveAssessmentFromMap()}
                  onRemoveDestination={removeGisDestination}
                />
              ) : null}

              {!national ? (
                <div className="map-snapshot-block">
                  {assessment?.id ? (
                    <>
                      <button
                        type="button"
                        className="ghost-btn map-snapshot-btn"
                        onClick={captureSiteSnapshots}
                        disabled={capturing || aiAnalyzing || Boolean(assessment.submitted)}
                      >
                        {capturing
                          ? `กำลังจับภาพ ${captureProgress}/${SNAPSHOT_VIEWS.length}…`
                          : aiAnalyzing
                            ? "กำลังวิเคราะห์ภูมิประเทศด้วย AI…"
                            : "📸 จับภาพ 3D ยืนยันที่ตั้ง"}
                      </button>
                      {captureErr ? <p className="map-snapshot-err">{captureErr}</p> : null}
                      <p className="map-snapshot-hint">
                        จับภาพ 9 มุม (มุมบน + ใกล้/ไกล 4 ทิศ) แล้วแนบเข้าแบบประเมินในหัวข้อ “ลักษณะที่ตั้ง” — จับใหม่จะแทนชุดเดิม
                      </p>
                    </>
                  ) : (
                    <p className="map-snapshot-hint">
                      กดบันทึกแบบประเมินก่อน แล้วเปิดแผนที่จากแบบประเมินอีกครั้งเพื่อจับภาพ 3D ยืนยันที่ตั้ง
                    </p>
                  )}
                </div>
              ) : null}

              <div className="map-population">
                <h3 className="map-population-title">คำนวณประชากรโดยประมาณในพื้นที่ที่วาด</h3>

                <div className="map-draw-controls">
                  <button
                    className="ghost-btn"
                    type="button"
                    onClick={() => setDrawing(true)}
                    disabled={polygonVertices.length > 0}
                  >
                    เริ่มวาด
                  </button>
                  <button
                    className="ghost-btn"
                    type="button"
                    onClick={() => {
                      setDrawing(false);
                      setPolygonClosed(true);
                    }}
                    disabled={!drawing || polygonVertices.length < 3}
                  >
                    เสร็จสิ้น
                  </button>
                  <button
                    className="ghost-btn"
                    type="button"
                    onClick={handleUndoVertex}
                    disabled={polygonVertices.length === 0}
                  >
                    ย้อนกลับ
                  </button>
                  <button
                    className="ghost-btn danger"
                    type="button"
                    onClick={handleClearPolygon}
                    disabled={polygonVertices.length === 0}
                  >
                    ล้างพื้นที่
                  </button>
                </div>
                <p className="map-note">
                  คลิกบนแผนที่เพื่อกำหนดจุดขอบเขตพื้นที่ ({polygonVertices.length}/{MAX_POLYGON_VERTICES} จุด)
                  {polygonVertices.length >= MAX_POLYGON_VERTICES ? " — ครบจำนวนสูงสุดแล้ว" : ""}
                </p>

                {buildingsLoading ? (
                  <p className="map-note">กำลังคำนวณ… (รอข้อมูลผังอาคารโหลดเสร็จก่อน)</p>
                ) : buildingsErr ? (
                  <p className="map-note map-note-error">{buildingsErr}</p>
                ) : polygonPopulation ? (
                  <>
                    <dl className="map-stats">
                      <div>
                        <dt>จำนวนอาคารในพื้นที่ที่วาด</dt>
                        <dd>{polygonPopulation.buildingCount.toLocaleString("th-TH")} หลัง</dd>
                      </div>
                      <div>
                        <dt>ประชากรโดยประมาณ</dt>
                        <dd>
                          {polygonPopulation.estPopulation !== null
                            ? `${polygonPopulation.estPopulation.toLocaleString("th-TH")} คน`
                            : "—"}
                        </dd>
                      </div>
                    </dl>
                    <p className="map-note">
                      ประมาณจากจำนวนอาคาร (Microsoft Building Footprints) คูณขนาดครัวเรือนเฉลี่ยของจังหวัด
                      {householdSize !== null ? ` (${householdSize.toFixed(1)} คน/ครัวเรือน)` : ""} —
                      ไม่ใช่ข้อมูลสำมะโนประชากรจริง
                      {polygonPopulation.truncated
                        ? " (แผนที่แสดงอาคารบางส่วนเพื่อความลื่นไหล แต่จำนวนที่นับรวมอาคารทั้งหมดในพื้นที่แล้ว)"
                        : ""}
                    </p>

                    {/* ข้อสรุปของพื้นที่หลังประมวลผลผังอาคาร — ปิดท้ายส่วนข้อมูล */}
                    {polygonPopulation.areaKm2 > 0
                      ? (() => {
                          const cls =
                            polygonPopulation.popDensityPerKm2 !== null
                              ? settlementClass(polygonPopulation.popDensityPerKm2)
                              : null;
                          return (
                            <div className={`map-area-summary${cls ? ` map-area-summary-${cls.tone}` : ""}`}>
                              <h4 className="map-area-summary-title">ข้อสรุปของพื้นที่</h4>
                              <dl className="map-stats">
                                <div>
                                  <dt>ขนาดพื้นที่ที่วิเคราะห์</dt>
                                  <dd>
                                    {polygonPopulation.areaKm2.toFixed(2)} ตร.กม. (
                                    {Math.round(polygonPopulation.areaKm2 * 625).toLocaleString("th-TH")} ไร่)
                                  </dd>
                                </div>
                                <div>
                                  <dt>ความหนาแน่นอาคาร</dt>
                                  <dd>{polygonPopulation.buildingDensityPerKm2.toLocaleString("th-TH")} หลัง/ตร.กม.</dd>
                                </div>
                                <div>
                                  <dt>ความหนาแน่นประชากรโดยประมาณ</dt>
                                  <dd>
                                    {polygonPopulation.popDensityPerKm2 !== null
                                      ? `${polygonPopulation.popDensityPerKm2.toLocaleString("th-TH")} คน/ตร.กม.`
                                      : "— (ไม่มีข้อมูลครัวเรือนจังหวัด)"}
                                  </dd>
                                </div>
                              </dl>
                              {cls ? (
                                <p className="map-area-summary-verdict">
                                  ความหนาแน่นการตั้งถิ่นฐาน (แกน C): <strong>{cls.label}</strong> — {cls.hint}
                                </p>
                              ) : null}
                              {/* "จะถูกบันทึกพร้อมกัน" อธิบายผลของปุ่มบันทึกใน GisAssessmentPanel ซึ่งเขียนลงฉบับ
                                  ปีปัจจุบันเสมอ (POST /api/assessments/from-map) — ต้องเช็ค currentYearAssessment.submitted
                                  ไม่ใช่ assessment.submitted ของฉบับที่กำลังเปิดดู (อาจเป็นปีอื่น) */}
                              <p className="map-note map-area-summary-note">
                                ข้อสรุปเป็นค่าประมาณจากผังอาคาร ML และขนาดครัวเรือนเฉลี่ยของจังหวัด ใช้ประกอบดุลยพินิจ
                                ไม่ใช่ข้อมูลทางการ · แกน C ไม่ใช่ระดับความทุรกันดาร/พื้นที่สูง (ดูกล่องวิเคราะห์ GIS)
                                {assessment && !currentYearAssessment?.submitted && canSaveAssessment
                                  ? " · ข้อสรุปพื้นที่นี้จะถูกบันทึกพร้อมกันเมื่อกดปุ่มบันทึกในกล่องวิเคราะห์ GIS"
                                  : ""}
                              </p>
                            </div>
                          );
                        })()
                      : null}
                  </>
                ) : (
                  <p className="map-note">ลากจุดบนแผนที่เพื่อกำหนดพื้นที่คำนวณประชากร</p>
                )}
              </div>

              <div className="map-analysis">
                {analyzing ? (
                  <p className="map-note">กำลังวิเคราะห์ภูมิประเทศจากข้อมูลความสูง (DEM)…</p>
                ) : analysisErr ? (
                  <p className="map-note map-note-error">{analysisErr}</p>
                ) : analysis ? (
                  <dl className="map-stats">
                    <div>
                      <dt>
                        ประเภทภูมิประเทศ <LandformLegendTip className="map-landform-tip" />
                      </dt>
                      <dd className="map-stat-strong">
                        {analysis.landformTh} <span className="map-stat-en">({analysis.landformEn})</span>
                      </dd>
                      <dd className="map-landform-note">{landformAppLabelNoteTh(analysis.landformTh)}</dd>
                      {officialElevBandTh(analysis.meanElev) ? (
                        <dd className="map-landform-note">{officialElevBandTh(analysis.meanElev)}</dd>
                      ) : null}
                    </div>
                    <div>
                      <dt>ความสูงเฉลี่ย</dt>
                      <dd>
                        {fmt(analysis.meanElev)} ม. (ต่ำสุด {fmt(analysis.minElev)} – สูงสุด {fmt(analysis.maxElev)})
                      </dd>
                    </div>
                    <div>
                      <dt>ความต่างระดับ (relief)</dt>
                      <dd>{fmt(analysis.relief)} ม.</dd>
                    </div>
                    <div>
                      <dt>ความลาดชันเฉลี่ย</dt>
                      <dd>
                        {analysis.meanSlopePct.toFixed(1)}% (สูงสุด {analysis.maxSlopePct.toFixed(1)}%)
                      </dd>
                    </div>
                    <div>
                      <dt>ชั้นความลาดชัน (LDD)</dt>
                      <dd>{analysis.lddClass}</dd>
                    </div>
                    <div>
                      <dt>จังหวัด (เกณฑ์ความสูง)</dt>
                      <dd>
                        {analysis.provinceName ?? "—"}
                        {analysis.provinceAvgElev ? ` (${fmt(analysis.provinceAvgElev)} ม.)` : ""}
                      </dd>
                    </div>
                    <div>
                      <dt>ความสูงสุดในรัศมี 1 กม. รอบที่ตั้ง</dt>
                      <dd>{analysis.local1000Elev !== null ? `${fmt(analysis.local1000Elev)} ม.` : "—"}</dd>
                    </div>
                    <div>
                      <dt>ความสูงสุดตลอดเส้นทางทั้งเส้น (เกต SSRA)</dt>
                      <dd>
                        {analysis.routeFullMaxElev !== null ? `${fmt(analysis.routeFullMaxElev)} ม.` : "ไม่มีข้อมูล"}
                      </dd>
                    </div>
                    <div>
                      <dt>ความสูงสุดช่วง 5 กม. สุดท้าย (จำแนก landform)</dt>
                      <dd>
                        {analysis.routeTailMaxElev !== null ? `${fmt(analysis.routeTailMaxElev)} ม.` : "ไม่มีข้อมูล"}
                      </dd>
                    </div>
                    {analysis.classificationMethod === "fallback" ? (
                      <div>
                        <dt>วิธีจำแนก</dt>
                        <dd className="map-note-error">
                          ใช้เกณฑ์สำรอง (ความลาดชัน/TPI) — ไม่มีข้อมูลเส้นทางรถยนต์สำหรับเช็คเกณฑ์ 5 กม.สุดท้าย
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                ) : (
                  <p className="map-note">รอโหลดข้อมูลภูมิประเทศ…</p>
                )}
              </div>
              <button
                className="ghost-btn"
                type="button"
                onClick={() => void runAnalysis()}
                disabled={analyzing || !terrainReady}
              >
                {analyzing ? "กำลังวิเคราะห์…" : "วิเคราะห์ภูมิประเทศอีกครั้ง"}
              </button>
            </>
          )}
          <p className="map-credit">ภูมิประเทศ: Terrarium · AWS Open Data • ภาพถ่าย: {imageryStatus.credit}</p>
        </aside>
      ) : (
        <MapPanelToggle expanded={false} onToggle={() => setPanelExpanded(true)} />
      )}
    </div>
  );
}
