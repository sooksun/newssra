import Link from "next/link";
import { DIMENSIONS, INDICATORS, PASS_THRESHOLD } from "@/lib/criteria";
import { listAllStates } from "@/lib/repo";
import { computeAll } from "@/lib/scoring";
import { INDICATOR_IDS } from "@/lib/types";
import type { IndicatorId } from "@/lib/types";

export const dynamic = "force-dynamic";

const LEVEL_ORDER = ["level-3", "level-2", "level-1", "neutral"] as const;
const LEVEL_META: Record<(typeof LEVEL_ORDER)[number], { label: string; className: string }> = {
  "level-3": { label: "ระดับ 3 (ผ่านเกณฑ์)", className: "level-3" },
  "level-2": { label: "ระดับ 2", className: "level-2" },
  "level-1": { label: "ระดับ 1", className: "level-1" },
  neutral: { label: "ยังไม่จัดระดับ", className: "neutral" },
};

const HISTOGRAM_BUCKETS = 10; // ช่วงละ 10 คะแนน 0-100

function formatThaiDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
}

export default async function DashboardPage() {
  let records: Awaited<ReturnType<typeof listAllStates>> = [];
  let dbError: string | null = null;

  try {
    records = await listAllStates();
  } catch (error) {
    console.error("[dashboard] list states failed:", error);
    dbError = "เชื่อมต่อฐานข้อมูล MySQL ไม่สำเร็จ — ตรวจสอบว่า MySQL เปิดใช้งานอยู่และค่าเชื่อมต่อถูกต้อง";
  }

  const rows = records.map((record) => ({ ...record, computed: computeAll(record.state) }));
  const total = rows.length;

  const passCount = rows.filter((row) => row.computed.level.key === "level-3").length;
  const passRate = total ? (passCount / total) * 100 : 0;
  const submittedCount = rows.filter((row) => row.state.submitted !== null).length;
  const avgScore = total ? rows.reduce((sum, row) => sum + row.computed.total, 0) / total : 0;

  const levelCounts: Record<string, number> = { neutral: 0, "level-1": 0, "level-2": 0, "level-3": 0 };
  rows.forEach((row) => {
    levelCounts[row.computed.level.key] = (levelCounts[row.computed.level.key] ?? 0) + 1;
  });
  const maxLevelCount = Math.max(1, ...Object.values(levelCounts));

  const buckets = Array.from({ length: HISTOGRAM_BUCKETS }, (_, index) => ({
    label: `${index * 10}-${index === HISTOGRAM_BUCKETS - 1 ? 100 : index * 10 + 9}`,
    count: 0,
  }));
  rows.forEach((row) => {
    const index = Math.min(HISTOGRAM_BUCKETS - 1, Math.floor(row.computed.total / 10));
    buckets[index].count += 1;
  });
  const maxBucketCount = Math.max(1, ...buckets.map((b) => b.count));

  const dimStats = DIMENSIONS.map((dim) => {
    const scores = rows.map((row) => row.computed.dims.find((d) => d.no === dim.no)?.earned ?? 0);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    return { ...dim, avg, avgPercent: dim.max ? (avg / dim.max) * 100 : 0 };
  });

  const levelIndicatorIds = INDICATOR_IDS.filter((id) => INDICATORS[id].kind === "level");
  const optionStats = levelIndicatorIds.map((id) => {
    const indicator = INDICATORS[id];
    if (indicator.kind !== "level") return null;
    const counts = indicator.options.map(() => 0);
    let answered = 0;
    rows.forEach((row) => {
      const raw = row.state.responses[id]?.level;
      if (raw === undefined || raw === "") return;
      const index = Number(raw);
      if (Number.isInteger(index) && counts[index] !== undefined) {
        counts[index] += 1;
        answered += 1;
      }
    });
    return { id: id as IndicatorId, title: indicator.title, options: indicator.options, counts, answered };
  });

  const resultsSorted = [...rows].sort((a, b) => b.computed.total - a.computed.total);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">พศ</div>
          <div>
            <p className="eyebrow">ระบบคัดกรองสถานศึกษาพื้นที่ลักษณะพิเศษ</p>
            <h1>แดชบอร์ดสรุปผลการประเมิน</h1>
          </div>
        </div>
        <div className="top-actions">
          <Link className="ghost-btn" href="/feedback">
            สรุปความคิดเห็นผู้ทดสอบ
          </Link>
          <Link className="ghost-btn" href="/">
            ← รายการแบบประเมิน
          </Link>
        </div>
      </header>

      <main className="home-main">
        {dbError ? (
          <div className="db-error">{dbError}</div>
        ) : total === 0 ? (
          <section className="panel list-empty">
            <strong>ยังไม่มีข้อมูลให้สรุป</strong>
            สร้างและกรอกแบบประเมินอย่างน้อย 1 ฉบับก่อน จึงจะเห็นกราฟและตารางสรุปที่นี่
          </section>
        ) : (
          <>
            <div className="stat-cards">
              <div className="stat-card">
                <div className="stat-value">{total}</div>
                <div className="stat-label">แบบประเมินทั้งหมด</div>
              </div>
              <div className="stat-card accent-green">
                <div className="stat-value">
                  {passCount} <small>({passRate.toFixed(0)}%)</small>
                </div>
                <div className="stat-label">ผ่านเกณฑ์ (ระดับ 3)</div>
              </div>
              <div className="stat-card accent-red">
                <div className="stat-value">{total - passCount}</div>
                <div className="stat-label">ไม่ผ่านเกณฑ์</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{avgScore.toFixed(1)}</div>
                <div className="stat-label">คะแนนเฉลี่ย (เต็ม 100)</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{submittedCount}</div>
                <div className="stat-label">ส่งแบบประเมินแล้ว</div>
              </div>
            </div>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">ผลคัดกรอง</p>
                  <h2>จำนวนโรงเรียนตามระดับผ่าน/ไม่ผ่าน (จุดตัด {PASS_THRESHOLD} คะแนน)</h2>
                </div>
              </div>
              <div className="chart-bar-list">
                {LEVEL_ORDER.map((key) => {
                  const count = levelCounts[key] ?? 0;
                  const percent = total ? (count / total) * 100 : 0;
                  const widthPercent = (count / maxLevelCount) * 100;
                  return (
                    <div className="chart-bar-row" key={key}>
                      <span className={`level-pill ${LEVEL_META[key].className}`}>{LEVEL_META[key].label}</span>
                      <div className="chart-bar-track">
                        <div className={`chart-bar-fill fill-${LEVEL_META[key].className}`} style={{ width: `${widthPercent}%` }} />
                      </div>
                      <span className="chart-bar-value">
                        {count} <small>({percent.toFixed(0)}%)</small>
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">การกระจายคะแนน</p>
                  <h2>จำนวนโรงเรียนตามช่วงคะแนนรวม</h2>
                </div>
              </div>
              <div className="histogram">
                {buckets.map((bucket) => (
                  <div className="histogram-bar" key={bucket.label}>
                    <span className="histogram-count">{bucket.count || ""}</span>
                    <div
                      className="histogram-bar-fill"
                      style={{ height: `${Math.max(2, (bucket.count / maxBucketCount) * 100)}%` }}
                    />
                    <span className="histogram-bar-label">{bucket.label}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">ภาพรวมรายด้าน</p>
                  <h2>คะแนนเฉลี่ยเทียบเต็มในแต่ละด้าน</h2>
                </div>
              </div>
              <div className="chart-bar-list">
                {dimStats.map((dim) => (
                  <div className="chart-bar-row" key={dim.no}>
                    <span className="chart-bar-label">
                      {dim.no}. {dim.short}
                    </span>
                    <div className="chart-bar-track">
                      <div className="chart-bar-fill fill-blue" style={{ width: `${dim.avgPercent}%` }} />
                    </div>
                    <span className="chart-bar-value">
                      {dim.avg.toFixed(1)}/{dim.max}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">ตัวชี้วัดแบบเลือกระดับ</p>
                  <h2>สัดส่วนตัวเลือกที่ถูกเลือกในแต่ละตัวชี้วัด</h2>
                </div>
              </div>
              <div className="option-dist-grid">
                {optionStats.filter(Boolean).map((stat) => (
                  <div className="option-dist-card" key={stat!.id}>
                    <div className="option-dist-head">
                      <span className="mini-tag">{stat!.id}</span>
                      <strong>{stat!.title}</strong>
                      <span className="option-dist-answered">{stat!.answered} คำตอบ</span>
                    </div>
                    {stat!.answered === 0 ? (
                      <div className="empty-state">ยังไม่มีข้อมูล</div>
                    ) : (
                      stat!.options.map((option, index) => {
                        const count = stat!.counts[index];
                        const percent = stat!.answered ? (count / stat!.answered) * 100 : 0;
                        return (
                          <div className="chart-bar-row option-dist-row" key={index}>
                            <span className="chart-bar-label" title={option.label}>
                              {option.label}
                            </span>
                            <div className="chart-bar-track">
                              <div className="chart-bar-fill fill-violet" style={{ width: `${percent}%` }} />
                            </div>
                            <span className="chart-bar-value">
                              {count} <small>({percent.toFixed(0)}%)</small>
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="panel table-scroll">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">รายโรงเรียน</p>
                  <h2>ตารางผลการประเมิน เรียงตามคะแนนมากไปน้อย</h2>
                </div>
              </div>
              <table className="list-table">
                <thead>
                  <tr>
                    <th>จุดจัดการศึกษา</th>
                    <th>จังหวัด</th>
                    <th>คะแนน</th>
                    <th>ระดับ</th>
                    <th>ผลคัดกรอง</th>
                    <th>สถานะ</th>
                    <th>แก้ไขล่าสุด</th>
                  </tr>
                </thead>
                <tbody>
                  {resultsSorted.map((row) => {
                    const passed = row.computed.level.key === "level-3";
                    return (
                      <tr key={row.id}>
                        <td className="cell-main">
                          <a href={`/assessment/${row.id}`}>{row.unitName || "(ยังไม่ระบุชื่อ)"}</a>
                          <span className="cell-sub">{row.unitCode ? `รหัส ${row.unitCode}` : ""}</span>
                        </td>
                        <td>{row.province || "-"}</td>
                        <td>
                          <span className="list-score">{row.computed.total}</span>
                          <span className="cell-sub">/100</span>
                        </td>
                        <td>
                          <span className={`level-pill ${LEVEL_META[row.computed.level.key as keyof typeof LEVEL_META]?.className ?? "neutral"}`}>
                            {row.computed.level.label}
                          </span>
                        </td>
                        <td>
                          <span className={`pf-badge ${passed ? "pass" : "fail"}`}>{passed ? "ผ่าน" : "ไม่ผ่าน"}</span>
                        </td>
                        <td>
                          {row.submittedRef ? (
                            <span className="status-pill submitted">ส่งแล้ว</span>
                          ) : (
                            <span className="status-pill draft">ร่าง</span>
                          )}
                        </td>
                        <td>{formatThaiDateTime(row.updatedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
