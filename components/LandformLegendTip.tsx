"use client";

// Shared help panel: สพฐ./HRDI vs แอป landform thresholds (Phase 2 / PR A)

import { useEffect, useId, useState } from "react";
import { landformThresholdLegendRows } from "@/lib/landform-legend";

interface Props {
  /** Extra class on the wrap (e.g. map-landform-tip) */
  className?: string;
}

export default function LandformLegendTip({ className = "" }: Props) {
  const rows = landformThresholdLegendRows();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const titleId = `${panelId}-title`;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <span className={`help-trigger-wrap gis-landform-tip${className ? ` ${className}` : ""}`}>
        <button
          type="button"
          className="help-icon-btn"
          aria-label="เปิดคำอธิบายเกณฑ์ถ้อยคำภูมิประเทศ"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen(true)}
        >
          <span aria-hidden="true">?</span>
        </button>
      </span>
      {open ? (
        <>
          <button
            type="button"
            className="help-panel-backdrop"
            aria-label="ปิดคำอธิบายเกณฑ์ภูมิประเทศ"
            onClick={() => setOpen(false)}
          />
          <aside
            id={panelId}
            className="help-panel landform-help-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <div className="help-panel-head">
              <div>
                <p className="help-panel-kicker">คำอธิบายเกณฑ์</p>
                <h2 id={titleId}>ถ้อยคำภูมิประเทศ: สพฐ. / HRDI / แอป</h2>
              </div>
              <button
                type="button"
                className="help-panel-close"
                aria-label="ปิด"
                onClick={() => setOpen(false)}
              >
                X
              </button>
            </div>

            <p className="help-panel-lead">
              เกตคัดกรองพื้นที่สูงใช้ 500 ม. หรือเทียบกับค่าเฉลี่ยจังหวัด/เส้นทางผ่านที่สูง
              ส่วนป้าย “ภูเขาสูง” ของแอปใช้ชั้น 1,000 ม. เพื่อไม่ปะปนกับนิยาม “ภูเขา” ในคู่มือ สพฐ.
            </p>

            <div className="help-panel-callout">
              <span>หลักจำเร็ว</span>
              <strong>500 ม. = เกตพื้นที่สูง · 600 ม. = นิยามภูเขา สพฐ. · 1,000 ม. = ภูเขาสูงของแอป</strong>
            </div>

            <div className="help-rule-list">
              {rows.map((row) => (
                <section className="help-rule-item" key={row.term}>
                  <h3>{row.term}</h3>
                  <p>{row.rule}</p>
                </section>
              ))}
            </div>

            <p className="help-panel-foot">
              ใช้เพื่ออธิบายป้ายภูมิประเทศและแกน A ของการจำแนกชุมชน ไม่ใช่การเปลี่ยนคะแนนด้วยมือ
            </p>
          </aside>
        </>
      ) : null}
    </>
  );
}
