// หัวข้อขั้นตอนในแผงแผนที่ 3 มิติ — หมายเลขไล่จากบนลงล่างตามลำดับที่ผู้ใช้ต้องทำจริง
// header-only โดยตั้งใจ: บล็อกเนื้อหาเดิม (ค้นหา/เส้นทาง/วาดพื้นที่/บันทึก/จับภาพ) วางต่อท้ายหัวข้อตามลำดับ DOM
// ผู้เรียกเป็นคนกำหนดเลข เพื่อให้เลขต่อเนื่องแม้บางขั้นตอนถูกซ่อน (เช่น ผู้ดูแลที่บันทึกไม่ได้)

type MapStepProps = {
  step: number;
  title: string;
  hint?: string;
};

export default function MapStep({ step, title, hint }: MapStepProps) {
  return (
    <div className="map-step" role="group" aria-label={`ขั้นตอนที่ ${step}: ${title}`}>
      <h3 className="map-step-title">
        <span className="map-step-num" aria-hidden="true">
          {step}
        </span>
        <span className="map-step-text">{title}</span>
      </h3>
      {hint ? <p className="map-step-hint">{hint}</p> : null}
    </div>
  );
}
