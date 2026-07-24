// มุมกล้องตายตัว 9 มุม สำหรับจับภาพยืนยันที่ตั้งจากแผนที่ 3D — pure (ไม่พึ่ง cesium/React) เพื่อทดสอบได้
// ใช้กับ camera.lookAt(หมุดโรงเรียน, HeadingPitchRange) เพื่อให้หมุดอยู่กึ่งกลางภาพทุกมุม (ทั้งใกล้/ไกล)
export interface SnapshotView {
  key: string;
  /** ป้ายไทยแสดงใต้ภาพใน gallery */
  label: string;
  /** มุมก้มกล้อง (องศา; −90 = มองตรงลง) */
  pitchDeg: number;
  /** ทิศหันกล้อง (องศาจากทิศเหนือ ตามเข็ม) */
  headingDeg: number;
  /** ระยะห่างกล้องถึงหมุด (เมตร) ตามแนวเล็งของ lookAt — ยิ่งมาก = เห็นกว้าง/ไกล; ไม่ใช้เมื่อ frame ถูกกำหนด */
  rangeM: number;
  /**
   * เมื่อกำหนด: จับภาพแบบ "ครอบ 2 จุด" (โรงเรียน + ศาลากลางจังหวัด) ด้วย BoundingSphere แทน lookAt รอบโรงเรียน
   * — ใช้ระยะกล้องที่คำนวณจากระยะห่างจริงของสองจุด (rangeM จึงไม่มีผล); ถ้าไม่มีพิกัดศาลากลางให้ข้ามมุมนี้ไป
   */
  frame?: "school-and-province";
}

const DIRS: { suffix: string; label: string; headingDeg: number }[] = [
  { suffix: "n", label: "เหนือ", headingDeg: 0 },
  { suffix: "e", label: "ตะวันออก", headingDeg: 90 },
  { suffix: "s", label: "ใต้", headingDeg: 180 },
  { suffix: "w", label: "ตะวันตก", headingDeg: 270 },
];

export const SNAPSHOT_VIEWS: readonly SnapshotView[] = [
  { key: "top", label: "มุมมองจากด้านบน", pitchDeg: -90, headingDeg: 0, rangeM: 2500 },
  // ระยะใกล้: 2,200 ม. + ก้ม 42° — ใกล้พอให้เห็นตัวอาคาร/ถนนรอบโรงเรียนชัด และหมุดไม่หลุดขอบภาพ
  // (ระยะเดิม 4,000 ม./ก้ม 35° ทำให้โรงเรียนเป็นจุดเล็กกลางภาพกว้าง ๆ และดูไม่ออกว่าเป็นพื้นที่แบบใด)
  ...DIRS.map((d) => ({
    key: `near-${d.suffix}`,
    label: `ใกล้–${d.label}`,
    pitchDeg: -42,
    headingDeg: d.headingDeg,
    rangeM: 2200,
  })),
  ...DIRS.map((d) => ({
    key: `far-${d.suffix}`,
    label: `ไกล–${d.label}`,
    pitchDeg: -30,
    headingDeg: d.headingDeg,
    rangeM: 13000,
  })),
  // มุมที่ 10: ครอบทั้งที่ตั้งโรงเรียนและศาลากลางจังหวัดในเฟรมเดียว เพื่อยืนยันความสัมพันธ์เชิงพื้นที่ของสองจุด
  // (กล้องเล็งกึ่งกลางระหว่างสองจุด ระยะคำนวณจากระยะห่างจริง) — ถ้าไม่มีพิกัดศาลากลาง (โหมดทั้งประเทศ) จะข้ามไป
  {
    key: "overview-province",
    label: "ภาพรวม–โรงเรียนถึงศาลากลางจังหวัด",
    pitchDeg: -55,
    headingDeg: 0,
    rangeM: 0,
    frame: "school-and-province",
  },
];
