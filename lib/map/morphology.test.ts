// เทสต์การจำแนก landform จากกริดความสูง — เน้นกรณีที่ข้อมูลจังหวัดหาย ซึ่งเคยทำให้ทุกที่กลายเป็น "พื้นที่สูง"

import { test } from "node:test";
import assert from "node:assert/strict";

import { meanSlopeWithinRadiusPct, morphologyFromGrid, type Bbox } from "./morphology";

const N = 41;
const WIDTH_M = 2828;

/** กริดราบสม่ำเสมอที่ความสูงเดียว */
function flatGrid(elevationM: number): Float32Array {
  return new Float32Array(N * N).fill(elevationM);
}

const BBOX: Bbox = { north: 7.02, south: 6.98, west: 101.28, east: 101.32 };

test("ที่ราบชายฝั่งที่ไม่มีข้อมูลค่าเฉลี่ยจังหวัด ต้องไม่ถูกจำแนกเป็นภูเขา/เชิงเขา", () => {
  const result = morphologyFromGrid(flatGrid(40), N, WIDTH_M, {
    bbox: BBOX,
    routeTailMaxElev: 45,
    routeFullMaxElev: 50,
    // ไม่ส่ง provinceOverride — จำลองกรณีหาแถวจังหวัดใน DB ไม่พบ
  });
  assert.equal(result.landformEn, "Plains");
  assert.equal(result.classificationMethod, "route");
});

test("ค่าเฉลี่ยจังหวัดที่หายไปต้องไม่ถูกแทนด้วยศูนย์", () => {
  const result = morphologyFromGrid(flatGrid(40), N, WIDTH_M, { bbox: BBOX, routeTailMaxElev: 45 });
  assert.equal(result.provinceAvgElev, null);
});

test("ความสูงสัมบูรณ์เกิน 500 ม. ยังเข้าเกณฑ์พื้นที่สูงแม้ไม่มีข้อมูลจังหวัด", () => {
  const result = morphologyFromGrid(flatGrid(900), N, WIDTH_M, {
    bbox: BBOX,
    routeTailMaxElev: 950,
    routeFullMaxElev: 1000,
  });
  assert.equal(result.landformEn, "Mountain");
});

test("ความลาดชันรอบโรงเรียนต้องไม่ถูกผนังหุบที่อยู่ไกลดึงให้สูงขึ้น", () => {
  // ก้นหุบราบรัศมี ~700 ม. แล้วผนังหุบชันขึ้นเร็วนอกรัศมีนั้น
  const grid = new Float32Array(N * N);
  const cellM = WIDTH_M / (N - 1);
  const center = (N - 1) / 2;
  for (let row = 0; row < N; row += 1) {
    for (let col = 0; col < N; col += 1) {
      const distM = Math.hypot((col - center) * cellM, (row - center) * cellM);
      grid[row * N + col] = distM <= 700 ? 500 : 500 + (distM - 700) * 0.8;
    }
  }

  const inner = meanSlopeWithinRadiusPct(grid, N, WIDTH_M, 500);
  const whole = morphologyFromGrid(grid, N, WIDTH_M, { bbox: BBOX, routeTailMaxElev: 900 }).meanSlopePct;

  assert.ok(inner !== null);
  assert.ok(inner < 1, `ก้นหุบต้องราบ แต่ได้ ${inner}%`);
  assert.ok(whole > inner * 5, `ค่าเฉลี่ยทั้งผืน (${whole}%) ต้องสูงกว่ารอบโรงเรียนมาก`);
});

test("ความลาดชันรอบโรงเรียนบนไหล่เขาลาดสม่ำเสมอต้องตรงกับความชันจริง", () => {
  const grid = new Float32Array(N * N);
  const cellM = WIDTH_M / (N - 1);
  for (let row = 0; row < N; row += 1) {
    for (let col = 0; col < N; col += 1) {
      grid[row * N + col] = 500 + col * cellM * 0.2; // ลาด 20% ตลอด
    }
  }
  const inner = meanSlopeWithinRadiusPct(grid, N, WIDTH_M, 500);
  assert.ok(inner !== null);
  assert.ok(Math.abs(inner - 20) < 0.5, `คาด ~20% ได้ ${inner}%`);
});

test("ผลวิเคราะห์ภูมิประเทศต้องแนบความลาดชันรอบโรงเรียนมาด้วย แยกจากค่าเฉลี่ยทั้งผืน", () => {
  const grid = new Float32Array(N * N);
  const cellM = WIDTH_M / (N - 1);
  const center = (N - 1) / 2;
  for (let row = 0; row < N; row += 1) {
    for (let col = 0; col < N; col += 1) {
      const distM = Math.hypot((col - center) * cellM, (row - center) * cellM);
      grid[row * N + col] = distM <= 700 ? 500 : 500 + (distM - 700) * 0.8;
    }
  }
  const result = morphologyFromGrid(grid, N, WIDTH_M, { bbox: BBOX, routeTailMaxElev: 900 });
  assert.ok(result.innerSlopePct !== null);
  assert.ok(result.innerSlopePct < result.meanSlopePct);
  assert.equal(result.innerSlopePct, meanSlopeWithinRadiusPct(grid, N, WIDTH_M, 500));
});

test("กริดที่อ่านค่าไม่ได้เลยในรัศมี ต้องคืน null ไม่ใช่ศูนย์", () => {
  const grid = new Float32Array(N * N).fill(NaN);
  assert.equal(meanSlopeWithinRadiusPct(grid, N, WIDTH_M, 500), null);
});

test("มีค่าเฉลี่ยจังหวัด: ที่ตั้งสูงกว่าค่าเฉลี่ยจังหวัดยังนับเป็นพื้นที่สูงตามเดิม", () => {
  const result = morphologyFromGrid(flatGrid(300), N, WIDTH_M, {
    bbox: BBOX,
    routeTailMaxElev: 320,
    provinceOverride: { name: "ทดสอบ", avgElev: 200 },
  });
  assert.equal(result.landformEn, "Mountain");
  assert.equal(result.provinceAvgElev, 200);
});
