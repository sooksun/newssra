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
  createGooglePhotorealistic3DTileset,
  Google2DImageryProvider,
  HeadingPitchRange,
  HeightReference,
  ImageryLayer,
  IonWorldImageryStyle,
  Math as CesiumMath,
  Matrix4,
  PolylineDashMaterialProperty,
  SceneTransforms,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  LabelStyle,
  Cartesian2,
  NearFarScalar,
  createWorldImageryAsync,
} from "cesium";
import type { Entity, ImageryProvider, TerrainProvider } from "cesium";
import {
  configureCesium,
  googleMapsApiKey,
  photorealistic3dEnabled,
  preferredImagerySource,
  type MapImagerySource,
} from "@/lib/map/cesium-config";
import { tilesetReady, withPhotorealisticTiles } from "@/lib/map/photorealistic3d";
import type { SnapshotTerrainSource } from "@/lib/types";
import type { NoRouteReason } from "@/lib/gis";
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
import { borderLabelPoints, parseSharedBorders, type SharedBordersDoc } from "@/lib/map/borders";
import { createLabelImage } from "@/lib/map/labelImage";
import { borderBlockedMessage, filterDomesticRoutes } from "@/lib/map/borderCrossing";
import {
  labelBox,
  labelFadedOut,
  pickVisibleLabels,
  type LabelBox,
  type LabelPlacement,
} from "@/lib/map/labelDeclutter";
import {
  fetchBuildings,
  fetchFootLeg,
  fetchNearestProvince,
  fetchOsrmRoutes,
  footRoutingEnabled,
  type FootLeg,
} from "@/lib/map/mapApi";
import { searchPlaces, resolvePlaceHit, reverseProvince, type PlaceHit } from "@/lib/map/placeSearch";
import {
  buildRouteElevationProfile,
  formatElevationMeters,
  formatManualHighPointLabel,
  formatRouteHighestLabel,
  routeElevationSampleCoordinates,
  type ManualHighPoint,
  type RouteElevationProfile,
} from "@/lib/map/routeElevation";
import {
  buildRouteAnalysis,
  computeAutoGisScore,
  computeCommunityClass,
  derive32Severity,
  elevationGainLoss,
  MAX_ASSESSMENT_RELOCATION_M,
  MAX_ROUTE_SNAP_M,
  settlementClass,
  type SettlementTone,
} from "@/lib/gis";
import { landformAppLabelNoteTh, officialElevBandTh } from "@/lib/landform-legend";
import LandformLegendTip from "@/components/LandformLegendTip";
import GisAssessmentPanel, { GisDestAddBar, MAX_GIS_DESTINATIONS } from "@/components/map/GisAssessmentPanel";
import MapPanelToggle from "@/components/map/MapPanelToggle";
import MapStep from "@/components/map/MapStep";
import type { MapAssessmentSaveAction, MapAssessmentSaveResponse } from "@/lib/map-assessment";
import {
  ADMIN_ATTRIBUTION,
  ADMIN_FETCH_RADIUS_M,
  ADMIN_KIND_LABELS,
  fetchAdminBoundaries,
} from "@/lib/map/adminBoundaries";
import type { AdminBoundary, AdminKind } from "@/lib/map/adminBoundaries";
import {
  buildForestAnalysis,
  type ForestAnalysis,
  type ForestLegalLayer,
  type ForestStatusLayer,
  type ForestTypeLayer,
} from "@/lib/forest-layers";
import {
  FOREST_ATTRIBUTION,
  FOREST_FETCH_RADIUS_M,
  FOREST_KIND_LABELS,
  FOREST_STATUS_LABELS,
  classifyForestOverlay,
  fetchForestBoundaries,
} from "@/lib/map/forestBoundaries";
import type { ForestBoundary, ForestOverlayResult, ForestZoneKind } from "@/lib/map/forestBoundaries";
import type { ForestPolygonFeature } from "@/lib/map/forest-polygons";
import { findTambonAt, loadTambonIndex, loadTambonProvince, provincesForPoint } from "@/lib/map/tambonBoundaries";
import type { TambonBoundary } from "@/lib/map/tambonBoundaries";
import { laoFullName, LAO_KIND_LABELS, loadLaoOffices, officesNear } from "@/lib/map/laoOffices";
import type { LaoKind, LaoOfficeNearby } from "@/lib/map/laoOffices";
import {
  deriveSectorMetrics,
  sectorElevationsFromGrid,
  sectorFlagLines,
  sectorFlagVisible,
  SECTOR_LABELS_TH,
  SECTOR_RADIUS_M,
  SECTOR_RELIEF_K_M,
} from "@/lib/gis-sectors";
import { GIS_DESTINATION_LABELS } from "@/lib/types";
import type {
  GisAnalysis,
  GisAreaSummary,
  GisDestinationType,
  GisRouteAnalysis,
  GisSectorConfig,
  GisSectorElevation,
} from "@/lib/types";
import { overviewFitRangeM, SNAPSHOT_VIEWS } from "@/lib/map/snapshotViews";
import { captureCurrentView, dataUrlToBlob, waitForTilesLoaded } from "@/lib/map/snapshotCapture";
import type { SchoolPin } from "@/lib/school-pins";

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

// รอบตรวจการทับซ้อนของป้าย (มิลลิวินาที) — ถี่พอให้ตามการซูม/หมุนกล้องได้ แต่ไม่ต้องคำนวณทุกเฟรม
const LABEL_DECLUTTER_INTERVAL_MS = 120;
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

// ธงจุดสูงสุด (ม่วง) / ต่ำสุด (ฟ้า) ราย 8 ทิศ ในรัศมี SECTOR_RADIUS_M — ทรงเดียวกับธงแดงเพื่อให้อ่านเป็นชุดเดียวกัน
const SECTOR_HIGH_FLAG_ICON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 44"><path d="M9 41V4" stroke="white" stroke-width="5" stroke-linecap="round"/><path d="M9 5h22l-6 8 6 8H9z" fill="#7c3aed" stroke="white" stroke-width="2" stroke-linejoin="round"/><circle cx="9" cy="41" r="3" fill="#4c1d95" stroke="white" stroke-width="2"/></svg>',
)}`;
const SECTOR_LOW_FLAG_ICON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 44"><path d="M9 41V4" stroke="white" stroke-width="5" stroke-linecap="round"/><path d="M9 5h22l-6 8 6 8H9z" fill="#0ea5e9" stroke="white" stroke-width="2" stroke-linejoin="round"/><circle cx="9" cy="41" r="3" fill="#075985" stroke="white" stroke-width="2"/></svg>',
)}`;
// สีเส้นเขตเทศบาลแต่ละประเภท — เลี่ยงสีที่ใช้ไปแล้ว (วงรัศมีเขียว/เหลือง/แดง, เส้นทางน้ำเงิน,
// เส้นตรงอำพัน, ธง 8 ทิศม่วง/ฟ้า) เพื่อไม่ให้ผู้ใช้อ่านสับสนว่าเป็นชั้นข้อมูลเดียวกัน
const ADMIN_KIND_COLORS: Record<AdminKind, string> = {
  nakhon: "#be185d",
  mueang: "#c2410c",
  tambon: "#0d9488",
  special: "#6b21a8",
};

/** สีเส้น/พื้นแนวเขตป่า แยกชนิด — โทนเขียว/ฟ้าให้ต่างจากเทศบาล */
const FOREST_KIND_COLORS: Record<ForestZoneKind, string> = {
  national_reserved_forest: "#166534",
  national_park: "#15803d",
  wildlife_sanctuary: "#0f766e",
  non_hunting: "#3f6212",
  forest_park: "#65a30d",
  botanical_garden: "#84cc16",
  arboretum: "#a3e635",
  community_forest: "#4d7c0f",
  mangrove_forest: "#0e7490",
  biosphere_reserve: "#0369a1",
  wetland_protected: "#0284c7",
  watershed_protected: "#1d4ed8",
  other_protected: "#4d7c0f",
  unclassified: "#365314",
};

/** รัศมีที่ดึง polygon ป่ามาวาด — ตรงกับ clamp ฝั่ง route /api/forest-status/polygons */
const FOREST_POLYGON_RADIUS_M = 10_000;
/** สภาพป่าจริง (กรมป่าไม้) — เขียวเข้ม แยกจากโทนของชั้นแนวเขตคุ้มครอง */
const FOREST_COVER_COLOR = "#16a34a";
const FOREST_COVER_LINE_COLOR = "#15803d";
/** ป่าทั่วไป (OSM) — เขียวอมเหลือง ให้ต่างจากชั้นสภาพป่าจริงด้วยตาเปล่า */
const FOREST_GENERIC_COLOR = "#84cc16";
const FOREST_GENERIC_LINE_COLOR = "#4d7c0f";

// รัศมีค้นหาสำนักงาน อปท. รอบจุดวิเคราะห์ (ม.) — กว้างพอให้เห็นทั้ง อปท. ที่ครอบและที่ติดกัน
const LAO_NEARBY_RADIUS_M = 20_000;

// สีหมุดสำนักงาน อปท. แยกตามประเภท — โทนเดียวกับเส้นเขตเทศบาลของ OSM เพื่อให้อ่านเป็นเรื่องเดียวกัน
const LAO_KIND_COLORS: Record<LaoKind, string> = {
  nakhon: "#be185d",
  mueang: "#c2410c",
  thesaban_tambon: "#0d9488",
  sao: "#4d7c0f",
  special: "#6b21a8",
};

// หมุดจุดสูงสุดที่ผู้ใช้ชี้เอง — ธงส้มเข้ม แยกจากธงแดง (จุดโรงเรียน/จุดสูงสุดของเส้นทางที่ระบบคำนวณ)
// เพื่อไม่ให้เข้าใจผิดว่าเป็นค่าที่บันทึกลงแบบประเมิน
const MANUAL_HIGH_FLAG_ICON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 44"><path d="M9 41V4" stroke="white" stroke-width="5" stroke-linecap="round"/><path d="M9 5h22l-6 8 6 8H9z" fill="#ea580c" stroke="white" stroke-width="2" stroke-linejoin="round"/><circle cx="9" cy="41" r="3" fill="#7c2d12" stroke="white" stroke-width="2"/></svg>',
)}`;

// ทะเบียนป้ายทั้งหมดบนแผนที่ (คีย์ = entity id) ใช้โดยรอบตรวจการทับซ้อนเพื่อคำนวณกล่องบนจอ
// เก็บระดับโมดูลเพราะหน้า /map มีแผนที่เดียวเสมอ และ entity id ก็ไม่ซ้ำข้ามชนิดป้ายอยู่แล้ว
const labelPlacements = new Map<string, LabelPlacement>();

/** ลำดับความสำคัญของป้ายเมื่อทับกัน — เลขน้อยได้แสดงก่อน */
const LABEL_PRIORITY = {
  school: 0, // จุดที่ตั้งโรงเรียน (จุดหลักของการวิเคราะห์)
  elevation: 1, // จุดสูงสุดบนเส้นทาง / จุดที่ชี้เอง
  place: 2, // ศาลากลางจังหวัด, หมุดผลค้นหา
  destination: 3, // จุดหมายวิเคราะห์ (อำเภอ/รพ.)
  sector: 4, // ธงสูงสุด/ต่ำสุด 8 ทิศ (16 ป้าย — ต้องยอมหลบป้ายหลักเมื่อทับกัน)
  admin: 5, // ชื่อเขตเทศบาล (overlay อ้างอิง เปิดเองเมื่อต้องการ)
  overviewSchool: 6, // ชื่อโรงเรียนในมุมมองทั้งประเทศ (มีจำนวนมาก)
  country: 7, // ชื่อประเทศเพื่อนบ้าน
} as const;

/** ป้ายข้อความของหมุดบนแผนที่ — วาดเป็นรูปเดียวแล้วแปะเป็น billboard
 *  ห้ามกลับไปใช้ Cesium `label` กับข้อความไทย: Cesium แยก glyph ทีละตัวอักษร ทำให้สระ/วรรณยุกต์
 *  ถูกฉีกออกจากพยัญชนะ (เห็นเป็น "ระดั" แล้วขึ้นบรรทัดใหม่เป็น "บ" หรือสระหายไปเลย) */
function addPinLabel(
  ds: CustomDataSource,
  options: {
    id: string;
    lat: number;
    lng: number;
    lines: string[];
    background: string;
    offsetY: number;
    fontPx?: number;
    /** ลำดับความสำคัญเมื่อป้ายทับกันบนจอ (LABEL_PRIORITY) — เลขน้อยได้แสดงก่อน */
    priority: number;
    /** ค่าเริ่มต้น BOTTOM = ป้ายลอยเหนือหมุด; ป้ายชื่อประเทศใช้ CENTER เพราะไม่มีหมุดคู่กัน */
    verticalOrigin?: VerticalOrigin;
    /** ย่อ/จางตามระยะกล้อง — ใช้กับป้ายจำนวนมาก (หมุดภาพรวมโรงเรียน) ไม่ให้ทับกันจนอ่านไม่ออก */
    scaleByDistance?: NearFarScalar;
    translucencyByDistance?: NearFarScalar;
  },
): Entity | null {
  const image = createLabelImage(options.lines, { background: options.background, fontPx: options.fontPx });
  if (!image) return null;
  labelPlacements.set(options.id, {
    width: image.width,
    height: image.height,
    offsetY: options.offsetY,
    verticalCenter: options.verticalOrigin === VerticalOrigin.CENTER,
    priority: options.priority,
    // เก็บค่าที่ไล่ตามระยะไว้ด้วย เพื่อให้กล่องชนเท่ากับขนาดที่ตาเห็นจริงในทุกระยะซูม
    scaleByDistance: options.scaleByDistance
      ? {
          near: options.scaleByDistance.near,
          nearValue: options.scaleByDistance.nearValue,
          far: options.scaleByDistance.far,
          farValue: options.scaleByDistance.farValue,
        }
      : undefined,
    translucencyByDistance: options.translucencyByDistance
      ? {
          near: options.translucencyByDistance.near,
          nearValue: options.translucencyByDistance.nearValue,
          far: options.translucencyByDistance.far,
          farValue: options.translucencyByDistance.farValue,
        }
      : undefined,
  });
  return ds.entities.add({
    id: options.id,
    position: Cartesian3.fromDegrees(options.lng, options.lat),
    billboard: {
      image: image.url,
      width: image.width,
      height: image.height,
      verticalOrigin: options.verticalOrigin ?? VerticalOrigin.BOTTOM,
      pixelOffset: new Cartesian2(0, options.offsetY),
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scaleByDistance: options.scaleByDistance,
      translucencyByDistance: options.translucencyByDistance,
    },
  });
}

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
// จำนวนป้ายชื่อประเทศต่อหนึ่งแนวชายแดน — วางบนเส้นจริงที่ 25%/50%/75% ของความยาว (ดู borderLabelPoints)
// 3 จุดเพราะแนวชายแดนแต่ละด้านยาวหลายร้อยกิโลเมตร ป้ายเดียวจึงมองไม่เห็นเมื่อซูมดูช่วงใดช่วงหนึ่ง
// ป้ายที่ทับกันตอนซูมออกถูกซ่อนอัตโนมัติโดยระบบ declutter อยู่แล้ว จึงไม่ทำให้จอรก
const BORDER_LABELS_PER_COUNTRY = 3;
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
  /** ระยะที่เครื่องคำนวณเส้นทางย้ายปลายทางไปเกาะถนน (ม.) — ดู OsrmRoute.destSnapM */
  destSnapM: number | null;
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
  /** หมุดภาพรวมโรงเรียน (เฉพาะ admin/ssra โหมดทั้งประเทศ) — [] = ไม่แสดงชั้นนี้ */
  schoolPins: SchoolPin[];
}

const fmt = (v: number) => Math.round(v).toLocaleString("th-TH");

// สีหมุดภาพรวมโรงเรียนตามสถานะ: เทา=ร่าง, เขียว=ส่งแล้วผ่าน (≥50), แดง=ส่งแล้วไม่ผ่าน (<50)
function schoolPinColor(status: SchoolPin["status"]): Color {
  if (status === "pass") return Color.fromCssColorString("#22c55e");
  if (status === "fail") return Color.fromCssColorString("#ef4444");
  return Color.fromCssColorString("#6b7280");
}

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

/**
 * ชั้นภาพถ่ายฐานตาม provider ที่เลือก
 *
 * provider ที่ต้องยืนยันตัวตน (google/ion) โหลดแบบ async และ "ล้มได้จริง" — quota หมด, key ถูก rotate,
 * API ถูกปิดสิทธิ์ ฯลฯ ถ้าไม่ดักไว้ Cesium จะได้ promise ที่ reject แล้วลูกโลกจะไม่มีภาพถ่ายเลย
 * ซึ่งอันตรายเป็นพิเศษกับระบบนี้ เพราะปุ่มจับภาพ 3D ยังทำงานต่อและจะส่ง "ภาพเปล่า" เข้า AI ไปตัดสิน
 * ลักษณะที่ตั้งโดยไม่มีอะไรเตือน — onProviderFailed จึงเป็นทางให้ผู้เรียกถอยไป Esri และบอกผู้ใช้
 */
function createBaseImageryLayer(
  source: MapImagerySource,
  esriMaxLevel = ESRI_MAX_REQUEST_LEVEL,
  onProviderFailed?: (source: MapImagerySource, reason: string) => void,
): ImageryLayer {
  const guard = (provider: Promise<ImageryProvider>) =>
    provider.catch((error: unknown) => {
      onProviderFailed?.(source, error instanceof Error ? error.message : "โหลดชั้นภาพถ่ายไม่สำเร็จ");
      throw error; // ส่งต่อให้ Cesium รู้ด้วย — ผู้เรียกเป็นคนสลับชั้นภาพแทน
    });

  if (source === "google") {
    const key = googleMapsApiKey();
    if (key) {
      const provider = Google2DImageryProvider.fromUrl({
        key,
        mapType: "satellite",
        language: "th-TH",
        region: "TH",
      }) as Promise<unknown> as Promise<ImageryProvider>;
      return ImageryLayer.fromProviderAsync(guard(provider), IMAGERY_LAYER_OPTIONS);
    }
  }

  if (source === "ion") {
    return ImageryLayer.fromProviderAsync(
      guard(createWorldImageryAsync({ style: IonWorldImageryStyle.AERIAL })),
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
  schoolPins = [],
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
  const sectorsDsRef = useRef<CustomDataSource | null>(null); // ธงจุดสูงสุด/ต่ำสุด 8 ทิศ
  const adminDsRef = useRef<CustomDataSource | null>(null); // เขตเทศบาล (overlay อ้างอิง)
  const forestDsRef = useRef<CustomDataSource | null>(null); // แนวเขตป่า / พื้นที่คุ้มครอง
  const forestCoverDsRef = useRef<CustomDataSource | null>(null); // สภาพพื้นที่ป่าจริง (กรมป่าไม้)
  const tambonDsRef = useRef<CustomDataSource | null>(null); // ขอบเขตตำบล (COD-AB)
  const laoDsRef = useRef<CustomDataSource | null>(null); // หมุดสำนักงาน อปท. (ทะเบียน สถ.)
  const schoolPinsDsRef = useRef<CustomDataSource | null>(null); // หมุดภาพรวมโรงเรียน (admin โหมดทั้งประเทศ)
  const manualHighDsRef = useRef<CustomDataSource | null>(null); // หมุดจุดสูงสุดที่ผู้ใช้คลิกขวาชี้เอง (ดูค่าอย่างเดียว)
  const routeCoordsRef = useRef<[number, number][] | null>(null); // [lng,lat][] เก็บไว้ให้ runAnalysis สุ่มความสูง 5 กม.สุดท้าย
  const imageryLayerRef = useRef<ImageryLayer | null>(null);
  const esriMaxLevelRef = useRef(ESRI_MAX_REQUEST_LEVEL);
  const drawHandlerRef = useRef<ScreenSpaceEventHandler | null>(null);
  // ── ลากหมุดจุดวิเคราะห์บนแผนที่ ──
  const dragHandlerRef = useRef<ScreenSpaceEventHandler | null>(null);
  const centerPinRef = useRef<Entity | null>(null); // อ้างอิงหมุดแดง (จุดวิเคราะห์) เพื่อย้ายตำแหน่งระหว่างลาก
  const centerPinLabelRef = useRef<Entity | null>(null); // ป้ายของหมุดแดง (entity แยก) — ย้ายตามหมุดตอนลาก
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
  const [routeBorderNote, setRouteBorderNote] = useState(""); // แจ้งเมื่อมีเส้นทางข้ามพรมแดนถูกคัดออก
  // เหตุที่ไม่มีเส้นทางศาลากลางให้ใช้ (null = มีเส้นทางปกติ) — ส่งไป server เพื่อบันทึกเป็นหลักฐาน
  // แทนการบล็อกไม่ให้บันทึก ซึ่งเดิมทำให้โรงเรียนที่ถนนเข้าไม่ถึงจริงใช้ระบบไม่ได้เลย
  const [noProvinceRouteReason, setNoProvinceRouteReason] = useState<NoRouteReason | null>(null);
  // ช่วงเดินเท้าจากปลายถนนถึงโรงเรียน (null = ไม่ต้องเดิน หรือหาไม่ได้/ยังไม่ตั้งค่า host เดินเท้า)
  const [walkLeg, setWalkLeg] = useState<FootLeg | null>(null);
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
  // ธงจุดสูงสุด/ต่ำสุด 8 ทิศ — จุดมาจากกริดชุดเดียวกับ runAnalysis (ไม่ยิง terrain เพิ่ม)
  // เก็บเฉพาะ "จุดดิบ" ไว้ ส่วนค่าที่อิงความสูงโรงเรียนคำนวณตอนใช้งาน เพราะ route profile
  // อาจมาถึงหลังการวิเคราะห์กริดเสร็จ — ถ้า freeze ค่าไว้ ส่วนต่างจะค้างที่ค่าเซลล์กลางกริดตลอด
  const [sectorScan, setSectorScan] = useState<{
    sectors: GisSectorElevation[];
    gridCenterElevationM: number | null;
  } | null>(null);
  const [showSectorFlags, setShowSectorFlags] = useState(true);
  // เขตเทศบาลรอบจุดวิเคราะห์ — ปิดเป็นค่าเริ่มต้นเพราะดึงสดจาก Overpass (บริการฟรี มีการจำกัดอัตรา)
  const [showAdminBoundaries, setShowAdminBoundaries] = useState(false);
  const [adminBoundaries, setAdminBoundaries] = useState<AdminBoundary[] | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminErr, setAdminErr] = useState("");
  // แนวเขตป่า / พื้นที่คุ้มครอง (OSM อ้างอิง) — ปิดเป็นค่าเริ่มต้น; ผลทับซ้อนเก็บใน forestOverlay
  const [showForestBoundaries, setShowForestBoundaries] = useState(false);
  const [forestBoundaries, setForestBoundaries] = useState<ForestBoundary[] | null>(null);
  const [forestOverlay, setForestOverlay] = useState<ForestOverlayResult | null>(null);
  const [forestLoading, setForestLoading] = useState(false);
  const [forestErr, setForestErr] = useState("");
  // สภาพพื้นที่ป่าจริง (กรมป่าไม้) — วาดจาก geometry ที่เซิร์ฟเวอร์ตัดมาให้ ปิดเป็นค่าเริ่มต้น
  const [showForestCover, setShowForestCover] = useState(false);
  const [forestCoverPolys, setForestCoverPolys] = useState<ForestPolygonFeature[] | null>(null);
  const [forestCoverCredit, setForestCoverCredit] = useState("");
  const [forestCoverLoading, setForestCoverLoading] = useState(false);
  const [forestCoverErr, setForestCoverErr] = useState("");
  // ชั้นสถานภาพป่า (กรมป่าไม้) จาก /api/forest-status — null = ยังไม่โหลดหรือไม่มีไฟล์ cells
  const [forestStatusLayer, setForestStatusLayer] = useState<ForestStatusLayer | null>(null);
  const [forestTypeLayer, setForestTypeLayer] = useState<ForestTypeLayer | null>(null);
  const [forestLegalFromRfd, setForestLegalFromRfd] = useState<ForestLegalLayer | null>(null);
  const [forestStatusAvailable, setForestStatusAvailable] = useState<boolean | null>(null);
  const [forestStatusNote, setForestStatusNote] = useState("");
  // ขอบเขตตำบล (COD-AB) — ตอบได้ว่าจุดที่ตั้งอยู่ตำบล/อำเภอใด ต่างจากชั้น OSM ที่ครอบคลุมไม่ครบ
  const [showTambon, setShowTambon] = useState(false);
  const [tambonHere, setTambonHere] = useState<TambonBoundary | null>(null);
  const [tambonList, setTambonList] = useState<TambonBoundary[] | null>(null);
  const [tambonErr, setTambonErr] = useState("");
  // หมุดสำนักงาน อปท. จากทะเบียนกรมส่งเสริมการปกครองท้องถิ่น (ครบทุกแห่ง ไม่ใช่ขอบเขต)
  const [showLaoOffices, setShowLaoOffices] = useState(false);
  const [laoNearby, setLaoNearby] = useState<LaoOfficeNearby[] | null>(null);
  const [laoErr, setLaoErr] = useState("");
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

  // ตัวจัดการ "provider หลักล้ม" — เก็บใน ref เพราะ effect สร้าง Viewer รันครั้งเดียวตอน mount
  // แต่ตัวจัดการต้องใช้ replaceEsriImageryLayer/setImageryStatus ที่ถูกสร้างหลังจากนั้น
  const imageryFallbackRef = useRef<((source: MapImagerySource, reason: string) => void) | null>(null);

  const replaceEsriImageryLayer = useCallback(
    // force = สลับแม้ระดับเท่าเดิม — ใช้ตอนถอยจาก provider อื่นมาเป็น Esri (ชั้นภาพปัจจุบันไม่ใช่ Esri
    // แต่ esriMaxLevelRef ถูกตั้งค่าไว้ตั้งแต่ init ทำให้การเทียบระดับอย่างเดียวบล็อกการสลับ)
    (maximumLevel: number, opts?: { force?: boolean }) => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) return;
      if (!opts?.force && esriMaxLevelRef.current === maximumLevel) return;

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

  // provider หลัก (Google/ion) โหลดไม่สำเร็จ → ถอยไป Esri ทันที และเปลี่ยนแถบสถานะให้บอกตรง ๆ
  // สำคัญกว่าความสวยงาม: ถ้าไม่ถอย ลูกโลกจะไม่มีภาพถ่ายเลย แล้วการจับภาพ 3D จะส่งภาพเปล่าเข้า AI
  // ไปตัดสิน "ลักษณะที่ตั้ง" โดยไม่มีใครรู้ — และ imageryStatus.source ที่อัปเดตตรงนี้คือค่าที่ถูกบันทึก
  // ลง metadata ของภาพ (SnapshotFile.imagerySource) จึงต้องสะท้อนแหล่งภาพที่ใช้จริง ไม่ใช่ที่ตั้งใจจะใช้
  useEffect(() => {
    imageryFallbackRef.current = (failedSource, reason) => {
      console.error(`[map] imagery provider "${failedSource}" failed:`, reason);
      replaceEsriImageryLayer(ESRI_MAX_REQUEST_LEVEL, { force: true });
      setImageryStatus({
        source: "esri",
        label: `ภาพถ่าย: ${imageryLabel("esri")} (สำรอง)`,
        detail: `ใช้ ${imageryLabel(failedSource)} ไม่ได้ — ${reason}`,
        tone: "warn",
        nativeMaxLevel: null,
        credit: imageryCredit("esri"),
      });
    };
    return () => {
      imageryFallbackRef.current = null;
    };
  }, [replaceEsriImageryLayer]);

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
    const imageryLayer = createBaseImageryLayer(imagerySource, ESRI_MAX_REQUEST_LEVEL, (failedSource, reason) =>
      imageryFallbackRef.current?.(failedSource, reason),
    );
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

    const sectorsDs = new CustomDataSource("sectors");
    void viewer.dataSources.add(sectorsDs);
    sectorsDsRef.current = sectorsDs;

    const adminDs = new CustomDataSource("admin");
    void viewer.dataSources.add(adminDs);
    adminDsRef.current = adminDs;

    const forestDs = new CustomDataSource("forest");
    void viewer.dataSources.add(forestDs);
    forestDsRef.current = forestDs;

    const forestCoverDs = new CustomDataSource("forestCover");
    void viewer.dataSources.add(forestCoverDs);
    forestCoverDsRef.current = forestCoverDs;

    const tambonDs = new CustomDataSource("tambon");
    void viewer.dataSources.add(tambonDs);
    tambonDsRef.current = tambonDs;

    const laoDs = new CustomDataSource("lao");
    void viewer.dataSources.add(laoDs);
    laoDsRef.current = laoDs;

    const schoolPinsDs = new CustomDataSource("schoolPins");
    void viewer.dataSources.add(schoolPinsDs);
    schoolPinsDsRef.current = schoolPinsDs;

    const manualHighDs = new CustomDataSource("manualHigh");
    void viewer.dataSources.add(manualHighDs);
    manualHighDsRef.current = manualHighDs;

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
      sectorsDsRef.current = null;
      adminDsRef.current = null;
      forestDsRef.current = null;
      forestCoverDsRef.current = null;
      tambonDsRef.current = null;
      laoDsRef.current = null;
      schoolPinsDsRef.current = null;
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
    centerPinLabelRef.current = null;
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
      });
      // ป้ายเป็น entity แยก (หนึ่ง entity มี billboard ได้ตัวเดียว) — ต้องย้ายตามหมุดตอนลากด้วย
      centerPinLabelRef.current = addPinLabel(pinDs, {
        id: "center-pin-label",
        priority: LABEL_PRIORITY.school,
        lat: center.lat,
        lng: center.lng,
        lines: [center.name, schoolElevationText],
        background: "rgba(185, 28, 28, 0.92)",
        offsetY: -48,
      });
    }
  }, [center.lat, center.lng, center.name, national, status, routeElevationProfile, routeElevationStatus]);

  // ── หมุดภาพรวมโรงเรียนทุกแห่งที่มีแบบประเมิน (เฉพาะ admin/ssra โหมดทั้งประเทศ) ──
  // แสดงเฉพาะหมุด+ป้ายชื่อ ไม่รันการวิเคราะห์ใด ๆ ของแต่ละพิกัด (ดูรายละเอียดเมื่อคลิกหมุด)
  useEffect(() => {
    const ds = schoolPinsDsRef.current;
    if (!ds || status !== "ready") return;
    ds.entities.removeAll();
    if (!national || schoolPins.length === 0) return;
    for (const pin of schoolPins) {
      ds.entities.add({
        id: `school-pin:${pin.id}`,
        position: Cartesian3.fromDegrees(pin.lng, pin.lat),
        point: {
          pixelSize: 11,
          color: schoolPinColor(pin.status),
          outlineColor: Color.WHITE,
          outlineWidth: 2,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      // ป้ายชื่อโรงเรียนเป็น entity แยก — id ยังขึ้นต้น "school-pin:" เพื่อให้คลิกที่ป้ายก็ยังเข้าโรงเรียนนั้นได้
      addPinLabel(ds, {
        id: `school-pin:${pin.id}:label`,
        priority: LABEL_PRIORITY.overviewSchool,
        lat: pin.lat,
        lng: pin.lng,
        lines: [pin.name],
        background: "rgba(17, 24, 39, 0.78)",
        offsetY: -14,
        fontPx: 13,
        scaleByDistance: new NearFarScalar(2.0e5, 1.0, 2.0e6, 0.5),
        translucencyByDistance: new NearFarScalar(1.5e6, 1.0, 3.0e6, 0.0),
      });
    }
  }, [schoolPins, national, status]);

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
    setRouteBorderNote("");
    // ขอเส้นทางพร้อมแนวชายแดนไปด้วย เพื่อคัดเส้นที่วิ่งเข้าประเทศเพื่อนบ้านออกก่อนนำไปคิดคะแนน
    // (โหลดแนวชายแดนไม่สำเร็จ → doc = null → filterDomesticRoutes ปล่อยผ่าน ไม่ทำให้แผนที่ใช้ไม่ได้)
    Promise.all([
      fetchOsrmRoutes(province.lng, province.lat, center.lng, center.lat, {
        alternatives: 3,
        signal: controller.signal,
      }),
      loadBorders().catch(() => null),
    ])
      .then(([alts, bordersDoc]) => {
        if (controller.signal.aborted) return;
        const { domestic, blocked } = filterDomesticRoutes(alts, bordersDoc);
        if (domestic.length === 0) {
          setRouteAlternatives([]);
          setSelectedRouteIdx(0);
          routeCoordsRef.current = null;
          setRoute(null);
          setRouteErr(borderBlockedMessage(blocked.map((b) => b.crossing)));
          // ยังบันทึกแบบประเมินได้ — เก็บ "เหตุที่ไม่มีเส้นทาง" ไปกับ payload แทนตัวเลขที่ไม่มีจริง
          setNoProvinceRouteReason(blocked.length > 0 ? "border-blocked" : "no-route");
          setWalkLeg(null);
          return;
        }
        setNoProvinceRouteReason(null);
        if (blocked.length > 0) {
          const countries = Array.from(new Set(blocked.map((b) => b.crossing.countryTh))).join(" / ");
          setRouteBorderNote(
            `ตัดเส้นทางที่ผ่านพรมแดน${countries} ออก ${blocked.length} เส้น — ใช้เฉพาะเส้นทางในประเทศ`,
          );
        }
        setRouteAlternatives(domestic);
        setSelectedRouteIdx(0);
        routeCoordsRef.current = domestic[0].coords; // เส้นแรกเป็นค่าเริ่มต้นให้ runAnalysis สุ่มความสูง 5 กม.สุดท้าย
        setRoute({ distanceM: domestic[0].distanceM, durationS: domestic[0].durationS });

        // ถนนไปไม่ถึงโรงเรียน → ต่อช่วงเดินเท้าจากปลายถนน (ถ้าตั้งค่า host เดินเท้าไว้)
        // เป็นข้อมูลเสริม: หาไม่ได้ก็ปล่อยเป็น null แล้วระบบจะบันทึกสถานะ snapped-far ตามเดิม
        const first = domestic[0];
        const needsWalk = first.destSnapM !== null && first.destSnapM > MAX_ROUTE_SNAP_M;
        if (!needsWalk || !first.destSnapLngLat || !footRoutingEnabled()) {
          setWalkLeg(null);
          return;
        }
        void fetchFootLeg(
          first.destSnapLngLat[0],
          first.destSnapLngLat[1],
          center.lng,
          center.lat,
          controller.signal,
        ).then((leg) => {
          if (!controller.signal.aborted) setWalkLeg(leg);
        });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setRouteErr(e instanceof Error ? e.message : "โหลดเส้นทางรถยนต์ไม่สำเร็จ");
        setNoProvinceRouteReason("no-route");
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
    });
    addPinLabel(routeDs, {
      id: "province-hall-label",
      priority: LABEL_PRIORITY.place,
      lat: province.lat,
      lng: province.lng,
      lines: [`ศาลากลางจังหวัด${province.name}`],
      background: "rgba(37, 99, 235, 0.9)",
      offsetY: -16,
      fontPx: 13,
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
      });
      addPinLabel(routeDs, {
        id: "route-highest-point-label",
        priority: LABEL_PRIORITY.elevation,
        lat: highestPoint.lat,
        lng: highestPoint.lng,
        lines: formatRouteHighestLabel(highestPoint.elevationM).split("\n"),
        background: "rgba(185, 28, 28, 0.92)",
        offsetY: -48,
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

  // ── set_high_point_manaual: คลิกขวาบนแผนที่เพื่อ "ดู" ระดับความสูงของจุดที่ชี้เอง ──────────
  // ดูค่าอย่างเดียว: ไม่บันทึกลงฐานข้อมูล ไม่เข้าไปใน state.gis ที่ส่งขึ้นเซิร์ฟเวอร์ และไม่กระทบคะแนนใด ๆ
  // คลิกขวาซ้ำได้ไม่จำกัด — มีหมุดได้ทีละจุดเดียว ย้ายไปจุดที่คลิกขวาล่าสุดเสมอ
  const [manualHighPoint, setManualHighPoint] = useState<ManualHighPoint | null>(null);
  const manualHighSeqRef = useRef(0); // คลิกขวารัว ๆ: ผลที่มาช้ากว่าคลิกล่าสุดต้องถูกทิ้ง

  const set_high_point_manaual = useCallback(async (lat: number, lng: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const seq = manualHighSeqRef.current + 1;
    manualHighSeqRef.current = seq;
    setManualHighPoint({ lat, lng, elevationM: null, sampling: true });

    // ต้องสุ่มจาก terrain provider ตรง ๆ ไม่ใช่ scene.globe.getHeight()/pickPosition —
    // ฉากตั้ง verticalExaggeration ไว้ VERTICAL_EXAGGERATION เท่า ความสูงในระบบพิกัดที่เรนเดอร์
    // จึงถูกคูณไว้แล้ว (เคยทำให้ป้ายขึ้น ~2 เท่าของค่าจริง) แหล่งนี้คือแหล่งเดียวกับที่หมุดโรงเรียน
    // และจุดสูงสุดบนเส้นทางใช้ (sampleCesiumPoints + KEYLESS_SAMPLE_LEVEL) ค่าจึงเทียบกันได้ตรง ๆ
    const provider = terrainRef.current;
    if (!provider) {
      setManualHighPoint({ lat, lng, elevationM: null, sampling: false });
      return;
    }
    try {
      const heights = await withTimeout(
        sampleCesiumPoints(provider, [{ lat, lng }], KEYLESS_SAMPLE_LEVEL),
        ANALYSIS_TIMEOUT_MS,
        "อ่านระดับความสูงของจุดที่ชี้ใช้เวลานานเกินไป",
      );
      if (seq !== manualHighSeqRef.current) return; // มีคลิกขวาใหม่แล้ว
      const elevationM = heights[0];
      setManualHighPoint({
        lat,
        lng,
        elevationM: Number.isFinite(elevationM) ? elevationM : null,
        sampling: false,
      });
    } catch {
      if (seq !== manualHighSeqRef.current) return;
      setManualHighPoint({ lat, lng, elevationM: null, sampling: false });
    }
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status !== "ready") return;
    const scene = viewer.scene;
    const canvas = scene.canvas;

    const handler = new ScreenSpaceEventHandler(canvas);
    handler.setInputAction((click: { position: Cartesian2 }) => {
      const cartesian = scene.pickPosition(click.position);
      if (!cartesian) return; // คลิกพลาดพื้นโลก
      const carto = Cartographic.fromCartesian(cartesian);
      // คลิกเฉียดขอบฟ้า/นอกโลกอาจได้พิกัด NaN — ต้องกันไว้เหมือนตอนวาด polygon
      if (!carto || !Number.isFinite(carto.latitude) || !Number.isFinite(carto.longitude)) return;
      // ใช้เฉพาะละติจูด/ลองจิจูดของจุดที่คลิก — ความสูงไปสุ่มจาก terrain provider ใน set_high_point_manaual
      void set_high_point_manaual(CesiumMath.toDegrees(carto.latitude), CesiumMath.toDegrees(carto.longitude));
    }, ScreenSpaceEventType.RIGHT_CLICK);

    // กันเมนูคลิกขวาของเบราว์เซอร์ขึ้นมาบังป้ายหมุดที่เพิ่งวาง
    const suppressContextMenu = (e: MouseEvent) => e.preventDefault();
    canvas.addEventListener("contextmenu", suppressContextMenu);

    return () => {
      canvas.removeEventListener("contextmenu", suppressContextMenu);
      handler.destroy();
    };
  }, [status, set_high_point_manaual]);

  // ── ซ่อนป้ายที่ทับกันบนจอ (ธง/หมุดยังแสดงครบ) — คำนวณใหม่เมื่อกล้องขยับ ────────────────
  // ตอนซูมออก ป้ายหลายอันตกมาอยู่ที่เดียวกันจนอ่านไม่ออก; ซูมเข้าจนแยกกันได้ ป้ายจะกลับมาเอง
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status !== "ready") return;
    const scene = viewer.scene;
    const anchor = new Cartesian2();
    const cameraToPoint = new Cartesian3();
    const groundCarto = new Cartographic();
    const groundPosition = new Cartesian3();
    let lastRunMs = 0;

    // ตำแหน่งที่ป้าย "ถูกวาดจริง" — entity เก็บพิกัดที่ความสูง 0 แต่ billboard ตั้ง CLAMP_TO_GROUND
    // จึงไปเกาะผิวภูมิประเทศ (และถูกคูณด้วย verticalExaggeration อีก) ถ้าใช้พิกัดดิบมาฉายลงจอ
    // จุดยึดจะต่ำกว่าธงจริงมากเมื่อซูมเข้า จนกล่องหลุดนอกจอและป้ายถูกซ่อนทั้งที่ควรแสดง
    const renderedPositionOf = (position: Cartesian3): Cartesian3 => {
      const carto = Cartographic.fromCartesian(position, undefined, groundCarto);
      if (!carto) return position;
      const height = scene.globe.getHeight(carto); // คืนความสูงหลังคูณ exaggeration แล้ว
      if (typeof height !== "number" || !Number.isFinite(height)) return position;
      return Cartesian3.fromRadians(carto.longitude, carto.latitude, height, undefined, groundPosition);
    };

    const declutter = () => {
      const now = performance.now();
      if (now - lastRunMs < LABEL_DECLUTTER_INTERVAL_MS) return;
      lastRunMs = now;

      const time = viewer.clock.currentTime;
      const boxes: LabelBox[] = [];
      const labeled: Entity[] = [];
      for (const dsRef of [
        pinDsRef,
        routeDsRef,
        searchDsRef,
        gisDsRef,
        schoolPinsDsRef,
        bordersDsRef,
        manualHighDsRef,
      ]) {
        const ds = dsRef.current;
        if (!ds) continue;
        for (const entity of ds.entities.values) {
          const id = String(entity.id);
          const placement = labelPlacements.get(id);
          if (!placement) continue;
          labeled.push(entity);
          const rawPosition = entity.position?.getValue(time);
          if (!rawPosition) continue;
          const position = renderedPositionOf(rawPosition);
          // จุดที่อยู่หลังกล้องยังถูกฉายเป็นพิกัดจอได้ (กลับด้าน) — ต้องคัดออก ไม่งั้นไปบังป้ายที่มองเห็นจริง
          const toPoint = Cartesian3.subtract(position, scene.camera.positionWC, cameraToPoint);
          if (Cartesian3.dot(toPoint, scene.camera.directionWC) <= 0) continue;
          // ระยะกล้อง→หมุด ใช้ย่อกล่องตาม scaleByDistance และเช็คว่าป้ายจางหายไปแล้วหรือยัง
          const distanceM = Cartesian3.magnitude(toPoint);
          if (labelFadedOut(placement, distanceM)) continue;
          // drawing-buffer pixel — หน่วยเดียวกับ billboard.width/height/pixelOffset ของ Cesium
          const screen = SceneTransforms.worldToDrawingBufferCoordinates(scene, position, anchor);
          if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) continue;
          const box = labelBox(id, screen.x, screen.y, placement, distanceM);
          // ป้ายที่อยู่นอกจอไม่ต้องนำมาคิด — ไม่มีใครเห็น และไม่ควรไปกันป้ายที่อยู่ในจอ
          if (box.right < 0 || box.bottom < 0 || box.left > scene.drawingBufferWidth) continue;
          if (box.top > scene.drawingBufferHeight) continue;
          boxes.push(box);
        }
      }
      if (labeled.length === 0) return;

      const visible = pickVisibleLabels(boxes);
      for (const entity of labeled) {
        const show = visible.has(String(entity.id));
        if (entity.show !== show) entity.show = show;
      }
    };

    scene.postRender.addEventListener(declutter);
    return () => {
      scene.postRender.removeEventListener(declutter);
    };
  }, [status]);

  // หมุด + ป้ายของจุดสูงสุดที่ชี้เอง — วาดใหม่ทั้งชุดทุกครั้ง จึงเหลือหมุดล่าสุดเพียงจุดเดียวเสมอ
  useEffect(() => {
    const ds = manualHighDsRef.current;
    if (!ds || status !== "ready") return;
    ds.entities.removeAll();
    if (!manualHighPoint) return;

    ds.entities.add({
      id: "manual-high-point",
      position: Cartesian3.fromDegrees(manualHighPoint.lng, manualHighPoint.lat),
      billboard: {
        image: MANUAL_HIGH_FLAG_ICON,
        width: 32,
        height: 40,
        verticalOrigin: VerticalOrigin.BOTTOM,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    addPinLabel(ds, {
      id: "manual-high-point-label",
      priority: LABEL_PRIORITY.elevation,
      lat: manualHighPoint.lat,
      lng: manualHighPoint.lng,
      lines: formatManualHighPointLabel(manualHighPoint).split("\n"),
      background: "rgba(234, 88, 12, 0.94)",
      offsetY: -44,
    });
  }, [manualHighPoint, status]);

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
      const draggedPosition = new ConstantPositionProperty(Cartesian3.fromDegrees(ll.lng, ll.lat));
      if (centerPinRef.current) centerPinRef.current.position = draggedPosition;
      if (centerPinLabelRef.current) centerPinLabelRef.current.position = draggedPosition;
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

  // ── คลิกหมุดภาพรวมโรงเรียน → เปิดมุมมองแบบประเมินของโรงเรียนนั้น (โหมดทั้งประเทศเท่านั้น) ──
  // ผูกเฉพาะ national → ไม่ชนกับ handler ลากหมุด/วาด polygon (ผูกเฉพาะ !national)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status !== "ready" || !national) return;
    const scene = viewer.scene;
    const handler = new ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction((e: { position: Cartesian2 }) => {
      const picked = scene.pick(e.position) as { id?: Entity | string } | undefined;
      const raw = picked && typeof picked.id === "object" ? picked.id.id : picked?.id;
      if (typeof raw !== "string" || !raw.startsWith("school-pin:")) return;
      // คลิกได้ทั้งจุดหมุดและป้ายชื่อ (ป้ายเป็น entity แยก id ลงท้าย ":label")
      const schoolPinId = raw.slice("school-pin:".length).replace(/:label$/, "");
      // full navigation → server โหลด+ตรวจสิทธิ์ (canAccessAssessment) แล้วแสดง read-only เหมือน user โรงเรียนนั้น
      window.location.assign(`/map?assessment=${schoolPinId}`);
    }, ScreenSpaceEventType.LEFT_CLICK);
    scene.canvas.style.cursor = "";
    return () => {
      handler.destroy();
    };
  }, [status, national]);

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
    });
    addPinLabel(searchDs, {
      id: "search-pin-label",
      priority: LABEL_PRIORITY.place,
      lat,
      lng,
      lines: [title],
      background: "rgba(124, 58, 237, 0.9)",
      offsetY: -16,
      fontPx: 13,
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

  // ── ธงจุดสูงสุด/ต่ำสุด 8 ทิศ ในรัศมี SECTOR_RADIUS_M ────────────────────────
  // ความสูงอ้างอิง: ใช้ค่าที่หมุดโรงเรียนแสดง (route profile) ก่อนเสมอ — ไม่มีเส้นทางจึงถอยไปใช้
  // เซลล์กลางกริด และบันทึกที่มาไว้ให้ตรวจย้อนได้ว่าตัวเลขส่วนต่างคำนวณจากอะไร
  const sectorResult = useMemo(() => {
    if (!sectorScan) return null;
    const routeElev = routeElevationProfile?.schoolElevationM ?? null;
    const fromRoute = routeElev !== null && Number.isFinite(routeElev);
    const schoolElevationM = fromRoute ? routeElev : sectorScan.gridCenterElevationM;
    const config: GisSectorConfig = {
      radiusM: SECTOR_RADIUS_M,
      thresholdM: SECTOR_RELIEF_K_M,
      schoolElevationM: schoolElevationM === null ? null : Math.round(schoolElevationM),
      schoolElevationSource: fromRoute ? "route-profile" : "grid-center",
    };
    return {
      config,
      sectors: deriveSectorMetrics(sectorScan.sectors, schoolElevationM, SECTOR_RELIEF_K_M),
    };
  }, [sectorScan, routeElevationProfile]);

  useEffect(() => {
    const sectorsDs = sectorsDsRef.current;
    if (!sectorsDs || status !== "ready") return;
    sectorsDs.entities.removeAll();
    if (national || !showSectorFlags || !sectorResult) return;

    for (const sector of sectorResult.sectors) {
      const sectorTh = SECTOR_LABELS_TH[sector.sector];
      // ปักธงเฉพาะจุดที่ต่างจากความสูงโรงเรียนตั้งแต่ ±SECTOR_RELIEF_K_M ขึ้นไป — ต่ำกว่านั้นไม่ปัก
      // (ข้อมูลยังถูกบันทึกครบทุกจุด การซ่อนมีผลแค่การแสดงบนแผนที่)
      if (sectorFlagVisible(sector.highest) && sector.highest) {
        sectorsDs.entities.add({
          id: `sector-high-${sector.sector}`,
          position: Cartesian3.fromDegrees(sector.highest.lng, sector.highest.lat),
          billboard: {
            image: SECTOR_HIGH_FLAG_ICON,
            width: 28,
            height: 34,
            verticalOrigin: VerticalOrigin.BOTTOM,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        addPinLabel(sectorsDs, {
          id: `sector-high-${sector.sector}-label`,
          priority: LABEL_PRIORITY.sector,
          lat: sector.highest.lat,
          lng: sector.highest.lng,
          lines: sectorFlagLines(`สูงสุดทิศ${sectorTh}`, sector.highest, sector.reliefM),
          background: "rgba(91, 33, 182, 0.92)",
          offsetY: -38,
          fontPx: 11,
        });
      }

      if (sectorFlagVisible(sector.lowest) && sector.lowest) {
        sectorsDs.entities.add({
          id: `sector-low-${sector.sector}`,
          position: Cartesian3.fromDegrees(sector.lowest.lng, sector.lowest.lat),
          billboard: {
            image: SECTOR_LOW_FLAG_ICON,
            width: 28,
            height: 34,
            verticalOrigin: VerticalOrigin.BOTTOM,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        addPinLabel(sectorsDs, {
          id: `sector-low-${sector.sector}-label`,
          priority: LABEL_PRIORITY.sector,
          lat: sector.lowest.lat,
          lng: sector.lowest.lng,
          lines: sectorFlagLines(`ต่ำสุดทิศ${sectorTh}`, sector.lowest, null),
          background: "rgba(7, 89, 133, 0.92)",
          offsetY: -38,
          fontPx: 11,
        });
      }
    }
  }, [sectorResult, showSectorFlags, national, status]);

  // ── เขตเทศบาลรอบจุดวิเคราะห์ (overlay อ้างอิง เปิดเองเมื่อต้องการ) ───────────
  // ดึงสดจาก OpenStreetMap ไม่บันทึกลงฐานข้อมูล และไม่มีผลต่อคะแนน
  useEffect(() => {
    if (!showAdminBoundaries || status !== "ready" || national) {
      setAdminBoundaries(null);
      setAdminErr("");
      return;
    }

    const controller = new AbortController();
    setAdminLoading(true);
    setAdminErr("");
    fetchAdminBoundaries(center.lat, center.lng, ADMIN_FETCH_RADIUS_M, controller.signal)
      .then((boundaries) => {
        if (controller.signal.aborted) return;
        setAdminBoundaries(boundaries);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setAdminBoundaries(null);
        setAdminErr(e instanceof Error ? e.message : "โหลดเขตปกครองไม่สำเร็จ");
      })
      .finally(() => {
        if (!controller.signal.aborted) setAdminLoading(false);
      });

    return () => controller.abort();
  }, [showAdminBoundaries, center.lat, center.lng, national, status]);

  useEffect(() => {
    const adminDs = adminDsRef.current;
    if (!adminDs || status !== "ready") return;
    adminDs.entities.removeAll();
    if (national || !showAdminBoundaries || !adminBoundaries) return;

    for (const boundary of adminBoundaries) {
      const color = ADMIN_KIND_COLORS[boundary.kind];

      if (boundary.pointOnly) {
        // OSM มีแค่หมุด — วาดจุดกลวงเพื่อสื่อว่า "รู้ว่ามีเทศบาลนี้ แต่ไม่รู้ขอบเขต"
        // ห้ามวาดวงกลมสมมติแทนขอบเขต เพราะจะกลายเป็นการกุขอบเขตที่ไม่มีข้อมูลรองรับ
        adminDs.entities.add({
          id: `admin-${boundary.name}-point`,
          position: Cartesian3.fromDegrees(boundary.labelLng, boundary.labelLat),
          point: {
            pixelSize: 12,
            color: Color.TRANSPARENT,
            outlineColor: Color.fromCssColorString(color),
            outlineWidth: 3,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }

      boundary.rings.forEach((ring, index) => {
        adminDs.entities.add({
          id: `admin-${boundary.name}-${index}`,
          polyline: {
            positions: ring.map(([lng, lat]) => Cartesian3.fromDegrees(lng, lat)),
            clampToGround: true,
            width: 3,
            material: Color.fromCssColorString(color).withAlpha(0.9),
          },
        });
      });

      addPinLabel(adminDs, {
        id: `admin-${boundary.name}-label`,
        priority: LABEL_PRIORITY.admin,
        lat: boundary.labelLat,
        lng: boundary.labelLng,
        // หมุดที่ไม่มีขอบเขตต้องบอกไว้บนป้าย ไม่ให้ผู้ตรวจเข้าใจว่าที่ตั้งอยู่ "ตรงจุดนั้น" คือทั้งเขต
        lines: boundary.pointOnly ? [boundary.name, "(ไม่มีขอบเขตในข้อมูล OSM)"] : [boundary.name],
        background: color,
        offsetY: boundary.pointOnly ? -14 : 0,
        fontPx: 12,
      });
    }
  }, [adminBoundaries, showAdminBoundaries, national, status]);

  // ── ชั้นสถานภาพป่า (Status) จาก data/forest-status ผ่าน API ────────────────
  useEffect(() => {
    if (status !== "ready" || national) {
      setForestStatusLayer(null);
      setForestTypeLayer(null);
      setForestLegalFromRfd(null);
      setForestStatusAvailable(null);
      setForestStatusNote("");
      return;
    }
    const controller = new AbortController();
    const q = new URLSearchParams({ lat: String(center.lat), lng: String(center.lng) });
    fetch(`/api/forest-status?${q}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("โหลดชั้นป่าไม่สำเร็จ");
        return res.json() as Promise<{
          available: boolean;
          status: ForestStatusLayer | null;
          type: ForestTypeLayer | null;
          legal: ForestLegalLayer | null;
          message?: string;
          note?: string | null;
        }>;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setForestStatusAvailable(data.available);
        setForestStatusLayer(data.status ?? null);
        setForestTypeLayer(data.type ?? null);
        setForestLegalFromRfd(data.legal ?? null);
        setForestStatusNote(data.note || data.message || "");
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setForestStatusAvailable(false);
        setForestStatusLayer(null);
        setForestTypeLayer(null);
        setForestLegalFromRfd(null);
        setForestStatusNote(e instanceof Error ? e.message : "โหลดชั้นป่าไม่สำเร็จ");
      });
    return () => controller.abort();
  }, [center.lat, center.lng, national, status]);

  // ── แนวเขตป่า / พื้นที่คุ้มครอง (overlay อ้างอิง OSM — ไม่ใช่ชั้นประกาศราชการ) ─
  useEffect(() => {
    if (!showForestBoundaries || status !== "ready" || national) {
      setForestBoundaries(null);
      setForestOverlay(null);
      setForestErr("");
      return;
    }

    const controller = new AbortController();
    setForestLoading(true);
    setForestErr("");
    fetchForestBoundaries(center.lat, center.lng, FOREST_FETCH_RADIUS_M, controller.signal)
      .then((boundaries) => {
        if (controller.signal.aborted) return;
        setForestBoundaries(boundaries);
        setForestOverlay(
          classifyForestOverlay(center.lat, center.lng, boundaries, {
            loaded: true,
            dataAuthority: "osm-reference",
            calculatedAt: new Date().toISOString(),
          }),
        );
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setForestBoundaries(null);
        setForestOverlay(
          classifyForestOverlay(center.lat, center.lng, [], {
            loaded: false,
            dataAuthority: "osm-reference",
            calculatedAt: new Date().toISOString(),
          }),
        );
        setForestErr(e instanceof Error ? e.message : "โหลดแนวเขตป่าไม่สำเร็จ");
      })
      .finally(() => {
        if (!controller.signal.aborted) setForestLoading(false);
      });

    return () => controller.abort();
  }, [showForestBoundaries, center.lat, center.lng, national, status]);

  useEffect(() => {
    const forestDs = forestDsRef.current;
    if (!forestDs || status !== "ready") return;
    forestDs.entities.removeAll();
    if (national || !showForestBoundaries || !forestBoundaries) return;

    for (const boundary of forestBoundaries) {
      const color = FOREST_KIND_COLORS[boundary.kind];
      boundary.rings.forEach((ring, index) => {
        forestDs.entities.add({
          id: `forest-${boundary.name}-${index}`,
          polyline: {
            positions: ring.map(([lng, lat]) => Cartesian3.fromDegrees(lng, lat)),
            clampToGround: true,
            width: 3,
            material: Color.fromCssColorString(color).withAlpha(0.95),
          },
          polygon: {
            hierarchy: ring.map(([lng, lat]) => Cartesian3.fromDegrees(lng, lat)),
            material: Color.fromCssColorString(color).withAlpha(0.12),
            outline: false,
            heightReference: HeightReference.CLAMP_TO_GROUND,
          },
        });
      });

      addPinLabel(forestDs, {
        id: `forest-${boundary.name}-label`,
        priority: LABEL_PRIORITY.admin,
        lat: boundary.labelLat,
        lng: boundary.labelLng,
        lines: [boundary.name, FOREST_KIND_LABELS[boundary.kind]],
        background: color,
        offsetY: 0,
        fontPx: 11,
      });
    }
  }, [forestBoundaries, showForestBoundaries, national, status]);

  // ── สภาพพื้นที่ป่าจริง (กรมป่าไม้) — geometry สำหรับวาดเท่านั้น ไม่เข้าคะแนน ──
  useEffect(() => {
    if (!showForestCover || status !== "ready" || national) {
      setForestCoverPolys(null);
      setForestCoverCredit("");
      setForestCoverErr("");
      return;
    }

    const controller = new AbortController();
    setForestCoverLoading(true);
    setForestCoverErr("");
    const q = new URLSearchParams({
      lat: String(center.lat),
      lng: String(center.lng),
      radius: String(FOREST_POLYGON_RADIUS_M),
    });
    fetch(`/api/forest-status/polygons?${q.toString()}`, { signal: controller.signal })
      .then((r) => r.json())
      .then(
        (data: {
          available?: boolean;
          attribution?: string;
          features?: ForestPolygonFeature[];
          message?: string;
        }) => {
          if (controller.signal.aborted) return;
          if (!data.available) {
            setForestCoverPolys(null);
            setForestCoverCredit("");
            setForestCoverErr(data.message || "ยังไม่ได้ติดตั้งชั้นสภาพพื้นที่ป่าในเซิร์ฟเวอร์");
            return;
          }
          setForestCoverPolys(data.features ?? []);
          setForestCoverCredit(data.attribution ?? "");
        },
      )
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setForestCoverPolys(null);
        setForestCoverCredit("");
        setForestCoverErr(e instanceof Error ? e.message : "โหลดพื้นที่ป่าไม่สำเร็จ");
      })
      .finally(() => {
        if (!controller.signal.aborted) setForestCoverLoading(false);
      });

    return () => controller.abort();
  }, [showForestCover, center.lat, center.lng, national, status]);

  useEffect(() => {
    const ds = forestCoverDsRef.current;
    if (!ds || status !== "ready") return;
    ds.entities.removeAll();
    if (national || !showForestCover || !forestCoverPolys) return;

    forestCoverPolys.forEach((feature, featureIndex) => {
      feature.rings.forEach((ring, ringIndex) => {
        const positions = ring.map(([lng, lat]) => Cartesian3.fromDegrees(lng, lat));
        ds.entities.add({
          id: `forest-cover-${featureIndex}-${ringIndex}`,
          polyline: {
            positions,
            clampToGround: true,
            width: 2,
            material: Color.fromCssColorString(FOREST_COVER_LINE_COLOR).withAlpha(0.9),
          },
          polygon: {
            hierarchy: positions,
            material: Color.fromCssColorString(FOREST_COVER_COLOR).withAlpha(0.2),
            outline: false,
            heightReference: HeightReference.CLAMP_TO_GROUND,
          },
        });
      });
    });
  }, [forestCoverPolys, showForestCover, national, status]);

  // ── ขอบเขตตำบล (COD-AB) + ระบุตำบลของจุดที่ตั้ง ─────────────────────────────
  useEffect(() => {
    if (!showTambon || status !== "ready" || national) {
      setTambonList(null);
      setTambonHere(null);
      setTambonErr("");
      return;
    }

    const controller = new AbortController();
    setTambonErr("");
    (async () => {
      const index = await loadTambonIndex(controller.signal);
      const provinces = provincesForPoint(index, center.lat, center.lng);
      if (provinces.length === 0) throw new Error("พิกัดนี้อยู่นอกขอบเขตข้อมูลตำบลของประเทศไทย");
      const docs = await Promise.all(provinces.map((p) => loadTambonProvince(p.code, controller.signal)));
      const tambons = docs.flatMap((doc) => doc?.tambons ?? []);
      if (controller.signal.aborted) return;
      setTambonList(tambons);
      setTambonHere(findTambonAt(tambons, center.lat, center.lng));
    })().catch((e: unknown) => {
      if (controller.signal.aborted) return;
      setTambonList(null);
      setTambonHere(null);
      setTambonErr(e instanceof Error ? e.message : "โหลดขอบเขตตำบลไม่สำเร็จ");
    });

    return () => controller.abort();
  }, [showTambon, center.lat, center.lng, national, status]);

  useEffect(() => {
    const tambonDs = tambonDsRef.current;
    if (!tambonDs || status !== "ready") return;
    tambonDs.entities.removeAll();
    if (national || !showTambon || !tambonList) return;

    for (const tambon of tambonList) {
      // ตำบลที่จุดที่ตั้งอยู่ข้างในเน้นให้เห็นชัด ที่เหลือเป็นเส้นอ้างอิงจาง ๆ
      const isHere = tambonHere !== null && tambon.code === tambonHere.code;
      for (const [index, ring] of tambon.rings.entries()) {
        tambonDs.entities.add({
          id: `tambon-${tambon.code}-${index}`,
          polyline: {
            positions: ring.map(([lng, lat]) => Cartesian3.fromDegrees(lng, lat)),
            clampToGround: true,
            width: isHere ? 4 : 2,
            material: Color.fromCssColorString(isHere ? "#ca8a04" : "#a16207").withAlpha(isHere ? 0.95 : 0.4),
          },
        });
      }
    }

    if (tambonHere) {
      addPinLabel(tambonDs, {
        id: "tambon-here-label",
        priority: LABEL_PRIORITY.admin,
        lat: center.lat,
        lng: center.lng,
        lines: [`ต.${tambonHere.name} อ.${tambonHere.amphoe}`],
        background: "rgba(202, 138, 4, 0.92)",
        offsetY: 26,
        fontPx: 12,
      });
    }
  }, [tambonList, tambonHere, showTambon, national, status, center.lat, center.lng]);

  // ── หมุดสำนักงาน อปท. รอบจุดวิเคราะห์ (ทะเบียน สถ.) ─────────────────────────
  useEffect(() => {
    if (!showLaoOffices || status !== "ready" || national) {
      setLaoNearby(null);
      setLaoErr("");
      return;
    }

    const controller = new AbortController();
    setLaoErr("");
    loadLaoOffices(controller.signal)
      .then((doc) => {
        if (controller.signal.aborted) return;
        setLaoNearby(officesNear(doc.offices, center.lat, center.lng, LAO_NEARBY_RADIUS_M));
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setLaoNearby(null);
        setLaoErr(e instanceof Error ? e.message : "โหลดทะเบียน อปท. ไม่สำเร็จ");
      });

    return () => controller.abort();
  }, [showLaoOffices, center.lat, center.lng, national, status]);

  useEffect(() => {
    const laoDs = laoDsRef.current;
    if (!laoDs || status !== "ready") return;
    laoDs.entities.removeAll();
    if (national || !showLaoOffices || !laoNearby) return;

    for (const office of laoNearby) {
      const color = LAO_KIND_COLORS[office.kind];
      laoDs.entities.add({
        id: `lao-${office.code}`,
        position: Cartesian3.fromDegrees(office.lng, office.lat),
        point: {
          pixelSize: 11,
          color: Color.fromCssColorString(color),
          outlineColor: Color.WHITE,
          outlineWidth: 2,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      addPinLabel(laoDs, {
        id: `lao-${office.code}-label`,
        priority: LABEL_PRIORITY.admin,
        lat: office.lat,
        lng: office.lng,
        // ระบุว่าเป็น "สำนักงาน" เสมอ เพื่อไม่ให้เข้าใจว่าหมุดคือขอบเขตหรือใจกลางเขต
        lines: [`สำนักงาน${laoFullName(office)}`],
        background: color,
        offsetY: -14,
        fontPx: 11,
      });
    }
  }, [laoNearby, showLaoOffices, national, status]);

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
          // ป้ายชื่อประเทศ 3 จุดบนเส้นชายแดนจริง (25% / 50% / 75% ของความยาวเส้น) แทนป้ายเดียวลอย ๆ
          // เดิมใช้ border.label ซึ่งเป็นพิกัดที่คำนวณไว้ล่วงหน้าและไม่ได้อยู่บนเส้นเสมอไป ทำให้เวลาซูมดู
          // ช่วงชายแดนหนึ่ง ๆ มักไม่เห็นป้ายเลยว่าอีกฝั่งคือประเทศอะไร — ถ้าเส้นสั้นผิดปกติจนคำนวณไม่ได้
          // ค่อย fallback กลับไปใช้ border.label ตามเดิม
          const labelPoints = borderLabelPoints(border, BORDER_LABELS_PER_COUNTRY);
          const positions = labelPoints.length > 0 ? labelPoints : [border.label];
          positions.forEach(([lng, lat], index) => {
            addPinLabel(bordersDs, {
              id: `border-label:${border.name}:${index}`,
              priority: LABEL_PRIORITY.country,
              lat,
              lng,
              lines: [border.nameTh],
              background: "rgba(15, 23, 42, 0.78)",
              offsetY: 0,
              fontPx: 13,
              verticalOrigin: VerticalOrigin.CENTER,
            });
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

      // ธง 8 ทิศจากกริดชุดเดียวกัน — เก็บจุดดิบไว้ก่อน ส่วนต่างจากโรงเรียนคำนวณภายหลัง (ดู sectorResult)
      const gridCenterElev = grid[Math.floor(GRID_N / 2) * GRID_N + Math.floor(GRID_N / 2)];
      setSectorScan({
        sectors: sectorElevationsFromGrid(grid, GRID_N, ANALYSIS_WIDTH_M, bbox, {
          radiusM: SECTOR_RADIUS_M,
          schoolElevationM: null,
          thresholdM: SECTOR_RELIEF_K_M,
        }),
        gridCenterElevationM: Number.isFinite(gridCenterElev) ? gridCenterElev : null,
      });
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
        // ขอหลายเส้นเพื่อให้ยังเหลือเส้นในประเทศให้เลือกหลังคัดเส้นที่ข้ามพรมแดนออก
        const routes = await fetchOsrmRoutes(center.lng, center.lat, lng, lat, { alternatives: 3 });
        const bordersDoc = await loadBorders().catch(() => null);
        const { domestic, blocked } = filterDomesticRoutes(routes, bordersDoc);
        if (domestic.length === 0) {
          error = borderBlockedMessage(blocked.map((b) => b.crossing));
        } else {
          route = domestic[0];
        }
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
      });
      addPinLabel(gisDs, {
        id: `gis-dest-label:${d.key}`,
        priority: LABEL_PRIORITY.destination,
        lat: d.lat,
        lng: d.lng,
        lines: [`${GIS_DESTINATION_LABELS[d.destinationType]}: ${d.name}`],
        background: "rgba(5, 150, 105, 0.9)",
        offsetY: -14,
        fontPx: 12,
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
          mountainPct: routeElevationProfile?.mountainPct ?? null,
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
            innerSlopePct: analysis.innerSlopePct === null ? null : Math.round(analysis.innerSlopePct * 10) / 10,
            maxSlopePct: Math.round(analysis.maxSlopePct * 10) / 10,
            localMaxElevation1KmM: analysis.local1000Elev === null ? null : Math.round(analysis.local1000Elev),
            slopeClass: analysis.lddClass,
            landformTh: analysis.landformTh,
            terrainConfidence: "client",
            provinceAvgElev: analysis.provinceAvgElev === null ? null : Math.round(analysis.provinceAvgElev),
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
        mountainPct: routeElevationProfile?.mountainPct ?? null,
        selected: true,
        // ระยะที่ OSRM ย้ายปลายทางไปเกาะถนน — server ใช้ตัดสินว่าเส้นทางนี้ "ไปถึงโรงเรียนจริงไหม"
        destSnapM: sel.destSnapM,
        // ช่วงเดินเท้าต่อจากปลายถนน (ถ้ามี) — server รวมเวลาเข้าข้อ 3.1 ให้เอง
        walkDistanceM: walkLeg?.distanceM ?? null,
        walkDurationS: walkLeg?.durationS ?? null,
        walkDestSnapM: walkLeg?.destSnapM ?? null,
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
  }, [routeAlternatives, selectedRouteIdx, province, mainRouteGain, gisDestinations, routeElevationProfile, walkLeg]);

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
          // ผู้ดูแลบันทึกแทนโรงเรียนได้เฉพาะเมื่อระบุแถวปลายทาง — บัญชีโรงเรียนส่งไปก็ถูกเพิกเฉย (server ใช้ session)
          ...(assessment ? { assessmentId: assessment.id } : {}),
          syncUnitLocation: centerDiffersFromForm,
          center: { lat: center.lat, lng: center.lng, source: centerSourceRef.current },
          elevation: previewGis.elevation,
          routes: buildRoutesPayload(),
          // ไม่มีเส้นทางศาลากลางให้ส่ง → บอก server ว่าเพราะอะไร เพื่อบันทึกเป็นหลักฐานความห่างไกล
          // แทนตัวเลขระยะทางที่ไม่มีจริง (server ตรวจค่านี้กับรายการที่รู้จักก่อนเชื่อ)
          ...(noProvinceRouteReason ? { noRouteReason: noProvinceRouteReason } : {}),
          radiusSummaries: ringStats?.map((ring) => ({
            radiusM: ring.radiusM,
            buildingCount: ring.buildingCount,
            estPopulation: ring.population,
            popDensityPerKm2: ring.densityPerKm2,
          })),
          areaSummary: currentAreaSummary ?? undefined,
          // 3 ชั้นป่า: RFD cells (สงวน/สถานภาพ) + Legal OSM ถ้ามี + Type
          ...(() => {
            const hasOsmLegal = forestOverlay && forestOverlay.status !== "unknown";
            const hasStatus = forestStatusLayer !== null;
            const hasRfdLegal = forestLegalFromRfd !== null;
            if (!hasOsmLegal && !hasStatus && !hasRfdLegal) return {};
            // RFD ป่าสงวนเป็น legal authoritative — ถ้ามี OSM ด้วย ใช้ RFD เป็นหลักสำหรับ legal
            const forestAnalysis: ForestAnalysis = buildForestAnalysis({
              status: forestStatusLayer,
              type: forestTypeLayer,
              legal: forestLegalFromRfd,
              legalOverlay: !forestLegalFromRfd && hasOsmLegal ? forestOverlay : null,
              calculatedAt: new Date().toISOString(),
            });
            return {
              ...(hasOsmLegal ? { forestOverlay } : {}),
              forestAnalysis,
            };
          })(),
          // ธง 8 ทิศ: ส่งเฉพาะพิกัด+ความสูงดิบของแต่ละจุด (server คำนวณ relief/ส่วนต่าง/เกินเกณฑ์ K ใหม่เอง)
          ...(sectorResult
            ? {
                sectorElevations: sectorResult.sectors.map((s) => ({
                  sector: s.sector,
                  highest: s.highest
                    ? { lat: s.highest.lat, lng: s.highest.lng, elevationM: s.highest.elevationM }
                    : null,
                  lowest: s.lowest ? { lat: s.lowest.lat, lng: s.lowest.lng, elevationM: s.lowest.elevationM } : null,
                })),
                sectorConfig: {
                  schoolElevationM: sectorResult.config.schoolElevationM,
                  schoolElevationSource: sectorResult.config.schoolElevationSource,
                },
              }
            : {}),
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
    sectorResult,
    forestOverlay,
    forestStatusLayer,
    forestTypeLayer,
    forestLegalFromRfd,
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
      // อ่านความสูงก่อนเปิด 3D Tiles เสมอ — ค่านี้ต้องมาจาก terrain เดิม (แหล่งเดียวกับที่ใช้คิดคะแนน)
      const pinCarto = Cartographic.fromDegrees(center.lng, center.lat);
      const terrainHeightM = viewer.scene.globe.getHeight(pinCarto);
      const pinHeightM = Number.isFinite(terrainHeightM)
        ? (terrainHeightM as number)
        : (routeElevationProfile?.schoolElevationM ?? 0);
      const hallHeightM = province
        ? viewer.scene.globe.getHeight(Cartographic.fromDegrees(province.lng, province.lat))
        : undefined;
      const pin = Cartesian3.fromDegrees(center.lng, center.lat, pinHeightM);
      const blobs: { blob: Blob; viewKey: string }[] = [];
      // แหล่งภูมิประเทศที่ "ใช้จริง" — ตั้งเป็น google-3dtiles เฉพาะเมื่อ tileset โหลดสำเร็จเท่านั้น
      // (ตั้งใจเปิดแต่ล้ม → ยังเป็น terrarium ตามความจริง ไม่ใช่ตามความตั้งใจ)
      let usedTerrainSource: SnapshotTerrainSource = "terrarium";

      await withPhotorealisticTiles(
        viewer,
        { enabled: photorealistic3dEnabled(), createTileset: () => createGooglePhotorealistic3DTileset() },
        async ({ tileset, skippedReason }) => {
          if (skippedReason) {
            // ตั้งใจเปิด 3D Tiles แต่ใช้ไม่ได้ — บอกผู้ใช้ตรง ๆ ว่าภาพชุดนี้มาจาก globe เดิม ไม่ใช่ Google mesh
            setCaptureErr(`ใช้ Google 3D Tiles ไม่ได้ (${skippedReason}) — จับภาพด้วยภูมิประเทศปกติแทน`);
          }
          if (tileset) usedTerrainSource = "google-3dtiles";
          for (let i = 0; i < SNAPSHOT_VIEWS.length; i++) {
            const view = SNAPSHOT_VIEWS[i];
            if (view.frame === "school-and-province") {
              // มุมภาพรวมครอบทั้งโรงเรียนและศาลากลางจังหวัด — ต้องมีพิกัดศาลากลาง (province) ไม่งั้นข้ามมุมนี้ไป
              if (!province) {
                setCaptureProgress(i + 1);
                continue;
              }
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
            // เมื่อใช้ Google 3D Tiles ต้องรอ mesh ของ tileset ด้วย (globe.tilesLoaded ไม่ครอบคลุม primitive นี้)
            await waitForTilesLoaded(viewer, SNAPSHOT_TILE_WAIT_MS, SNAPSHOT_TILE_STABLE_TICKS, () =>
              tilesetReady(tileset),
            );
            blobs.push({ blob: dataUrlToBlob(captureCurrentView(viewer)), viewKey: view.key });
            setCaptureProgress(i + 1);
          }
        },
      );
      // (transform ของ lookAt ถูกปลดล็อกใน finally เสมอ ก่อนคืนมุมกล้องเดิม)

      const fd = new FormData();
      for (const b of blobs) fd.append("files", b.blob, `${b.viewKey}.jpg`);
      fd.append("viewKeys", JSON.stringify(blobs.map((b) => b.viewKey)));
      // บันทึกแหล่งภาพ/ภูมิประเทศไปกับไฟล์ เพื่อให้ตรวจย้อนหลังได้ว่าหลักฐานชุดนี้เรนเดอร์จากอะไร
      // imageryStatus.source สะท้อนแหล่งที่ใช้จริง (ถ้า provider หลักล้มแล้วถอยไป Esri ค่านี้จะเป็น esri แล้ว)
      fd.append("imagerySource", imageryStatus.source);
      fd.append("terrainSource", usedTerrainSource);
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
  }, [capturing, national, center, assessment, routeElevationProfile, province, imageryStatus.source]);

  // ขั้นตอนในแผงด้านซ้ายเรียงบนลงล่าง 1→5 และจบที่ปุ่มบันทึก (ขั้นตอนที่ 5) เสมอ
  // ซ่อนขั้นตอนที่ 5 เมื่อผู้ใช้บันทึกไม่ได้และยังไม่มีฉบับให้เปิดดู — เป็นขั้นตอนสุดท้ายอยู่แล้ว เลขจึงไม่ขาดช่วง
  const showSaveStep = !national && (canSaveAssessment || Boolean(assessment));

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
          {national && schoolPins.length > 0 ? (
            <div className="map-pin-legend">
              <div className="map-pin-legend-title">โรงเรียนที่บันทึกแบบประเมิน ({fmt(schoolPins.length)} แห่ง)</div>
              <div className="map-pin-legend-row">
                <span className="map-pin-legend-dot" style={{ background: "#6b7280" }} /> ยังร่าง
              </div>
              <div className="map-pin-legend-row">
                <span className="map-pin-legend-dot" style={{ background: "#22c55e" }} /> ส่งแล้ว ผ่านเกณฑ์ (≥50)
              </div>
              <div className="map-pin-legend-row">
                <span className="map-pin-legend-dot" style={{ background: "#ef4444" }} /> ส่งแล้ว ไม่ผ่านเกณฑ์ (&lt;50)
              </div>
              <p className="map-pin-legend-hint">💡 คลิกที่หมุดเพื่อดูข้อมูลวิเคราะห์ของโรงเรียนนั้น</p>
            </div>
          ) : null}
          {!national ? (
            <MapStep
              step={1}
              title="ยืนยันจุดที่ตั้งโรงเรียน"
              hint="💡 ลากหมุดแดงบนแผนที่เพื่อย้ายจุดวิเคราะห์ หรือค้นหาสถานที่ด้านล่าง แล้วระบบจะคำนวณใหม่ให้อัตโนมัติ"
            />
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

          {national ? (
            <p className="map-note">
              บัญชีผู้ดูแล/เจ้าหน้าที่ไม่ผูกกับโรงเรียนใดโรงเรียนหนึ่ง จึงแสดงมุมมองทั้งประเทศ —
              ผู้ใช้บทบาทโรงเรียนจะเห็นแผนที่ตั้งจุดที่โรงเรียนของตนเองพร้อมผลวิเคราะห์ภูมิประเทศ
            </p>
          ) : (
            <>
              <MapStep
                step={2}
                title="เลือกเส้นทางเดินทางเข้าถึง"
                hint="ระบบหาเส้นทางจากศาลากลางจังหวัดให้อัตโนมัติ — ถ้ามีหลายเส้นให้เลือกเส้นที่ใช้จริง และเพิ่มจุดหมาย (อำเภอ/รพ.) ได้จากช่องค้นหาในขั้นตอนที่ 1"
              />
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

              {routeBorderNote ? <p className="map-note map-note-sync">🛂 {routeBorderNote}</p> : null}

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

              <h3 className="map-population-title map-info-title">ผลวิเคราะห์ภูมิประเทศ (คำนวณอัตโนมัติ)</h3>
              <p className="map-note">
                💡 คลิกขวาบนแผนที่ตรงจุดที่คิดว่าสูงสุด เพื่อดูระดับความสูงของจุดนั้น (หมุดส้ม) — คลิกซ้ำได้เรื่อย ๆ
                หมุดจะย้ายไปจุดล่าสุด เป็นการดูค่าอย่างเดียว ไม่บันทึกลงแบบประเมิน
              </p>
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

              <MapStep
                step={3}
                title="วาดพื้นที่เพื่อคำนวณประชากร (ถ้าต้องการ)"
                hint="ข้อสรุปของพื้นที่ที่วาดจะถูกบันทึกไปพร้อมกันในขั้นตอนถัดไป — ข้ามได้ถ้าไม่ต้องการ"
              />
              <div className="map-population">
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

              {!national ? (
                <MapStep
                  step={4}
                  title="จับภาพ 3D ยืนยันที่ตั้ง"
                  hint="ต้องมีแบบประเมินอยู่แล้วจึงจับภาพได้ — ถ้ายังไม่เคยบันทึก ให้ทำขั้นตอนที่ 5 ก่อน แล้วเปิดแผนที่จากแบบประเมินอีกครั้ง"
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
                        จับภาพ 9 มุม (มุมบน + ใกล้/ไกล 4 ทิศ) แล้วแนบเข้าแบบประเมินในหัวข้อ “ลักษณะที่ตั้ง” —
                        จับใหม่จะแทนชุดเดิม
                      </p>
                    </>
                  ) : (
                    <p className="map-snapshot-hint">
                      กดบันทึกแบบประเมินก่อน แล้วเปิดแผนที่จากแบบประเมินอีกครั้งเพื่อจับภาพ 3D ยืนยันที่ตั้ง
                    </p>
                  )}
                </div>
              ) : null}

              {showSaveStep ? (
                <MapStep
                  step={5}
                  title="บันทึกข้อมูลประกอบเกณฑ์และกรอกแบบประเมิน"
                  hint="ขั้นตอนสุดท้าย — บันทึกครั้งเดียวจะเก็บผลทุกขั้นตอนด้านบน (พิกัด เส้นทาง พื้นที่ที่วาด) กรอกข้อมูลประกอบเกณฑ์ และคำนวณคะแนนด้านที่ 3 ให้แบบประเมินปีปัจจุบัน"
                />
              ) : null}

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
            </>
          )}
          <div className={`map-imagery-status map-imagery-status-${imageryStatus.tone}`}>
            <span>{imageryStatus.label}</span>
            <strong>{imageryStatus.detail}</strong>
          </div>

          {!national ? (
            <label className="map-border-toggle">
              <input type="checkbox" checked={showSectorFlags} onChange={(e) => setShowSectorFlags(e.target.checked)} />
              <span>แสดงธงจุดสูงสุด/ต่ำสุด 8 ทิศ (รัศมี {(SECTOR_RADIUS_M / 1000).toLocaleString("th-TH")} กม.)</span>
            </label>
          ) : null}

          {!national ? (
            <>
              <label className="map-border-toggle">
                <input type="checkbox" checked={showTambon} onChange={(e) => setShowTambon(e.target.checked)} />
                <span>แสดงขอบเขตตำบล</span>
              </label>
              {showTambon ? (
                <>
                  {tambonErr ? <p className="map-note map-note-error">{tambonErr}</p> : null}
                  {!tambonErr && tambonHere ? (
                    <p className="map-note">
                      จุดที่ตั้งอยู่ใน <strong>ต.{tambonHere.name}</strong> อ.{tambonHere.amphoe}
                    </p>
                  ) : null}
                  {!tambonErr && tambonList && !tambonHere ? (
                    <p className="map-note">ระบุตำบลของจุดนี้ไม่ได้ (อยู่นอกขอบเขตตำบลในชุดข้อมูล)</p>
                  ) : null}
                  {!tambonErr && tambonList ? (
                    <p className="map-note map-note-warn">
                      ขอบเขตตำบลไม่ใช่เขต อปท. — ตำบลหนึ่งอาจถูกแบ่งระหว่างเทศบาลกับ อบต. จึงบอกได้ว่าอยู่ตำบลใด
                      แต่บอกไม่ได้ว่าอยู่ในเขตเทศบาลหรือไม่
                    </p>
                  ) : null}
                  {!tambonErr && tambonList ? (
                    <p className="map-note map-note-credit">ขอบเขตตำบล: COD-AB (RTSD/OCHA) — CC BY-IGO</p>
                  ) : null}
                </>
              ) : null}

              <label className="map-border-toggle">
                <input type="checkbox" checked={showLaoOffices} onChange={(e) => setShowLaoOffices(e.target.checked)} />
                <span>แสดงสำนักงาน อปท. ใกล้เคียง</span>
              </label>
              {showLaoOffices ? (
                <>
                  {laoErr ? <p className="map-note map-note-error">{laoErr}</p> : null}
                  {!laoErr && laoNearby ? (
                    laoNearby.length > 0 ? (
                      <>
                        <ul className="map-lao-list">
                          {laoNearby.slice(0, 6).map((office) => (
                            <li key={office.code}>
                              {laoFullName(office)} · {(office.distanceM / 1000).toFixed(1)} กม. ·{" "}
                              {office.areaKm2 === null
                                ? "ไม่ระบุขนาดพื้นที่"
                                : `${office.areaKm2.toLocaleString("th-TH")} ตร.กม.`}
                            </li>
                          ))}
                        </ul>
                        {laoNearby.length > 6 ? (
                          <p className="map-note">และอีก {(laoNearby.length - 6).toLocaleString("th-TH")} แห่ง</p>
                        ) : null}
                      </>
                    ) : (
                      <p className="map-note">
                        ไม่พบสำนักงาน อปท. ในรัศมี {(LAO_NEARBY_RADIUS_M / 1000).toLocaleString("th-TH")} กม.
                      </p>
                    )
                  ) : null}
                  {!laoErr && laoNearby ? (
                    <p className="map-note map-note-warn">
                      หมุดคือ<strong>ที่ตั้งสำนักงาน</strong> ไม่ใช่ขอบเขตและไม่ใช่ใจกลางเขต ·
                      ขนาดพื้นที่เป็นตัวเลขตามทะเบียน ไม่ได้บอกรูปร่างหรือทิศทางของเขต
                    </p>
                  ) : null}
                  {!laoErr && laoNearby ? (
                    <p className="map-note map-note-credit">
                      ทะเบียน อปท.: กรมส่งเสริมการปกครองท้องถิ่น (DLA Open Data)
                    </p>
                  ) : null}
                </>
              ) : null}

              <label className="map-border-toggle">
                <input
                  type="checkbox"
                  checked={showAdminBoundaries}
                  onChange={(e) => setShowAdminBoundaries(e.target.checked)}
                />
                <span>แสดงเขตเทศบาลเท่าที่มีใน OpenStreetMap</span>
              </label>
              {showAdminBoundaries ? (
                <>
                  {adminLoading ? <p className="map-note">กำลังโหลดเขตปกครองจาก OpenStreetMap…</p> : null}
                  {adminErr ? <p className="map-note map-note-error">{adminErr}</p> : null}
                  {!adminLoading && !adminErr && adminBoundaries ? (
                    <>
                      {adminBoundaries.length > 0 ? (
                        <p className="map-note">
                          พบ {adminBoundaries.length.toLocaleString("th-TH")} เทศบาลในรัศมี{" "}
                          {(ADMIN_FETCH_RADIUS_M / 1000).toLocaleString("th-TH")} กม. (
                          {[...new Set(adminBoundaries.map((b) => ADMIN_KIND_LABELS[b.kind]))].join(" · ")}) —{" "}
                          {adminBoundaries.filter((b) => !b.pointOnly).length.toLocaleString("th-TH")} แห่งมีเส้นขอบเขต,{" "}
                          {adminBoundaries.filter((b) => b.pointOnly).length.toLocaleString("th-TH")} แห่งมีแต่หมุด
                        </p>
                      ) : (
                        <p className="map-note">
                          ไม่พบเทศบาลในรัศมี {(ADMIN_FETCH_RADIUS_M / 1000).toLocaleString("th-TH")} กม. ในข้อมูล
                          OpenStreetMap
                        </p>
                      )}
                      {/* OSM มีเขตเทศบาลไทยไม่ครบ (เทศบาลเมืองหลายแห่งมีแค่หมุด ไม่มีขอบเขต)
                          จึงต้องเตือนทุกครั้ง ไม่ใช่เฉพาะตอนไม่พบ — ไม่พบ ≠ ไม่มีเทศบาล */}
                      <p className="map-note map-note-warn">
                        ข้อมูลขอบเขตใน OpenStreetMap ยังไม่ครบทุกเทศบาล —
                        แห่งที่ขึ้นเป็นหมุดคือรู้ว่ามีเทศบาลนั้นอยู่แต่ไม่มีเส้นเขตในข้อมูล
                        และการไม่พบเลยก็ไม่ได้แปลว่าพื้นที่นั้นไม่อยู่ในเขตเทศบาล โปรดยึดประกาศจัดตั้ง อปท. เป็นหลักฐาน
                      </p>
                      <p className="map-note map-note-credit">เขตปกครอง: {ADMIN_ATTRIBUTION}</p>
                    </>
                  ) : null}
                </>
              ) : null}

              {/* ชั้น A: สถานภาพป่า — โหลดอัตโนมัติเมื่อมี data/forest-status/cells */}
              {forestStatusAvailable !== null ? (
                <div className="map-note" style={{ marginBottom: "0.5rem" }}>
                  <strong>
                    {forestStatusLayer?.authority === "rfd-national-reserved-forest"
                      ? "แนวเขตป่าสงวนแห่งชาติ (ชั้นกฎหมาย RFD)"
                      : "สภาพพื้นที่ป่า (ชั้น Status)"}
                  </strong>
                  {forestStatusAvailable && forestStatusLayer ? (
                    <>
                      <p className="map-note" style={{ margin: "0.25rem 0 0" }}>
                        {forestStatusLayer.inside === 1 ? "อยู่ในแนวเขต/พื้นที่" : "นอกแนวเขตในรัศมีที่คำนวณ"} · ระยะ{" "}
                        {forestStatusLayer.distanceM === null
                          ? "—"
                          : `${forestStatusLayer.distanceM.toLocaleString("th-TH")} ม.`}{" "}
                        · สัดส่วนใน 1/3/5 กม.{" "}
                        {[forestStatusLayer.pct1km, forestStatusLayer.pct3km, forestStatusLayer.pct5km]
                          .map((p) => (p === null ? "—" : `${p}%`))
                          .join(" / ")}
                        {forestTypeLayer?.typeLabelTh ? ` · ${forestTypeLayer.typeLabelTh}` : ""}
                        {forestStatusLayer.yearBe ? ` · ชั้น พ.ศ. ${forestStatusLayer.yearBe}` : ""}
                      </p>
                      {forestStatusLayer.authority === "rfd-national-reserved-forest" ? (
                        <p className="map-note map-note-warn" style={{ margin: "0.25rem 0 0" }}>
                          ข้อมูลจาก shapefile แนวเขตป่าสงวนกรมป่าไม้ (Open Data) — เป็นเขตกฎหมายโดยประมาณ
                          <strong> ไม่ใช่</strong> แผนที่สภาพพื้นที่ป่าจริง (ไม่นับ/นับต้นไม้)
                          และไม่ใช่เอกสารรับรองแนวเขต
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="map-note map-note-warn" style={{ margin: "0.25rem 0 0" }}>
                      {forestStatusNote || "ยังไม่มีชั้นป่าในเซิร์ฟเวอร์ — ดู data/forest-status/README.md"}
                    </p>
                  )}
                </div>
              ) : null}

              <label className="map-border-toggle">
                <input
                  type="checkbox"
                  checked={showForestCover}
                  onChange={(e) => setShowForestCover(e.target.checked)}
                />
                <span>แสดงพื้นที่ป่าจริงบนแผนที่ (กรมป่าไม้ · ชั้น Status)</span>
              </label>
              {showForestCover ? (
                <>
                  {forestCoverLoading ? <p className="map-note">กำลังโหลดพื้นที่ป่า…</p> : null}
                  {forestCoverErr ? <p className="map-note map-note-error">{forestCoverErr}</p> : null}
                  {!forestCoverLoading && forestCoverPolys ? (
                    <>
                      <p className="map-note">
                        วาด {forestCoverPolys.length.toLocaleString("th-TH")} ผืนในรัศมี{" "}
                        {(FOREST_POLYGON_RADIUS_M / 1000).toLocaleString("th-TH")} กม.
                      </p>
                      <p className="map-note map-note-warn">
                        ชุดข้อมูลไม่ได้แยก “ขอบนอก” กับ “รูใน” และตัวคำนวณเกณฑ์ก็นับทุกวงเป็นป่า
                        ภาพนี้จึงถมพื้นที่โล่งกลางผืนป่าด้วย เพื่อให้ตรงกับตัวเลขสัดส่วนด้านบน
                      </p>
                      {forestCoverCredit ? <p className="map-note map-note-credit">{forestCoverCredit}</p> : null}
                    </>
                  ) : null}
                </>
              ) : null}

              <label className="map-border-toggle">
                <input
                  type="checkbox"
                  checked={showForestBoundaries}
                  onChange={(e) => setShowForestBoundaries(e.target.checked)}
                />
                <span>แสดงแนวเขตตามกฎหมาย / คุ้มครอง (อ้างอิง OSM · ชั้น Legal)</span>
              </label>
              {showForestBoundaries ? (
                <>
                  {forestLoading ? <p className="map-note">กำลังโหลดแนวเขตป่าจาก OpenStreetMap…</p> : null}
                  {forestErr ? <p className="map-note map-note-error">{forestErr}</p> : null}
                  {!forestLoading && forestOverlay ? (
                    <>
                      <p className="map-note">
                        <strong>จุดที่ตั้ง:</strong> {FOREST_STATUS_LABELS[forestOverlay.status]}
                        {forestOverlay.nearestDistanceM !== null && forestOverlay.status !== "in"
                          ? ` · ระยะใกล้สุด ${forestOverlay.nearestDistanceM.toLocaleString("th-TH")} ม.`
                          : null}
                        {forestBoundaries && forestBoundaries.length > 0
                          ? ` · พบ ${forestBoundaries.length.toLocaleString("th-TH")} เขตในรัศมี ${(FOREST_FETCH_RADIUS_M / 1000).toLocaleString("th-TH")} กม.`
                          : null}
                      </p>
                      {forestOverlay.zones.length > 0 ? (
                        <ul className="map-note" style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem" }}>
                          {forestOverlay.zones.slice(0, 5).map((z) => (
                            <li key={`${z.name}-${z.relation}`}>
                              {z.relation === "in" ? "ทับ" : "ชิด"} {z.name} ({FOREST_KIND_LABELS[z.kind]}
                              {z.relation === "near" ? ` · ${z.distanceM.toLocaleString("th-TH")} ม.` : ""})
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <p className="map-note map-note-warn">
                        ชั้นนี้ดึงจาก OpenStreetMap เพื่ออ้างอิงบนแผนที่เท่านั้น — ครอบคลุมชื่อ/แท็ก ป่าสงวน · อุทยาน ·
                        เขตรักษาพันธุ์ · ห้ามล่า · วนอุทยาน · ป่าชุมชน · ป่าชายเลน · สวนพฤกษศาสตร์/รุกขชาติ · ชีวมณฑล ·
                        พื้นที่ชุ่มน้ำ · ลุ่มน้ำชั้น 1 (ถ้ามีใน OSM) ยังไม่ครบทุกเขตและไม่ใช่ประกาศกรมป่าไม้/กรมอุทยาน ·
                        การไม่พบเขต ≠ อยู่นอกป่าทั้งประเทศ · ยังไม่ใช้เป็นประตูคะแนนเพียงลำพัง
                      </p>
                      <p className="map-note map-note-credit">แนวเขตป่า: {FOREST_ATTRIBUTION}</p>
                    </>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}

          <label className="map-border-toggle">
            <input type="checkbox" checked={showBorders} onChange={(e) => setShowBorders(e.target.checked)} />
            <span>แสดงแนวชายแดนไทย + ชื่อประเทศเพื่อนบ้าน</span>
          </label>
          {bordersErr ? <p className="map-note map-note-error">{bordersErr}</p> : null}
          {showBorders && bordersCredit && !bordersErr ? (
            <p className="map-note map-note-credit">แนวชายแดน: {bordersCredit}</p>
          ) : null}

          <p className="map-credit">ภูมิประเทศ: Terrarium · AWS Open Data • ภาพถ่าย: {imageryStatus.credit}</p>
        </aside>
      ) : (
        <MapPanelToggle expanded={false} onToggle={() => setPanelExpanded(true)} />
      )}
    </div>
  );
}
