import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { laoFullName, LAO_KIND_LABELS, officesNear, parseLaoOffices } from "./laoOffices";

const OFFICE = {
  code: "5801",
  kind: "mueang",
  name: "แม่ฮ่องสอน",
  province: "แม่ฮ่องสอน",
  amphoe: "เมืองแม่ฮ่องสอน",
  areaKm2: 6,
  lat: 19.30104,
  lng: 97.96976,
};

test("parseLaoOffices รับเฉพาะแถวที่ประเภทและพิกัดใช้ได้", () => {
  const doc = parseLaoOffices({
    attribution: "ทดสอบ",
    registeredCount: 9,
    offices: [
      OFFICE,
      { ...OFFICE, code: "x1", kind: "อบจ." }, // ประเภทนอกรายการ
      { ...OFFICE, code: "x2", lat: 999 }, // พิกัดนอกช่วง
      { ...OFFICE, code: "x3", lat: null }, // ไม่มีพิกัด
      { ...OFFICE, code: "x4", name: "" }, // ไม่มีชื่อ
    ],
  });
  assert.equal(doc.offices.length, 1);
  assert.equal(doc.offices[0].code, "5801");
  assert.equal(doc.registeredCount, 9, "ต้องเก็บจำนวนในทะเบียนไว้ ไม่ใช่จำนวนที่วางหมุดได้");
  assert.equal(doc.attribution, "ทดสอบ");
});

test("parseLaoOffices กับข้อมูลพัง → offices ว่าง ไม่ throw", () => {
  assert.deepEqual(parseLaoOffices(null).offices, []);
  assert.deepEqual(parseLaoOffices({}).offices, []);
  assert.deepEqual(parseLaoOffices({ offices: "ไม่ใช่อาร์เรย์" }).offices, []);
});

test("areaKm2 ที่ทะเบียนไม่ระบุ ต้องเป็น null ไม่ใช่ 0", () => {
  const doc = parseLaoOffices({ offices: [{ ...OFFICE, areaKm2: "" }] });
  assert.equal(doc.offices[0].areaKm2, null);
});

test("officesNear คัดตามรัศมีและเรียงจากใกล้ไปไกล", () => {
  const offices = [
    { ...OFFICE, code: "far", name: "ไกล", lat: 19.5, lng: 97.96976 },
    { ...OFFICE, code: "near", name: "ใกล้", lat: 19.302, lng: 97.96976 },
    { ...OFFICE, code: "mid", name: "กลาง", lat: 19.34, lng: 97.96976 },
  ];
  const near = officesNear(parseLaoOffices({ offices }).offices, 19.30104, 97.96976, 10_000);
  assert.deepEqual(
    near.map((o) => o.code),
    ["near", "mid"],
    "แห่งที่อยู่ไกลเกินรัศมีต้องไม่ติดมา",
  );
  assert.ok(near[0].distanceM < near[1].distanceM);
});

test("officesNear กับพิกัด/รัศมีที่ใช้ไม่ได้ → []", () => {
  const offices = parseLaoOffices({ offices: [OFFICE] }).offices;
  assert.deepEqual(officesNear(offices, Number.NaN, 97.9, 5000), []);
  assert.deepEqual(officesNear(offices, 19.3, 97.9, 0), []);
});

test("laoFullName ประกอบชื่อแบบที่ราชการเรียก", () => {
  assert.equal(laoFullName({ kind: "mueang", name: "แม่ฮ่องสอน" }), "เทศบาลเมืองแม่ฮ่องสอน");
  assert.equal(laoFullName({ kind: "nakhon", name: "เชียงราย" }), "เทศบาลนครเชียงราย");
  assert.equal(laoFullName({ kind: "thesaban_tambon", name: "เวียงพางคำ" }), "เทศบาลตำบลเวียงพางคำ");
  assert.equal(laoFullName({ kind: "sao", name: "ปางหมู" }), "อบต.ปางหมู");
});

// ── ตรวจไฟล์จริงที่สคริปต์นำเข้าสร้างไว้ ─────────────────────────────────────
// จุดประสงค์: จับกรณีไฟล์หาย/รูปแบบเพี้ยนตั้งแต่ตอนรันเทสต์ ไม่ใช่ตอนผู้ใช้เปิดแผนที่
test("ไฟล์ public/geo/lao-offices.json ที่ commit ไว้ ใช้งานได้จริง", () => {
  const doc = parseLaoOffices(JSON.parse(readFileSync("public/geo/lao-offices.json", "utf8")));
  assert.ok(doc.offices.length > 4000, `ควรมี อปท. เกิน 4,000 แห่ง ได้ ${doc.offices.length}`);
  assert.ok(doc.registeredCount >= doc.offices.length);
  assert.match(doc.attribution, /กรมส่งเสริมการปกครองท้องถิ่น/);

  // ต้องมีครบทุกประเภทที่ประกาศไว้ (ยกเว้นรูปแบบพิเศษที่มีแห่งเดียว)
  const kinds = new Set(doc.offices.map((o) => o.kind));
  for (const kind of Object.keys(LAO_KIND_LABELS)) {
    assert.ok(kinds.has(kind as never), `ไม่พบประเภท ${kind} ในไฟล์`);
  }

  // เคสที่เป็นต้นเรื่องของฟีเจอร์นี้: เทศบาลเมืองแม่ฮ่องสอนต้องอยู่ในทะเบียน
  const mhs = doc.offices.find((o) => o.province === "แม่ฮ่องสอน" && o.kind === "mueang");
  assert.ok(mhs, "ต้องพบเทศบาลเมืองในจังหวัดแม่ฮ่องสอน");
  assert.equal(laoFullName(mhs), "เทศบาลเมืองแม่ฮ่องสอน");
});
