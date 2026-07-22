import type { SnapshotFile } from "@/lib/types";

interface Props {
  assessmentId: number;
  snapshots: SnapshotFile[];
}

export default function SiteSnapshotGallery({ assessmentId, snapshots }: Props) {
  if (snapshots.length === 0) {
    return (
      <p className="site-snapshot-empty">
        ยังไม่มีภาพยืนยันที่ตั้ง — เปิดแผนที่ 3 มิติแล้วกด "จับภาพ 3D ยืนยันที่ตั้ง"
      </p>
    );
  }
  return (
    <div className="site-snapshot-gallery">
      {snapshots.map((s) => {
        const src = `/api/assessments/${assessmentId}/site-snapshots/${s.id}`;
        return (
          <figure key={s.id} className="site-snapshot-item">
            <a href={src} target="_blank" rel="noreferrer">
              <img src={src} alt={s.viewLabel} loading="lazy" />
            </a>
            <figcaption>{s.viewLabel}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}
