// นำเข้าบัญชีสำนักงานในพื้นที่พิเศษตามประกาศกระทรวงการคลัง → ตาราง treasury_special_area
//
//   node scripts/import-treasury-special-area.mjs                 # ใช้ไฟล์ปี 2569 ที่อยู่ในโปรเจกต์
//   node scripts/import-treasury-special-area.mjs --file=<path>   # ประกาศปีอื่น (โครงสร้าง JSON เดียวกัน)
//   node scripts/import-treasury-special-area.mjs --dry-run       # ดูผลจับคู่โดยไม่เขียนฐาน
//
// ข้อมูลต้นทางคือไฟล์ประกาศ ไม่ใช่คำตอบที่โรงเรียนกรอกเอง — ในระบบเดิม 547 จาก 549 โรงเรียน
// ที่ตอบว่า "ได้ประกาศคลัง" ไม่ได้แนบเอกสารเลย จึงต้องยึดบัญชีทางการเป็นแหล่งเดียว
//
// การจับคู่รหัสโรงเรียน: จับได้เท่าที่ทะเบียน master_school มีจริง ที่เหลือปล่อยเป็น NULL
// (โรงเรียนสาขา / ตชด. / ศูนย์การเรียน ไม่มีในทะเบียน สพฐ.) — ห้ามเดารหัสให้ครบ

import { readFileSync } from "node:fs";
import path from "node:path";
import { createConnection } from "mysql2/promise";

try {
  process.loadEnvFile(".env.local");
} catch {
  // ไม่มี .env.local ก็ใช้ค่า default / env ที่ตั้งมาแล้ว (แพตเทิร์นเดียวกับ scripts/init-db.mjs)
}

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const dryRun = args.includes("--dry-run");
const file = argOf("file", path.join("scripts", "data", "treasury-special-area-2569.json"));

const doc = JSON.parse(readFileSync(file, "utf8"));
const offices = Array.isArray(doc.offices) ? doc.offices : [];
if (offices.length === 0) throw new Error(`ไม่พบรายการสำนักงานในไฟล์ ${file}`);

/** พ.ศ. → ค.ศ. สำหรับคอลัมน์ DATE (เก็บเป็น Gregorian ตามข้อตกลงของโปรเจกต์) */
function beDateToIso(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!m) return null;
  return `${Number(m[1]) - 543}-${m[2]}-${m[3]}`;
}

const norm = (s) =>
  String(s || "")
    .replace(/\s+/g, "")
    .replace(/^โรงเรียน/, "")
    .trim();

const config = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME || "newssra",
  charset: "utf8mb4",
};

const conn = await createConnection(config);
console.log(`[treasury] ${file}`);
console.log(`[treasury] ประกาศ ${doc.source?.announcementRef || "-"} ปีงบประมาณ ${doc.fiscalYear} · ${offices.length} สำนักงาน`);

// ทะเบียนโรงเรียนสำหรับจับคู่รหัส
const [masterRows] = await conn.query("SELECT sc_id, sc_name, provinces, amphures FROM master_school");
const byNameProvinceAmphoe = new Map();
const byNameProvince = new Map();
const byNameOnly = new Map();
for (const m of masterRows) {
  const code = String(m.sc_id).trim();
  const n = norm(m.sc_name);
  const p = String(m.provinces || "").trim();
  const a = String(m.amphures || "").trim();
  byNameProvinceAmphoe.set(`${n}|${p}|${a}`, code);
  const kp = `${n}|${p}`;
  if (!byNameProvince.has(kp)) byNameProvince.set(kp, []);
  byNameProvince.get(kp).push(code);
  if (!byNameOnly.has(n)) byNameOnly.set(n, []);
  byNameOnly.get(n).push(code);
}

/** จับคู่แบบเข้มก่อนเสมอ และยอมรับผลกำกวมเป็น "ไม่จับคู่" ไม่ใช่เดาเอาตัวแรก */
function matchSchool(office, province, amphoe) {
  const n = norm(office);
  const exact = byNameProvinceAmphoe.get(`${n}|${province}|${amphoe}`);
  if (exact) return { code: exact, method: "name+province+amphoe" };
  const inProvince = byNameProvince.get(`${n}|${province}`);
  if (inProvince && inProvince.length === 1) return { code: inProvince[0], method: "name+province" };
  const anywhere = byNameOnly.get(n);
  if (anywhere && anywhere.length === 1) return { code: anywhere[0], method: "name" };
  return { code: null, method: null };
}

const announcedOn = beDateToIso(doc.source?.announcedOn);
const announcementRef = String(doc.source?.announcementRef || "").slice(0, 64);
const rows = [];
const stats = { school: 0, other: 0, matched: 0, byMethod: {}, uncertain: 0 };

for (const o of offices) {
  const officeName = String(o.office || "").trim();
  const province = String(o.province || "").trim();
  const amphoe = String(o.amphoe || "").trim();
  const isSchool = officeName.startsWith("โรงเรียน");
  const { code, method } = isSchool ? matchSchool(officeName, province, amphoe) : { code: null, method: null };
  if (isSchool) stats.school++;
  else stats.other++;
  if (code) {
    stats.matched++;
    stats.byMethod[method] = (stats.byMethod[method] || 0) + 1;
  }
  if (o.uncertain) stats.uncertain++;
  rows.push([
    doc.fiscalYear,
    announcementRef,
    announcedOn,
    province,
    o.seq ?? null,
    officeName.slice(0, 255),
    String(o.tambon || "").trim().slice(0, 120),
    amphoe.slice(0, 120),
    isSchool ? 1 : 0,
    code,
    method,
    o.page ?? null,
    o.uncertain ? 1 : 0,
  ]);
}

console.log(`[treasury] โรงเรียน ${stats.school} · หน่วยงานอื่น ${stats.other} · อ่านจากภาพไม่ชัด ${stats.uncertain}`);
console.log(
  `[treasury] จับคู่รหัสโรงเรียนได้ ${stats.matched}/${stats.school} (${((stats.matched / stats.school) * 100).toFixed(1)}%) — ${Object.entries(stats.byMethod)
    .map(([k, v]) => `${k}:${v}`)
    .join(" · ")}`,
);

if (dryRun) {
  console.log("[treasury] --dry-run: ไม่เขียนฐานข้อมูล");
  await conn.end();
  process.exit(0);
}

// แทนที่ทั้งปีงบประมาณ — ประกาศฉบับใหม่แทนฉบับเดิมทั้งฉบับ ไม่ merge รายแถว
await conn.query("DELETE FROM treasury_special_area WHERE fiscal_year = ?", [doc.fiscalYear]);
const CHUNK = 200;
for (let i = 0; i < rows.length; i += CHUNK) {
  await conn.query(
    `INSERT INTO treasury_special_area
       (fiscal_year, announcement_ref, announced_on, province, seq, office_name, tambon, amphoe,
        is_school, school_code, match_method, source_page, uncertain)
     VALUES ?`,
    [rows.slice(i, i + CHUNK)],
  );
}

const [[check]] = await conn.query(
  "SELECT COUNT(*) n, SUM(is_school) schools, COUNT(school_code) matched FROM treasury_special_area WHERE fiscal_year = ?",
  [doc.fiscalYear],
);
console.log(`[treasury] เขียนแล้ว ${check.n} แถว · โรงเรียน ${check.schools} · มีรหัส ${check.matched}`);
await conn.end();
