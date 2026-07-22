import Link from "next/link";
import { canAccessAssessment, requireUser } from "@/lib/auth";
import { currentBuddhistYear } from "@/lib/assessment-year";
import {
  assessmentForSchoolYear,
  getAssessment,
  latestOwnerCoords,
  listProvinces,
  provinceHouseholdSize,
  resolveSchoolProvince,
  schoolLocationByCode,
} from "@/lib/repo";
import type { ProvinceInfo } from "@/lib/repo";
import { ROLE_LABELS } from "@/lib/types";
import UserMenu from "@/components/UserMenu";
import CesiumMapLoader from "@/components/map/CesiumMapLoader";
import type { MapAssessment, MapCenter } from "@/components/map/CesiumMap";

export const dynamic = "force-dynamic";

// มุมมองเริ่มต้นทั้งประเทศ (ศูนย์กลางประมาณกลางประเทศไทย) สำหรับ admin/ssra_admin
const THAILAND_CENTER: MapCenter = { lat: 15.5, lng: 101.0, name: "ประเทศไทย" };

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ assessment?: string }>;
}) {
  const user = await requireUser();
  const canSeeAll = user.role === "admin" || user.role === "ssra_admin";
  const sp = await searchParams;

  // โหมดวิเคราะห์แบบประเมิน (?assessment=ID) — โหลดแบบประเมิน + ตรวจสิทธิ์; ไม่ผ่าน → แผนที่ปกติ (ไม่ leak ว่ามี id นี้)
  let assessment: MapAssessment | null = null;
  let assessmentCoords: MapCenter | null = null;
  let assessmentOwnerCode: string | null = null; // รหัสโรงเรียนเจ้าของแบบประเมิน (ใช้หาจังหวัดจริงจากทะเบียน)
  let assessmentEnteredProvince = ""; // จังหวัดที่ผู้ใช้กรอกในแบบประเมิน (fallback ก่อนศาลากลางใกล้สุด)
  const assessmentId = Number.parseInt(sp.assessment ?? "", 10);
  if (Number.isInteger(assessmentId) && assessmentId > 0) {
    try {
      const record = await getAssessment(assessmentId);
      if (record && canAccessAssessment(user, record.ownerSchoolCode)) {
        const unitName = record.state.unit.name || `แบบประเมิน #${record.id}`;
        assessmentOwnerCode = record.ownerSchoolCode;
        assessmentEnteredProvince = record.state.unit.province;
        assessment = {
          id: record.id,
          name: unitName,
          unitCenter: null,
          submitted: Boolean(record.state.submitted),
          existingGis: record.state.gis ?? null,
        };
        // จุดเริ่มต้น: พิกัดในแบบประเมิน → พิกัด GIS ที่เคยวิเคราะห์ → พิกัดโรงเรียนจากฐานระบบเดิม
        const lat = Number.parseFloat(record.state.unit.lat);
        const lng = Number.parseFloat(record.state.unit.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
          assessment.unitCenter = { lat, lng, name: unitName };
          assessmentCoords = assessment.unitCenter;
        } else if (record.state.gis) {
          assessmentCoords = { lat: record.state.gis.center.lat, lng: record.state.gis.center.lng, name: unitName };
        } else if (record.ownerSchoolCode) {
          const loc = await schoolLocationByCode(record.ownerSchoolCode);
          if (loc) assessmentCoords = { lat: loc.lat, lng: loc.lng, name: unitName };
        }
      }
    } catch (error) {
      console.error("[map] assessment lookup failed:", error);
    }
  }

  // โรงเรียนเปิด /map ปกติ → ผูกกับแบบประเมิน "ปีปัจจุบัน" ของโรงเรียนตน (1 โรงเรียน/1 ปี)
  // ถ้ายังไม่มีฉบับปีนี้ assessment คง null ได้ — ปุ่มบันทึกครั้งเดียวจะสร้างให้เอง (canSaveAssessment ไม่ผูกกับการมีฉบับ)
  if (!assessment && user.role === "school") {
    try {
      const record = await assessmentForSchoolYear(user.schoolCode, currentBuddhistYear());
      if (record && canAccessAssessment(user, record.ownerSchoolCode)) {
        const unitName = record.state.unit.name || `แบบประเมิน #${record.id}`;
        assessmentOwnerCode = record.ownerSchoolCode;
        assessmentEnteredProvince = record.state.unit.province;
        assessment = {
          id: record.id,
          name: unitName,
          unitCenter: null,
          submitted: Boolean(record.state.submitted),
          existingGis: record.state.gis ?? null,
        };
        const lat = Number.parseFloat(record.state.unit.lat);
        const lng = Number.parseFloat(record.state.unit.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
          assessment.unitCenter = { lat, lng, name: unitName };
          assessmentCoords = assessment.unitCenter;
        } else if (record.state.gis) {
          assessmentCoords = { lat: record.state.gis.center.lat, lng: record.state.gis.center.lng, name: unitName };
        } else if (record.ownerSchoolCode) {
          const loc = await schoolLocationByCode(record.ownerSchoolCode);
          if (loc) assessmentCoords = { lat: loc.lat, lng: loc.lng, name: unitName };
        }
      }
    } catch (error) {
      console.error("[map] latest assessment lookup failed:", error);
    }
  }

  // school → จุดเริ่มต้นที่โรงเรียนของตน (จากแบบประเมินล่าสุดที่มีพิกัด); ไม่พบ → มุมมองทั้งประเทศ
  let center: MapCenter = THAILAND_CENTER;
  let national = true;
  if (assessmentCoords) {
    center = assessmentCoords;
    national = false;
  } else if (user.role === "school") {
    let coords = null;
    try {
      // 1) แบบประเมินล่าสุดที่มีพิกัด → 2) พิกัดจากฐานข้อมูลหลักของระบบเดิม (มีตั้งแต่ยังไม่ได้ทำแบบประเมิน)
      coords = await latestOwnerCoords(user.schoolCode);
      if (!coords) coords = await schoolLocationByCode(user.schoolCode);
    } catch (error) {
      console.error("[map] school coords lookup failed:", error);
    }
    if (coords) {
      center = { lat: coords.lat, lng: coords.lng, name: coords.name };
      national = false;
    }
  }

  // จังหวัดของจุดวิเคราะห์ → จุดเริ่มต้นเส้นทางรถยนต์ + เกณฑ์ความสูงเฉลี่ยจังหวัด
  // ใช้จังหวัดจริงจากทะเบียนโรงเรียนก่อน (แม่นสำหรับอำเภอชายขอบ) แล้วค่อย fallback เป็นศาลากลางที่ใกล้ที่สุด
  let province: ProvinceInfo | null = null;
  if (!national) {
    try {
      const provinces = await listProvinces();
      const schoolCode = assessmentOwnerCode ?? (user.role === "school" ? user.schoolCode : null);
      province = await resolveSchoolProvince(provinces, {
        schoolCode,
        enteredProvince: assessmentEnteredProvince,
        lat: center.lat,
        lng: center.lng,
      });
    } catch (error) {
      console.error("[map] province lookup failed:", error);
    }
  }

  // ขนาดครัวเรือนเฉลี่ยของจังหวัด — ใช้ประมาณจำนวนประชากรจากจำนวนอาคารในแต่ละรัศมี (ดูตารางในแผนที่)
  const householdSize = !national && province ? await provinceHouseholdSize(province.name) : null;

  // เฉพาะบัญชีโรงเรียนที่มีรหัสจึงบันทึกลงแบบประเมินปีปัจจุบันได้ — แยกจากการมีฉบับอยู่แล้วหรือไม่
  const canSaveAssessment = user.role === "school" && Boolean(user.schoolCode);

  return (
    <div className="app-shell map-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">พศ</div>
          <div>
            <p className="eyebrow">ระบบคัดกรองสถานศึกษาพื้นที่ลักษณะพิเศษ</p>
            <h1>{assessment ? `วิเคราะห์พิกัด GIS — ${assessment.name}` : "แผนที่ 3 มิติ (Cesium)"}</h1>
          </div>
        </div>
        <div className="top-actions">
          {assessment ? (
            <Link className="ghost-btn" href={`/assessment/${assessment.id}`}>
              กลับไปที่แบบประเมิน
            </Link>
          ) : null}
          <Link className="ghost-btn" href="/">
            รายการแบบประเมิน
          </Link>
          {canSeeAll ? (
            <Link className="ghost-btn" href="/dashboard">
              แดชบอร์ดสรุปผล
            </Link>
          ) : null}
          <UserMenu name={user.name} roleLabel={ROLE_LABELS[user.role]} />
        </div>
      </header>

      <CesiumMapLoader
        center={center}
        national={national}
        province={province}
        householdSize={householdSize}
        assessment={assessment}
        canSaveAssessment={canSaveAssessment}
      />
    </div>
  );
}
