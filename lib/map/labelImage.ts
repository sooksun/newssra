// ป้ายข้อความบนแผนที่ 3 มิติ — วาดเป็นรูปภาพเดียวแล้วใช้เป็น billboard แทน Cesium Label
//
// เหตุผล: Cesium สร้าง glyph แยกทีละตัวอักษรลง texture atlas แล้วจัดตำแหน่งเอง ภาษาไทยที่มี
// สระบน/ล่างและวรรณยุกต์ (เช่น "ระดับ") จึงถูกฉีกออกจากกัน — เห็นเป็น "ระดั" ขึ้นบรรทัดใหม่เป็น "บ"
// หรือสระหาย การวาดผ่าน canvas.fillText ให้เบราว์เซอร์ shape ข้อความเองแล้วส่งเป็นรูปเดียว
// ทำให้ข้อความไทยแสดงถูกต้องเสมอ

export interface LabelImageStyle {
  /** สีพื้นหลังป้าย (CSS color) */
  background: string;
  fontPx?: number;
  paddingX?: number;
  paddingY?: number;
  /** ระยะห่างระหว่างบรรทัด เป็นสัดส่วนของ fontPx */
  lineHeightRatio?: number;
  radius?: number;
}

export interface LabelImageResult {
  url: string;
  width: number;
  height: number;
}

export const LABEL_IMAGE_DEFAULTS = {
  fontPx: 14,
  paddingX: 10,
  paddingY: 7,
  lineHeightRatio: 1.45,
  radius: 8,
} as const;

/** ขนาดป้ายจากความกว้างของแต่ละบรรทัด (หน่วย CSS px) — แยกออกมาเป็นฟังก์ชันบริสุทธิ์เพื่อทดสอบได้ */
export function labelImageSize(lineWidths: readonly number[], style: LabelImageStyle) {
  const fontPx = style.fontPx ?? LABEL_IMAGE_DEFAULTS.fontPx;
  const paddingX = style.paddingX ?? LABEL_IMAGE_DEFAULTS.paddingX;
  const paddingY = style.paddingY ?? LABEL_IMAGE_DEFAULTS.paddingY;
  const lineHeight = Math.round(fontPx * (style.lineHeightRatio ?? LABEL_IMAGE_DEFAULTS.lineHeightRatio));
  const widest = lineWidths.reduce((max, w) => (Number.isFinite(w) && w > max ? w : max), 0);
  const lineCount = Math.max(lineWidths.length, 1);
  return {
    width: Math.ceil(widest + paddingX * 2),
    height: Math.ceil(lineHeight * lineCount + paddingY * 2),
    lineHeight,
    fontPx,
    paddingX,
    paddingY,
  };
}

/** ฟอนต์ของแอป (Sarabun ผ่าน next/font) เพื่อให้ป้ายบนแผนที่หน้าตาเหมือนข้อความในหน้าเว็บ */
function resolveFontFamily(): string {
  if (typeof document === "undefined") return "'Sarabun', sans-serif";
  const family = getComputedStyle(document.body).fontFamily;
  return family && family.trim() ? family : "'Sarabun', sans-serif";
}

// ป้ายเดิมถูกวาดซ้ำทุกครั้งที่ effect ของหมุดทำงานใหม่ (เปลี่ยนกล้อง/โหลดความสูงเสร็จ ฯลฯ)
// และหมุดภาพรวมโรงเรียนมีจำนวนมาก — cache ตามข้อความ+สไตล์ ทำให้ canvas ถูกวาดครั้งเดียวต่อป้ายหนึ่งแบบ
const imageCache = new Map<string, LabelImageResult>();
const IMAGE_CACHE_LIMIT = 500;

/** วาดป้ายเป็น data URL — คืน null เมื่อเรียกนอกเบราว์เซอร์หรือขอ canvas 2d ไม่ได้ */
export function createLabelImage(lines: readonly string[], style: LabelImageStyle): LabelImageResult | null {
  if (typeof document === "undefined") return null;
  const text = lines.filter((line) => line.length > 0);
  if (text.length === 0) return null;

  const cacheKey = JSON.stringify([text, style]);
  const cached = imageCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const fontPx = style.fontPx ?? LABEL_IMAGE_DEFAULTS.fontPx;
  const font = `600 ${fontPx}px ${resolveFontFamily()}`;
  ctx.font = font;
  const size = labelImageSize(
    text.map((line) => ctx.measureText(line).width),
    style,
  );

  // วาดที่ความละเอียดจอจริงเพื่อไม่ให้ตัวหนังสือแตกบนจอ HiDPI (จำกัด 3 เท่า กันรูป texture ใหญ่เกิน)
  const scale = Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, 3);
  canvas.width = Math.ceil(size.width * scale);
  canvas.height = Math.ceil(size.height * scale);
  ctx.scale(scale, scale);
  ctx.font = font;
  ctx.textBaseline = "middle";

  const radius = style.radius ?? LABEL_IMAGE_DEFAULTS.radius;
  ctx.fillStyle = style.background;
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(0, 0, size.width, size.height, radius);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, size.width, size.height);
  }

  ctx.fillStyle = "#ffffff";
  text.forEach((line, index) => {
    ctx.fillText(line, size.paddingX, size.paddingY + size.lineHeight * (index + 0.5));
  });

  const result: LabelImageResult = { url: canvas.toDataURL("image/png"), width: size.width, height: size.height };
  if (imageCache.size >= IMAGE_CACHE_LIMIT) imageCache.clear(); // กันโตไม่จำกัดเมื่อผู้ใช้เลื่อนดูหลายพื้นที่
  imageCache.set(cacheKey, result);
  return result;
}
