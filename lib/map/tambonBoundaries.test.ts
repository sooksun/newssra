import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { findTambonAt, parseTambonIndex, parseTambonProvince, provincesForPoint } from "./tambonBoundaries";

/** วงสี่เหลี่ยมปิด [lng,lat] รอบจุด */
function square(lat: number, lng: number, size: number) {
  return [
    [lng - size, lat - size],
    [lng + size, lat - size],
    [lng + size, lat + size],
    [lng - size, lat + size],
    [lng - size, lat - size],
  ];
}

const DOC = {
  attribution: "ทดสอบ",
  province: "แม่ฮ่องสอน",
  provinceCode: "TH58",
  tambons: [
    { name: "จองคำ", amphoe: "เมืองแม่ฮ่องสอน", code: "TH580101", rings: [square(19.3, 97.97, 0.01)] },
    { name: "ปางหมู", amphoe: "เมืองแม่ฮ่องสอน", code: "TH580102", rings: [square(19.34, 97.97, 0.01)] },
  ],
};

test("parseTambonProvince อ่านไฟล์จังหวัดที่ถูกต้อง", () => {
  const doc = parseTambonProvince(DOC);
  assert.ok(doc);
  assert.equal(doc.province, "แม่ฮ่องสอน");
  assert.equal(doc.provinceCode, "TH58");
  assert.equal(doc.tambons.length, 2);
  assert.equal(doc.tambons[0].amphoe, "เมืองแม่ฮ่องสอน");
});

test("parseTambonProvince ทิ้งพิกัดที่ใช้ไม่ได้ และวงที่สั้นเกินกว่าจะวาด", () => {
  const doc = parseTambonProvince({
    ...DOC,
    tambons: [
      { name: "ดี", rings: [square(19.3, 97.97, 0.01)] },
      {
        name: "วงสั้น",
        rings: [
          [
            [97.9, 19.3],
            [97.91, 19.3],
          ],
        ],
      },
      {
        name: "พิกัดพัง",
        rings: [
          [
            [97.9, 19.3],
            [Number.NaN, 19.3],
            [999, 19.3],
            [97.92, 19.31],
          ],
        ],
      },
      { name: "", rings: [square(19.3, 97.97, 0.01)] },
    ],
  });
  assert.deepEqual(
    doc?.tambons.map((t) => t.name),
    ["ดี"],
  );
});

test("parseTambonProvince กับไฟล์พัง → null (ผู้เรียกแสดงข้อผิดพลาดเอง)", () => {
  assert.equal(parseTambonProvince(null), null);
  assert.equal(parseTambonProvince({}), null);
  assert.equal(parseTambonProvince({ province: "ก", provinceCode: "TH01", tambons: [] }), null);
});

test("findTambonAt คืนตำบลที่จุดนั้นอยู่ข้างใน", () => {
  const doc = parseTambonProvince(DOC);
  assert.equal(findTambonAt(doc!.tambons, 19.3, 97.97)?.name, "จองคำ");
  assert.equal(findTambonAt(doc!.tambons, 19.34, 97.97)?.name, "ปางหมู");
});

test("findTambonAt คืน null เมื่อจุดอยู่นอกทุกตำบล — ไม่เดาตำบลที่ใกล้ที่สุด", () => {
  const doc = parseTambonProvince(DOC);
  assert.equal(findTambonAt(doc!.tambons, 19.9, 98.5), null);
  assert.equal(findTambonAt(doc!.tambons, Number.NaN, 97.97), null);
});

test("parseTambonIndex ทิ้งรายการที่ bbox ใช้ไม่ได้", () => {
  const index = parseTambonIndex({
    provinces: [
      { code: "TH58", name: "แม่ฮ่องสอน", tambonCount: 45, bbox: { north: 19.8, south: 17.9, west: 97.3, east: 98.7 } },
      { code: "BAD", name: "พัง", bbox: { north: "x", south: 1, west: 2, east: 3 } },
      { name: "ไม่มีรหัส", bbox: { north: 1, south: 0, west: 0, east: 1 } },
    ],
  });
  assert.deepEqual(
    index.map((p) => p.code),
    ["TH58"],
  );
  assert.equal(index[0].tambonCount, 45);
});

test("provincesForPoint เลือกจังหวัดจาก bbox — จุดใกล้รอยต่อได้มากกว่าหนึ่งจังหวัด", () => {
  const index = parseTambonIndex({
    provinces: [
      { code: "TH58", name: "แม่ฮ่องสอน", tambonCount: 1, bbox: { north: 19.8, south: 17.9, west: 97.3, east: 98.7 } },
      { code: "TH50", name: "เชียงใหม่", tambonCount: 1, bbox: { north: 20.1, south: 17.4, west: 98.0, east: 99.5 } },
      { code: "TH90", name: "สงขลา", tambonCount: 1, bbox: { north: 7.9, south: 6.3, west: 100.0, east: 101.2 } },
    ],
  });
  assert.deepEqual(
    provincesForPoint(index, 19.3, 97.97, 0).map((p) => p.code),
    ["TH58"],
  );
  assert.deepEqual(
    provincesForPoint(index, 19.3, 98.3, 0).map((p) => p.code),
    ["TH58", "TH50"],
  );
  assert.deepEqual(provincesForPoint(index, 19.3, 97.97, 0).length, 1);
  assert.deepEqual(provincesForPoint(index, Number.NaN, 97.97), []);
});

// ── ตรวจไฟล์จริงที่สคริปต์นำเข้าสร้างไว้ ─────────────────────────────────────
test("ไฟล์ public/geo/tambon ที่ commit ไว้ ใช้งานได้จริง", () => {
  const index = parseTambonIndex(JSON.parse(readFileSync("public/geo/tambon/index.json", "utf8")));
  assert.equal(index.length, 77, "ต้องมีครบ 77 จังหวัด");
  assert.equal(
    index.reduce((sum, p) => sum + p.tambonCount, 0),
    7425,
    "จำนวนตำบลรวมต้องตรงกับชุดข้อมูล COD-AB",
  );

  // เคสต้นเรื่อง: ที่ตั้งเทศบาลเมืองแม่ฮ่องสอน (19.30104, 97.96976) ต้องระบุตำบลได้
  const hit = provincesForPoint(index, 19.30104, 97.96976);
  assert.ok(hit.length >= 1, "ต้องเลือกไฟล์จังหวัดสำหรับพิกัดแม่ฮ่องสอนได้");

  const doc = parseTambonProvince(JSON.parse(readFileSync(`public/geo/tambon/${hit[0].code}.json`, "utf8")));
  assert.ok(doc, "ไฟล์จังหวัดต้องอ่านได้");
  const tambon = hit
    .map((p) => parseTambonProvince(JSON.parse(readFileSync(`public/geo/tambon/${p.code}.json`, "utf8"))))
    .flatMap((d) => (d ? [findTambonAt(d.tambons, 19.30104, 97.96976)] : []))
    .find((t) => t !== null);
  assert.ok(tambon, "ต้องระบุตำบลของที่ตั้งเทศบาลเมืองแม่ฮ่องสอนได้");
  assert.equal(tambon?.amphoe, "เมืองแม่ฮ่องสอน");
});
