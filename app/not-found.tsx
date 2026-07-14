// หน้า 404 — แทนหน้าเริ่มต้นของ Next ให้เป็นภาษาไทยกลมกลืนกับทั้งแอป
// เรียกจาก notFound() ใน app/assessment/[id] และ app/map เมื่อไม่พบข้อมูล/ไม่มีสิทธิ์
import Link from "next/link";

export const metadata = { title: "ไม่พบหน้าที่ต้องการ — พ.ส.ศ." };

export default function NotFound() {
  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">พศ</div>
          <div>
            <p className="eyebrow">ระบบคัดกรองสถานศึกษาพื้นที่ลักษณะพิเศษ</p>
            <h1>ไม่พบหน้าที่ต้องการ</h1>
          </div>
        </div>
        <p className="login-lead">
          หน้าที่คุณเปิดอาจถูกลบ ย้าย หรือคุณไม่มีสิทธิ์เข้าถึงแบบประเมินนี้
        </p>
        <Link href="/" className="primary-btn" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          กลับหน้าแรก
        </Link>
      </div>
    </div>
  );
}
