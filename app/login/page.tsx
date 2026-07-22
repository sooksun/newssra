import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await getSession();
  if (session) redirect("/map");

  const nextParam = (await searchParams).next;
  const nextPath = typeof nextParam === "string" && nextParam.startsWith("/") ? nextParam : "/";

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">พศ</div>
          <div>
            <p className="eyebrow">ระบบคัดกรองสถานศึกษาพื้นที่ลักษณะพิเศษ</p>
            <h1>เข้าสู่ระบบ</h1>
          </div>
        </div>
        <p className="login-lead">
          กรุณาเข้าสู่ระบบเพื่อใช้งานแบบประเมิน พ.ส.ศ. — โรงเรียนใช้บัญชีเดิม (รหัสผู้ใช้ 8 หลัก) ได้เลย
        </p>
        <LoginForm nextPath={nextPath} />
      </div>
    </div>
  );
}
