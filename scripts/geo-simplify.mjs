// ลดรูปเส้น/วงพิกัดด้วย Douglas–Peucker บนระนาบท้องถิ่นหน่วยเมตร
//
// แยกออกมาจาก scripts/fetch-borders.mjs เพื่อให้สคริปต์นำเข้าข้อมูลภูมิศาสตร์ทุกตัวใช้สูตรเดียวกัน
// (แนวชายแดน, ขอบเขตตำบล) — ค่า tolerance ที่บอกเป็นเมตรจึงหมายถึงสิ่งเดียวกันทุกที่
//
// พิกัดทุกจุดเป็น [lng, lat]

const R = 6_371_008.8;
const rad = (deg) => (deg * Math.PI) / 180;

/** ทศนิยมที่เก็บลงไฟล์ — 5 ตำแหน่ง ≈ 1.1 ม. ละเอียดพอสำหรับ tolerance ระดับ 50 ม. */
export const COORD_DECIMALS = 5;

/**
 * Douglas–Peucker แบบวนซ้ำด้วย stack (ไม่ recursive — วงขอบเขตบางวงมีจุดหลักหมื่น
 * การเรียกซ้ำจะทำให้ stack ล้น)
 */
export function simplify(chain, toleranceM) {
  if (toleranceM <= 0 || chain.length < 3) return chain;
  const lat0 = chain.reduce((s, p) => s + p[1], 0) / chain.length;
  const kx = (Math.PI / 180) * R * Math.cos(rad(lat0));
  const ky = (Math.PI / 180) * R;
  const xy = chain.map(([lng, lat]) => [lng * kx, lat * ky]);

  const keep = new Uint8Array(chain.length);
  keep[0] = 1;
  keep[chain.length - 1] = 1;
  const stack = [[0, chain.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop();
    if (last - first < 2) continue;
    const [ax, ay] = xy[first];
    const [bx, by] = xy[last];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;

    let farIndex = -1;
    let farDist = toleranceM;
    for (let i = first + 1; i < last; i += 1) {
      const [px, py] = xy[i];
      let dist;
      if (len2 === 0) {
        dist = Math.hypot(px - ax, py - ay);
      } else {
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        dist = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (dist > farDist) {
        farDist = dist;
        farIndex = i;
      }
    }

    if (farIndex !== -1) {
      keep[farIndex] = 1;
      stack.push([first, farIndex], [farIndex, last]);
    }
  }

  return chain.filter((_, i) => keep[i]);
}

/** ปัดพิกัดลงตาม COORD_DECIMALS แล้วตัดจุดที่ปัดจนซ้ำกับจุดก่อนหน้า */
export function roundCoords(chain) {
  const f = 10 ** COORD_DECIMALS;
  const out = [];
  for (const [lng, lat] of chain) {
    const p = [Math.round(lng * f) / f, Math.round(lat * f) / f];
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    out.push(p);
  }
  return out;
}
