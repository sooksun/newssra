import Link from "next/link";
import { DIMENSIONS, INDICATORS } from "@/lib/criteria";
import { listAllFeedback } from "@/lib/repo";
import type { FeedbackEntry } from "@/lib/repo";
import { FEEDBACK_OPINIONS, FEEDBACK_OPINION_LABELS } from "@/lib/types";
import type { FeedbackOpinion, IndicatorId } from "@/lib/types";

export const dynamic = "force-dynamic";

const OPINION_BAR_CLASS: Record<FeedbackOpinion, string> = {
  agree: "fill-level-3",
  "agree-with-changes": "fill-level-1",
  disagree: "fill-neutral",
};

function formatThaiDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
}

interface Comment {
  unitName: string;
  unitCode: string;
  updatedAt: string;
  text: string;
}

function opinionCountsFor(entries: FeedbackEntry[], id: IndicatorId): Record<FeedbackOpinion, number> {
  const counts: Record<FeedbackOpinion, number> = { agree: 0, "agree-with-changes": 0, disagree: 0 };
  entries.forEach((entry) => {
    const fb = entry.feedback[id];
    if (fb) counts[fb.opinion] += 1;
  });
  return counts;
}

/** เหตุผล/ข้อเสนอแนะ — มีเฉพาะรายการที่เลือก "เห็นด้วยแต่ควรแก้ไข" หรือ "ไม่เห็นด้วย" และกรอกข้อความไว้ */
function notesFor(entries: FeedbackEntry[], id: IndicatorId): Comment[] {
  return entries
    .filter((entry) => {
      const fb = entry.feedback[id];
      return fb && fb.opinion !== "agree" && fb.note.trim().length > 0;
    })
    .map((entry) => {
      const fb = entry.feedback[id]!;
      return {
        unitName: entry.unitName,
        unitCode: entry.unitCode,
        updatedAt: entry.updatedAt,
        text: `[${FEEDBACK_OPINION_LABELS[fb.opinion]}] ${fb.note.trim()}`,
      };
    });
}

function OpinionDistribution({ counts }: { counts: Record<FeedbackOpinion, number> }) {
  const total = FEEDBACK_OPINIONS.reduce((sum, key) => sum + counts[key], 0);
  if (total === 0) {
    return <div className="empty-state">ยังไม่มีความคิดเห็นจากผู้ทดสอบ</div>;
  }
  return (
    <div className="chart-bar-list">
      {FEEDBACK_OPINIONS.map((opinion) => {
        const count = counts[opinion];
        const percent = total ? (count / total) * 100 : 0;
        return (
          <div className="chart-bar-row" key={opinion}>
            <span className="chart-bar-label">{FEEDBACK_OPINION_LABELS[opinion]}</span>
            <div className="chart-bar-track">
              <div className={`chart-bar-fill ${OPINION_BAR_CLASS[opinion]}`} style={{ width: `${percent}%` }} />
            </div>
            <span className="chart-bar-value">
              {count} <small>({percent.toFixed(0)}%)</small>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CommentList({ comments }: { comments: Comment[] }) {
  if (!comments.length) {
    return <div className="empty-state">ยังไม่มีความคิดเห็นจากผู้ทดสอบ</div>;
  }
  return (
    <div className="feedback-entry-list">
      {comments.map((comment, index) => (
        <div className="feedback-entry" key={index}>
          <p className="feedback-entry-text">{comment.text}</p>
          <p className="feedback-entry-meta">
            {comment.unitName || "(ไม่ระบุชื่อ)"}
            {comment.unitCode ? ` • รหัส ${comment.unitCode}` : ""} • {formatThaiDateTime(comment.updatedAt)}
          </p>
        </div>
      ))}
    </div>
  );
}

export default async function FeedbackPage() {
  let entries: FeedbackEntry[] = [];
  let dbError: string | null = null;

  try {
    entries = await listAllFeedback();
  } catch (error) {
    console.error("[feedback-page] list feedback failed:", error);
    dbError = "เชื่อมต่อฐานข้อมูล MySQL ไม่สำเร็จ — ตรวจสอบว่า MySQL เปิดใช้งานอยู่และค่าเชื่อมต่อถูกต้อง";
  }

  const totalAssessments = entries.length;
  const generalComments: Comment[] = entries
    .filter((entry) => entry.generalFeedback.trim().length > 0)
    .map((entry) => ({
      unitName: entry.unitName,
      unitCode: entry.unitCode,
      updatedAt: entry.updatedAt,
      text: entry.generalFeedback.trim(),
    }));
  const respondedCount = new Set(
    entries
      .filter(
        (entry) =>
          entry.generalFeedback.trim().length > 0 ||
          Object.values(entry.feedback).some((fb) => fb && (fb.opinion !== "agree" || fb.note.trim().length > 0))
      )
      .map((entry) => entry.assessmentId)
  ).size;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">พศ</div>
          <div>
            <p className="eyebrow">โหมดทดสอบกับผู้เกี่ยวข้อง (Stakeholder Test)</p>
            <h1>สรุปความคิดเห็นผู้ทดสอบ</h1>
          </div>
        </div>
        <div className="top-actions">
          <Link className="ghost-btn" href="/">
            ← รายการแบบประเมิน
          </Link>
        </div>
      </header>

      <main className="home-main">
        {dbError ? (
          <div className="db-error">{dbError}</div>
        ) : (
          <>
            <div className="home-head">
              <div>
                <h2>ภาพรวมความคิดเห็น</h2>
                <p>
                  มีความคิดเห็นจาก {respondedCount} แบบประเมิน จากทั้งหมด {totalAssessments} แบบประเมินที่ทดลองกรอก
                </p>
              </div>
            </div>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">ภาพรวม</p>
                  <h2>ความคิดเห็นโดยรวมต่อทั้งแบบประเมิน</h2>
                </div>
              </div>
              <CommentList comments={generalComments} />
            </section>

            {DIMENSIONS.map((dimension) => (
              <section className="panel dimension-panel" key={dimension.no}>
                <div className="dimension-head">
                  <div>
                    <p className="eyebrow">ด้านที่ {dimension.no} จาก 5</p>
                    <h2>{dimension.title}</h2>
                  </div>
                </div>
                <div className="indicator-grid">
                  {dimension.ids.map((id) => {
                    const counts = opinionCountsFor(entries, id);
                    const flagged = counts["agree-with-changes"] + counts.disagree;
                    const notes = notesFor(entries, id);
                    return (
                      <article className="indicator-card" key={id}>
                        <div className="indicator-head">
                          <div>
                            <div className="indicator-title">
                              <span className="mini-tag">{id}</span>
                              <strong>{INDICATORS[id].title}</strong>
                            </div>
                          </div>
                          <div className={`score-badge ${flagged ? "has-score" : ""}`}>{flagged} ข้อเสนอแนะ</div>
                        </div>
                        <OpinionDistribution counts={counts} />
                        {notes.length ? (
                          <>
                            <p className="feedback-box-label">เหตุผล/ข้อเสนอแนะ</p>
                            <CommentList comments={notes} />
                          </>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  );
}
