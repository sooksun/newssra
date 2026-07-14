"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function UserMenu({ name, roleLabel }: { name: string; roleLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ถึงจะ error ก็ยังพาไปหน้า login (cookie อาจถูกล้างแล้ว)
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="user-menu">
      <div className="user-menu-info">
        <span className="user-menu-name">{name}</span>
        <span className="user-menu-role">{roleLabel}</span>
      </div>
      <button className="ghost-btn" type="button" onClick={handleLogout} disabled={busy}>
        {busy ? "กำลังออก…" : "ออกจากระบบ"}
      </button>
    </div>
  );
}
