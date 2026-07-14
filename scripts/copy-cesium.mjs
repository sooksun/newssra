// คัดลอก static assets ของ Cesium (Workers/Assets/ThirdParty/Widgets) ไปไว้ที่ public/cesium
// รันอัตโนมัติก่อน dev/build (predev/prebuild) — Cesium ต้องโหลดไฟล์เหล่านี้จาก CESIUM_BASE_URL="/cesium"
// public/cesium ถูก gitignore (สร้างใหม่ได้จาก node_modules เสมอ)

import { cp, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules", "cesium", "Build", "Cesium");
const dest = path.join(root, "public", "cesium");
const SUBDIRS = ["Workers", "Assets", "ThirdParty", "Widgets"];

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(src))) {
    console.warn(`[copy-cesium] ข้าม: ไม่พบ ${src} (ยังไม่ได้ npm install cesium?)`);
    return;
  }
  // ถ้าคัดลอกไว้แล้วให้ข้าม (Workers เป็นตัวชี้วัดว่าคัดลอกครบ) — กัน build ช้าโดยไม่จำเป็น
  if (await exists(path.join(dest, "Workers"))) {
    console.log("[copy-cesium] public/cesium มีอยู่แล้ว — ข้าม");
    return;
  }
  await mkdir(dest, { recursive: true });
  for (const sub of SUBDIRS) {
    const from = path.join(src, sub);
    if (await exists(from)) {
      await cp(from, path.join(dest, sub), { recursive: true });
    }
  }
  console.log(`[copy-cesium] คัดลอก Cesium assets → public/cesium แล้ว`);
}

main().catch((err) => {
  console.error("[copy-cesium] ล้มเหลว:", err);
  process.exit(1);
});
