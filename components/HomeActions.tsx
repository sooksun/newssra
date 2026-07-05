"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateAssessmentButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    setBusy(true);
    try {
      const res = await fetch("/api/assessments", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { id: number };
      router.push(`/assessment/${data.id}`);
    } catch (error) {
      console.error(error);
      alert("สร้างแบบประเมินไม่สำเร็จ — ตรวจสอบการเชื่อมต่อฐานข้อมูล");
      setBusy(false);
    }
  }

  return (
    <button className="primary-btn" type="button" onClick={handleCreate} disabled={busy}>
      {busy ? "กำลังสร้าง…" : "+ สร้างแบบประเมินใหม่"}
    </button>
  );
}

export function DeleteAssessmentButton({ id, unitName }: { id: number; unitName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    const label = unitName || `แบบประเมิน #${id}`;
    if (!window.confirm(`ต้องการลบ "${label}" ออกจากระบบหรือไม่? ข้อมูลจะหายถาวร`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/assessments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (error) {
      console.error(error);
      alert("ลบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="ghost-btn danger" type="button" onClick={handleDelete} disabled={busy}>
      {busy ? "กำลังลบ…" : "ลบ"}
    </button>
  );
}
