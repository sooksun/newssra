"use client";

// Error boundary ระดับ route segment — จับ throw ที่ไม่ถูกดักในหน้า/คอมโพเนนต์
// อยู่ใต้ root layout จึงได้ฟอนต์ Sarabun + globals.css ตามปกติ
import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] render error:", error);
  }, [error]);

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">พศ</div>
          <div>
            <p className="eyebrow">ระบบคัดกรองสถานศึกษาพื้นที่ลักษณะพิเศษ</p>
            <h1>เกิดข้อผิดพลาด</h1>
          </div>
        </div>
        <div className="db-error" role="alert">
          ระบบทำงานผิดพลาดชั่วคราว กรุณาลองใหม่อีกครั้ง หากยังพบปัญหาโปรดแจ้งผู้ดูแลระบบ
          {error.digest ? <div style={{ marginTop: 8, opacity: 0.7 }}>รหัสอ้างอิง: {error.digest}</div> : null}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
          <button type="button" className="primary-btn" onClick={() => reset()}>
            ลองใหม่อีกครั้ง
          </button>
          <Link href="/" className="primary-btn ghost-btn" style={{ minWidth: 140 }}>
            กลับหน้าแรก
          </Link>
        </div>
      </div>
    </div>
  );
}
