"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "เข้าสู่ระบบไม่สำเร็จ");
        setBusy(false);
        return;
      }
      // deep link ที่ตั้งใจจะเข้า (ถ้ามี) จะถูกเคารพ; ไม่งั้นพาไปหน้าแรกหลัง login = แผนที่ 3 มิติ (/map)
      // รับเฉพาะ path ภายในเพื่อกัน open-redirect
      const isDeepLink = nextPath.startsWith("/") && !nextPath.startsWith("//") && nextPath !== "/";
      const target = isDeepLink ? nextPath : "/map";
      router.replace(target);
      router.refresh();
    } catch {
      setError("เชื่อมต่อไม่สำเร็จ — ลองใหม่อีกครั้ง");
      setBusy(false);
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit} noValidate>
      <label className="login-field">
        <span>ชื่อบัญชีผู้ใช้</span>
        <input
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          required
        />
      </label>
      <label className="login-field">
        <span>รหัสผ่าน</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>

      {error ? (
        <p className="login-error" role="alert">
          {error}
        </p>
      ) : null}

      <button className="primary-btn login-submit" type="submit" disabled={busy}>
        {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
      </button>
    </form>
  );
}
