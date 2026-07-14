"use client";

// โหลด CesiumMap แบบ client-only (ssr:false) — cesium ใช้ WebGL/window จึงรันบน server ไม่ได้
import dynamic from "next/dynamic";
import type { MapAssessment, MapCenter, MapProvince } from "./CesiumMap";

const CesiumMap = dynamic(() => import("./CesiumMap"), {
  ssr: false,
  loading: () => <div className="map-stage map-loading">กำลังโหลดแผนที่ 3 มิติ…</div>,
});

export default function CesiumMapLoader({
  center,
  national,
  province,
  householdSize,
  assessment = null,
}: {
  center: MapCenter;
  national: boolean;
  province: MapProvince | null;
  householdSize: number | null;
  /** โหมดวิเคราะห์แบบประเมิน (?assessment=ID) — null = แผนที่ standalone แบบเดิมทุกประการ */
  assessment?: MapAssessment | null;
}) {
  return (
    <CesiumMap
      center={center}
      national={national}
      province={province}
      householdSize={householdSize}
      assessment={assessment}
    />
  );
}
