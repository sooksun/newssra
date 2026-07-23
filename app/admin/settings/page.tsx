import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings-repo";
import { ROLE_LABELS } from "@/lib/types";
import SettingsAdmin from "@/components/SettingsAdmin";
import UserMenu from "@/components/UserMenu";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const admin = await requireRole("admin");
  const settings = await getAppSettings();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">พศ</div>
          <div>
            <p className="eyebrow">ระบบคัดกรองสถานศึกษาพื้นที่ลักษณะพิเศษ</p>
            <h1>ตั้งค่าระบบ</h1>
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
            <h2>ค่าตั้งค่าส่วนกลาง</h2>
            <p>ค่าที่ตั้งที่นี่มีผลกับผู้ใช้ทุกคนในระบบ และบันทึกทันทีเมื่อเปลี่ยน</p>
          </div>
        </div>

        <SettingsAdmin initialSettings={settings} />
      </main>
    </div>
  );
}
