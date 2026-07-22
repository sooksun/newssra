import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseSharedBorders } from "./borders";

test("parseSharedBorders drops malformed entries and orders neighbors", () => {
  const doc = parseSharedBorders({
    attribution: "© OpenStreetMap contributors",
    borders: [
      { name: "Malaysia", nameTh: "มาเลเซีย", label: [101, 6], chains: [[[100, 6], [101, 6]]] },
      { name: "Myanmar", nameTh: "เมียนมา", label: [98, 16], chains: [[[98, 16], [99, 17]]] },
      // ตกไปทั้งหมด: ไม่มีชื่อ / label เพี้ยน / เส้นสั้นเกินไป / ไม่มีเส้นเลย
      { name: "", nameTh: "ไร้ชื่อ", label: [100, 15], chains: [[[100, 15], [101, 15]]] },
      { name: "Nowhere", nameTh: "ไม่มีจริง", label: [999, 15], chains: [[[100, 15], [101, 15]]] },
      { name: "TooShort", nameTh: "สั้นไป", label: [100, 15], chains: [[[100, 15]]] },
      { name: "NoChains", nameTh: "ไม่มีเส้น", label: [100, 15], chains: [] },
    ],
  });

  assert.equal(doc.attribution, "© OpenStreetMap contributors");
  assert.deepEqual(
    doc.borders.map((border) => border.name),
    ["Myanmar", "Malaysia"],
  );
  assert.equal(doc.borders[0].pointCount, 2);
});

test("parseSharedBorders tolerates a missing or broken document", () => {
  assert.deepEqual(parseSharedBorders(null), { attribution: "", borders: [] });
  assert.deepEqual(parseSharedBorders({ borders: "nope" }), { attribution: "", borders: [] });
});

test("bundled border data covers Thailand's four land neighbors at map-usable precision", () => {
  const doc = parseSharedBorders(
    JSON.parse(readFileSync(join(process.cwd(), "public/geo/sea-borders.json"), "utf8")),
  );

  assert.deepEqual(
    doc.borders.map((border) => border.name),
    ["Myanmar", "Laos", "Cambodia", "Malaysia"],
  );
  assert.match(doc.attribution, /OpenStreetMap/);

  // ต้องเป็นเส้นต่อเนื่องเส้นเดียวต่อประเทศ — ถ้าแตกเป็นหลายเส้นแปลว่าการต่อ way พลาด
  // หรือมีเขตแดนทางทะเลหลุดเข้ามา (เคยเป็นบั๊ก: มาเลเซียเริ่มกลางทะเลใกล้ลังกาวี)
  for (const border of doc.borders) {
    assert.equal(border.chains.length, 1, `${border.name} ควรมีเส้นเดียว`);
  }

  // ชายแดนแต่ละด้านต้องยาวใกล้ตัวเลขทางการ (กม.) — กันข้อมูลขาดหายหรือปนส่วนที่ไม่ใช่ชายแดน
  const expectedKm: Record<string, number> = {
    Myanmar: 2429,
    Laos: 1854,
    Cambodia: 815,
    Malaysia: 618,
  };
  for (const border of doc.borders) {
    const km = chainLengthKm(border.chains[0]);
    const expected = expectedKm[border.name];
    assert.ok(
      Math.abs(km - expected) / expected < 0.05,
      `${border.name}: ยาว ${km.toFixed(0)} กม. ต่างจากที่คาด ${expected} กม. เกิน 5%`,
    );
  }

  // ความละเอียดต้องพอสำหรับการซูมระดับวงรัศมี 500 ม. ของแอป
  // (ชุดข้อมูลเดิม Natural Earth 1:10m มี median ~2,000 ม. ซึ่งใช้ไม่ได้)
  for (const border of doc.borders) {
    const gaps = border.chains
      .flatMap((chain) => chain.slice(1).map((point, i) => haversineKm(chain[i], point) * 1000))
      .sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    assert.ok(median < 700, `${border.name}: ระยะห่างจุดต่อจุด median ${median.toFixed(0)} ม. หยาบเกินไป`);
  }

  // จุดสามแดนต้องบรรจบกันพอดี: ไทย–เมียนมา–ลาว และ ไทย–ลาว–กัมพูชา
  const byName = Object.fromEntries(doc.borders.map((b) => [b.name, b.chains[0]]));
  const ends = (chain: [number, number][]) => [chain[0], chain[chain.length - 1]];
  const meets = (a: [number, number][], b: [number, number][]) =>
    ends(a).some((pa) => ends(b).some((pb) => haversineKm(pa, pb) < 0.1));
  assert.ok(meets(byName.Myanmar, byName.Laos), "ชายแดนเมียนมากับลาวควรบรรจบที่สามเหลี่ยมทองคำ");
  assert.ok(meets(byName.Laos, byName.Cambodia), "ชายแดนลาวกับกัมพูชาควรบรรจบที่ช่องบก");
});

function haversineKm(a: [number, number], b: [number, number]): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
}

function chainLengthKm(chain: [number, number][]): number {
  let total = 0;
  for (let i = 0; i < chain.length - 1; i += 1) total += haversineKm(chain[i], chain[i + 1]);
  return total;
}
