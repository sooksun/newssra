// ซ่อนป้ายที่ทับกันบนจอ — เหลือไว้เฉพาะป้ายที่สำคัญกว่า ส่วนหมุด/ธงยังแสดงครบทุกจุด
//
// ตอนซูมออก ป้ายหลายอันตกลงมาอยู่พื้นที่เดียวกันจนอ่านไม่ออก (ชื่อโรงเรียนทับระดับความสูงทับจุดสูงสุด)
// เมื่อซูมเข้าจนป้ายแยกกันได้แล้ว ป้ายที่ถูกซ่อนจะกลับมาแสดงเองเพราะคำนวณใหม่ทุกเฟรมที่กล้องขยับ
//
// พิกัดที่ใช้เป็น "drawing buffer pixel" (พื้นที่เดียวกับ width/height/pixelOffset ของ billboard ใน Cesium)
// จึงเทียบขนาดกับตำแหน่งได้ตรงกันบนจอความละเอียดสูง

/** ค่าที่ไล่ระดับตามระยะกล้อง — โครงเดียวกับ Cesium NearFarScalar */
export interface NearFarRamp {
  near: number;
  nearValue: number;
  far: number;
  farValue: number;
}

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
  /** billboard.scaleByDistance — ป้ายที่ย่อตามระยะต้องใช้กล่องที่ย่อตามด้วย ไม่งั้นกันกันเองเกินจริง */
  scaleByDistance?: NearFarRamp;
  /** billboard.translucencyByDistance — ป้ายที่จางจนมองไม่เห็นแล้วต้องไม่ไปกันป้ายอื่น */
  translucencyByDistance?: NearFarRamp;
}

/**
 * ค่าที่ Cesium ใช้จริงที่ระยะหนึ่ง — ไล่เป็นเส้นตรงระหว่าง near กับ far และคงที่นอกช่วงนั้น
 * ต้องตรงกับพฤติกรรมของ NearFarScalar ไม่งั้นกล่องชนจะไม่ตรงกับสิ่งที่ตาเห็น
 */
export function nearFarScale(distance: number, ramp?: NearFarRamp): number {
  if (!ramp || !Number.isFinite(distance)) return 1;
  const { near, nearValue, far, farValue } = ramp;
  if (distance <= near) return nearValue;
  if (distance >= far) return farValue;
  if (far === near) return nearValue;
  const t = (distance - near) / (far - near);
  return nearValue + (farValue - nearValue) * t;
}

/** ป้ายที่จางกว่านี้ถือว่ามองไม่เห็น จึงไม่ควรไปกันป้ายอื่น */
export const LABEL_MIN_VISIBLE_ALPHA = 0.05;

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

/** กล่องของป้ายบนจอ จากจุดยึด (ตำแหน่งหมุดบนจอ) — billboard ยึดกึ่งกลางแนวนอนเสมอ
 *  distanceM = ระยะจากกล้องถึงหมุด ใช้ย่อกล่องตาม scaleByDistance ให้เท่ากับขนาดที่เรนเดอร์จริง
 *  (Cesium ย่อเฉพาะตัวรูป ไม่ย่อ pixelOffset จึงคูณเฉพาะความกว้าง/สูง) */
export function labelBox(
  id: string,
  anchorX: number,
  anchorY: number,
  placement: LabelPlacement,
  distanceM = Number.NaN,
): LabelBox {
  const scale = nearFarScale(distanceM, placement.scaleByDistance);
  const width = placement.width * scale;
  const height = placement.height * scale;
  const left = anchorX - width / 2;
  const bottom = placement.verticalCenter ? anchorY + placement.offsetY + height / 2 : anchorY + placement.offsetY;
  return {
    id,
    left,
    right: left + width,
    top: bottom - height,
    bottom,
    priority: placement.priority,
  };
}

/** ป้ายนี้จางจนมองไม่เห็นที่ระยะนี้แล้วหรือยัง — ถ้าใช่ ไม่ต้องเอาไปคิดเรื่องการทับซ้อน */
export function labelFadedOut(placement: LabelPlacement, distanceM: number): boolean {
  if (!placement.translucencyByDistance) return false;
  return nearFarScale(distanceM, placement.translucencyByDistance) < LABEL_MIN_VISIBLE_ALPHA;
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
