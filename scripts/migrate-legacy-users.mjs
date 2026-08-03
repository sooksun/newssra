// แคมเปญ migrate ล่วงหน้า: backfill บัญชีโรงเรียนจากตาราง legacy `user` (รหัสผ่าน plaintext)
// → ตาราง `users` ที่แอปเป็นเจ้าของ โดยแฮชด้วย scrypt — เพื่อ "เลิกพึ่งการเทียบ plaintext ตอน login"
// โดยไม่ต้องรอให้แต่ละโรงเรียน login เอง (lazy migration เดิม; ดู docs/AUTH-MIGRATION.md)
//
// ปลอดภัย:
//   • ตาราง legacy `user` ถูกอ่านอย่างเดียว — สคริปต์นี้ไม่แก้ไข/ลบ (เขียนลง `users` เท่านั้น)
//   • idempotent + resumable: ข้ามบัญชีที่มีใน `users` แล้ว → สั่งซ้ำ/ทำต่อจากที่ค้างได้
//   • DEFAULT = DRY-RUN (ไม่เขียนอะไรเลย) — ต้องใส่ --commit จึงจะเขียนจริง
//
// การใช้งาน:
//   node scripts/migrate-legacy-users.mjs                 # dry-run: สรุปว่าจะ migrate กี่บัญชี (ไม่เขียน)
//   node scripts/migrate-legacy-users.mjs --commit        # เขียนจริงทั้งหมด (ใช้เวลานาน — scrypt ต่อบัญชี)
//   node scripts/migrate-legacy-users.mjs --commit --limit 2000   # ทำเป็นชุด (รันซ้ำได้จนหมด)
//
// หมายเหตุความปลอดภัย: การ backfill แปลง "เทียบ plaintext ตอน login" → "เทียบ scrypt" ให้ครบทุกบัญชี
// ทันที (แทนที่จะทยอยตามการใช้งาน) แต่รหัส legacy สั้น (5–6 ตัว) ยัง "อ่อน" อยู่ — endgame จริงคือ
// บังคับตั้งรหัสใหม่ที่ยาวขึ้น (forced reset, ยังไม่ทำ ดู AUTH-MIGRATION.md §ขั้นตอนถัดไป)

import { createConnection } from "mysql2/promise";
import { scryptSync, randomBytes } from "node:crypto";

// ⚠️ ต้องตรงกับรูปแบบใน lib/auth.ts#hashPassword เป๊ะ (scrypt$<saltHex>$<hashHex>, salt 16B, keylen 64)
// ใช้ scryptSync ที่นี่โดยตั้งใจ — เป็นสคริปต์ CLI ที่รันจบเป็นครั้ง ๆ ไม่มี request อื่นรอ event loop อยู่
// (ต่างจาก lib/auth.ts ที่เปลี่ยนเป็น crypto.scrypt แบบ async เพราะอยู่ในเส้นทางคำขอของเว็บ)
function hashPassword(plain) {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

try {
  process.loadEnvFile(".env.local");
} catch {
  // ใช้ค่า env ที่ตั้งไว้แล้ว (เช่นบน production)
}

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Math.max(0, Number.parseInt(args[limitIdx + 1] ?? "", 10) || 0) : 0;

const config = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME || "newssra",
};

const conn = await createConnection(config);
console.log(`[migrate] เชื่อมต่อ ${config.host}:${config.port} db=${config.database} — โหมด: ${COMMIT ? "COMMIT (เขียนจริง)" : "DRY-RUN (ไม่เขียน)"}`);

// นับภาพรวม
const [[legacyTotal]] = await conn.query("SELECT COUNT(*) AS n FROM `user` WHERE password IS NOT NULL AND password <> ''");
const [[alreadyMigrated]] = await conn.query(
  "SELECT COUNT(*) AS n FROM users lu JOIN `user` u ON lu.username = u.`user`"
);

// บัญชีที่ยังไม่ถูก migrate (ยังไม่มีใน users) — LEFT JOIN แล้วกรอง IS NULL
const limitSql = LIMIT > 0 ? ` LIMIT ${LIMIT}` : "";
const [candidates] = await conn.query(
  "SELECT u.`user` AS code, u.name AS name, u.password AS password " +
    "FROM `user` u LEFT JOIN users lu ON lu.username = u.`user` " +
    "WHERE lu.id IS NULL AND u.password IS NOT NULL AND u.password <> ''" +
    limitSql
);

console.log(`[migrate] legacy ที่มีรหัสผ่าน: ${legacyTotal.n.toLocaleString()} | migrate แล้ว: ${alreadyMigrated.n.toLocaleString()} | รอ migrate: ${candidates.length.toLocaleString()}${LIMIT ? ` (จำกัด ${LIMIT})` : ""}`);

if (candidates.length === 0) {
  console.log("[migrate] ไม่มีบัญชีที่ต้อง migrate — เสร็จสิ้น");
  await conn.end();
  process.exit(0);
}

// ตัวอย่าง (ไม่แสดงรหัสผ่าน)
const sample = candidates.slice(0, 3).map((r) => `${r.code} (${(r.name ?? "").slice(0, 24) || "-"})`);
console.log(`[migrate] ตัวอย่างที่จะ migrate: ${sample.join(", ")}${candidates.length > 3 ? ", ..." : ""}`);

if (!COMMIT) {
  console.log(`[migrate] DRY-RUN — จะสร้างบัญชี school ${candidates.length.toLocaleString()} รายการ (ยังไม่เขียน). ใส่ --commit เพื่อเขียนจริง`);
  await conn.end();
  process.exit(0);
}

// เขียนจริง — INSERT IGNORE กัน race/ซ้ำ; log ความคืบหน้าเป็นระยะ (scrypt ช้า จึงทำทีละแถว)
let migrated = 0;
let skipped = 0;
let failed = 0;
const startedAt = Date.now();
for (const r of candidates) {
  const username = String(r.code);
  const displayName = ((r.name ?? "").toString().trim() || username).slice(0, 120);
  try {
    const [res] = await conn.query(
      "INSERT IGNORE INTO users (username, password_hash, role, display_name, school_code, active) VALUES (?, ?, 'school', ?, ?, 1)",
      [username, hashPassword(String(r.password)), displayName, username]
    );
    if (res.affectedRows === 1) migrated++;
    else skipped++; // ชนกับที่เพิ่งถูกสร้าง (race) — ถือว่า migrate แล้ว
  } catch (error) {
    failed++;
    console.error(`[migrate] ล้มเหลวที่บัญชี ${username}:`, error instanceof Error ? error.message : error);
  }
  if ((migrated + skipped + failed) % 500 === 0) {
    const secs = ((Date.now() - startedAt) / 1000).toFixed(0);
    console.log(`[migrate]   ...${migrated + skipped + failed}/${candidates.length} (สร้าง ${migrated}, ข้าม ${skipped}, ล้ม ${failed}) — ${secs}s`);
  }
}

const secs = ((Date.now() - startedAt) / 1000).toFixed(0);
console.log(`[migrate] เสร็จสิ้น: สร้างใหม่ ${migrated.toLocaleString()} | ข้าม ${skipped} | ล้มเหลว ${failed} | ใช้เวลา ${secs}s`);
console.log(`[migrate] เหลือรอ migrate อีก: ${(candidates.length - migrated - skipped).toLocaleString()} (รันซ้ำเพื่อทำต่อ${LIMIT ? " — หรือเพิ่ม --limit" : ""})`);
await conn.end();
