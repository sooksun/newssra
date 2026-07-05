import type { CSSProperties } from "react";
import { DIMENSIONS } from "@/lib/criteria";
import type { ComputedAll } from "@/lib/scoring";
import { clamp } from "@/lib/scoring";

interface Props {
  computed: ComputedAll;
  signed: boolean;
}

export default function ScoreRail({ computed, signed }: Props) {
  const angle = clamp(computed.total, 0, 100) * 3.6;
  const blockers = computed.flags.filter((flag) => flag.tone === "block").length;

  const readiness = [
    { done: computed.unitOk, text: "กรอกข้อมูลจุดจัดการศึกษาครบถ้วน" },
    {
      done: computed.answered === computed.totalIndicators,
      text: `กรอกตัวชี้วัดครบ ${computed.answered}/${computed.totalIndicators} รายการ`,
    },
    {
      done: blockers === 0,
      text: blockers === 0 ? "ไม่มีธงบล็อกการส่ง" : `มีธงบล็อก ${blockers} รายการ`,
    },
    { done: signed, text: "ลงนามรับรองข้อมูลก่อนส่ง" },
  ];

  return (
    <aside className="score-rail" aria-label="สรุปคะแนน">
      <section className="score-panel">
        <div
          className="score-ring"
          aria-live="polite"
          style={{ "--score-angle": `${angle}deg` } as CSSProperties}
        >
          <span>{computed.total}</span>
          <small>/100</small>
        </div>
        <div className={`level-pill ${computed.level.key}`}>{computed.level.label}</div>
        <p className="score-note">{computed.level.detail}</p>
      </section>

      <nav className="section-nav" aria-label="นำทางตามด้านประเมิน">
        {DIMENSIONS.map((dim) => {
          const earned = computed.dims.find((d) => d.no === dim.no)?.earned ?? 0;
          return (
            <a key={dim.no} href={`#dimension-${dim.no}`}>
              <span className="nav-no">{dim.no}</span>
              <span className="nav-title">{dim.short}</span>
              <span className="nav-score">
                {earned}/{dim.max}
              </span>
            </a>
          );
        })}
      </nav>

      <section className="readiness">
        <h2>ความพร้อมก่อนส่ง</h2>
        <ul>
          {readiness.map((item, index) => (
            <li key={index} className={`ready-item ${item.done ? "done" : ""}`}>
              <span className="ready-dot">{item.done ? "✓" : ""}</span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
