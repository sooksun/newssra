// MySQL connection pool — สร้างแบบ lazy ตอน request แรก (ห้ามเชื่อมต่อระหว่าง next build)
// สร้าง database + ตารางอัตโนมัติถ้ายังไม่มี (ถ้าสิทธิ์ไม่พอจะข้ามและถือว่ามีอยู่แล้ว)

import mysql from "mysql2/promise";
import type { Pool } from "mysql2/promise";

const DB_NAME = process.env.DB_NAME || "newssra";

function baseConfig() {
  return {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD ?? "",
    charset: "utf8mb4_unicode_ci",
  };
}

export const SCHEMA_SQL = `
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

let poolPromise: Promise<Pool> | null = null;

async function init(): Promise<Pool> {
  // สร้าง database ถ้ายังไม่มี (ใช้ connection ชั่วคราวที่ยังไม่เลือก database)
  try {
    const boot = await mysql.createConnection(baseConfig());
    await boot.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await boot.end();
  } catch (error) {
    // สิทธิ์ไม่พอหรือมี database อยู่แล้ว — ปล่อยให้ pool ด้านล่างเป็นผู้รายงานปัญหาจริง
    console.warn("[db] skip CREATE DATABASE:", error instanceof Error ? error.message : error);
  }

  const pool = mysql.createPool({
    ...baseConfig(),
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    maxIdle: 5,
    idleTimeout: 60_000,
  });

  await pool.query(SCHEMA_SQL);
  return pool;
}

export function getPool(): Promise<Pool> {
  if (!poolPromise) {
    poolPromise = init().catch((error) => {
      poolPromise = null; // ให้ request ถัดไปลองใหม่ (เช่น เพิ่งเปิด MySQL ทีหลัง)
      throw error;
    });
  }
  return poolPromise;
}
