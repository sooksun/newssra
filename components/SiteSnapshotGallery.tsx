"use client";

// แกลเลอรีภาพยืนยันที่ตั้ง (จับจากแผนที่ 3D) — คลิกภาพใดก็ได้เพื่อเปิด lightbox แล้วเลื่อนดูต่อเนื่องทั้งชุด
// เก็บสถานะไว้ในคอมโพเนนต์นี้ล้วน ๆ (ไม่กระทบ state ของแบบประเมิน); ซ่อนทั้งบล็อกตอนพิมพ์ผ่าน .unit-snapshots

import { useCallback, useEffect, useState } from "react";
import { SNAPSHOT_IMAGERY_LABELS, SNAPSHOT_TERRAIN_LABELS } from "@/lib/types";
import type { SnapshotFile } from "@/lib/types";

interface Props {
  assessmentId: number;
  snapshots: SnapshotFile[];
}

/** บรรทัดที่มาของภาพ — ภาพที่จับก่อนมีการบันทึกฟีลด์นี้จะไม่มีค่า จึงแสดง "ไม่มีข้อมูล" ตามความจริง
 *  (ไม่เดาว่าเป็น provider ปัจจุบัน — ผู้ตรวจต้องแยกออกว่าอันไหนรู้แน่กับอันไหนไม่รู้) */
function sourceLine(s: SnapshotFile): string {
  const imagery = s.imagerySource ? SNAPSHOT_IMAGERY_LABELS[s.imagerySource] : "ไม่มีข้อมูล";
  const terrain = s.terrainSource ? SNAPSHOT_TERRAIN_LABELS[s.terrainSource] : "ไม่มีข้อมูล";
  return `ภาพถ่าย: ${imagery} · ภูมิประเทศ: ${terrain}`;
}

export default function SiteSnapshotGallery({ assessmentId, snapshots }: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const total = snapshots.length;

  const close = useCallback(() => setOpenIndex(null), []);
  // เลื่อนแบบวนรอบ: ภาพสุดท้าย → กลับภาพแรก
  const step = useCallback(
    (delta: number) => setOpenIndex((i) => (i === null ? null : (i + delta + total) % total)),
    [total],
  );

  // คีย์บอร์ด: ← → เลื่อน, Esc ปิด (ผูกเฉพาะตอนเปิด lightbox)
  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIndex, close, step]);

  if (total === 0) {
    return (
      <p className="site-snapshot-empty">
        ยังไม่มีภาพยืนยันที่ตั้ง — เปิดแผนที่ 3 มิติแล้วกด &ldquo;จับภาพ 3D ยืนยันที่ตั้ง&rdquo;
      </p>
    );
  }

  const srcOf = (s: SnapshotFile) => `/api/assessments/${assessmentId}/site-snapshots/${s.id}`;
  const current = openIndex === null ? null : snapshots[openIndex];
  // ทั้งชุดจับพร้อมกันครั้งเดียวเสมอ (route แทนที่ทั้งชุด) จึงสรุปที่มาระดับชุดได้จากภาพแรก
  const setSourceLine = sourceLine(snapshots[0]);

  return (
    <>
      <p className="site-snapshot-source">{setSourceLine}</p>
      <div className="site-snapshot-gallery">
        {snapshots.map((s, i) => (
          <figure key={s.id} className="site-snapshot-item">
            <button
              type="button"
              className="site-snapshot-open"
              onClick={() => setOpenIndex(i)}
              aria-label={`ดูภาพขนาดเต็ม: ${s.viewLabel}`}
            >
              <img src={srcOf(s)} alt={s.viewLabel} loading="lazy" />
            </button>
            <figcaption>{s.viewLabel}</figcaption>
          </figure>
        ))}
      </div>

      {current ? (
        <div
          className="snapshot-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`ภาพยืนยันที่ตั้ง: ${current.viewLabel}`}
          onClick={close}
        >
          {/* หยุด event ไม่ให้ทะลุไปพื้นหลัง (คลิกในกล่องต้องไม่ปิด) */}
          <div className="snapshot-lightbox-box" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="snapshot-lightbox-close" onClick={close} aria-label="ปิด">
              ✕
            </button>
            <button
              type="button"
              className="snapshot-lightbox-nav snapshot-lightbox-prev"
              onClick={() => step(-1)}
              aria-label="ภาพก่อนหน้า"
            >
              ‹
            </button>
            <img className="snapshot-lightbox-img" src={srcOf(current)} alt={current.viewLabel} />
            <button
              type="button"
              className="snapshot-lightbox-nav snapshot-lightbox-next"
              onClick={() => step(1)}
              aria-label="ภาพถัดไป"
            >
              ›
            </button>
            <p className="snapshot-lightbox-caption">
              {current.viewLabel}{" "}
              <span className="snapshot-lightbox-count">
                {openIndex! + 1} / {total}
              </span>
              <span className="snapshot-lightbox-source">{sourceLine(current)}</span>
            </p>
            <div className="snapshot-lightbox-strip">
              {snapshots.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  className={i === openIndex ? "active" : ""}
                  onClick={() => setOpenIndex(i)}
                  aria-label={s.viewLabel}
                  aria-current={i === openIndex ? "true" : undefined}
                >
                  <img src={srcOf(s)} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
