import Link from "next/link";
import { SETTING_TYPES, UNIT_TYPES } from "@/lib/types";
import type { SettingType, UnitInfo } from "@/lib/types";
import SiteSnapshotGallery from "./SiteSnapshotGallery";

interface Props {
  unit: UnitInfo;
  onChange: <K extends keyof UnitInfo>(key: K, value: UnitInfo[K]) => void;
  /** ใช้สร้างลิงก์ไปหน้าแผนที่โหมดวิเคราะห์แบบประเมิน (/map?assessment=ID) */
  assessmentId: number;
}

interface UnitField {
  key: Exclude<keyof UnitInfo, "unitType" | "settingType" | "siteSnapshots">;
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

export default function UnitPanel({ unit, onChange, assessmentId }: Props) {
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

      <div className="unit-map-link gis-actions">
        <Link className="ghost-btn" href={`/map?assessment=${assessmentId}`}>
          🗺️ เปิดแผนที่ 3 มิติเพื่อวิเคราะห์พิกัด (GIS)
        </Link>
        <span className="unit-map-hint">
          ระบบจะคำนวณระยะทางจริง ความคดเคี้ยว เวลาเดินทาง และความสูงของพื้นที่ แล้วนำผลมาช่วยคำนวณคะแนนด้านที่ 3
          อัตโนมัติ
        </span>
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

      <div className="unit-setting" role="group" aria-label="ลักษณะที่ตั้ง">
        <div className="unit-setting-head">
          <span className="unit-setting-label">ลักษณะที่ตั้ง (ข้อมูลประกอบ)</span>
          <span className="unit-setting-hint">
            ไม่ใช่เงื่อนไขตัดสิทธิ์ — ใช้ประกอบภูมิประเทศ (เกาะ / ภูเขาสูง / หุบเขา / เชิงเขา / พื้นราบห่างไกล)
          </span>
        </div>
        <div className="segmented unit-setting-options">
          <button
            type="button"
            className={unit.settingType === "" ? "active" : ""}
            onClick={() => onChange("settingType", "")}
          >
            ยังไม่ระบุ
          </button>
          {SETTING_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className={unit.settingType === type ? "active" : ""}
              onClick={() => onChange("settingType", type as SettingType)}
            >
              {type}
            </button>
          ))}
        </div>
        <div className="unit-snapshots">
          <span className="unit-setting-label">ภาพยืนยันที่ตั้งจากแผนที่ 3 มิติ</span>
          <SiteSnapshotGallery assessmentId={assessmentId} snapshots={unit.siteSnapshots ?? []} />
        </div>
      </div>

      <div className="notice">
        ระบบนี้รับข้อมูลผู้เรียนเป็นยอดรวมเท่านั้น ห้ามแนบรายชื่อรายบุคคลในหมวดชาติพันธุ์ ความยากจน ความพิการ
        หรือสถานะทะเบียน เพื่อรักษาหลัก PDPA
      </div>
    </section>
  );
}
