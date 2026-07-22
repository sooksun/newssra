// MySQL connection pool — สร้างแบบ lazy ตอน request แรก (ห้ามเชื่อมต่อระหว่าง next build)
// สร้าง database + ตารางอัตโนมัติถ้ายังไม่มี (ถ้าสิทธิ์ไม่พอจะข้ามและถือว่ามีอยู่แล้ว)

import mysql from "mysql2/promise";
import type { Pool, RowDataPacket } from "mysql2/promise";

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
// หมายเหตุ: MySQL อนุญาตหลายแถวเป็น NULL ใน UNIQUE index ได้ → แบบประเมินที่ยังไม่ยื่น (submitted_ref = NULL)
// ไม่ชนกัน ส่วนเลขที่อ้างอิงจริงหลังยื่นจะไม่ซ้ำกันเด็ดขาด (บังคับโดยฐานข้อมูล)
// uq_owner_school_year: หนึ่งโรงเรียน (owner_school_code) มีแบบประเมินได้ปีละ 1 ฉบับ (ปี พ.ศ.) — บังคับที่ฐานข้อมูล
// เพื่อกันคำขอบันทึกจากแผนที่ 3 มิติพร้อมกันสร้างซ้ำ; แถว owner_school_code = NULL (admin สร้างเอง) ไม่ถูกกันชน
// เพราะ MySQL ถือ NULL แต่ละแถวไม่เท่ากัน (เหมือน submitted_ref)

// ผู้ใช้ระบบ 3 บทบาท (admin / ssra_admin / school) — เก็บเฉพาะบัญชี/บทบาท ไม่มีข้อมูลส่วนบุคคลนักเรียน
export const USERS_SCHEMA_SQL = `
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
  await pool.query(USERS_SCHEMA_SQL);

  // migration สำหรับฐานข้อมูลเดิม — MySQL 8 ไม่มี ADD COLUMN IF NOT EXISTS จึงเช็ค information_schema ก่อน
  await ensureColumn(pool, "assessments", "owner_user_id",
    "ALTER TABLE assessments ADD COLUMN owner_user_id INT UNSIGNED NULL, ADD KEY idx_owner (owner_user_id)");
  await ensureColumn(pool, "assessments", "owner_school_code",
    "ALTER TABLE assessments ADD COLUMN owner_school_code VARCHAR(16) NULL, ADD KEY idx_owner_school (owner_school_code)");
  // Phase 4: สรุปจำแนกชุมชน + ลักษณะที่ตั้ง สำหรับรายการ/กรอง (derive จาก state ตอน save)
  await ensureColumn(pool, "assessments", "community_class_key",
    "ALTER TABLE assessments ADD COLUMN community_class_key VARCHAR(32) NULL, ADD KEY idx_community_class (community_class_key)");
  await ensureColumn(pool, "assessments", "community_class_label",
    "ALTER TABLE assessments ADD COLUMN community_class_label VARCHAR(100) NULL");
  await ensureColumn(pool, "assessments", "setting_type",
    "ALTER TABLE assessments ADD COLUMN setting_type VARCHAR(32) NULL");
  await ensureColumn(pool, "users", "school_code",
    "ALTER TABLE users ADD COLUMN school_code VARCHAR(16) NULL");

  // บังคับให้เลขที่อ้างอิงการยื่นไม่ซ้ำในระดับฐานข้อมูล (ถ้าฐานเดิมมีเลขซ้ำอยู่แล้ว การ ALTER จะล้ม
  // — จับ error ไว้แล้วเตือน ให้ผู้ดูแลไป dedupe เอง; แอปยังทำงานต่อได้ด้วยตัวสร้างเลขแบบรันในโค้ด)
  await ensureUniqueIndex(pool, "assessments", "uq_submitted_ref",
    "ALTER TABLE assessments ADD UNIQUE KEY uq_submitted_ref (submitted_ref)");

  // บังคับ 1 โรงเรียน/1 ปี พ.ศ. ต่อแบบประเมิน — ตรวจซ้ำก่อนเสมอ (ต่างจาก uq_submitted_ref ด้านบน):
  // ถ้าเจอแถวซ้ำจริงในฐานเดิม ต้อง throw ทันที ห้าม auto-fix/ลบ/เลือกผู้ชนะเอง (ต้องให้แอดมินตัดสินใจ)
  await assertNoDuplicateOwnerSchoolYear(pool);
  await ensureUniqueIndex(pool, "assessments", "uq_owner_school_year",
    "ALTER TABLE assessments ADD UNIQUE KEY uq_owner_school_year (owner_school_code, assessment_year)");

  // สร้างบัญชีตั้งต้นผู้ดูแล (dynamic import เพื่อเลี่ยง cycle db ↔ users-repo)
  try {
    const { seedDefaultUsers } = await import("./users-repo");
    await seedDefaultUsers(pool);
  } catch (error) {
    console.warn("[db] seed default users failed:", error instanceof Error ? error.message : error);
  }

  return pool;
}

/** เพิ่มคอลัมน์ถ้ายังไม่มี (เช็ค information_schema เพราะ MySQL 8 ไม่รองรับ ADD COLUMN IF NOT EXISTS) */
async function ensureColumn(pool: Pool, table: string, column: string, alterSql: string): Promise<void> {
  const [rows] = await pool.query<(RowDataPacket & { n: number })[]>(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [DB_NAME, table, column]
  );
  if ((rows[0]?.n ?? 0) === 0) {
    await pool.query(alterSql);
    console.log(`[db] migrated: added ${table}.${column}`);
  }
}

interface DuplicateOwnerSchoolYearRow extends RowDataPacket {
  owner_school_code: string;
  assessment_year: string;
  n: number;
  ids: string;
}

/**
 * ตรวจก่อนเพิ่ม uq_owner_school_year ว่าไม่มีคู่ (owner_school_code, assessment_year) ซ้ำอยู่แล้ว
 * ต่างจาก ensureUniqueIndex ทั่วไป (best-effort + เตือน) เพราะ index นี้กระทบข้อมูลจริงถ้าเลือกผิด —
 * ถ้าพบซ้ำ ต้อง throw พร้อมรายชื่อทุกกลุ่มที่ชนกัน ห้ามลบ/รวม/เลือกผู้ชนะเองเด็ดขาด ให้แอดมิน dedupe เอง
 */
async function assertNoDuplicateOwnerSchoolYear(pool: Pool): Promise<void> {
  const [rows] = await pool.query<DuplicateOwnerSchoolYearRow[]>(
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
    `[db] พบแบบประเมินซ้ำโรงเรียน/ปีเดียวกันก่อนเพิ่ม uq_owner_school_year — ต้องแก้ก่อน (ไม่ลบ/รวมอัตโนมัติ): ${groups}`
  );
}

/** เพิ่ม index/unique key ถ้ายังไม่มี — best-effort: ถ้า ALTER ล้ม (เช่นมีค่าซ้ำเดิม) แค่เตือน ไม่ล้มทั้งแอป */
async function ensureUniqueIndex(pool: Pool, table: string, indexName: string, alterSql: string): Promise<void> {
  const [rows] = await pool.query<(RowDataPacket & { n: number })[]>(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [DB_NAME, table, indexName]
  );
  if ((rows[0]?.n ?? 0) > 0) return;
  try {
    await pool.query(alterSql);
    console.log(`[db] migrated: added unique index ${table}.${indexName}`);
  } catch (error) {
    console.warn(
      `[db] ไม่สามารถเพิ่ม unique index ${table}.${indexName} ได้ (อาจมีค่าซ้ำเดิม) — โปรด dedupe แล้วลองใหม่:`,
      error instanceof Error ? error.message : error
    );
  }
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

/** ตรวจว่าฐานข้อมูลตอบสนองจริง (readiness probe) — คืน false แทนการโยน เพื่อให้ผู้เรียกตัดสินใจเอง */
export async function pingDb(): Promise<boolean> {
  try {
    const pool = await getPool();
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
