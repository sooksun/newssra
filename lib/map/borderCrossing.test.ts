import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseSharedBorders } from "./borders";
import { borderBlockedMessage, filterDomesticRoutes, findBorderCrossing, segmentsIntersect } from "./borderCrossing";
import type { LngLat, SharedBordersDoc } from "./borders";

const real = parseSharedBorders(JSON.parse(readFileSync("public/geo/sea-borders.json", "utf8")));

/** พรมแดนจำลอง: เส้นตรงแนวตั้งที่ lng = 100 */
const fake: SharedBordersDoc = {
  attribution: "test",
  borders: [
    {
      name: "Testland",
      nameTh: "ประเทศทดสอบ",
      label: [100, 15],
      chains: [
        [
          [100, 10],
          [100, 20],
        ],
      ],
      pointCount: 2,
    },
  ],
};

test("segmentsIntersect covers crossing, touching and disjoint segments", () => {
  assert.equal(
    segmentsIntersect([0, 0], [2, 2], [0, 2], [2, 0]),
    true,
    "ตัดกันกลางเส้น",
  );
  assert.equal(segmentsIntersect([0, 0], [2, 0], [1, 0], [1, 2]), true, "แตะที่ปลาย = ถือว่าตัด");
  assert.equal(segmentsIntersect([0, 0], [1, 1], [2, 2], [3, 3]), false, "ขนานคนละช่วง");
  assert.equal(segmentsIntersect([0, 0], [1, 0], [0, 1], [1, 1]), false, "ขนานไม่ตัดกัน");
});

test("a route that stays on one side is domestic", () => {
  const route: LngLat[] = [
    [99.0, 15.0],
    [99.5, 15.5],
    [99.9, 16.0],
  ];
  assert.equal(findBorderCrossing(route, fake), null);
});

test("a route that steps over the border reports the country and the crossing point", () => {
  const route: LngLat[] = [
    [99.5, 15.0],
    [100.5, 15.0],
  ];
  const crossing = findBorderCrossing(route, fake);
  assert.ok(crossing, "ต้องตรวจพบการข้ามพรมแดน");
  assert.equal(crossing.country, "Testland");
  assert.equal(crossing.countryTh, "ประเทศทดสอบ");
});

test("a route that leaves and comes back is still blocked", () => {
  const route: LngLat[] = [
    [99.5, 15.0],
    [100.5, 15.2],
    [99.5, 15.4],
  ];
  assert.ok(findBorderCrossing(route, fake));
});

test("missing border data never blocks a route (map must keep working offline)", () => {
  assert.equal(findBorderCrossing([[99, 15], [101, 15]], null), null);
  const split = filterDomesticRoutes([{ coords: [[99, 15], [101, 15]] as LngLat[] }], null);
  assert.equal(split.domestic.length, 1);
  assert.equal(split.blocked.length, 0);
});

test("filterDomesticRoutes keeps order and separates the blocked ones", () => {
  const good1 = { id: "a", coords: [[99.0, 15], [99.4, 15]] as LngLat[] };
  const bad = { id: "b", coords: [[99.5, 15], [100.5, 15]] as LngLat[] };
  const good2 = { id: "c", coords: [[98.0, 15], [98.5, 15]] as LngLat[] };

  const split = filterDomesticRoutes([good1, bad, good2], fake);
  assert.deepEqual(
    split.domestic.map((r) => r.id),
    ["a", "c"],
  );
  assert.equal(split.blocked.length, 1);
  assert.equal(split.blocked[0].route.id, "b");
});

test("the blocked message lists each country once", () => {
  const message = borderBlockedMessage([
    { country: "Myanmar", countryTh: "เมียนมา", at: [99, 20] },
    { country: "Myanmar", countryTh: "เมียนมา", at: [99, 20] },
    { country: "Laos", countryTh: "ลาว", at: [100, 20] },
  ]);
  assert.match(message, /เมียนมา \/ ลาว/);
  assert.equal(message.match(/เมียนมา/g)?.length, 1);
});

// ข้อมูลจริง: แม่สาย (เชียงราย) อยู่ติดพรมแดนเมียนมา — เส้นทางที่ลัดเข้าฝั่งท่าขี้เหล็กต้องถูกจับได้
test("a real route hopping into Myanmar near Mae Sai is detected", () => {
  const route: LngLat[] = [
    [99.88, 20.27], // ฝั่งไทย (แม่สาย)
    [99.87, 20.46], // ข้ามเข้าฝั่งเมียนมา
    [99.9, 20.3], // กลับเข้าไทย
  ];
  const crossing = findBorderCrossing(route, real);
  assert.ok(crossing, "ต้องตรวจพบว่าตัดผ่านแนวชายแดนจริง");
  assert.equal(crossing.country, "Myanmar");
});

test("a real route inside Thailand (เชียงราย → บ้านพญาไพร ฝั่งไทย) is not blocked", () => {
  const route: LngLat[] = [
    [99.8325, 19.9105], // ศาลากลางจังหวัดเชียงราย
    [99.83, 20.1],
    [99.7, 20.28],
    [99.61901, 20.32147], // บ้านพญาไพร
  ];
  assert.equal(findBorderCrossing(route, real), null);
});

test("scanning a long route against the real border data stays fast", () => {
  // เส้นทางสังเคราะห์ 5,000 จุดในไทย — ดัชนีเชิงพื้นที่ต้องทำให้จบเร็ว ไม่ใช่ไล่ทุกคู่หมื่นกว่าส่วน
  const route: LngLat[] = Array.from({ length: 5000 }, (_, i) => [99.8 + i * 0.00004, 19.9 + i * 0.00008]);
  const started = process.hrtime.bigint();
  findBorderCrossing(route, real);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < 500, `ตรวจเส้นทางยาวใช้เวลานานเกินไป: ${elapsedMs.toFixed(0)} ms`);
});
