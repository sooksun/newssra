import Link from "next/link";
import { listAssessments } from "@/lib/repo";
import type { AssessmentSummary } from "@/lib/types";
import { CreateAssessmentButton, DeleteAssessmentButton } from "@/components/HomeActions";

export const dynamic = "force-dynamic";

function formatThaiDateTime(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  });
}

function levelPillClass(levelKey: string): string {
  return ["level-1", "level-2", "level-3"].includes(levelKey) ? levelKey : "neutral";
}

export default async function HomePage() {
  let items: AssessmentSummary[] = [];
  let dbError: string | null = null;

  try {
    items = await listAssessments();
  } catch (error) {
    console.error("[page] list assessments failed:", error);
    dbError =
      "เชื่อมต่อฐานข้อมูล MySQL ไม่สำเร็จ — ตรวจสอบว่า MySQL เปิดใช้งานอยู่ และค่าเชื่อมต่อใน .env.local (DB_HOST / DB_USER / DB_PASSWORD / DB_NAME) ถูกต้อง";
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">พศ</div>
          <div>
            <p className="eyebrow">ระบบคัดกรองสถานศึกษาพื้นที่ลักษณะพิเศษ</p>
            <h1>ร่าง แบบประเมินโรงเรียนที่ตั้งในพื้นที่ลักษณะพิเศษ พ.ศ.....</h1>
          </div>
        </div>
        <div className="top-actions">
          <Link className="ghost-btn" href="/dashboard">
            แดชบอร์ดสรุปผล
          </Link>
          <Link className="ghost-btn" href="/feedback">
            สรุปความคิดเห็นผู้ทดสอบ
          </Link>
          <CreateAssessmentButton />
        </div>
      </header>

      <div className="pilot-banner">
        <strong>ระบบอยู่ระหว่างทดสอบกับผู้เกี่ยวข้อง (Stakeholder Test)</strong>
        <span>
          สร้างแบบประเมินเพื่อทดลองกรอกและแสดงความคิดเห็นต่อแต่ละตัวชี้วัด แล้วดูสรุปความคิดเห็นทั้งหมดได้ที่ &ldquo;สรุปความคิดเห็นผู้ทดสอบ&rdquo;
        </span>
      </div>

      <main className="home-main">
        <div className="home-head">
          <div>
            <h2>แบบประเมินทั้งหมด ({items.length})</h2>
            <p>เกณฑ์ฉบับเสนอ v1 • จุดตัดระดับ 3 คือ 70 คะแนนขึ้นไป</p>
          </div>
        </div>

        {dbError ? (
          <div className="db-error">{dbError}</div>
        ) : items.length === 0 ? (
          <section className="panel list-empty">
            <strong>ยังไม่มีแบบประเมินในระบบ</strong>
            กดปุ่ม &ldquo;สร้างแบบประเมินใหม่&rdquo; เพื่อเริ่มประเมินจุดจัดการศึกษาแห่งแรก
          </section>
        ) : (
          <section className="panel table-scroll">
            <table className="list-table">
              <thead>
                <tr>
                  <th>จุดจัดการศึกษา</th>
                  <th>ปีประเมิน</th>
                  <th>จังหวัด</th>
                  <th>คะแนน</th>
                  <th>ระดับ</th>
                  <th>สถานะ</th>
                  <th>แก้ไขล่าสุด</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="cell-main">
                      <a href={`/assessment/${item.id}`}>
                        {item.unitName || "(ยังไม่ระบุชื่อ)"}
                      </a>
                      <span className="cell-sub">
                        {item.unitType}
                        {item.unitCode ? ` • รหัส ${item.unitCode}` : ""}
                      </span>
                    </td>
                    <td>{item.year || "-"}</td>
                    <td>{item.province || "-"}</td>
                    <td>
                      <span className="list-score">{item.totalScore}</span>
                      <span className="cell-sub">/100</span>
                    </td>
                    <td>
                      <span className={`level-pill ${levelPillClass(item.levelKey)}`}>
                        {item.levelLabel}
                      </span>
                    </td>
                    <td>
                      {item.submittedRef ? (
                        <span className="status-pill submitted">ส่งแล้ว • {item.submittedRef}</span>
                      ) : (
                        <span className="status-pill draft">ร่าง</span>
                      )}
                    </td>
                    <td>{formatThaiDateTime(item.updatedAt)}</td>
                    <td>
                      <div className="row-actions">
                        <a className="ghost-btn" href={`/assessment/${item.id}`}>
                          เปิด
                        </a>
                        <DeleteAssessmentButton id={item.id} unitName={item.unitName} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </div>
  );
}
