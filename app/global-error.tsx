"use client";

// Global error boundary — ทำงานเมื่อ root layout เองพัง (กรณีร้ายแรงสุด)
// ต้อง render <html>/<body> เอง และไม่พึ่งฟอนต์/สไตล์จาก layout — ใช้ inline style ให้ทนทาน
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] global error:", error);
  }, [error]);

  return (
    <html lang="th">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          fontFamily: "'Sarabun', 'Segoe UI', Tahoma, sans-serif",
          background: "#f4f6fb",
          color: "#1f2a44",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 420,
            background: "#fff",
            border: "1px solid #e2e6ef",
            borderRadius: 16,
            boxShadow: "0 18px 40px rgba(20,40,90,0.12)",
            padding: "30px 28px",
          }}
        >
          <h1 style={{ margin: "0 0 10px", fontSize: 22 }}>ระบบขัดข้อง</h1>
          <p style={{ color: "#5a6683", fontSize: 14, lineHeight: 1.6, margin: "0 0 20px" }}>
            เกิดข้อผิดพลาดร้ายแรงในการโหลดหน้า กรุณาลองใหม่อีกครั้ง หากยังพบปัญหาโปรดแจ้งผู้ดูแลระบบ
            {error.digest ? (
              <span style={{ display: "block", marginTop: 8, opacity: 0.7 }}>รหัสอ้างอิง: {error.digest}</span>
            ) : null}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              border: 0,
              borderRadius: 8,
              minHeight: 40,
              minWidth: 220,
              padding: "0 14px",
              fontWeight: 700,
              color: "#fff",
              background: "#2254d6",
              cursor: "pointer",
            }}
          >
            ลองใหม่อีกครั้ง
          </button>
        </div>
      </body>
    </html>
  );
}
