// สร้าง database + ตาราง (idempotent) — ใช้ตอน setup ครั้งแรกหรือบนเซิร์ฟเวอร์ที่ปิด auto-init
// อ่านค่าเชื่อมต่อจาก env: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
// รัน: npm run db:init

import { createConnection } from "mysql2/promise";

try {
  process.loadEnvFile(".env.local");
} catch {
  // ไม่มี .env.local ก็ใช้ค่า default / env ที่ตั้งมาแล้ว
}

const config = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD ?? "",
};
const dbName = process.env.DB_NAME || "newssra";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS assessments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  state JSON NOT NULL,
  unit_name VARCHAR(255) NOT NULL DEFAULT '',
  unit_code VARCHAR(32) NOT NULL DEFAULT '',
  assessment_year VARCHAR(8) NOT NULL DEFAULT '',
  province VARCHAR(120) NOT NULL DEFAULT '',
  unit_type VARCHAR(32) NOT NULL DEFAULT 'โรงเรียน',
  total_score INT NOT NULL DEFAULT 0,
  level_key VARCHAR(16) NOT NULL DEFAULT 'neutral',
  level_label VARCHAR(64) NOT NULL DEFAULT 'ยังไม่จัดระดับ',
  community_class_key VARCHAR(32) NULL,
  community_class_label VARCHAR(100) NULL,
  setting_type VARCHAR(32) NULL,
  signed TINYINT(1) NOT NULL DEFAULT 0,
  submitted_ref VARCHAR(40) NULL,
  submitted_at DATETIME NULL,
  owner_user_id INT UNSIGNED NULL,
  owner_school_code VARCHAR(16) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_updated_at (updated_at),
  KEY idx_unit_code (unit_code),
  KEY idx_owner (owner_user_id),
  KEY idx_owner_school (owner_school_code),
  KEY idx_community_class (community_class_key),
  UNIQUE KEY uq_submitted_ref (submitted_ref),
  UNIQUE KEY uq_owner_school_year (owner_school_code, assessment_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const USERS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'school',
  display_name VARCHAR(120) NOT NULL DEFAULT '',
  school_code VARCHAR(16) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

console.log(`[db:init] connecting to ${config.host}:${config.port} as ${config.user}`);
const conn = await createConnection(config);
await conn.query(
  `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
);
await conn.changeUser({ database: dbName });
await conn.query(SCHEMA_SQL);
await conn.query(USERS_SCHEMA_SQL);

// migration แถวเดิม (MySQL 8 ไม่มี ADD COLUMN IF NOT EXISTS จึงเช็ค information_schema ก่อน)
async function ensureColumn(table, column, alterSql) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [dbName, table, column]
  );
  if (rows[0].n === 0) {
    await conn.query(alterSql);
    console.log(`[db:init] migrated: added ${table}.${column}`);
  }
}
await ensureColumn("assessments", "owner_user_id",
  "ALTER TABLE assessments ADD COLUMN owner_user_id INT UNSIGNED NULL, ADD KEY idx_owner (owner_user_id)");
await ensureColumn("assessments", "owner_school_code",
  "ALTER TABLE assessments ADD COLUMN owner_school_code VARCHAR(16) NULL, ADD KEY idx_owner_school (owner_school_code)");
await ensureColumn("assessments", "community_class_key",
  "ALTER TABLE assessments ADD COLUMN community_class_key VARCHAR(32) NULL, ADD KEY idx_community_class (community_class_key)");
await ensureColumn("assessments", "community_class_label",
  "ALTER TABLE assessments ADD COLUMN community_class_label VARCHAR(100) NULL");
await ensureColumn("assessments", "setting_type",
  "ALTER TABLE assessments ADD COLUMN setting_type VARCHAR(32) NULL");
await ensureColumn("users", "school_code", "ALTER TABLE users ADD COLUMN school_code VARCHAR(16) NULL");

async function ensureUniqueIndex(table, indexName, alterSql) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [dbName, table, indexName]
  );
  if (rows[0].n > 0) return;
  try {
    await conn.query(alterSql);
    console.log(`[db:init] migrated: added unique index ${table}.${indexName}`);
  } catch (error) {
    console.warn(
      `[db:init] ไม่สามารถเพิ่ม unique index ${table}.${indexName} ได้ (อาจมีค่าซ้ำเดิม) — โปรด dedupe แล้วลองใหม่:`,
      error instanceof Error ? error.message : error
    );
  }
}

await ensureUniqueIndex("assessments", "uq_submitted_ref",
  "ALTER TABLE assessments ADD UNIQUE KEY uq_submitted_ref (submitted_ref)");

// ตรวจก่อนเพิ่ม uq_owner_school_year ว่าไม่มีคู่ (owner_school_code, assessment_year) ซ้ำอยู่แล้ว —
// ต่างจาก ensureUniqueIndex ทั่วไป (best-effort + เตือน) เพราะกระทบข้อมูลจริงถ้าเลือกผิด: พบซ้ำ = หยุดทันที
// พร้อมรายชื่อทุกกลุ่มที่ชนกัน ห้ามลบ/รวม/เลือกผู้ชนะเองเด็ดขาด ให้แอดมิน dedupe เอง
async function assertNoDuplicateOwnerSchoolYear() {
  const [rows] = await conn.query(
    `SELECT owner_school_code, assessment_year, COUNT(*) AS n,
            GROUP_CONCAT(id ORDER BY id) AS ids
       FROM assessments
      WHERE owner_school_code IS NOT NULL AND owner_school_code <> ''
      GROUP BY owner_school_code, assessment_year
     HAVING COUNT(*) > 1`
  );
  if (!rows.length) return;
  const groups = rows
    .map((r) => `${r.owner_school_code}/${r.assessment_year} (ids: ${r.ids})`)
    .join("; ");
  throw new Error(
    `[db:init] พบแบบประเมินซ้ำโรงเรียน/ปีเดียวกันก่อนเพิ่ม uq_owner_school_year — ต้องแก้ก่อน (ไม่ลบ/รวมอัตโนมัติ): ${groups}`
  );
}

await assertNoDuplicateOwnerSchoolYear();
await ensureUniqueIndex("assessments", "uq_owner_school_year",
  "ALTER TABLE assessments ADD UNIQUE KEY uq_owner_school_year (owner_school_code, assessment_year)");

const [rows] = await conn.query("SELECT COUNT(*) AS n FROM assessments");
console.log(`[db:init] database "${dbName}" ready — assessments rows: ${rows[0].n}`);
console.log("[db:init] หมายเหตุ: บัญชีผู้ใช้ตั้งต้น (admin/ssra_admin/school) จะถูกสร้างอัตโนมัติเมื่อแอปเชื่อมต่อฐานข้อมูลครั้งแรก");
await conn.end();
