"use client";

// โหลด CesiumMap แบบ client-only (ssr:false) — cesium ใช้ WebGL/window จึงรันบน server ไม่ได้
import dynamic from "next/dynamic";
import type { MapAssessment, MapCenter, MapCurrentYearAssessment, MapProvince } from "./CesiumMap";

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
  canSaveAssessment = false,
  currentYearAssessment = null,
  showPlaceSearch = true,
}: {
  center: MapCenter;
  national: boolean;
  province: MapProvince | null;
  householdSize: number | null;
  /** โหมดวิเคราะห์แบบประเมิน (?assessment=ID) — null = แผนที่ standalone แบบเดิมทุกประการ */
  assessment?: MapAssessment | null;
  /** เฉพาะบัญชีโรงเรียนที่มีรหัสจึงบันทึกลงแบบประเมินปีปัจจุบันได้ (ปุ่มบันทึกครั้งเดียว) */
  canSaveAssessment?: boolean;
  /** ฉบับปีปัจจุบันของโรงเรียน แยกจาก assessment ที่เปิดดู — null = ยังไม่มีฉบับปีปัจจุบัน */
  currentYearAssessment?: MapCurrentYearAssessment | null;
  /** ค่าตั้งค่าส่วนกลาง: แสดงช่องค้นหาสถานที่บนแผนที่หรือไม่ */
  showPlaceSearch?: boolean;
}) {
  return (
    <CesiumMap
      center={center}
      national={national}
      province={province}
      householdSize={householdSize}
      assessment={assessment}
      canSaveAssessment={canSaveAssessment}
      currentYearAssessment={currentYearAssessment}
      showPlaceSearch={showPlaceSearch}
    />
  );
}
