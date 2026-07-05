-- Schema ระบบประเมิน พ.ส.ศ. (สำหรับ import ผ่าน phpMyAdmin หรือ mysql CLI ถ้าไม่ใช้ auto-init)
-- แอปสร้างตารางนี้ให้อัตโนมัติอยู่แล้วเมื่อเชื่อมต่อครั้งแรก (lib/db.ts)

CREATE DATABASE IF NOT EXISTS `newssra`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `newssra`;

CREATE TABLE IF NOT EXISTS assessments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- state = source of truth (unit/responses/evidence/signed/submitted ทั้งก้อน)
  state JSON NOT NULL,
  -- คอลัมน์สรุปสำหรับหน้ารายการ — server คำนวณใหม่ทุกครั้งที่บันทึก ห้ามแก้ตรง
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
