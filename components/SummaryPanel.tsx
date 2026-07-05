import type { ComputedAll } from "@/lib/scoring";
import type { SubmittedInfo } from "@/lib/types";
import { FlagList } from "./Flags";

interface Props {
  computed: ComputedAll;
  signed: boolean;
  submitted: SubmittedInfo | null;
  submitLabel: string;
  submitHint: string;
  generalFeedback: string;
  onGeneralFeedbackChange: (value: string) => void;
  onSignedChange: (signed: boolean) => void;
  onReset: () => void;
  onSubmit: () => void;
  submitting: boolean;
}

function formatThaiDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
}

export default function SummaryPanel({
  computed,
  signed,
  submitted,
  submitLabel,
  submitHint,
  generalFeedback,
  onGeneralFeedbackChange,
  onSignedChange,
  onReset,
  onSubmit,
  submitting,
}: Props) {
  return (
    <section className="panel summary-panel" id="summaryPanel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">สรุปผลการประเมิน</p>
          <h2>ผลคัดกรองและรายการที่ต้องตรวจทาน</h2>
        </div>
        <button className="ghost-btn" type="button" onClick={onReset}>
          ล้างข้อมูล
        </button>
      </div>

      {submitted ? (
        <div className="submitted-banner">
          ส่งแบบประเมินแล้ว เลขที่อ้างอิง {submitted.ref} • เมื่อ {formatThaiDateTime(submitted.at)} • คะแนน{" "}
          {submitted.total}/100 ({submitted.level})
        </div>
      ) : null}

      <div className="summary-grid">
        <div className="result-block">
          <p>คะแนนรวม</p>
          <strong>{computed.total}</strong>
          <span>{computed.level.label}</span>
          <small>{computed.level.short}</small>
        </div>
        <div className="dimension-list">
          {computed.dims.map((dim) => {
            const percent = dim.max ? (dim.earned / dim.max) * 100 : 0;
            return (
              <div key={dim.no} className="dimension-row">
                <span className="nav-no">{dim.no}</span>
                <strong>{dim.short}</strong>
                <strong>
                  {dim.earned}/{dim.max}
                </strong>
                <div className="bar">
                  <span style={{ width: `${percent}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flags-wrap">
        <h3>ข้อสังเกตจากระบบ</h3>
        {computed.flags.length ? (
          <FlagList flags={computed.flags} />
        ) : (
          <div className="empty-state">ไม่มีข้อสังเกตที่ต้องแก้ไข</div>
        )}
      </div>

      <div className="feedback-box general-feedback">
        <label>
          <span>ความคิดเห็นโดยรวมต่อแบบประเมินนี้ (ไม่บังคับ)</span>
          <textarea
            placeholder="เช่น ความชัดเจนของตัวชี้วัดโดยรวม ความเหมาะสมของเกณฑ์ ข้อเสนอแนะอื่น ๆ ต่อระบบ — เว้นว่างได้"
            value={generalFeedback}
            onChange={(event) => onGeneralFeedbackChange(event.target.value)}
          />
        </label>
      </div>

      <div className="notice entitlement-notice">
        <strong>ข้อควรทราบเกี่ยวกับสิทธิการขอรับเงินเพิ่ม</strong>
        <p>
          ในกรณีที่ผลการประเมินของสถานศึกษาแห่งนี้เข้าเกณฑ์ตามที่กำหนด
          ข้าราชการครูและบุคลากรทางการศึกษาที่ปฏิบัติหน้าที่ในสถานศึกษาแห่งนี้มีสิทธิ์ยื่นขอรับเงินเพิ่มสำหรับตำแหน่งที่มีเหตุพิเศษ
          (พ.ส.ศ.) โดยมีเงื่อนไขว่าต้องปฏิบัติหน้าที่ในสถานศึกษาแห่งนี้ติดต่อกันไม่น้อยกว่า 5 ปี
          นับแต่วันที่ได้รับการแต่งตั้งให้ปฏิบัติหน้าที่ ณ สถานศึกษาแห่งนี้ ทั้งนี้ ผู้มีสิทธิ์อาจเลือกไม่ยื่นขอรับเงินเพิ่มดังกล่าวก็ได้
        </p>
      </div>

      <label className="certify-box">
        <input type="checkbox" checked={signed} onChange={(event) => onSignedChange(event.target.checked)} />
        <span>
          ข้าพเจ้าในฐานะผู้รับรองข้อมูล ขอรับรองว่าข้อมูลและหลักฐานทั้งหมดเป็นความจริง
          และทราบว่าการรายงานเท็จมีผลทางวินัยและต้องคืนเงินที่รับไปทั้งหมด
        </span>
      </label>

      <div className="submit-row">
        <button
          className="primary-btn"
          type="button"
          disabled={!computed.submittable || submitting}
          onClick={onSubmit}
        >
          {submitting ? "กำลังส่ง…" : submitLabel}
        </button>
        <span className="submit-hint">{submitHint}</span>
      </div>

      <div className="print-signoff">
        <div className="signoff-col">
          <p className="signoff-line">ลงชื่อ</p>
          <p className="signoff-role">ผู้กรอกข้อมูล</p>
        </div>
        <div className="signoff-col">
          <p className="signoff-line">ลงชื่อ</p>
          <p className="signoff-role">ผู้รับรองข้อมูล (ผู้อำนวยการสถานศึกษา)</p>
        </div>
      </div>
    </section>
  );
}
