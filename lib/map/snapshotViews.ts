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
  /** ระยะห่างกล้องถึงหมุด (เมตร) ตามแนวเล็งของ lookAt — ยิ่งมาก = เห็นกว้าง/ไกล */
  rangeM: number;
}

const DIRS: { suffix: string; label: string; headingDeg: number }[] = [
  { suffix: "n", label: "เหนือ", headingDeg: 0 },
  { suffix: "e", label: "ตะวันออก", headingDeg: 90 },
  { suffix: "s", label: "ใต้", headingDeg: 180 },
  { suffix: "w", label: "ตะวันตก", headingDeg: 270 },
];

export const SNAPSHOT_VIEWS: readonly SnapshotView[] = [
  { key: "top", label: "มุมมองจากด้านบน", pitchDeg: -90, headingDeg: 0, rangeM: 2500 },
  ...DIRS.map((d) => ({
    key: `near-${d.suffix}`,
    label: `ใกล้–${d.label}`,
    pitchDeg: -35,
    headingDeg: d.headingDeg,
    rangeM: 4000,
  })),
  ...DIRS.map((d) => ({
    key: `far-${d.suffix}`,
    label: `ไกล–${d.label}`,
    pitchDeg: -30,
    headingDeg: d.headingDeg,
    rangeM: 13000,
  })),
];
