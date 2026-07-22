// เครื่องมือจับภาพจาก Cesium canvas — client-only (ต้องมี WebGL จริง จึงไม่มี unit test; ทดสอบผ่าน browser)
import type { Viewer } from "cesium";

/** รอจน terrain/imagery tile รอบมุมกล้องปัจจุบันโหลดครบ (หรือหมดเวลา) เพื่อกันภาพเบลอ/โหลดไม่ครบ */
export function waitForTilesLoaded(viewer: Viewer, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      if (viewer.isDestroyed()) return resolve();
      if (viewer.scene.globe.tilesLoaded || performance.now() - start > timeoutMs) {
        return resolve();
      }
      viewer.scene.requestRender();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** เรนเดอร์เฟรมปัจจุบันแล้วคืน data URL JPEG (ต้องเปิด preserveDrawingBuffer:true ตอนสร้าง Viewer) */
export function captureCurrentView(viewer: Viewer): string {
  viewer.scene.render();
  return viewer.canvas.toDataURL("image/jpeg", 0.85);
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(head)?.[1] ?? "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
