import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireApiRole } from "@/lib/api-auth";
import { getAppSettings, setAppSetting } from "@/lib/settings-repo";
import { isAppSettingKey } from "@/lib/settings";

export const dynamic = "force-dynamic";

// ตั้งค่าส่วนกลางทีละ key — admin เท่านั้น; key ต้องอยู่ใน allowlist (lib/settings.ts) ไม่งั้น 400
export async function PATCH(request: NextRequest) {
  const guard = await requireApiRole("admin");
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const key = typeof obj.key === "string" ? obj.key : "";
  if (!isAppSettingKey(key)) {
    return NextResponse.json({ error: "ไม่รู้จักค่าตั้งค่านี้" }, { status: 400 });
  }
  if (typeof obj.value !== "boolean") {
    return NextResponse.json({ error: "ค่าต้องเป็น true/false" }, { status: 400 });
  }

  try {
    await setAppSetting(key, obj.value);
    const settings = await getAppSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    console.error("[api] update setting failed:", error);
    return NextResponse.json({ error: "บันทึกค่าตั้งค่าไม่สำเร็จ" }, { status: 500 });
  }
}
