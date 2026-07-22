"use client";

import { useState } from "react";
import { ROLES, ROLE_LABELS } from "@/lib/types";
import type { Role, User } from "@/lib/types";

interface Props {
  initialUsers: User[];
  currentUserId: number;
}

const BLANK_FORM = { username: "", displayName: "", role: "admin" as Role, password: "", schoolCode: "" };

export default function UsersAdmin({ initialUsers, currentUserId }: Props) {
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [form, setForm] = useState(BLANK_FORM);
  const [creating, setCreating] = useState(false);

  async function reload() {
    const res = await fetch("/api/admin/users");
    if (res.ok) {
      const data = (await res.json()) as { users: User[] };
      setUsers(data.users);
    }
  }

  async function patchUser(id: number, patch: Record<string, unknown>) {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "แก้ไขไม่สำเร็จ");
        return;
      }
      await reload();
    } catch {
      setError("เชื่อมต่อไม่สำเร็จ — ลองใหม่อีกครั้ง");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "สร้างผู้ใช้ไม่สำเร็จ");
        return;
      }
      setForm(BLANK_FORM);
      await reload();
    } catch {
      setError("เชื่อมต่อไม่สำเร็จ — ลองใหม่อีกครั้ง");
    } finally {
      setCreating(false);
    }
  }

  function handleEditSchoolCode(user: User) {
    const code = window.prompt(
      `ตั้งรหัสโรงเรียนให้ "${user.username}" (ใช้จำกัดขอบเขตข้อมูลของบทบาทโรงเรียน — เว้นว่างเพื่อยกเลิกการผูก)`,
      user.schoolCode ?? "",
    );
    if (code === null) return;
    patchUser(user.id, { schoolCode: code.trim() });
  }

  function handleResetPassword(user: User) {
    const pw = window.prompt(`ตั้งรหัสผ่านใหม่ให้ "${user.username}" (อย่างน้อย 6 ตัวอักษร)`);
    if (pw === null) return;
    if (pw.length < 6) {
      setError("รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร");
      return;
    }
    patchUser(user.id, { password: pw });
  }

  return (
    <>
      {error ? (
        <div className="db-error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="panel admin-create">
        <h3>เพิ่มผู้ใช้ใหม่</h3>
        <form className="admin-create-form" onSubmit={handleCreate}>
          <label className="admin-field">
            <span>ชื่อบัญชี</span>
            <input
              type="text"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              placeholder="เช่น school-0123"
              autoComplete="off"
              required
            />
          </label>
          <label className="admin-field">
            <span>ชื่อที่แสดง</span>
            <input
              type="text"
              value={form.displayName}
              onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              placeholder="เช่น โรงเรียนบ้านตัวอย่าง"
              autoComplete="off"
            />
          </label>
          <label className="admin-field">
            <span>บทบาท</span>
            <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </label>
          {form.role === "school" ? (
            <label className="admin-field">
              <span>รหัสโรงเรียน</span>
              <input
                type="text"
                value={form.schoolCode}
                onChange={(e) => setForm((f) => ({ ...f, schoolCode: e.target.value }))}
                placeholder="เช่น 10010001"
                autoComplete="off"
              />
            </label>
          ) : null}
          <label className="admin-field">
            <span>รหัสผ่าน</span>
            <input
              type="text"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="อย่างน้อย 6 ตัวอักษร"
              autoComplete="off"
              required
            />
          </label>
          <button className="primary-btn" type="submit" disabled={creating}>
            {creating ? "กำลังเพิ่ม…" : "+ เพิ่มผู้ใช้"}
          </button>
        </form>
      </section>

      <section className="panel table-scroll">
        <table className="list-table">
          <thead>
            <tr>
              <th>ชื่อบัญชี</th>
              <th>ชื่อที่แสดง</th>
              <th>บทบาท</th>
              <th>รหัสโรงเรียน</th>
              <th>สถานะ</th>
              <th>การจัดการ</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isSelf = user.id === currentUserId;
              const busy = busyId === user.id;
              return (
                <tr key={user.id}>
                  <td className="cell-main">
                    <span>{user.username}</span>
                    {isSelf ? <span className="cell-sub">บัญชีของคุณ</span> : null}
                  </td>
                  <td>{user.displayName || "-"}</td>
                  <td>
                    <select
                      className="ghost-btn"
                      value={user.role}
                      disabled={busy}
                      onChange={(e) => patchUser(user.id, { role: e.target.value as Role })}
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {user.role === "school" ? (
                      <button
                        className="ghost-btn"
                        type="button"
                        disabled={busy}
                        onClick={() => handleEditSchoolCode(user)}
                      >
                        {user.schoolCode || "— ตั้งรหัส"}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <span className={`status-pill ${user.active ? "submitted" : "draft"}`}>
                      {user.active ? "ใช้งาน" : "ระงับ"}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="ghost-btn"
                        type="button"
                        disabled={busy}
                        onClick={() => handleResetPassword(user)}
                      >
                        ตั้งรหัสผ่าน
                      </button>
                      <button
                        className={`ghost-btn ${user.active ? "danger" : ""}`}
                        type="button"
                        disabled={busy}
                        onClick={() => patchUser(user.id, { active: !user.active })}
                      >
                        {user.active ? "ระงับบัญชี" : "เปิดใช้งาน"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
