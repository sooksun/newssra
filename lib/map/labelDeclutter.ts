// ซ่อนป้ายที่ทับกันบนจอ — เหลือไว้เฉพาะป้ายที่สำคัญกว่า ส่วนหมุด/ธงยังแสดงครบทุกจุด
//
// ตอนซูมออก ป้ายหลายอันตกลงมาอยู่พื้นที่เดียวกันจนอ่านไม่ออก (ชื่อโรงเรียนทับระดับความสูงทับจุดสูงสุด)
// เมื่อซูมเข้าจนป้ายแยกกันได้แล้ว ป้ายที่ถูกซ่อนจะกลับมาแสดงเองเพราะคำนวณใหม่ทุกเฟรมที่กล้องขยับ
//
// พิกัดที่ใช้เป็น "drawing buffer pixel" (พื้นที่เดียวกับ width/height/pixelOffset ของ billboard ใน Cesium)
// จึงเทียบขนาดกับตำแหน่งได้ตรงกันบนจอความละเอียดสูง

export interface LabelPlacement {
  /** ขนาดป้ายที่วาดไว้ (หน่วยเดียวกับ billboard.width/height) */
  width: number;
  height: number;
  /** billboard.pixelOffset แกน y (ค่าลบ = ลอยขึ้นเหนือหมุด) */
  offsetY: number;
  /** true = ยึดกึ่งกลางแนวตั้ง (ป้ายชื่อประเทศ), false = ยึดขอบล่าง (ป้ายเหนือหมุด) */
  verticalCenter: boolean;
  /** เลขน้อย = สำคัญกว่า ได้แสดงก่อนเมื่อทับกัน */
  priority: number;
}

export interface LabelBox {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  priority: number;
}

/** ระยะเผื่อรอบป้าย (พิกเซล) — ป้ายที่เฉียดกันพอดีก็ถือว่าทับ เพื่อไม่ให้อ่านยาก */
export const LABEL_GAP_PX = 4;

/** กล่องของป้ายบนจอ จากจุดยึด (ตำแหน่งหมุดบนจอ) — billboard ยึดกึ่งกลางแนวนอนเสมอ */
export function labelBox(id: string, anchorX: number, anchorY: number, placement: LabelPlacement): LabelBox {
  const left = anchorX - placement.width / 2;
  const bottom = placement.verticalCenter
    ? anchorY + placement.offsetY + placement.height / 2
    : anchorY + placement.offsetY;
  return {
    id,
    left,
    right: left + placement.width,
    top: bottom - placement.height,
    bottom,
    priority: placement.priority,
  };
}

export function boxesOverlap(a: LabelBox, b: LabelBox, gap: number = LABEL_GAP_PX): boolean {
  return (
    a.left - gap < b.right && a.right + gap > b.left && a.top - gap < b.bottom && a.bottom + gap > b.top
  );
}

/**
 * เลือกป้ายที่จะแสดง: ไล่จากป้ายสำคัญที่สุดก่อน ป้ายที่ทับของที่เลือกไว้แล้วจะถูกซ่อน
 * ลำดับเท่ากันตัดสินด้วย id เพื่อให้ผลเสถียร (ป้ายไม่กะพริบสลับกันไปมาระหว่างเฟรม)
 */
export function pickVisibleLabels(boxes: readonly LabelBox[], gap: number = LABEL_GAP_PX): Set<string> {
  const ordered = [...boxes].sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const kept: LabelBox[] = [];
  const visible = new Set<string>();
  for (const box of ordered) {
    if (kept.some((other) => boxesOverlap(box, other, gap))) continue;
    kept.push(box);
    visible.add(box.id);
  }
  return visible;
}
