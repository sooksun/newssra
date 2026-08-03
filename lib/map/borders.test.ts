import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { borderLabelPoints, parseSharedBorders } from "./borders";

test("parseSharedBorders drops malformed entries and orders neighbors", () => {
  const doc = parseSharedBorders({
    attribution: "© OpenStreetMap contributors",
    borders: [
      {
        name: "Malaysia",
        nameTh: "มาเลเซีย",
        label: [101, 6],
        chains: [
          [
            [100, 6],
            [101, 6],
          ],
        ],
      },
      {
        name: "Myanmar",
        nameTh: "เมียนมา",
        label: [98, 16],
        chains: [
          [
            [98, 16],
            [99, 17],
          ],
        ],
      },
      // ตกไปทั้งหมด: ไม่มีชื่อ / label เพี้ยน / เส้นสั้นเกินไป / ไม่มีเส้นเลย
      {
        name: "",
        nameTh: "ไร้ชื่อ",
        label: [100, 15],
        chains: [
          [
            [100, 15],
            [101, 15],
          ],
        ],
      },
      {
        name: "Nowhere",
        nameTh: "ไม่มีจริง",
        label: [999, 15],
        chains: [
          [
            [100, 15],
            [101, 15],
          ],
        ],
      },
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
  const doc = parseSharedBorders(JSON.parse(readFileSync(join(process.cwd(), "public/geo/sea-borders.json"), "utf8")));

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
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
}

function chainLengthKm(chain: [number, number][]): number {
  let total = 0;
  for (let i = 0; i < chain.length - 1; i += 1) total += haversineKm(chain[i], chain[i + 1]);
  return total;
}

// ── borderLabelPoints: ตำแหน่งป้ายชื่อประเทศบนเส้นชายแดน ────────────────────────

/** ระยะจากจุดถึงเส้น (โพลีไลน์) เป็นเมตร — ใช้ยืนยันว่าป้าย "อยู่บนเส้นจริง" ไม่ใช่ลอยข้าง ๆ */
function distanceToChainM(point: [number, number], chain: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < chain.length; i++) {
    const [ax, ay] = chain[i];
    const [bx, by] = chain[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / len2));
    const proj: [number, number] = [ax + dx * t, ay + dy * t];
    best = Math.min(best, haversineKm(point, proj) * 1000);
  }
  return best;
}

test("borderLabelPoints: คืน 3 จุดที่ 25/50/75% ของความยาวเส้นตรง", () => {
  // เส้นตรงตามเส้นลองจิจูดคงที่ จุดถี่ไม่เท่ากันโดยตั้งใจ — ผลต้องอิงระยะทาง ไม่ใช่ดัชนีจุด
  const border = {
    name: "Test",
    nameTh: "ทดสอบ",
    label: [100, 10] as [number, number],
    chains: [
      [
        [100, 10],
        [100, 10.1],
        [100, 10.2],
        [100, 11],
      ] as [number, number][],
    ],
    pointCount: 4,
  };
  const pts = borderLabelPoints(border, 3);
  assert.equal(pts.length, 3);
  // ความยาวรวม 1 องศาละติจูด → 25/50/75% = lat 10.25 / 10.5 / 10.75
  assert.ok(Math.abs(pts[0][1] - 10.25) < 0.01, `จุดแรกควรอยู่ราว 10.25 ได้ ${pts[0][1]}`);
  assert.ok(Math.abs(pts[1][1] - 10.5) < 0.01, `จุดกลางควรอยู่ราว 10.5 ได้ ${pts[1][1]}`);
  assert.ok(Math.abs(pts[2][1] - 10.75) < 0.01, `จุดท้ายควรอยู่ราว 10.75 ได้ ${pts[2][1]}`);
  // ต้องไม่ไปตกที่ปลายเส้น (จุดสามเหลี่ยมพรมแดนที่ป้ายสองประเทศจะชนกัน)
  pts.forEach((p) => assert.ok(p[1] > 10 && p[1] < 11));
});

test("borderLabelPoints: count ไม่ถูกต้อง หรือเส้นยาวศูนย์ → คืน [] ให้ผู้เรียก fallback", () => {
  const flat = {
    name: "T",
    nameTh: "ท",
    label: [100, 10] as [number, number],
    chains: [
      [
        [100, 10],
        [100, 10],
      ] as [number, number][],
    ],
    pointCount: 2,
  };
  assert.deepEqual(borderLabelPoints(flat, 3), [], "ทุกจุดซ้ำกัน = ความยาวศูนย์");
  const ok = {
    ...flat,
    chains: [
      [
        [100, 10],
        [100, 11],
      ] as [number, number][],
    ],
  };
  assert.deepEqual(borderLabelPoints(ok, 0), []);
  assert.deepEqual(borderLabelPoints(ok, -1), []);
  assert.deepEqual(borderLabelPoints(ok, 1.5), []);
});

test("borderLabelPoints: ทุกจุดตกบนเส้นชายแดนจริงของทั้ง 4 ประเทศ (< 1 ม.)", () => {
  const doc = parseSharedBorders(JSON.parse(readFileSync(join(process.cwd(), "public/geo/sea-borders.json"), "utf8")));
  assert.equal(doc.borders.length, 4);
  for (const border of doc.borders) {
    const pts = borderLabelPoints(border, 3);
    assert.equal(pts.length, 3, `${border.name} ต้องได้ 3 จุด`);
    for (const p of pts) {
      const d = Math.min(...border.chains.map((c) => distanceToChainM(p, c)));
      assert.ok(d < 1, `${border.name}: ป้ายห่างจากเส้น ${d.toFixed(1)} ม. (ต้องอยู่บนเส้น)`);
    }
  }
});

test("borderLabelPoints: จุดกระจายห่างกันจริง ไม่กระจุกช่วงที่เส้นคดเคี้ยว", () => {
  const doc = parseSharedBorders(JSON.parse(readFileSync(join(process.cwd(), "public/geo/sea-borders.json"), "utf8")));
  for (const border of doc.borders) {
    const [a, b, c] = borderLabelPoints(border, 3);
    const total = border.chains.reduce((s, ch) => s + chainLengthKm(ch), 0);
    // ระยะตรงระหว่างป้ายที่ติดกันต้องไม่น้อยเกินไปเมื่อเทียบกับความยาวเส้น (กันกรณีกระจุกที่จุดเดียว)
    assert.ok(haversineKm(a, b) > total * 0.05, `${border.name}: ป้าย 1-2 ใกล้กันเกินไป`);
    assert.ok(haversineKm(b, c) > total * 0.05, `${border.name}: ป้าย 2-3 ใกล้กันเกินไป`);
  }
});
