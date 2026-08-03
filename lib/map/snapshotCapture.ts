// เครื่องมือจับภาพจาก Cesium canvas — client-only
// captureCurrentView/dataUrlToBlob ต้องมี WebGL/canvas จริง จึงไม่มี unit test (ทดสอบผ่าน browser)
// waitForTilesLoaded เป็น timing utility ล้วน ๆ (ไม่แตะ rAF/canvas) จึงมี unit test ด้วย fake viewer ได้ — ดู snapshotCapture.test.ts
import type { Viewer } from "cesium";

/**
 * รอจน terrain/imagery tile รอบมุมกล้องปัจจุบันโหลดครบ (หรือหมดเวลา) เพื่อกันภาพเบลอ/โหลดไม่ครบ
 *
 * ใช้ setTimeout polling แทน requestAnimationFrame โดยเจตนา: rAF จะไม่ยิงเลยเมื่อแท็บ/webview
 * ไม่ได้ compositing เฟรม (แท็บถูกซ่อน/สลับไปแท็บอื่น) ซึ่งจะทำให้ทั้ง poll และ timeout (ที่เดิม
 * เช็คอยู่ใน callback ของ rAF) ค้างตลอดไป — setTimeout ยังคงยิงในแท็บที่ถูกซ่อนอยู่ (แค่ถูก throttle)
 * จึงการันตีว่า timeout จะทำงานเสมอไม่ว่าแท็บจะอยู่ foreground หรือไม่
 */
export function waitForTilesLoaded(
  viewer: Viewer,
  timeoutMs = 4000,
  stableTicks = 1,
  /** เงื่อนไขความพร้อมเพิ่มเติมนอกเหนือจาก globe เช่น Cesium3DTileset.tilesLoaded ตอนใช้ Google 3D Tiles
   *  (globe.tilesLoaded ไม่ครอบคลุม primitive อื่น — ถ้าไม่รอด้วยจะจับภาพตอน mesh ยังโหลดไม่ครบ)
   *  ไม่ส่งมา = พฤติกรรมเดิมทุกประการ */
  extraReady?: () => boolean,
): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let loadedStreak = 0;

    const finish = () => {
      if (timer !== undefined) clearTimeout(timer);
      resolve();
    };

    const tick = () => {
      if (viewer.isDestroyed()) return finish();
      // ต้องเห็น tilesLoaded ติดกัน stableTicks ครั้งจึงถือว่านิ่งจริง — หลังหมุนกล้อง Cesium มักรายงาน
      // tilesLoaded=true ชั่วครู่ก่อนจะเริ่มขอไทล์ระดับละเอียดของมุมใหม่ ถ้าจับภาพจังหวะนั้นจะได้ภาพเบลอ
      const ready = viewer.scene.globe.tilesLoaded && (extraReady ? extraReady() : true);
      loadedStreak = ready ? loadedStreak + 1 : 0;
      if (loadedStreak >= stableTicks || Date.now() - start > timeoutMs) {
        return finish();
      }
      viewer.scene.requestRender();
      timer = setTimeout(tick, 100);
    };

    tick();
  });
}

/** เรนเดอร์เฟรมปัจจุบันแล้วคืน data URL JPEG (ต้องเปิด preserveDrawingBuffer:true ตอนสร้าง Viewer) */
export function captureCurrentView(viewer: Viewer, quality = 0.92): string {
  viewer.scene.render();
  return viewer.canvas.toDataURL("image/jpeg", quality);
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(head)?.[1] ?? "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
