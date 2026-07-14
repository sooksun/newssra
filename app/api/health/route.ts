import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { pingDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// Health probe — ใช้โดย healthcheck ของ docker-compose; route นี้ไม่ถูกบังคับ login
//  • ค่าเริ่มต้น (liveness): ยืนยันแค่ว่าเว็บเซิร์ฟเวอร์ตอบสนอง — เร็ว ไม่แตะฐานข้อมูล
//    เพื่อไม่ให้ DB สะดุดชั่วครู่ทำให้คอนเทนเนอร์ถูกมองว่าตายจนรีสตาร์ตวน
//  • ?deep=1 (readiness): ping ฐานข้อมูลด้วย — ตอบ 503 ถ้า DB ล่ม (ให้ orchestration เห็นปัญหา DB จริง)
export async function GET(request: NextRequest) {
  const deep = new URL(request.url).searchParams.get("deep") === "1";
  if (!deep) {
    return NextResponse.json({ ok: true, ts: new Date().toISOString() });
  }
  const db = await pingDb();
  return NextResponse.json({ ok: db, db, ts: new Date().toISOString() }, { status: db ? 200 : 503 });
}
