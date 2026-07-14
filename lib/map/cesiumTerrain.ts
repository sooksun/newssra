// Terrain สำหรับหน้าแผนที่ 3 มิติ: (1) keyless Terrarium provider (2) ตัวสุ่มกริดความสูง
// พอร์ตจาก GeoCommunity Classifier (ไม่ต้องมี Cesium ion token)
import {
  Cartographic,
  Credit,
  CustomHeightmapTerrainProvider,
  WebMercatorTilingScheme,
  sampleTerrain,
  sampleTerrainMostDetailed,
} from "cesium";
import type { TerrainProvider } from "cesium";
import type { Bbox } from "./morphology";

// ── Terrarium (terrain-RGB) terrain provider แบบ keyless ─────────────────────
// ดึงไทล์ความสูงจาก AWS Open Data (elevation-tiles-prod, Mapzen/Tilezen) แล้ว decode
// สี RGB → เมตร ตามสูตร Terrarium: h = R*256 + G + B/256 - 32768
export const TERRARIUM_MAX_LEVEL = 15; // ระดับซูมสูงสุดที่ชุดข้อมูลมี
const HEIGHTMAP_SAMPLES = 64; // ความละเอียด heightmap ต่อไทล์ (จุด/ด้าน)

function terrariumUrl(level: number, x: number, y: number): string {
  return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${level}/${x}/${y}.png`;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// ดึง+ถอดรหัสไทล์ Terrarium 1 ไทล์ → heightmap (Float32Array ขนาด samples×samples หน่วยเมตร)
// ลำดับ row-major north→south, west→east ตรงกับที่ Cesium HeightmapTerrainData ต้องการ
async function terrariumHeightmap(x: number, y: number, level: number, samples: number): Promise<Float32Array> {
  const img = await loadImage(terrariumUrl(level, x, y));
  if (!img || !img.width || !img.height) throw new Error(`โหลดไทล์ Terrarium ${level}/${x}/${y} ไม่สำเร็จ`);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("สร้าง canvas ถอดรหัสความสูงไม่สำเร็จ");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const out = new Float32Array(samples * samples);
  for (let row = 0; row < samples; row++) {
    const py = Math.min(canvas.height - 1, Math.round((row / (samples - 1)) * (canvas.height - 1))); // row 0 = เหนือ
    for (let col = 0; col < samples; col++) {
      const px = Math.min(canvas.width - 1, Math.round((col / (samples - 1)) * (canvas.width - 1))); // col 0 = ตะวันตก
      const o = (py * canvas.width + px) * 4;
      out[row * samples + col] = data[o] * 256 + data[o + 1] + data[o + 2] / 256 - 32768;
    }
  }
  return out;
}

// สร้าง terrain provider จากไทล์ Terrarium (keyless) — ใช้แทน Cesium World Terrain เมื่อไม่มี ion token
export function createTerrariumTerrainProvider(): CustomHeightmapTerrainProvider {
  return new CustomHeightmapTerrainProvider({
    width: HEIGHTMAP_SAMPLES,
    height: HEIGHTMAP_SAMPLES,
    tilingScheme: new WebMercatorTilingScheme(), // XYZ เว็บเมอร์เคเตอร์ ตรงกับพิกัดไทล์ Terrarium
    credit: new Credit("Terrain: Terrarium · AWS Open Data (Mapzen/Tilezen)"),
    callback: (x, y, level) => {
      if (level > TERRARIUM_MAX_LEVEL) return undefined; // เกินระดับสูงสุด → upsample จากไทล์แม่
      return terrariumHeightmap(x, y, level, HEIGHTMAP_SAMPLES);
    },
  });
}

// สุ่มกริด n×n (row 0 = เหนือสุด, col 0 = ตะวันตกสุด) จาก provider → ความสูง (ม.) เป็น Float32Array
// - level = ตัวเลข → ใช้ sampleTerrain ที่ระดับคงที่ (สำหรับ Terrarium ที่ไม่มี availability)
// - level = undefined → ใช้ sampleTerrainMostDetailed (สำหรับ Cesium World Terrain/ion)
export async function sampleCesiumGrid(
  provider: TerrainProvider,
  bbox: Bbox,
  n: number,
  level?: number,
): Promise<Float32Array> {
  const carts: Cartographic[] = [];
  for (let i = 0; i < n; i++) {
    const lat = bbox.north + (bbox.south - bbox.north) * (i / (n - 1));
    for (let j = 0; j < n; j++) {
      const lng = bbox.west + (bbox.east - bbox.west) * (j / (n - 1));
      carts.push(Cartographic.fromDegrees(lng, lat));
    }
  }
  if (typeof level === "number") {
    // clamp กันไม่ให้ขอเกินระดับสูงสุด (level > max → callback คืน undefined → sampleTerrain วน retry ไม่จบ)
    await sampleTerrain(provider, Math.min(level, TERRARIUM_MAX_LEVEL), carts);
  } else {
    await sampleTerrainMostDetailed(provider, carts);
  }
  // ตัวอย่างที่ล้มเหลว (ไทล์โหลดไม่ได้) → height เป็น undefined → เก็บเป็น NaN (อย่าแทนด้วย 0)
  const out = new Float32Array(n * n);
  for (let k = 0; k < carts.length; k++) out[k] = carts[k].height ?? NaN;
  return out;
}

// สุ่มความสูงที่จุดใดๆ (ไม่ใช่กริดสี่เหลี่ยม) — ใช้กับจุดตามแนวเส้นทาง (เช่น ช่วง 5 กม.สุดท้ายของเส้นทางรถยนต์)
export async function sampleCesiumPoints(
  provider: TerrainProvider,
  points: { lat: number; lng: number }[],
  level?: number,
): Promise<Float32Array> {
  const carts = points.map((p) => Cartographic.fromDegrees(p.lng, p.lat));
  if (typeof level === "number") {
    await sampleTerrain(provider, Math.min(level, TERRARIUM_MAX_LEVEL), carts);
  } else {
    await sampleTerrainMostDetailed(provider, carts);
  }
  const out = new Float32Array(carts.length);
  for (let k = 0; k < carts.length; k++) out[k] = carts[k].height ?? NaN;
  return out;
}
