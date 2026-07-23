"use client";

// หน้าตั้งค่าส่วนกลาง (admin) — เปลี่ยนสวิตช์แล้วบันทึกทันที; ถ้าบันทึกไม่สำเร็จให้ย้อนค่ากลับ
import { useState } from "react";
import { APP_SETTING_DEFS } from "@/lib/settings";
import type { AppSettings } from "@/lib/settings";

interface Props {
  initialSettings: AppSettings;
}

export default function SettingsAdmin({ initialSettings }: Props) {
  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState("");

  async function toggle(key: string, next: boolean) {
    const prev = settings[key];
    setSettings((s) => ({ ...s, [key]: next })); // optimistic
    setSavingKey(key);
    setErr("");
    setSaved("");
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { settings?: AppSettings; error?: string };
      if (!res.ok) throw new Error(data.error || "บันทึกไม่สำเร็จ");
      if (data.settings) setSettings(data.settings);
      setSaved("บันทึกแล้ว");
    } catch (e) {
      setSettings((s) => ({ ...s, [key]: prev })); // ย้อนกลับเมื่อพลาด
      setErr(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="settings-admin">
      {APP_SETTING_DEFS.map((def) => (
        <div key={def.key} className="settings-row">
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings[def.key] ?? def.defaultValue}
              disabled={savingKey === def.key}
              onChange={(e) => toggle(def.key, e.target.checked)}
            />
            <span className="settings-label">{def.label}</span>
          </label>
          <p className="settings-desc">{def.description}</p>
        </div>
      ))}
      {err ? <p className="settings-err">{err}</p> : null}
      {saved && !err ? <p className="settings-saved">{saved}</p> : null}
    </div>
  );
}
