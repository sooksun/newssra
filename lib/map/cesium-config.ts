// ตัวตั้งค่า CesiumJS แบบรวมศูนย์ (client-only) — ตั้ง base URL ของ static assets + ion token (ถ้ามี)
// พอร์ตมาจากระบบ GeoCommunity Classifier: แปลง import.meta.env.VITE_* → process.env.NEXT_PUBLIC_*
// เรียก configureCesium() ครั้งเดียวก่อนสร้าง Viewer (idempotent)
import { GoogleMaps, Ion } from "cesium";

// ต้องขึ้นต้นด้วย NEXT_PUBLIC_ จึงจะถูก inline เข้า client bundle; เว้นว่างได้ (โหมด keyless)
const ION_TOKEN = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const MAP_IMAGERY_PROVIDER = process.env.NEXT_PUBLIC_MAP_IMAGERY_PROVIDER;

export type MapImagerySource = "esri" | "google" | "ion";

let configured = false;

/** ตั้งค่า Cesium ให้พร้อมใช้งาน (เรียกซ้ำได้ ไม่ทำงานซ้ำ) */
export function configureCesium() {
  if (configured) return;
  // Cesium โหลด Workers/Assets/Widgets จาก path นี้ (คัดลอกไว้ที่ public/cesium โดย scripts/copy-cesium.mjs)
  if (typeof window !== "undefined") {
    (window as unknown as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = "/cesium";
  }
  // ตั้ง ion token เฉพาะเมื่อผู้ใช้ตั้งค่าเอง — ไม่มีก็ใช้โหมด keyless (Terrarium terrain + Esri imagery)
  if (ION_TOKEN && ION_TOKEN.trim()) {
    Ion.defaultAccessToken = ION_TOKEN.trim();
  }
  if (GOOGLE_MAPS_API_KEY && GOOGLE_MAPS_API_KEY.trim()) {
    GoogleMaps.defaultApiKey = GOOGLE_MAPS_API_KEY.trim();
  }
  configured = true;
}

/** มี Cesium ion token ที่ผู้ใช้ตั้งเองหรือไม่ (ไม่นับ demo token ในตัว) */
export function hasCesiumIonToken(): boolean {
  return Boolean(ION_TOKEN && ION_TOKEN.trim());
}

export function googleMapsApiKey(): string | null {
  return GOOGLE_MAPS_API_KEY?.trim() || null;
}

export function preferredImagerySource(): MapImagerySource {
  const requested = MAP_IMAGERY_PROVIDER?.trim().toLowerCase();
  if (requested === "esri") return "esri";
  if (requested === "google" && googleMapsApiKey()) return "google";
  if (requested === "ion" && hasCesiumIonToken()) return "ion";
  if (googleMapsApiKey()) return "google";
  if (hasCesiumIonToken()) return "ion";
  return "esri";
}
