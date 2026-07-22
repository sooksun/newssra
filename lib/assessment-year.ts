// คำนวณปี พ.ศ. ปัจจุบันตามเขตเวลา Asia/Bangkok — ใช้เป็นค่าเริ่มต้นของ unit.year
// ในแบบประเมินใหม่ (ทั้งฟอร์มเปล่าและ flow กรอกอัตโนมัติจากแผนที่) แยกเป็นฟังก์ชัน pure
// รับ `now` ได้เพื่อให้ทดสอบขอบเขตวันสิ้นปีได้แน่นอน ไม่ผูกกับนาฬิกาเครื่องที่รันจริง

export function currentBuddhistYear(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).formatToParts(now);
  const gregorianYear = Number(parts.find((part) => part.type === "year")?.value);
  if (!Number.isInteger(gregorianYear)) throw new Error("cannot resolve Asia/Bangkok year");
  return String(gregorianYear + 543);
}
