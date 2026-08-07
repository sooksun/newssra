import assert from "node:assert/strict";
import test from "node:test";
import { boxAround, featuresInBox } from "./forest-polygons";

test("boxAround: กรอบกว้างเป็นองศามากขึ้นเมื่อละติจูดสูงขึ้น (ชดเชย cos)", () => {
  const eq = boxAround(0, 100, 10_000);
  const th = boxAround(20, 100, 10_000);
  assert.ok(eq && th);
  const eqWidth = eq.maxLng - eq.minLng;
  const thWidth = th.maxLng - th.minLng;
  assert.ok(thWidth > eqWidth, `คาดว่ากรอบที่ lat 20 กว้างกว่าที่เส้นศูนย์สูตร (${thWidth} vs ${eqWidth})`);
  // ความสูงเป็นองศาเท่ากันทุกละติจูด
  assert.ok(Math.abs(eq.maxLat - eq.minLat - (th.maxLat - th.minLat)) < 1e-9);
});

test("boxAround: อินพุตใช้ไม่ได้ → null", () => {
  assert.equal(boxAround(Number.NaN, 100, 10_000), null);
  assert.equal(boxAround(20, Number.NaN, 10_000), null);
  assert.equal(boxAround(20, 100, 0), null);
  assert.equal(boxAround(20, 100, -5), null);
});

test("featuresInBox: box = null → ว่าง", () => {
  assert.deepEqual(
    featuresInBox(
      [
        {
          rings: [
            [
              [100, 20],
              [100.1, 20],
              [100.1, 20.1],
              [100, 20.1],
            ],
          ],
        },
      ],
      null,
    ),
    [],
  );
});

test("featuresInBox: วงที่อยู่นอกกรอบทั้งก้อนถูกตัด", () => {
  const box = boxAround(20, 100, 10_000);
  const far = {
    rings: [
      [
        [105, 15],
        [105.1, 15],
        [105.1, 15.1],
        [105, 15.1],
      ],
    ],
  };
  assert.deepEqual(featuresInBox([far], box), []);
});

test("featuresInBox: วงที่ใหญ่กว่ากรอบและครอบกรอบไว้ต้องไม่ถูกตัด (โรงเรียนกลางผืนป่าใหญ่)", () => {
  const box = boxAround(20, 100, 10_000);
  const huge = {
    rings: [
      [
        [99, 19],
        [101, 19],
        [101, 21],
        [99, 21],
      ],
    ],
  };
  assert.equal(featuresInBox([huge], box).length, 1);
});

test("featuresInBox: เก็บวงทั้งวง ไม่ตัดกลางวงที่ขอบกรอบ", () => {
  const box = boxAround(20, 100, 10_000);
  const straddle = {
    rings: [
      [
        [99.99, 19.99],
        [100.5, 19.99],
        [100.5, 20.5],
        [99.99, 20.5],
      ],
    ],
  };
  const out = featuresInBox([straddle], box);
  assert.equal(out.length, 1);
  assert.equal(out[0].rings[0].length, 4);
});

test("featuresInBox: ปัดพิกัดเหลือ 5 ตำแหน่ง", () => {
  const box = boxAround(20, 100, 10_000);
  const f = {
    rings: [
      [
        [100.123456789, 20.987654321],
        [100.1, 20.0],
        [100.05, 20.05],
        [100.02, 20.02],
      ],
    ],
  };
  const out = featuresInBox([f], box);
  assert.deepEqual(out[0].rings[0][0], [100.12346, 20.98765]);
});

test("featuresInBox: วงที่เหลือน้อยกว่า 4 จุดถูกตัด และ feature ที่ไม่เหลือวงเลยหายไป", () => {
  const box = boxAround(20, 100, 10_000);
  const f = {
    rings: [
      [
        [100, 20],
        [100.01, 20],
        [100.01, 20.01],
      ],
    ],
  };
  assert.deepEqual(featuresInBox([f], box), []);
});

test("featuresInBox: พิกัด NaN/Infinity/นอกช่วงโลก ถูกตัดทิ้ง", () => {
  const box = boxAround(20, 100, 10_000);
  const f = {
    rings: [
      [
        [100, 20],
        [Number.NaN, 20],
        [100.01, Number.POSITIVE_INFINITY],
        [999, 20],
        [100.01, 20.01],
        [100, 20.01],
        [100.005, 20.005],
      ],
    ],
  };
  const out = featuresInBox([f], box);
  assert.equal(out.length, 1);
  assert.equal(out[0].rings[0].length, 4);
  for (const [lng, lat] of out[0].rings[0]) {
    assert.ok(Number.isFinite(lng) && Number.isFinite(lat));
  }
});

test("featuresInBox: ไม่แก้ไขอินพุต", () => {
  const box = boxAround(20, 100, 10_000);
  const ring = [
    [100.123456789, 20.987654321],
    [100.1, 20.0],
    [100.05, 20.05],
    [100.02, 20.02],
  ];
  const snapshot = JSON.stringify(ring);
  featuresInBox([{ rings: [ring] }], box);
  assert.equal(JSON.stringify(ring), snapshot);
});

test("featuresInBox: feature ที่ rings ไม่ใช่ array ไม่ทำให้พัง", () => {
  const box = boxAround(20, 100, 10_000);
  assert.deepEqual(featuresInBox([{ rings: undefined }, {}], box), []);
});
