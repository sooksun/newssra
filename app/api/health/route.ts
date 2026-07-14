import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Liveness probe — ยืนยันว่าเว็บเซิร์ฟเวอร์ตอบสนอง (ไม่แตะฐานข้อมูลเพื่อให้เร็วและไม่มี side effect)
// ใช้โดย healthcheck ของ docker-compose; อยู่ใต้ /api จึงไม่ถูก middleware บังคับ login
export function GET() {
  return NextResponse.json({ ok: true, ts: new Date().toISOString() });
}
