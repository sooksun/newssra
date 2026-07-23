import Link from "next/link";
import { countAssessments, listAssessments } from "@/lib/repo";
import { requireUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/types";
import {
  COMMUNITY_COMPOSITE_KEYS,
  COMMUNITY_COMPOSITES,
  COMMUNITY_LIST_UNINDEXED_KEY,
  COMMUNITY_LIST_UNINDEXED_LABEL,
  isCommunityCompositeKey,
} from "@/lib/community-class";
import type { AssessmentSummary } from "@/lib/types";
import { CreateAssessmentButton, DeleteAssessmentButton } from "@/components/HomeActions";
import UserMenu from "@/components/UserMenu";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

const COMMUNITY_FILTERS: { key: string; label: string }[] = [
  { key: "", label: "ทั้งหมด" },
  ...COMMUNITY_COMPOSITE_KEYS.map((key) => ({ key, label: COMMUNITY_COMPOSITES[key].labelTh })),
  { key: COMMUNITY_LIST_UNINDEXED_KEY, label: COMMUNITY_LIST_UNINDEXED_LABEL },
];

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

function communityPillClass(key: string | null): string {
  if (key === "highland_remote" || key === "flat_remote") return "community-warn";
  if (key === "highland_accessible" || key === "incomplete") return "community-info";
  if (key === "flat_normal") return "community-ok";
  return "community-muted";
}

/** ป้ายคอลัมน์จำแนกชุมชน — แยก incomplete (policy) กับ null (ยังไม่จัดดัชนีรายการ) */
function communityListCell(item: AssessmentSummary): { label: string; className: string; title?: string } {
  if (item.communityClassKey && item.communityClassLabel) {
    return {
      label: item.communityClassLabel,
      className: communityPillClass(item.communityClassKey),
    };
  }
  return {
    label: COMMUNITY_LIST_UNINDEXED_LABEL,
    className: "community-muted",
    title: "ยังไม่มี community_class ในดัชนีรายการ — เปิดบันทึกแบบประเมินหรือบันทึกผล GIS อีกครั้งเพื่อจัดดัชนี",
  };
}

function filterHref(community: string, page?: number): string {
  const params = new URLSearchParams();
  if (community) params.set("community", community);
  if (page && page > 1) params.set("page", String(page));
  const q = params.toString();
  return q ? `/?${q}` : "/";
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; community?: string }>;
}) {
  const user = await requireUser();
  const canSeeAll = user.role === "admin" || user.role === "ssra_admin";

  const sp = await searchParams;
  const requestedPage = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const rawCommunity = sp.community ?? "";
  const communityFilter =
    rawCommunity === "" || rawCommunity === COMMUNITY_LIST_UNINDEXED_KEY || isCommunityCompositeKey(rawCommunity)
      ? rawCommunity
      : "";

  let items: AssessmentSummary[] = [];
  let totalItems = 0;
  let dbError: string | null = null;

  try {
    totalItems = await countAssessments(user, communityFilter || undefined);
    const pageCount = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    const page = Math.min(requestedPage, pageCount);
    items = await listAssessments(user, {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      ...(communityFilter ? { communityClassKey: communityFilter } : {}),
    });
  } catch (error) {
    console.error("[page] list assessments failed:", error);
    dbError =
      "เชื่อมต่อฐานข้อมูล MySQL ไม่สำเร็จ — ตรวจสอบว่า MySQL เปิดใช้งานอยู่ และค่าเชื่อมต่อใน .env.local (DB_HOST / DB_USER / DB_PASSWORD / DB_NAME) ถูกต้อง";
  }

  const pageCount = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const currentPage = Math.min(requestedPage, pageCount);
  const rangeStart = totalItems === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, totalItems);

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
          <Link className="ghost-btn" href="/map">
            แผนที่ 3 มิติ
          </Link>
          {canSeeAll ? (
            <>
              <Link className="ghost-btn" href="/dashboard">
                แดชบอร์ดสรุปผล
              </Link>
              <Link className="ghost-btn" href="/feedback">
                สรุปความคิดเห็นผู้ทดสอบ
              </Link>
            </>
          ) : null}
          {user.role === "admin" ? (
            <>
              <Link className="ghost-btn" href="/admin/users">
                จัดการผู้ใช้
              </Link>
              <Link className="ghost-btn" href="/admin/settings">
                ตั้งค่าระบบ
              </Link>
            </>
          ) : null}
          <CreateAssessmentButton />
          <UserMenu name={user.name} roleLabel={ROLE_LABELS[user.role]} />
        </div>
      </header>

      <div className="pilot-banner">
        <strong>ระบบอยู่ระหว่างทดสอบกับผู้เกี่ยวข้อง (Stakeholder Test)</strong>
        <span>
          สร้างแบบประเมินเพื่อทดลองกรอกและแสดงความคิดเห็นต่อแต่ละตัวชี้วัด แล้วดูสรุปความคิดเห็นทั้งหมดได้ที่
          &ldquo;สรุปความคิดเห็นผู้ทดสอบ&rdquo;
        </span>
      </div>

      <main className="home-main">
        <div className="home-head">
          <div>
            <h2>แบบประเมินทั้งหมด ({totalItems})</h2>
            <p>
              เกณฑ์ฉบับเสนอ v1 • จุดตัดระดับ 3 คือ 70 คะแนนขึ้นไป
              {totalItems > PAGE_SIZE ? ` • แสดง ${rangeStart}-${rangeEnd} จาก ${totalItems}` : ""}
            </p>
          </div>
        </div>

        <div className="list-filters" role="navigation" aria-label="กรองตามจำแนกชุมชน">
          {COMMUNITY_FILTERS.map((f) => (
            <Link
              key={f.key || "all"}
              className={`ghost-btn list-filter-btn${communityFilter === f.key ? " active" : ""}`}
              href={filterHref(f.key)}
            >
              {f.label}
            </Link>
          ))}
        </div>

        {dbError ? (
          <div className="db-error">{dbError}</div>
        ) : items.length === 0 ? (
          <section className="panel list-empty">
            <strong>{communityFilter ? "ไม่พบแบบประเมินในกลุ่มที่เลือก" : "ยังไม่มีแบบประเมินในระบบ"}</strong>
            {communityFilter === COMMUNITY_LIST_UNINDEXED_KEY
              ? "ไม่มีรายการที่ยังไม่จัดดัชนี — แถวที่มี GIS จะถูกจัดดัชนีอัตโนมัติเมื่อบันทึกแบบประเมิน"
              : communityFilter
                ? "ลองเปลี่ยนตัวกรอง หรือบันทึกผล GIS ลงแบบประเมินเพื่อให้ระบบจำแนกชุมชน"
                : "กดปุ่ม “สร้างแบบประเมินใหม่” เพื่อเริ่มประเมินจุดจัดการศึกษาแห่งแรก"}
          </section>
        ) : (
          <section className="panel table-scroll">
            <table className="list-table">
              <thead>
                <tr>
                  <th>จุดจัดการศึกษา</th>
                  <th>ปีประเมิน</th>
                  <th>จังหวัด</th>
                  <th>จำแนกชุมชน</th>
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
                      <a href={`/assessment/${item.id}`}>{item.unitName || "(ยังไม่ระบุชื่อ)"}</a>
                      <span className="cell-sub">
                        {item.unitType}
                        {item.unitCode ? ` • รหัส ${item.unitCode}` : ""}
                        {item.settingType ? ` • ${item.settingType}` : ""}
                      </span>
                    </td>
                    <td>{item.year || "-"}</td>
                    <td>{item.province || "-"}</td>
                    <td>
                      {(() => {
                        const cell = communityListCell(item);
                        return (
                          <span className={`status-pill ${cell.className}`} title={cell.title}>
                            {cell.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td>
                      <span className="list-score">{item.totalScore}</span>
                      <span className="cell-sub">/100</span>
                    </td>
                    <td>
                      <span className={`level-pill ${levelPillClass(item.levelKey)}`}>{item.levelLabel}</span>
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

        {!dbError && pageCount > 1 ? (
          <nav className="pager" aria-label="แบ่งหน้า">
            {currentPage > 1 ? (
              <Link className="ghost-btn" href={filterHref(communityFilter, currentPage - 1)}>
                ← ก่อนหน้า
              </Link>
            ) : (
              <span className="ghost-btn disabled" aria-disabled="true">
                ← ก่อนหน้า
              </span>
            )}
            <span className="pager-status">
              หน้า {currentPage} / {pageCount}
            </span>
            {currentPage < pageCount ? (
              <Link className="ghost-btn" href={filterHref(communityFilter, currentPage + 1)}>
                ถัดไป →
              </Link>
            ) : (
              <span className="ghost-btn disabled" aria-disabled="true">
                ถัดไป →
              </span>
            )}
          </nav>
        ) : null}
      </main>
    </div>
  );
}
