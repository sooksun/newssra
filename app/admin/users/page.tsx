import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { listUsers } from "@/lib/users-repo";
import { ROLE_LABELS } from "@/lib/types";
import type { User } from "@/lib/types";
import UsersAdmin from "@/components/UsersAdmin";
import UserMenu from "@/components/UserMenu";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const admin = await requireRole("admin");

  let users: User[] = [];
  let dbError: string | null = null;
  try {
    users = await listUsers();
  } catch (error) {
    console.error("[admin] list users failed:", error);
    dbError = "เชื่อมต่อฐานข้อมูล MySQL ไม่สำเร็จ — ตรวจสอบว่า MySQL เปิดใช้งานอยู่และค่าเชื่อมต่อถูกต้อง";
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">พศ</div>
          <div>
            <p className="eyebrow">ระบบคัดกรองสถานศึกษาพื้นที่ลักษณะพิเศษ</p>
            <h1>จัดการผู้ใช้ระบบ</h1>
          </div>
        </div>
        <div className="top-actions">
          <Link className="ghost-btn" href="/">
            ← รายการแบบประเมิน
          </Link>
          <UserMenu name={admin.name} roleLabel={ROLE_LABELS[admin.role]} />
        </div>
      </header>

      <main className="home-main">
        <div className="home-head">
          <div>
            <h2>ผู้ใช้ทั้งหมด ({users.length})</h2>
            <p>
              บทบาท: <strong>ผู้ดูแลระบบ</strong> เห็น/แก้ไขได้ทุกโรงเรียน + จัดการผู้ใช้ •{" "}
              <strong>เจ้าหน้าที่ สพฐ.</strong> เห็น/แก้ไขได้ทุกโรงเรียน • <strong>โรงเรียน</strong>{" "}
              เห็น/แก้ไขได้เฉพาะโรงเรียนตน (ผูกด้วยรหัสโรงเรียน)
            </p>
            <p className="admin-hint">
              หน้านี้จัดการเฉพาะบัญชีในระบบใหม่ — โรงเรียนส่วนใหญ่เข้าสู่ระบบด้วย<strong>บัญชีเดิม</strong> (รหัส 8
              หลัก) จากตาราง <code>user</code> อยู่แล้ว โดยไม่ต้องสร้างที่นี่
            </p>
          </div>
        </div>

        {dbError ? (
          <div className="db-error">{dbError}</div>
        ) : (
          <UsersAdmin initialUsers={users} currentUserId={admin.uid} />
        )}
      </main>
    </div>
  );
}
