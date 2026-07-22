// สร้าง public/geo/sea-borders.json จาก OpenStreetMap ผ่าน Overpass API
//
// ทำไมต้องดึงจาก OSM: ชุดข้อมูลเดิม (Natural Earth 1:10m) มีระยะห่างจุดต่อจุดตามแนวชายแดนไทย
// median ~2 กม. และกระโดดตรงยาวสุดถึง 20 กม. วัดความเพี้ยนที่ด่านจริงได้ 0.7–3.2 กม.
// ซึ่งใช้ไม่ได้กับแอปนี้ที่ซูมถึงระดับวงรัศมี 500–1500 ม.
//
// วิธี: ชายแดนระหว่างประเทศใน OSM ถูกอ้างเป็น "way เดียวกัน" โดย relation ของทั้งสองประเทศ
// จึงหา way ที่เป็นสมาชิกของทั้ง relation ไทยและ relation เพื่อนบ้าน (`way.th.n`) ได้ตรง ๆ
// → ได้แนวชายแดนร่วมที่ตรงกันเป๊ะโดยธรรมชาติ ไม่ต้องจับคู่พิกัดเองเหมือนวิธีเดิม
//
// รัน: node scripts/fetch-borders.mjs [--tolerance 50] [--out public/geo/sea-borders.json]
//
// ลิขสิทธิ์ข้อมูล: ODbL 1.0 — ต้องแสดงเครดิต "© OpenStreetMap contributors" ในหน้าที่ใช้งาน

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// เพื่อนบ้านที่มีพรมแดนทางบกติดไทย เรียงตามลำดับที่ใช้แสดงผล
// label = จุดวางป้ายชื่อประเทศ (ฝั่งเพื่อนบ้าน ใกล้แนวชายแดน) — สคริปต์คำนวณให้อัตโนมัติ
// โดยยึดจุดกึ่งกลางของ chain ที่ยาวที่สุด แล้วเลื่อนตั้งฉากออกไปฝั่งตรงข้ามประเทศไทย
const NEIGHBORS = [
  { iso: "MM", name: "Myanmar", nameTh: "เมียนมา" },
  { iso: "LA", name: "Laos", nameTh: "ลาว" },
  { iso: "KH", name: "Cambodia", nameTh: "กัมพูชา" },
  { iso: "MY", name: "Malaysia", nameTh: "มาเลเซีย" },
];

const LABEL_OFFSET_M = 45_000; // ระยะเลื่อนป้ายออกจากเส้นชายแดนเข้าไปฝั่งเพื่อนบ้าน
const COORD_DECIMALS = 5; // ~1.1 ม. — ละเอียดพอสำหรับ tolerance 50 ม.

function parseArgs(argv) {
  const args = { tolerance: 50, out: "public/geo/sea-borders.json" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--tolerance") args.tolerance = Number(argv[++i]);
    else if (argv[i] === "--out") args.out = argv[++i];
  }
  if (!Number.isFinite(args.tolerance) || args.tolerance < 0) {
    throw new Error(`--tolerance ต้องเป็นตัวเลข >= 0 (ได้ ${args.tolerance})`);
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query, { attempts = 5 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "newssra-border-fetch (https://github.com/; contact via repo)",
        },
        body: "data=" + encodeURIComponent(query),
        signal: AbortSignal.timeout(600_000),
      });
      if (res.status === 429 || res.status === 504) {
        const wait = 20_000 * (attempt + 1);
        console.log(`   ! ${endpoint} ตอบ ${res.status} — รอ ${wait / 1000}s แล้วลองใหม่`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      const wait = 15_000 * (attempt + 1);
      console.log(`   ! ${e.message} — รอ ${wait / 1000}s แล้วลองใหม่`);
      await sleep(wait);
    }
  }
  throw lastErr ?? new Error("Overpass ล้มเหลวทุกครั้ง");
}

function sharedWaysQuery(iso) {
  return `[out:json][timeout:600];
rel["boundary"="administrative"]["admin_level"="2"]["ISO3166-1"="TH"];way(r)->.th;
rel["boundary"="administrative"]["admin_level"="2"]["ISO3166-1"="${iso}"];way(r)->.n;
way.th.n;
out geom;`;
}

// relation ประเทศใน OSM รวม "เขตแดนทางทะเล" มาด้วย ซึ่งเป็นเส้นตรงยาวกลางทะเล
// ไม่ใช่แนวชายแดนทางบกที่แอปต้องการแสดง — ตัดทิ้งด้วย tag ที่ OSM ใช้กำกับ
function isMaritime(way) {
  const tags = way.tags ?? {};
  return tags.maritime === "yes" || tags.border_type === "territorial";
}

// ── เรขาคณิต ────────────────────────────────────────────────────────────────
const R = 6_371_008.8;
const rad = (d) => (d * Math.PI) / 180;

function haversineM(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function chainLengthM(chain) {
  let total = 0;
  for (let i = 0; i < chain.length - 1; i += 1) total += haversineM(chain[i], chain[i + 1]);
  return total;
}

// ต่อ way หลายเส้นให้เป็นเส้นต่อเนื่อง โดยจับปลายต่อปลาย (way ใน OSM มีทิศทางไม่แน่นอน)
function chainWays(ways) {
  const key = ([lng, lat]) => `${lng.toFixed(7)},${lat.toFixed(7)}`;
  const unused = new Set(ways.keys());
  const endpoints = new Map();
  const remember = (k, i) => {
    if (!endpoints.has(k)) endpoints.set(k, []);
    endpoints.get(k).push(i);
  };
  ways.forEach((coords, i) => {
    remember(key(coords[0]), i);
    remember(key(coords[coords.length - 1]), i);
  });

  const takeAdjacent = (k, skip) => {
    for (const i of endpoints.get(k) ?? []) {
      if (i !== skip && unused.has(i)) return i;
    }
    return -1;
  };

  const chains = [];
  for (const seed of ways.keys()) {
    if (!unused.has(seed)) continue;
    unused.delete(seed);
    let chain = [...ways[seed]];

    // ขยายไปทางท้ายเส้น
    for (;;) {
      const tail = key(chain[chain.length - 1]);
      const next = takeAdjacent(tail, -1);
      if (next === -1) break;
      unused.delete(next);
      const coords = ways[next];
      const forward = key(coords[0]) === tail;
      chain = chain.concat((forward ? coords : [...coords].reverse()).slice(1));
    }
    // ขยายไปทางหัวเส้น
    for (;;) {
      const head = key(chain[0]);
      const prev = takeAdjacent(head, -1);
      if (prev === -1) break;
      unused.delete(prev);
      const coords = ways[prev];
      const forward = key(coords[coords.length - 1]) === head;
      chain = (forward ? coords : [...coords].reverse()).slice(0, -1).concat(chain);
    }

    if (chain.length >= 2) chains.push(chain);
  }

  return chains.sort((a, b) => chainLengthM(b) - chainLengthM(a));
}

// Douglas–Peucker บนระนาบท้องถิ่น (เมตร) โดยอิงละติจูดเฉลี่ยของเส้น
function simplify(chain, toleranceM) {
  if (toleranceM <= 0 || chain.length < 3) return chain;
  const lat0 = chain.reduce((s, p) => s + p[1], 0) / chain.length;
  const kx = (Math.PI / 180) * R * Math.cos(rad(lat0));
  const ky = (Math.PI / 180) * R;
  const xy = chain.map(([lng, lat]) => [lng * kx, lat * ky]);

  const keep = new Uint8Array(chain.length);
  keep[0] = 1;
  keep[chain.length - 1] = 1;
  const stack = [[0, chain.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop();
    if (last - first < 2) continue;
    const [ax, ay] = xy[first];
    const [bx, by] = xy[last];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;

    let farIndex = -1;
    let farDist = toleranceM;
    for (let i = first + 1; i < last; i += 1) {
      const [px, py] = xy[i];
      let dist;
      if (len2 === 0) {
        dist = Math.hypot(px - ax, py - ay);
      } else {
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        dist = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (dist > farDist) {
        farDist = dist;
        farIndex = i;
      }
    }

    if (farIndex !== -1) {
      keep[farIndex] = 1;
      stack.push([first, farIndex], [farIndex, last]);
    }
  }

  return chain.filter((_, i) => keep[i]);
}

function roundCoords(chain) {
  const f = 10 ** COORD_DECIMALS;
  const out = [];
  for (const [lng, lat] of chain) {
    const p = [Math.round(lng * f) / f, Math.round(lat * f) / f];
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue; // ปัดแล้วซ้ำจุดเดิม
    out.push(p);
  }
  return out;
}

// วางป้ายชื่อประเทศฝั่งเพื่อนบ้าน: จากจุดกึ่งกลางเส้นที่ยาวที่สุด เลื่อนตั้งฉากออกไป
// แล้วเลือกด้านที่ "ไม่ใช่" ฝั่งไทย โดยเทียบว่าด้านไหนอยู่ไกลจากเส้นชายแดนอื่น ๆ ของไทยมากกว่า
function labelPosition(chains, thaiChains) {
  const chain = chains[0];
  const mid = chain[Math.floor(chain.length / 2)];
  const a = chain[Math.max(0, Math.floor(chain.length / 2) - 1)];
  const b = chain[Math.min(chain.length - 1, Math.floor(chain.length / 2) + 1)];

  const kx = Math.cos(rad(mid[1])) * 111_320;
  const ky = 110_540;
  const dx = (b[0] - a[0]) * kx;
  const dy = (b[1] - a[1]) * ky;
  const len = Math.hypot(dx, dy) || 1;
  // เวกเตอร์ตั้งฉากสองด้าน
  const nx = -dy / len;
  const ny = dx / len;

  const candidates = [1, -1].map((sign) => [
    mid[0] + (sign * nx * LABEL_OFFSET_M) / kx,
    mid[1] + (sign * ny * LABEL_OFFSET_M) / ky,
  ]);

  // ด้านที่เป็นฝั่งไทยจะอยู่ใกล้แนวชายแดนไทย "เส้นอื่น" มากกว่า เพราะไทยถูกล้อมด้วยชายแดนหลายด้าน
  // ใช้ระยะรวมถึงทุกจุดของทุกชายแดนไทยเป็นตัวชี้: ฝั่งนอกประเทศจะมีค่ามากกว่า
  const score = (p) => {
    let sum = 0;
    for (const c of thaiChains) {
      for (let i = 0; i < c.length; i += Math.max(1, Math.floor(c.length / 200))) {
        sum += haversineM(p, c[i]);
      }
    }
    return sum;
  };

  return score(candidates[0]) >= score(candidates[1]) ? candidates[0] : candidates[1];
}

// ── main ────────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
console.log(`ดึงแนวชายแดนไทยจาก OpenStreetMap (tolerance = ${args.tolerance} ม.)\n`);

const collected = [];
for (const neighbor of NEIGHBORS) {
  process.stdout.write(`• ${neighbor.nameTh} (${neighbor.iso}) ... `);
  const doc = await overpass(sharedWaysQuery(neighbor.iso));
  const all = (doc.elements ?? []).filter((e) => e.type === "way" && Array.isArray(e.geometry));
  const land = all.filter((e) => !isMaritime(e));
  const ways = land
    .map((e) => e.geometry.map((g) => [g.lon, g.lat]))
    .filter((coords) => coords.length >= 2);

  if (ways.length === 0) throw new Error(`ไม่พบ way ที่ใช้ร่วมกันระหว่างไทยกับ ${neighbor.name}`);

  const chains = chainWays(ways);
  const rawPoints = chains.reduce((s, c) => s + c.length, 0);
  const rawLen = chains.reduce((s, c) => s + chainLengthM(c), 0);

  const simplified = chains
    .map((c) => roundCoords(simplify(c, args.tolerance)))
    .filter((c) => c.length >= 2);
  const points = simplified.reduce((s, c) => s + c.length, 0);
  const len = simplified.reduce((s, c) => s + chainLengthM(c), 0);

  console.log(
    `ways=${ways.length} (ตัดทางทะเล ${all.length - land.length}) chains=${simplified.length} ` +
      `จุด ${rawPoints}→${points} ยาว ${(rawLen / 1000).toFixed(0)} กม. ` +
      `(ลดรูปแล้ว ${(len / 1000).toFixed(0)} กม.)`,
  );

  collected.push({ ...neighbor, chains: simplified });
  await sleep(8_000); // สุภาพกับ Overpass สาธารณะ
}

const allChains = collected.flatMap((c) => c.chains);
const borders = collected.map((c) => ({
  name: c.name,
  nameTh: c.nameTh,
  label: labelPosition(
    c.chains,
    allChains.filter((chain) => !c.chains.includes(chain)),
  ).map((v) => Math.round(v * 10 ** 4) / 10 ** 4),
  chains: c.chains,
}));

const out = {
  note:
    "แนวชายแดนทางบกที่ไทยใช้ร่วมกับประเทศเพื่อนบ้าน ดึงจาก OpenStreetMap ผ่าน Overpass API " +
    "(way ที่เป็นสมาชิกของ relation ทั้งสองประเทศ) แล้วลดรูปด้วย Douglas–Peucker",
  source: "OpenStreetMap via Overpass API",
  license: "ODbL 1.0",
  attribution: "© OpenStreetMap contributors",
  generated: new Date().toISOString().slice(0, 10),
  simplifyToleranceM: args.tolerance,
  borders,
};

const outPath = resolve(process.cwd(), args.out);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out) + "\n", "utf8");

const bytes = Buffer.byteLength(JSON.stringify(out));
console.log(`\nเขียน ${args.out} — ${(bytes / 1024).toFixed(0)} KB`);
for (const b of borders) {
  console.log(
    `  ${b.nameTh.padEnd(8)} chains=${String(b.chains.length).padStart(3)} ` +
      `จุด=${String(b.chains.reduce((s, c) => s + c.length, 0)).padStart(6)} ` +
      `ป้าย=[${b.label[0]}, ${b.label[1]}]`,
  );
}
