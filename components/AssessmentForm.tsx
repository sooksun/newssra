"use client";

// ฟอร์มประเมิน — client state + autosave ลง MySQL ผ่าน PUT /api/assessments/[id]
// คะแนนฝั่ง client ใช้แสดงผลทันที ส่วนคะแนนจริงที่บันทึก server คำนวณซ้ำเสมอ

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { DIMENSIONS } from "@/lib/criteria";
import { DEMO_PROFILES, makeDemoState } from "@/lib/demo";
import { computeAll } from "@/lib/scoring";
import { makeBlankState } from "@/lib/state";
import type { AssessmentState, EvidenceInfo, IndicatorFeedback, IndicatorId, SubmittedInfo, UnitInfo } from "@/lib/types";
import DimensionPanel from "./DimensionPanel";
import ScoreRail from "./ScoreRail";
import SummaryPanel from "./SummaryPanel";
import UnitPanel from "./UnitPanel";

type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

const SAVE_DEBOUNCE_MS = 800;

interface Props {
  id: number;
  initial: AssessmentState;
}

export default function AssessmentForm({ id, initial }: Props) {
  const [state, setState] = useState<AssessmentState>(initial);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string>("");

  const computed = useMemo(() => computeAll(state), [state]);
  const stateJson = JSON.stringify(state);

  const lastSavedRef = useRef<string>(JSON.stringify(initial));
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // autosave: หน่วงหลังแก้ไขล่าสุด แล้วส่งทั้ง state ให้ server คำนวณและบันทึก
  useEffect(() => {
    if (stateJson === lastSavedRef.current) return;
    setSaveStatus("pending");
    const timer = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        const res = await fetch(`/api/assessments/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: `{"state":${stateJson}}`,
        });
        if (!res.ok) throw new Error(`save failed: ${res.status}`);
        lastSavedRef.current = stateJson;
        setSaveStatus("saved");
        setSavedAt(
          new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })
        );
      } catch (error) {
        console.error(error);
        setSaveStatus("error");
      }
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [id, stateJson]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 2600);
  }

  function updateUnit<K extends keyof UnitInfo>(key: K, value: UnitInfo[K]) {
    setState((prev) => ({ ...prev, unit: { ...prev.unit, [key]: value } }));
  }

  function updateResponse(indicatorId: IndicatorId, key: string, value: string) {
    setState((prev) => ({
      ...prev,
      responses: { ...prev.responses, [indicatorId]: { ...prev.responses[indicatorId], [key]: value } },
    }));
  }

  function setLevel(indicatorId: IndicatorId, index: number) {
    updateResponse(indicatorId, "level", String(index));
  }

  function updateEvidence(indicatorId: IndicatorId, patch: Partial<EvidenceInfo>) {
    setState((prev) => ({
      ...prev,
      evidence: { ...prev.evidence, [indicatorId]: { ...prev.evidence[indicatorId], ...patch } },
    }));
  }

  function updateFeedback(indicatorId: IndicatorId, patch: Partial<IndicatorFeedback>) {
    setState((prev) => ({
      ...prev,
      feedback: { ...prev.feedback, [indicatorId]: { ...prev.feedback[indicatorId], ...patch } },
    }));
  }

  function setGeneralFeedback(value: string) {
    setState((prev) => ({ ...prev, generalFeedback: value }));
  }

  function setSigned(signed: boolean) {
    setState((prev) => ({ ...prev, signed }));
  }

  function handleDemo(profileId: string) {
    const profile = DEMO_PROFILES.find((p) => p.id === profileId);
    setState(makeDemoState(profileId));
    showToast(
      profile
        ? `เติมตัวอย่าง "${profile.name}" แล้ว (${profile.total}/100, ${profile.levelLabel})`
        : "เติมข้อมูลตัวอย่างแล้ว"
    );
  }

  function handleReset() {
    if (!window.confirm("ต้องการล้างข้อมูลแบบประเมินฉบับนี้หรือไม่")) return;
    setState(makeBlankState());
    showToast("ล้างข้อมูลแล้ว");
  }

  function handleExport() {
    const payload = {
      exportedAt: new Date().toISOString(),
      unit: state.unit,
      scores: computed.scores,
      total: computed.total,
      level: computed.level,
      flags: computed.flags,
      responses: state.responses,
      evidence: state.evidence,
      feedback: state.feedback,
      generalFeedback: state.generalFeedback,
      submitted: state.submitted,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pss-assessment-${state.unit.code || id}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("ส่งออกไฟล์ JSON แล้ว");
  }

  async function handleSubmit() {
    if (!computed.submittable || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/assessments/${id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: `{"state":${stateJson}}`,
      });
      const data = (await res.json()) as { submitted?: SubmittedInfo; error?: string };
      if (!res.ok || !data.submitted) {
        showToast(data.error || "ส่งแบบประเมินไม่สำเร็จ");
        return;
      }
      const next: AssessmentState = { ...state, signed: true, submitted: data.submitted };
      lastSavedRef.current = JSON.stringify(next);
      setState(next);
      setSaveStatus("saved");
      setSavedAt(
        new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })
      );
      showToast(`ส่งแบบประเมินแล้ว เลขที่อ้างอิง ${data.submitted.ref}`);
    } catch (error) {
      console.error(error);
      showToast("ส่งแบบประเมินไม่สำเร็จ — ตรวจสอบการเชื่อมต่อ");
    } finally {
      setSubmitting(false);
    }
  }

  const blockers = computed.flags.some((flag) => flag.tone === "block");
  let submitLabel = "ลงนามรับรองและส่งแบบประเมิน";
  let submitHint = "ระบบจะบันทึกและออกเลขที่อ้างอิงให้อัตโนมัติ";
  if (!computed.unitOk) {
    submitLabel = "กรอกข้อมูลจุดจัดการศึกษาให้ครบก่อนส่ง";
    submitHint = "ต้องมีชื่อ รหัส ปีประเมิน ยอดผู้เรียน หน่วยงานต้นทาง และจังหวัด";
  } else if (computed.answered !== computed.totalIndicators) {
    submitLabel = "กรอกข้อมูลให้ครบก่อนส่ง";
    submitHint = `เหลือ ${computed.totalIndicators - computed.answered} ตัวชี้วัด`;
  } else if (blockers) {
    submitLabel = "แก้ธงที่บล็อกก่อนส่ง";
    submitHint = "รายการสีแดงต้องแก้ไขหรือยืนยันหลักฐานให้ครบ";
  } else if (!state.signed) {
    submitLabel = "ลงนามรับรองก่อนส่ง";
    submitHint = "ติ๊กคำรับรองข้อมูลด้านล่าง";
  }

  const saveText =
    saveStatus === "saving" || saveStatus === "pending"
      ? "กำลังบันทึก…"
      : saveStatus === "error"
        ? "บันทึกไม่สำเร็จ — แก้ไขข้อมูลเพื่อลองใหม่"
        : saveStatus === "saved" && savedAt
          ? `บันทึกอัตโนมัติแล้ว ${savedAt} น.`
          : "บันทึกอัตโนมัติเมื่อแก้ไข";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">พศ</div>
          <div>
            <p className="eyebrow">ระบบคัดกรองสถานศึกษาพื้นที่ลักษณะพิเศษ</p>
            <h1>แบบประเมินเพื่อรับเงินเพิ่ม พ.ส.ศ.</h1>
          </div>
        </div>
        <div className="top-actions" aria-label="เครื่องมือแบบประเมิน">
          <span className={`save-indicator ${saveStatus}`}>{saveText}</span>
          <Link className="ghost-btn" href="/">
            ← รายการแบบประเมิน
          </Link>
          <select
            className="ghost-btn demo-select"
            aria-label="เลือกตัวอย่างโรงเรียนเพื่อทดลองกรอก"
            value=""
            onChange={(event) => {
              const profileId = event.target.value;
              if (profileId) handleDemo(profileId);
              event.target.value = "";
            }}
          >
            <option value="" disabled>
              เติมตัวอย่าง ▾
            </option>
            {DEMO_PROFILES.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} ({profile.total} คะแนน)
              </option>
            ))}
          </select>
          <button className="ghost-btn" type="button" onClick={handleExport}>
            ส่งออก JSON
          </button>
          <button className="ghost-btn" type="button" onClick={() => window.print()}>
            พิมพ์
          </button>
        </div>
      </header>

      <div className="pilot-banner">
        <strong>ระบบอยู่ระหว่างทดสอบกับผู้เกี่ยวข้อง (Stakeholder Test)</strong>
        <span>
          กรุณาทดลองกรอกแบบประเมิน แล้วแสดงความคิดเห็นในช่อง &ldquo;ความคิดเห็นของผู้ทดสอบ&rdquo; ท้ายแต่ละตัวชี้วัด
          หรือช่องความคิดเห็นโดยรวมท้ายแบบประเมิน เพื่อนำไปปรับปรุงเกณฑ์ก่อนประกาศใช้จริง — เว้นว่างได้หากไม่มีความเห็นเพิ่มเติม
        </span>
      </div>

      <main className="layout">
        <ScoreRail computed={computed} signed={state.signed} />

        <section className="workspace">
          <form onSubmit={(event) => event.preventDefault()} noValidate>
            <UnitPanel unit={state.unit} onChange={updateUnit} />

            {DIMENSIONS.map((dimension) => (
              <DimensionPanel
                key={dimension.no}
                dimension={dimension}
                assessmentId={id}
                state={state}
                computed={computed}
                handlers={{
                  onResponse: updateResponse,
                  onLevel: setLevel,
                  onEvidence: updateEvidence,
                  onFeedback: updateFeedback,
                }}
              />
            ))}

            <SummaryPanel
              computed={computed}
              signed={state.signed}
              submitted={state.submitted}
              submitLabel={submitLabel}
              submitHint={submitHint}
              generalFeedback={state.generalFeedback}
              onGeneralFeedbackChange={setGeneralFeedback}
              onSignedChange={setSigned}
              onReset={handleReset}
              onSubmit={handleSubmit}
              submitting={submitting}
            />
          </form>
        </section>
      </main>

      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}
