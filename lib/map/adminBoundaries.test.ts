import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_FETCH_RADIUS_M,
  boundingBox,
  classifyAdminKind,
  overpassQuery,
  parseOverpassAdminBoundaries,
} from "./adminBoundaries";

/** ย่อการเขียน fixture: วงสี่เหลี่ยมปิด 5 จุด รอบ (lat,lng) */
function squareGeometry(lat: number, lng: number, size = 0.01) {
  return [
    { lat: lat - size, lon: lng - size },
    { lat: lat - size, lon: lng + size },
    { lat: lat + size, lon: lng + size },
    { lat: lat + size, lon: lng - size },
    { lat: lat - size, lon: lng - size },
  ];
}

function relation(name: string, geometry: { lat: number; lon: number }[], role = "outer") {
  return {
    type: "relation",
    id: 1,
    tags: { name, boundary: "administrative", admin_level: "7" },
    members: [{ type: "way", ref: 11, role, geometry }],
  };
}

test("classifyAdminKind จำแนกครบ 4 ประเภทจากคำนำหน้าชื่อไทย", () => {
  assert.equal(classifyAdminKind("เทศบาลนครเชียงราย"), "nakhon");
  assert.equal(classifyAdminKind("เทศบาลเมืองแม่สาย"), "mueang");
  assert.equal(classifyAdminKind("เทศบาลตำบลเวียงพางคำ"), "tambon");
  assert.equal(classifyAdminKind("กรุงเทพมหานคร"), "special");
  assert.equal(classifyAdminKind("เมืองพัทยา"), "special");
  assert.equal(classifyAdminKind("  เทศบาลตำบลแม่จัน  "), "tambon", "ต้องตัดช่องว่างหัวท้ายก่อนเทียบ");
});

test("classifyAdminKind: ชื่อที่ไม่เข้าเค้า → null (ห้ามเดาประเภท)", () => {
  assert.equal(classifyAdminKind("องค์การบริหารส่วนตำบลโป่งงาม"), null);
  assert.equal(classifyAdminKind("อำเภอแม่สาย"), null);
  assert.equal(classifyAdminKind(""), null);
  assert.equal(classifyAdminKind(undefined), null);
  assert.equal(classifyAdminKind(42), null);
});

test("parseOverpassAdminBoundaries แปลงผล out geom เป็นวงที่วาดได้ พร้อมชื่อและประเภท", () => {
  const parsed = parseOverpassAdminBoundaries({
    elements: [relation("เทศบาลตำบลเวียงพางคำ", squareGeometry(20.4, 99.88))],
  });

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "เทศบาลตำบลเวียงพางคำ");
  assert.equal(parsed[0].kind, "tambon");
  assert.equal(parsed[0].rings.length, 1);
  assert.equal(parsed[0].rings[0].length, 5);
  // เก็บเป็น [lng,lat] ให้ตรงกับที่ Cesium ใช้ (เทียบแบบมีค่าคลาดเคลื่อน เพราะเป็นเลขทศนิยมฐานสอง)
  const [lng0, lat0] = parsed[0].rings[0][0];
  assert.ok(Math.abs(lng0 - 99.87) < 1e-9, `lng แรกควรเป็น 99.87 ได้ ${lng0}`);
  assert.ok(Math.abs(lat0 - 20.39) < 1e-9, `lat แรกควรเป็น 20.39 ได้ ${lat0}`);
  assert.ok(Math.abs(parsed[0].labelLat - 20.4) < 1e-9);
  assert.ok(Math.abs(parsed[0].labelLng - 99.88) < 1e-9);
});

test("ทิ้งรายการที่จำแนกประเภทไม่ได้ และรายการที่ไม่มีชื่อ", () => {
  const parsed = parseOverpassAdminBoundaries({
    elements: [
      relation("เทศบาลเมืองแม่สาย", squareGeometry(20.43, 99.88)),
      relation("อำเภอแม่สาย", squareGeometry(20.44, 99.89)),
      {
        type: "relation",
        id: 3,
        tags: {},
        members: [{ type: "way", role: "outer", geometry: squareGeometry(20, 99) }],
      },
    ],
  });
  assert.deepEqual(
    parsed.map((b) => b.name),
    ["เทศบาลเมืองแม่สาย"],
  );
});

test("ตัดพิกัดที่ไม่ใช่ตัวเลขจำกัด/นอกช่วง — วงที่เหลือน้อยกว่า 4 จุดถูกทิ้ง", () => {
  const dirty = [
    { lat: 20.4, lon: 99.87 },
    { lat: Number.NaN, lon: 99.88 },
    { lat: 20.41, lon: 999 },
    { lat: 20.42, lon: 99.89 },
  ];
  const parsed = parseOverpassAdminBoundaries({
    elements: [relation("เทศบาลตำบลแม่จัน", dirty)],
  });
  // เหลือ 2 จุดที่ใช้ได้ → ต่ำกว่าขั้นต่ำ 4 จุด → ทิ้งทั้งวง → ทั้งรายการไม่เหลือวง → ถูกตัดออก
  assert.deepEqual(parsed, []);
});

test("ใช้เฉพาะ member role=outer — วงในของเขตแบบโดนัทไม่ถูกวาด", () => {
  const parsed = parseOverpassAdminBoundaries({
    elements: [
      {
        type: "relation",
        id: 7,
        tags: { name: "เทศบาลนครเชียงราย" },
        members: [
          { type: "way", role: "outer", geometry: squareGeometry(19.9, 99.83, 0.02) },
          { type: "way", role: "inner", geometry: squareGeometry(19.9, 99.83, 0.005) },
          { type: "node", role: "admin_centre", geometry: squareGeometry(19.9, 99.83) },
        ],
      },
    ],
  });
  assert.equal(parsed[0].rings.length, 1, "ต้องได้เฉพาะวงนอก 1 วง");
});

test("ป้ายชื่อวางที่ centroid ของวงที่ใหญ่ที่สุด (ไม่ใช่วงแรกที่เจอ)", () => {
  const parsed = parseOverpassAdminBoundaries({
    elements: [
      {
        type: "relation",
        id: 9,
        tags: { name: "เทศบาลตำบลเกาะเล็ก" },
        members: [
          { type: "way", role: "outer", geometry: squareGeometry(19.0, 99.0, 0.002) }, // วงเล็ก มาก่อน
          { type: "way", role: "outer", geometry: squareGeometry(20.0, 100.0, 0.05) }, // วงใหญ่
        ],
      },
    ],
  });
  assert.ok(Math.abs(parsed[0].labelLat - 20.0) < 1e-9, "ป้ายต้องอยู่ที่วงใหญ่");
  assert.ok(Math.abs(parsed[0].labelLng - 100.0) < 1e-9);
});

test("centroid ไม่ถูกจุดปิดวงที่ซ้ำจุดแรกถ่วงน้ำหนัก", () => {
  // วงสี่เหลี่ยมปิด (จุดแรกซ้ำท้ายวงตามแบบ OSM) — centroid ต้องเป็นกลางรูปพอดี
  const parsed = parseOverpassAdminBoundaries({
    elements: [relation("เทศบาลนครเชียงราย", squareGeometry(19.9, 99.83, 0.05))],
  });
  assert.ok(Math.abs(parsed[0].labelLat - 19.9) < 1e-9, `ควรได้ 19.9 ได้ ${parsed[0].labelLat}`);
  assert.ok(Math.abs(parsed[0].labelLng - 99.83) < 1e-9, `ควรได้ 99.83 ได้ ${parsed[0].labelLng}`);
  // วงที่วาดยังต้องปิดครบ 5 จุดเหมือนเดิม (ตัดจุดซ้ำเฉพาะตอนคิด centroid)
  assert.equal(parsed[0].rings[0].length, 5);
});

// หมายเหตุ: ผลว่าง = "OSM ไม่มีข้อมูลขอบเขตแถวนี้" เท่านั้น ห้ามตีความว่าเป็นเขต อบต.
// (วัดจริงพบว่าเทศบาลเมืองหลายแห่ง เช่น แม่ฮ่องสอน/น่าน/ลำพูน มีแค่ node ไม่มีขอบเขตใน OSM)
test("ผลลัพธ์ว่าง/รูปแบบผิด → [] ไม่ throw", () => {
  assert.deepEqual(parseOverpassAdminBoundaries({ elements: [] }), []);
  assert.deepEqual(parseOverpassAdminBoundaries({}), []);
  assert.deepEqual(parseOverpassAdminBoundaries(null), []);
  assert.deepEqual(parseOverpassAdminBoundaries("ไม่ใช่ JSON ที่คาดไว้"), []);
});

test("boundingBox ครอบรัศมีที่ขอจริงทั้งสี่ด้าน", () => {
  const [south, west, north, east] = boundingBox(20, 99.9, ADMIN_FETCH_RADIUS_M);
  assert.ok(north > 20 && south < 20 && east > 99.9 && west < 99.9);
  // 15 กม. ตามแนวเหนือ-ใต้ ≈ 0.1357°
  assert.ok(Math.abs(north - 20 - 0.1357) < 0.005);
  // แนวตะวันออก-ตะวันตกต้องกว้างกว่าแนวเหนือ-ใต้ตามการหดของลองจิจูดที่ละติจูด 20°
  assert.ok(east - 99.9 > north - 20);
});

test("overpassQuery คัดด้วยชื่อขึ้นต้น 'เทศบาล' ไม่ใช่ admin_level (OSM ไทยแท็กระดับไม่สม่ำเสมอ)", () => {
  const query = overpassQuery(20, 99.9, ADMIN_FETCH_RADIUS_M);
  assert.match(query, /\[out:json\]/);
  assert.match(query, /relation\["boundary"="administrative"\]\["name"~"\^เทศบาล"\]/);
  assert.match(query, /out geom;$/);
  // ล็อก admin_level เมื่อไหร่จะพลาดของที่มีจริง เช่น "เทศบาลตำบลแม่จัน" ที่ถูกแท็กเป็น level 6
  assert.doesNotMatch(query, /admin_level/);
});

// ── หมุดเทศบาลที่ OSM ยังไม่มีขอบเขต ─────────────────────────────────────────
// วัดจริง 2026-08-05: node 301515447 = เทศบาลเมืองแม่ฮ่องสอน มี name="แม่ฮ่องสอน"
// (ชื่อสั้น จำแนกไม่ได้) แต่ official_name="เทศบาลเมืองแม่ฮ่องสอน" — ต้องอ่าน official_name ก่อน
function municipalityNode(id: number, lat: number, lon: number, tags: Record<string, string>) {
  return { type: "node", id, lat, lon, tags };
}

test("อ่าน official_name ก่อน name — หมุดเทศบาลที่ชื่อสั้นต้องจำแนกประเภทได้", () => {
  const parsed = parseOverpassAdminBoundaries({
    elements: [
      municipalityNode(301515447, 19.3011, 97.9685, {
        name: "แม่ฮ่องสอน",
        official_name: "เทศบาลเมืองแม่ฮ่องสอน",
        place: "town",
        admin_level: "7",
      }),
    ],
  });

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "เทศบาลเมืองแม่ฮ่องสอน", "ต้องแสดงชื่อเต็ม ไม่ใช่ชื่อสั้น");
  assert.equal(parsed[0].kind, "mueang");
  assert.equal(parsed[0].pointOnly, true);
  assert.deepEqual(parsed[0].rings, [], "ไม่มีขอบเขต ต้องไม่กุวงกลมสมมติขึ้นมา");
  assert.equal(parsed[0].labelLat, 19.3011);
  assert.equal(parsed[0].labelLng, 97.9685);
});

test("relation ที่มีขอบเขตยังต้อง pointOnly = false", () => {
  const parsed = parseOverpassAdminBoundaries({
    elements: [relation("เทศบาลนครเชียงราย", squareGeometry(19.9, 99.83))],
  });
  assert.equal(parsed[0].pointOnly, false);
  assert.equal(parsed[0].rings.length, 1);
});

test("เทศบาลเดียวกันมีทั้ง relation และ node → ขอบเขตชนะ ไม่ขึ้นป้ายซ้ำ", () => {
  const parsed = parseOverpassAdminBoundaries({
    elements: [
      municipalityNode(1, 19.9, 99.83, { official_name: "เทศบาลนครเชียงราย", place: "city" }),
      relation("เทศบาลนครเชียงราย", squareGeometry(19.9, 99.83)),
    ],
  });
  assert.equal(parsed.length, 1, "ต้องเหลือรายการเดียว");
  assert.equal(parsed[0].pointOnly, false, "ตัวที่มีขอบเขตต้องชนะหมุด");
});

test("หมุดที่พิกัดใช้ไม่ได้ → ถูกทิ้ง", () => {
  const parsed = parseOverpassAdminBoundaries({
    elements: [
      municipalityNode(2, Number.NaN, 99.9, { official_name: "เทศบาลตำบลผี", place: "municipality" }),
      municipalityNode(3, 91, 99.9, { official_name: "เทศบาลตำบลนอกโลก", place: "municipality" }),
    ],
  });
  assert.deepEqual(parsed, []);
});

test("หมุดสถานที่ทั่วไปที่ไม่ใช่เทศบาล → ถูกทิ้ง", () => {
  const parsed = parseOverpassAdminBoundaries({
    elements: [municipalityNode(4, 19.9, 99.83, { name: "แม่ฮ่องสอน", place: "town" })],
  });
  assert.deepEqual(parsed, [], "ชื่อสั้นที่ไม่มี official_name จำแนกไม่ได้ ต้องไม่เดา");
});

test("overpassQuery ถามทั้ง relation และ node และทั้ง name/official_name", () => {
  const query = overpassQuery(20, 99.9, ADMIN_FETCH_RADIUS_M);
  assert.match(query, /relation\["boundary"="administrative"\]\["name"~"\^เทศบาล"\]/);
  assert.match(query, /relation\["boundary"="administrative"\]\["official_name"~"\^เทศบาล"\]/);
  assert.match(query, /node\["place"\]\["name"~"\^เทศบาล"\]/);
  assert.match(query, /node\["place"\]\["official_name"~"\^เทศบาล"\]/);
});
