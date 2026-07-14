import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { canAccessAssessment } from "@/lib/auth";
import { getAssessment, listProvinces, provinceByName, provinceHouseholdSize, resolveSchoolProvince } from "@/lib/repo";

export const dynamic = "force-dynamic";

// หาจังหวัดของพิกัดที่ระบุ + ขนาดครัวเรือนเฉลี่ย — ใช้เมื่อผู้ใช้ย้ายจุดวิเคราะห์ในแผนที่ (/map)
// สำคัญ: ต้องจับคู่จังหวัดให้ตรงกับตอนโหลดหน้าแผนที่ (app/map/page.tsx) — คือใช้จังหวัดจริงจากทะเบียนโรงเรียนก่อน
// (แม่นสำหรับอำเภอชายขอบ เช่น อ.ฝาง เชียงใหม่ ที่ใกล้ศาลากลางเชียงรายมากกว่า) แล้วค่อย fallback เป็นศาลากลางที่ใกล้ที่สุด
// รหัสโรงเรียนมาจาก session ที่เชื่อถือได้ (บทบาท school) หรือจากแบบประเมินที่ตรวจสิทธิ์แล้ว — ไม่รับจาก client ตรง ๆ กันการปลอม
export async function GET(request: NextRequest) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "พิกัดไม่ถูกต้อง" }, { status: 400 });
  }

  // บริบทโรงเรียน: school viewer → รหัสของตนเอง; โหมดแบบประเมิน (?assessment=ID ที่เข้าถึงได้) → เจ้าของแบบประเมิน
  let schoolCode = guard.user.role === "school" ? guard.user.schoolCode : "";
  let enteredProvince: string | null = null;
  const assessmentId = Number.parseInt(searchParams.get("assessment") ?? "", 10);
  if (Number.isInteger(assessmentId) && assessmentId > 0) {
    try {
      const record = await getAssessment(assessmentId);
      if (record && canAccessAssessment(guard.user, record.ownerSchoolCode)) {
        schoolCode = record.ownerSchoolCode ?? schoolCode;
        enteredProvince = record.state.unit.province;
      }
    } catch {
      // เข้าถึงแบบประเมินไม่ได้ → ใช้ค่าจาก session ตามเดิม
    }
  }

  // จังหวัดที่ค้น/ลากไป (จาก geocode/reverse-geocode ฝั่ง client) — ใช้ก่อนเป็นอันดับแรก
  // เพื่อให้จังหวัด "ตามตำแหน่งจริงที่เลือก" ไม่ใช่ยึดจังหวัดของโรงเรียนที่ล็อกอินเสมอ
  const provinceHint = searchParams.get("province")?.trim() || "";

  try {
    const provinces = await listProvinces();
    // ลำดับความสำคัญ: จังหวัดจากตำแหน่งที่ค้น/ลากไป → ทะเบียนโรงเรียน/จังหวัดที่กรอก → ศาลากลางที่ใกล้ที่สุด
    const province =
      (provinceHint ? provinceByName(provinces, provinceHint) : null) ??
      (await resolveSchoolProvince(provinces, { schoolCode, enteredProvince, lat, lng }));
    const householdSize = province ? await provinceHouseholdSize(province.name) : null;
    return NextResponse.json({ province, householdSize });
  } catch (error) {
    console.error("[api] nearest province failed:", error);
    return NextResponse.json({ error: "หาจังหวัดใกล้เคียงไม่สำเร็จ" }, { status: 502 });
  }
}
