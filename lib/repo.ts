// Repository ของแบบประเมิน — จุดเดียวที่แตะตาราง assessments
// หลักการ: state JSON คือ source of truth, summary columns คำนวณโดย server ทุกครั้งที่บันทึก

import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "./db";
import { levelFor, totalScore } from "./scoring";
import type { AssessmentRecord, AssessmentState, AssessmentSummary, IndicatorFeedback, IndicatorId } from "./types";
import { sanitizeState } from "./state";

interface AssessmentRow extends RowDataPacket {
  id: number;
  state: unknown;
  unit_name: string;
  unit_code: string;
  assessment_year: string;
  province: string;
  unit_type: string;
  total_score: number;
  level_key: string;
  level_label: string;
  signed: number;
  submitted_ref: string | null;
  submitted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/** mysql2 คืน JSON column เป็น object (MySQL 8) หรือ string (MariaDB) — รองรับทั้งคู่ */
function parseState(value: unknown): AssessmentState {
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  return sanitizeState(raw);
}

function summaryValues(state: AssessmentState) {
  const total = totalScore(state);
  const level = levelFor(total);
  return {
    unitName: state.unit.name,
    unitCode: state.unit.code,
    year: state.unit.year,
    province: state.unit.province,
    unitType: state.unit.unitType,
    totalScore: total,
    levelKey: level.key,
    levelLabel: level.label,
    signed: state.signed ? 1 : 0,
    submittedRef: state.submitted?.ref ?? null,
    submittedAt: state.submitted?.at ? new Date(state.submitted.at) : null,
  };
}

function rowToSummary(row: AssessmentRow): AssessmentSummary {
  return {
    id: row.id,
    unitName: row.unit_name,
    unitCode: row.unit_code,
    year: row.assessment_year,
    province: row.province,
    unitType: row.unit_type,
    totalScore: row.total_score,
    levelKey: row.level_key,
    levelLabel: row.level_label,
    signed: row.signed === 1,
    submittedRef: row.submitted_ref,
    submittedAt: toIso(row.submitted_at),
    createdAt: toIso(row.created_at) ?? "",
    updatedAt: toIso(row.updated_at) ?? "",
  };
}

const SUMMARY_COLUMNS =
  "id, unit_name, unit_code, assessment_year, province, unit_type, total_score, level_key, level_label, signed, submitted_ref, submitted_at, created_at, updated_at";

export async function listAssessments(): Promise<AssessmentSummary[]> {
  const pool = await getPool();
  const [rows] = await pool.query<AssessmentRow[]>(
    `SELECT ${SUMMARY_COLUMNS} FROM assessments ORDER BY updated_at DESC`
  );
  return rows.map(rowToSummary);
}

export async function getAssessment(id: number): Promise<AssessmentRecord | null> {
  const pool = await getPool();
  const [rows] = await pool.query<AssessmentRow[]>(
    `SELECT id, state, created_at, updated_at FROM assessments WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    state: parseState(row.state),
    createdAt: toIso(row.created_at) ?? "",
    updatedAt: toIso(row.updated_at) ?? "",
  };
}

export async function createAssessment(state: AssessmentState): Promise<number> {
  const pool = await getPool();
  const s = summaryValues(state);
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO assessments
      (state, unit_name, unit_code, assessment_year, province, unit_type,
       total_score, level_key, level_label, signed, submitted_ref, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      JSON.stringify(state),
      s.unitName,
      s.unitCode,
      s.year,
      s.province,
      s.unitType,
      s.totalScore,
      s.levelKey,
      s.levelLabel,
      s.signed,
      s.submittedRef,
      s.submittedAt,
    ]
  );
  return result.insertId;
}

export async function saveAssessment(id: number, state: AssessmentState): Promise<AssessmentSummary | null> {
  const pool = await getPool();
  const s = summaryValues(state);
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE assessments SET
       state = ?, unit_name = ?, unit_code = ?, assessment_year = ?, province = ?, unit_type = ?,
       total_score = ?, level_key = ?, level_label = ?, signed = ?, submitted_ref = ?, submitted_at = ?
     WHERE id = ?`,
    [
      JSON.stringify(state),
      s.unitName,
      s.unitCode,
      s.year,
      s.province,
      s.unitType,
      s.totalScore,
      s.levelKey,
      s.levelLabel,
      s.signed,
      s.submittedRef,
      s.submittedAt,
      id,
    ]
  );
  if (result.affectedRows === 0) return null;

  const [rows] = await pool.query<AssessmentRow[]>(
    `SELECT ${SUMMARY_COLUMNS} FROM assessments WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows.length ? rowToSummary(rows[0]) : null;
}

export async function deleteAssessment(id: number): Promise<boolean> {
  const pool = await getPool();
  const [result] = await pool.query<ResultSetHeader>(`DELETE FROM assessments WHERE id = ?`, [id]);
  return result.affectedRows > 0;
}

export interface AssessmentWithState {
  id: number;
  unitName: string;
  unitCode: string;
  province: string;
  submittedRef: string | null;
  updatedAt: string;
  state: AssessmentState;
}

/** ดึงทุกแบบประเมินพร้อม state เต็ม — ใช้คำนวณสถิติ/กราฟในแดชบอร์ด (ไม่เหมาะกับ dataset ขนาดใหญ่มาก) */
export async function listAllStates(): Promise<AssessmentWithState[]> {
  const pool = await getPool();
  const [rows] = await pool.query<AssessmentRow[]>(
    `SELECT id, state, unit_name, unit_code, province, submitted_ref, updated_at FROM assessments ORDER BY updated_at DESC`
  );
  return rows.map((row) => ({
    id: row.id,
    unitName: row.unit_name,
    unitCode: row.unit_code,
    province: row.province,
    submittedRef: row.submitted_ref,
    updatedAt: toIso(row.updated_at) ?? "",
    state: parseState(row.state),
  }));
}

export interface FeedbackEntry {
  assessmentId: number;
  unitName: string;
  unitCode: string;
  updatedAt: string;
  feedback: Partial<Record<IndicatorId, IndicatorFeedback>>;
  generalFeedback: string;
}

/** ดึงความคิดเห็นของผู้ทดสอบจากทุกแบบประเมิน — ใช้สรุปผลการทดสอบกับผู้เกี่ยวข้อง (ไม่ใช่หน้าจอสำหรับผู้กรอกทั่วไป) */
export async function listAllFeedback(): Promise<FeedbackEntry[]> {
  const pool = await getPool();
  const [rows] = await pool.query<AssessmentRow[]>(
    `SELECT id, state, unit_name, unit_code, updated_at FROM assessments ORDER BY updated_at DESC`
  );
  return rows.map((row) => {
    const state = parseState(row.state);
    return {
      assessmentId: row.id,
      unitName: row.unit_name,
      unitCode: row.unit_code,
      updatedAt: toIso(row.updated_at) ?? "",
      feedback: state.feedback,
      generalFeedback: state.generalFeedback,
    };
  });
}
