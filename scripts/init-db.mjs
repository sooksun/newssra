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
  signed TINYINT(1) NOT NULL DEFAULT 0,
  submitted_ref VARCHAR(40) NULL,
  submitted_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_updated_at (updated_at),
  KEY idx_unit_code (unit_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

console.log(`[db:init] connecting to ${config.host}:${config.port} as ${config.user}`);
const conn = await createConnection(config);
await conn.query(
  `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
);
await conn.changeUser({ database: dbName });
await conn.query(SCHEMA_SQL);
const [rows] = await conn.query("SELECT COUNT(*) AS n FROM assessments");
console.log(`[db:init] database "${dbName}" ready — assessments rows: ${rows[0].n}`);
await conn.end();
