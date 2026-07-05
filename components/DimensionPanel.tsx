import { useState } from "react";
import { INDICATORS } from "@/lib/criteria";
import type { DimensionDef, IndicatorDef } from "@/lib/criteria";
import { computedText } from "@/lib/scoring";
import type { ComputedAll } from "@/lib/scoring";
import { formatFileSize, MAX_FILES_PER_INDICATOR } from "@/lib/upload-constants";
import { FEEDBACK_OPINIONS, FEEDBACK_OPINION_LABELS } from "@/lib/types";
import type { AssessmentState, EvidenceFile, EvidenceInfo, IndicatorFeedback, IndicatorId } from "@/lib/types";
import { FlagList } from "./Flags";

export interface IndicatorHandlers {
  onResponse: (id: IndicatorId, key: string, value: string) => void;
  onLevel: (id: IndicatorId, index: number) => void;
  onEvidence: (id: IndicatorId, patch: Partial<EvidenceInfo>) => void;
  onFeedback: (id: IndicatorId, patch: Partial<IndicatorFeedback>) => void;
}

interface DimensionProps {
  dimension: DimensionDef;
  assessmentId: number;
  state: AssessmentState;
  computed: ComputedAll;
  handlers: IndicatorHandlers;
}

export default function DimensionPanel({ dimension, assessmentId, state, computed, handlers }: DimensionProps) {
  const earned = computed.dims.find((d) => d.no === dimension.no)?.earned ?? 0;

  return (
    <section className="panel dimension-panel" id={`dimension-${dimension.no}`}>
      <div className="dimension-head">
        <div>
          <p className="eyebrow">ด้านที่ {dimension.no} จาก 5</p>
          <h2>{dimension.title}</h2>
          <p>{dimension.note}</p>
        </div>
        <div className="dimension-score">
          {earned}/{dimension.max}
        </div>
      </div>
      <div className="indicator-grid">
        {dimension.ids.map((id) => (
          <IndicatorCard key={id} id={id} assessmentId={assessmentId} state={state} computed={computed} handlers={handlers} />
        ))}
      </div>
    </section>
  );
}

interface CardProps {
  id: IndicatorId;
  assessmentId: number;
  state: AssessmentState;
  computed: ComputedAll;
  handlers: IndicatorHandlers;
}

function IndicatorCard({ id, assessmentId, state, computed, handlers }: CardProps) {
  const indicator = INDICATORS[id];
  const score = computed.scores[id];
  const line = computedText(id, state, score);
  const localFlags = computed.flags.filter((flag) => flag.id === id);

  return (
    <article className="indicator-card">
      <div className="indicator-head">
        <div>
          <div className="indicator-title">
            <span className="mini-tag">{id}</span>
            <strong>{indicator.title}</strong>
          </div>
          {indicator.desc ? <p className="indicator-desc">{indicator.desc}</p> : null}
        </div>
        <div className={`score-badge ${score !== null && score > 0 ? "has-score" : ""}`}>
          {score === null ? 0 : score}/{indicator.max}
        </div>
      </div>

      {indicator.kind === "level" ? (
        <LevelOptions id={id} indicator={indicator} state={state} onLevel={handlers.onLevel} />
      ) : (
        <FieldInputs id={id} indicator={indicator} state={state} onResponse={handlers.onResponse} />
      )}

      <EvidenceBox
        id={id}
        indicator={indicator}
        evidence={state.evidence[id]}
        assessmentId={assessmentId}
        onEvidence={handlers.onEvidence}
      />

      <div className={`computed-line ${line.tone}`}>{line.text}</div>
      <FlagList flags={localFlags} />

      <FeedbackBox
        id={id}
        value={state.feedback[id] ?? { opinion: "agree", note: "" }}
        onChange={(patch) => handlers.onFeedback(id, patch)}
      />
    </article>
  );
}

function FeedbackBox({
  id,
  value,
  onChange,
}: {
  id: IndicatorId;
  value: IndicatorFeedback;
  onChange: (patch: Partial<IndicatorFeedback>) => void;
}) {
  const showNote = value.opinion !== "agree";
  return (
    <div className="feedback-box">
      <p className="feedback-box-label">ระดับความเห็นของผู้ทดสอบต่อตัวชี้วัดนี้</p>
      <div className="feedback-radio-group" role="radiogroup" aria-label={`ระดับความเห็นต่อตัวชี้วัด ${id}`}>
        {FEEDBACK_OPINIONS.map((opinion) => (
          <label key={opinion} className="feedback-radio">
            <input
              type="radio"
              name={`feedback-opinion-${id}`}
              checked={value.opinion === opinion}
              onChange={() => onChange({ opinion })}
            />
            <span>{FEEDBACK_OPINION_LABELS[opinion]}</span>
          </label>
        ))}
      </div>
      {showNote ? (
        <textarea
          className="feedback-note"
          placeholder="กรุณาระบุเหตุผลหรือข้อเสนอแนะเพิ่มเติม"
          value={value.note}
          onChange={(event) => onChange({ note: event.target.value })}
        />
      ) : null}
    </div>
  );
}

interface FieldInputsProps {
  id: IndicatorId;
  indicator: Extract<IndicatorDef, { kind: "fields" }>;
  state: AssessmentState;
  onResponse: IndicatorHandlers["onResponse"];
}

function FieldInputs({ id, indicator, state, onResponse }: FieldInputsProps) {
  return (
    <div className="input-grid">
      {indicator.fields.map((field) => (
        <label key={field.key} className="input-wrap">
          <span>{field.label}</span>
          <input
            type={field.type}
            min={field.type === "number" ? 0 : undefined}
            step={field.type === "number" ? "any" : undefined}
            placeholder={field.unit || "กรอกข้อมูล"}
            value={state.responses[id]?.[field.key] ?? ""}
            onChange={(event) => onResponse(id, field.key, event.target.value)}
          />
          {field.unit ? <small>{field.unit}</small> : null}
        </label>
      ))}
    </div>
  );
}

interface LevelOptionsProps {
  id: IndicatorId;
  indicator: Extract<IndicatorDef, { kind: "level" }>;
  state: AssessmentState;
  onLevel: IndicatorHandlers["onLevel"];
}

function LevelOptions({ id, indicator, state, onLevel }: LevelOptionsProps) {
  const selected = state.responses[id]?.level;
  return (
    <div className="level-options" role="group" aria-label={indicator.title}>
      {indicator.options.map((option, index) => (
        <button
          key={index}
          type="button"
          className={`level-option ${String(selected) === String(index) ? "active" : ""}`}
          onClick={() => onLevel(id, index)}
        >
          <span className="point-chip">{option.points}</span>
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

interface EvidenceBoxProps {
  id: IndicatorId;
  indicator: IndicatorDef;
  evidence: EvidenceInfo;
  assessmentId: number;
  onEvidence: IndicatorHandlers["onEvidence"];
}

function EvidenceBox({ id, indicator, evidence, assessmentId, onEvidence }: EvidenceBoxProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const files = evidence?.files ?? [];
  const atLimit = files.length >= MAX_FILES_PER_INDICATOR;

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = ""; // เคลียร์ช่องเลือกไฟล์ เผื่อต้องเลือกไฟล์เดิมซ้ำ
    if (!selected.length) return;

    setError("");
    setUploading(true);
    let latestFiles = files;
    for (const file of selected) {
      if (latestFiles.length >= MAX_FILES_PER_INDICATOR) {
        setError(`แนบไฟล์ได้สูงสุด ${MAX_FILES_PER_INDICATOR} ไฟล์ต่อตัวชี้วัด`);
        break;
      }
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch(`/api/assessments/${assessmentId}/evidence/${id}`, { method: "POST", body });
        const data = (await res.json()) as { file?: EvidenceFile; error?: string };
        if (!res.ok || !data.file) {
          setError(data.error || `อัปโหลด "${file.name}" ไม่สำเร็จ`);
          continue;
        }
        latestFiles = [...latestFiles, data.file];
        onEvidence(id, { files: latestFiles });
      } catch {
        setError(`อัปโหลด "${file.name}" ไม่สำเร็จ — ตรวจสอบการเชื่อมต่อ`);
      }
    }
    setUploading(false);
  }

  async function handleDelete(file: EvidenceFile) {
    if (!window.confirm(`ต้องการลบไฟล์ "${file.originalName}" หรือไม่`)) return;
    try {
      const res = await fetch(`/api/assessments/${assessmentId}/evidence/${id}/${file.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      onEvidence(id, { files: files.filter((f) => f.id !== file.id) });
    } catch {
      setError("ลบไฟล์ไม่สำเร็จ");
    }
  }

  return (
    <div className="evidence-box">
      <div className="evidence-row">
        <p>
          <strong>หลักฐาน:</strong> {indicator.evidence}
        </p>
        <label className="evidence-check">
          <input
            type="checkbox"
            checked={evidence?.ready ?? false}
            onChange={(event) => onEvidence(id, { ready: event.target.checked })}
          />
          หลักฐานพร้อมตรวจ
        </label>
      </div>
      <textarea
        placeholder="บันทึกเลขที่เอกสาร ชื่อไฟล์ หรือคำชี้แจงประกอบ"
        value={evidence?.note ?? ""}
        onChange={(event) => onEvidence(id, { note: event.target.value })}
      />

      {files.length ? (
        <div className="evidence-files">
          {files.map((file) => {
            const fileUrl = `/api/assessments/${assessmentId}/evidence/${id}/${file.id}`;
            return (
              <div className="evidence-file" key={file.id}>
                {file.mimeType.startsWith("image/") ? (
                  <a href={fileUrl} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element -- ไฟล์ผู้ใช้อัปโหลดเอง ไม่ใช่ asset ที่รู้ล่วงหน้า ใช้ next/image ไม่ได้ */}
                    <img className="evidence-thumb" src={fileUrl} alt={file.originalName} />
                  </a>
                ) : (
                  <a className="evidence-file-icon" href={fileUrl} target="_blank" rel="noreferrer">
                    PDF
                  </a>
                )}
                <div className="evidence-file-info">
                  <span className="evidence-file-name" title={file.originalName}>
                    {file.originalName}
                  </span>
                  <span className="evidence-file-meta">{formatFileSize(file.size)}</span>
                </div>
                <button
                  type="button"
                  className="evidence-file-remove"
                  onClick={() => handleDelete(file)}
                  aria-label={`ลบไฟล์ ${file.originalName}`}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      <label className={`evidence-upload-btn ${uploading || atLimit ? "disabled" : ""}`}>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          multiple
          disabled={uploading || atLimit}
          onChange={handleFileSelect}
        />
        {uploading ? "กำลังอัปโหลด…" : atLimit ? `แนบไฟล์ครบ ${MAX_FILES_PER_INDICATOR} ไฟล์แล้ว` : "+ แนบไฟล์หลักฐาน (ภาพ/PDF)"}
      </label>
      {error ? <p className="evidence-upload-error">{error}</p> : null}
    </div>
  );
}
