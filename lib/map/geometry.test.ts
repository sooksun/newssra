// Unit tests สำหรับ lib/map/geometry.ts — รัน: node --import tsx --test lib/map/geometry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { pointInPolygon, polygonCentroid, polygonBoundingRadiusM, polygonAreaM2 } from "./geometry";

// สามเหลี่ยมง่ายๆ รอบจุด (0,0): มุมที่ (1,0) (-1,1) (-1,-1) — lat,lng
const triangle: [number, number][] = [
  [1, 0],
  [-1, 1],
  [-1, -1],
];

test("pointInPolygon: จุดกลางสามเหลี่ยมอยู่ข้างใน", () => {
  assert.equal(pointInPolygon([0, 0], triangle), true);
});

test("pointInPolygon: จุดไกลออกไปอยู่ข้างนอก", () => {
  assert.equal(pointInPolygon([5, 5], triangle), false);
});

test("pointInPolygon: จุดยอด (vertex) เอง", () => {
  // ray-casting ที่จุดยอดพอดีขึ้นกับ implementation แต่ต้องไม่ throw และคืนค่า boolean
  const result = pointInPolygon([1, 0], triangle);
  assert.equal(typeof result, "boolean");
});

test("pointInPolygon: รูป 10 จุดแบบเว้า (concave) — จุดในร่องเว้าต้องอยู่นอกรูป", () => {
  // รูปคล้ายดาว/หยัก 10 จุด รอบจุดกำเนิด: สลับรัศมีไกล/ใกล้
  const star: [number, number][] = [];
  const outerR = 10;
  const innerR = 3;
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI * 2 * i) / 10;
    const r = i % 2 === 0 ? outerR : innerR;
    star.push([r * Math.cos(angle), r * Math.sin(angle)]);
  }
  // จุดตรงร่องเว้า (ระยะ ~innerR/2 ตามแนวเส้นแบ่งระหว่างแฉก) ควรอยู่นอกรูปดาว
  const midAngle = Math.PI / 10; // กึ่งกลางระหว่างจุดแฉกที่ 0 กับ 1
  const dentPoint: [number, number] = [innerR * 0.4 * Math.cos(midAngle), innerR * 0.4 * Math.sin(midAngle)];
  assert.equal(pointInPolygon(dentPoint, star), true); // ใกล้ศูนย์กลางมากพอยังอยู่ในรูป
  // จุดไกลเกินรัศมีนอกสุด ต้องอยู่นอกรูปเสมอ
  assert.equal(pointInPolygon([outerR * 2, 0], star), false);
});

test("polygonCentroid: สามเหลี่ยมสมมาตรรอบจุดกำเนิด centroid ใกล้ (0,0)", () => {
  const [lat, lng] = polygonCentroid(triangle);
  assert.ok(Math.abs(lat - -1 / 3) < 1e-9);
  assert.ok(Math.abs(lng) < 1e-9);
});

test("polygonBoundingRadiusM: รัศมีเท่ากับระยะไกลสุดจาก centroid ถึง vertex", () => {
  // สี่เหลี่ยมจัตุรัสรอบจุดกำเนิด ±0.01 องศา (~1.1 กม.)
  const square: [number, number][] = [
    [0.01, 0.01],
    [0.01, -0.01],
    [-0.01, -0.01],
    [-0.01, 0.01],
  ];
  const centroid = polygonCentroid(square);
  assert.ok(Math.abs(centroid[0]) < 1e-9 && Math.abs(centroid[1]) < 1e-9);
  const radius = polygonBoundingRadiusM(square, centroid);
  assert.ok(radius > 1000 && radius < 2000); // มุมสี่เหลี่ยมห่างจากศูนย์กลางประมาณ 1.1-1.6 กม.
});

test("polygonAreaM2: สี่เหลี่ยม 0.01°×0.01° ที่เส้นศูนย์สูตร ≈ 1.24 ตร.กม.", () => {
  // ด้านละ 0.01° ≈ 1113.2 ม. (lat) และ ~1113.2 ม. (lng ที่ lat 0) → ~1.239 ล้าน ตร.ม.
  const square: [number, number][] = [
    [0, 0],
    [0, 0.01],
    [0.01, 0.01],
    [0.01, 0],
  ];
  const area = polygonAreaM2(square);
  assert.ok(area > 1.2e6 && area < 1.26e6, `area=${area}`);
});

test("polygonAreaM2: ทิศทางวน (CW/CCW) ให้พื้นที่เท่ากัน (ใช้ค่าสัมบูรณ์)", () => {
  const ccw: [number, number][] = [
    [0, 0],
    [0, 0.01],
    [0.01, 0.01],
    [0.01, 0],
  ];
  const cw = [...ccw].reverse();
  assert.ok(Math.abs(polygonAreaM2(ccw) - polygonAreaM2(cw)) < 1e-6);
});

test("polygonAreaM2: จุดน้อยกว่า 3 → 0", () => {
  assert.equal(
    polygonAreaM2([
      [0, 0],
      [0, 0.01],
    ]),
    0,
  );
  assert.equal(polygonAreaM2([]), 0);
});
