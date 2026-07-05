import { UNIT_TYPES } from "@/lib/types";
import type { UnitInfo } from "@/lib/types";

interface Props {
  unit: UnitInfo;
  onChange: <K extends keyof UnitInfo>(key: K, value: UnitInfo[K]) => void;
}

interface UnitField {
  key: keyof UnitInfo;
  label: string;
  placeholder: string;
  type: "text" | "number";
  step?: string;
  inputMode?: "numeric";
}

const UNIT_FIELDS: UnitField[] = [
  { key: "name", label: "ชื่อจุดจัดการศึกษา", placeholder: "เช่น โรงเรียนบ้านห้วยเย็น", type: "text" },
  { key: "code", label: "รหัสสถานศึกษา", placeholder: "10 หลัก", type: "text", inputMode: "numeric" },
  { key: "year", label: "ปีการประเมิน", placeholder: "2569", type: "text", inputMode: "numeric" },
  { key: "totalStudents", label: "ผู้เรียนทั้งหมด ณ 10 มิ.ย.", placeholder: "คน", type: "number" },
  { key: "areaOffice", label: "สำนักงานเขต/สกร.อำเภอ", placeholder: "หน่วยงานต้นทาง", type: "text" },
  { key: "province", label: "จังหวัด", placeholder: "จังหวัด", type: "text" },
  { key: "lat", label: "ละติจูด", placeholder: "เช่น 18.7891", type: "number", step: "0.000001" },
  { key: "lng", label: "ลองจิจูด", placeholder: "เช่น 98.9832", type: "number", step: "0.000001" },
];

export default function UnitPanel({ unit, onChange }: Props) {
  return (
    <section className="panel" id="unitPanel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">ข้อมูลจุดจัดการศึกษา</p>
          <h2>ประเมินแยกรายโรงเรียนหลัก โรงเรียนสาขา หรือห้องเรียนสาขา</h2>
        </div>
        <span className="config-badge">เกณฑ์ฉบับเสนอ v1</span>
      </div>

      <div className="unit-grid">
        {UNIT_FIELDS.map((field) => (
          <label key={field.key}>
            <span>{field.label}</span>
            <input
              type={field.type}
              min={field.type === "number" ? 0 : undefined}
              step={field.step}
              inputMode={field.inputMode}
              placeholder={field.placeholder}
              value={unit[field.key]}
              onChange={(event) => onChange(field.key, event.target.value as UnitInfo[typeof field.key])}
            />
          </label>
        ))}
      </div>

      <div className="segmented" role="group" aria-label="ประเภทจุดจัดการศึกษา">
        {UNIT_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className={unit.unitType === type ? "active" : ""}
            onClick={() => onChange("unitType", type)}
          >
            {type}
          </button>
        ))}
      </div>

      <div className="notice">
        ระบบนี้รับข้อมูลผู้เรียนเป็นยอดรวมเท่านั้น ห้ามแนบรายชื่อรายบุคคลในหมวดชาติพันธุ์ ความยากจน ความพิการ
        หรือสถานะทะเบียน เพื่อรักษาหลัก PDPA
      </div>
    </section>
  );
}
