// Gate ระดับ UX: ถ้าไม่มี session cookie เลย ให้เด้งไปหน้า /login
// เช็คแค่ "มี cookie ไหม" (ไม่ได้ตรวจลายเซ็น) — การตรวจจริงอยู่ในหน้า/route (node runtime)
// Next 16 เปลี่ยนชื่อ convention จาก middleware → proxy (ไฟล์ proxy.ts + ฟังก์ชันชื่อ proxy)
// รันบน edge จึง import ได้เฉพาะค่าคงที่ที่ไม่มี dependency ของ node

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-constants";

export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (hasSession) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // ยกเว้น: หน้า login, ทุก API (ป้องกันตัวเองด้วย 401), ไฟล์ static/next, favicon, ไฟล์ geo สาธารณะ (แนวชายแดน)
  matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico|geo).*)"],
};
