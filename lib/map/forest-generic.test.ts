import assert from "node:assert/strict";
import test from "node:test";
import { overpassGenericForestQuery, parseOverpassGenericForest } from "./forest-generic";

test("query: ถามทั้ง natural=wood และ landuse=forest ทั้ง way และ relation ในรัศมีที่ขอ", () => {
  const q = overpassGenericForestQuery(20.28, 99.72, 10_000);
  assert.match(q, /way\["natural"="wood"\]\(around:10000,20\.28,99\.72\);/);
  assert.match(q, /way\["landuse"="forest"\]\(around:10000,20\.28,99\.72\);/);
  assert.match(q, /relation\["natural"="wood"\]\(around:10000,20\.28,99\.72\);/);
  assert.match(q, /relation\["landuse"="forest"\]\(around:10000,20\.28,99\.72\);/);
  assert.match(q, /out geom;/);
});

test("parse: way ที่มี geometry → 1 วง และแปลงเป็น [lng, lat]", () => {
  const out = parseOverpassGenericForest({
    elements: [
      {
        type: "way",
        geometry: [
          { lat: 20.0, lon: 99.0 },
          { lat: 20.0, lon: 99.1 },
          { lat: 20.1, lon: 99.1 },
          { lat: 20.1, lon: 99.0 },
        ],
      },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].rings.length, 1);
  assert.deepEqual(out[0].rings[0][0], [99.0, 20.0]);
});

test("parse: relation หลาย member → หลายวง", () => {
  const ring = (offset: number) => [
    { lat: 20.0 + offset, lon: 99.0 },
    { lat: 20.0 + offset, lon: 99.1 },
    { lat: 20.1 + offset, lon: 99.1 },
    { lat: 20.1 + offset, lon: 99.0 },
  ];
  const out = parseOverpassGenericForest({
    elements: [
      {
        type: "relation",
        members: [
          { type: "way", role: "outer", geometry: ring(0) },
          { type: "way", role: "outer", geometry: ring(1) },
        ],
      },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].rings.length, 2);
});

test("parse: member role inner ถูกตัด (รูในผืนป่า OSM ระบุไว้ชัด จึงไม่ถม)", () => {
  const ring = [
    { lat: 20.0, lon: 99.0 },
    { lat: 20.0, lon: 99.1 },
    { lat: 20.1, lon: 99.1 },
    { lat: 20.1, lon: 99.0 },
  ];
  const out = parseOverpassGenericForest({
    elements: [
      {
        type: "relation",
        members: [
          { type: "way", role: "outer", geometry: ring },
          { type: "way", role: "inner", geometry: ring },
        ],
      },
    ],
  });
  assert.equal(out[0].rings.length, 1);
});

test("parse: element ที่ไม่มี geometry หรือมีน้อยกว่า 4 จุด ถูกตัด", () => {
  const out = parseOverpassGenericForest({
    elements: [
      { type: "way" },
      {
        type: "way",
        geometry: [
          { lat: 20, lon: 99 },
          { lat: 20, lon: 99.1 },
        ],
      },
      { type: "node", lat: 20, lon: 99 },
    ],
  });
  assert.deepEqual(out, []);
});

test("parse: อินพุตพัง → ว่าง ไม่ throw", () => {
  assert.deepEqual(parseOverpassGenericForest(null), []);
  assert.deepEqual(parseOverpassGenericForest({}), []);
  assert.deepEqual(parseOverpassGenericForest({ elements: "nope" }), []);
});
