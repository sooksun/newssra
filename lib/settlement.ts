// จำแนกความหนาแน่นการตั้งถิ่นฐาน (แกน C) — pure; ใช้จาก gis sanitize และ community-class
// แยกเพื่อตัด circular import ระหว่าง gis ↔ community-class

export type SettlementTone = "sparse" | "rural" | "semi" | "urban";

/**
 * จำแนกลักษณะการตั้งถิ่นฐานจากความหนาแน่นประชากรโดยประมาณ (คน/ตร.กม.)
 * แกน C เท่านั้น — ไม่ใช่ตัวชี้ "พื้นที่สูง/ห่างไกล"
 */
export function settlementClass(peoplePerKm2: number): { label: string; tone: SettlementTone; hint: string } {
  if (peoplePerKm2 < 100) {
    return {
      label: "พื้นที่ตั้งถิ่นฐานเบาบาง",
      tone: "sparse",
      // แกน C เท่านั้น — เบาบาง ≠ ห่างไกล/ทุรกันดาร (research: density orthogonal to remoteness)
      hint: "อาคารกระจัดกระจาย — บอกแค่ความหนาแน่น ไม่ใช่ระดับความทุรกันดาร",
    };
  }
  if (peoplePerKm2 < 750) {
    return { label: "ชุมชนชนบท", tone: "rural", hint: "ความหนาแน่นระดับหมู่บ้าน/ชุมชนชนบททั่วไป" };
  }
  if (peoplePerKm2 < 2500) {
    return { label: "ชุมชนหนาแน่นปานกลาง (กึ่งเมือง)", tone: "semi", hint: "การตั้งถิ่นฐานค่อนข้างต่อเนื่อง" };
  }
  return { label: "ชุมชนเมืองหนาแน่น", tone: "urban", hint: "อาคารหนาแน่นต่อเนื่องแบบเขตเมือง" };
}
