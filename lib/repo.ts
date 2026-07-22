// Repository ของแบบประเมิน — จุดเดียวที่แตะตาราง assessments
// หลักการ: state JSON คือ source of truth, summary columns คำนวณโดย server ทุกครั้งที่บันทึก

import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "./db";
import { levelFor, totalScore } from "./scoring";
import type {
  AssessmentRecord,
  AssessmentState,
  AssessmentSummary,
  IndicatorFeedback,
  IndicatorId,
  SessionUser,
} from "./types";
import {
  COMMUNITY_LIST_UNINDEXED_KEY,
  isCommunityCompositeKey,
} from "./community-class";
import { computeCommunityClass } from "./gis";
import { applyMapGisToState } from "./map-assessment";
import type { MapAssessmentSaveResult, SaveAssessmentFromMapInput, SchoolAssessmentMaster } from "./map-assessment";
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
  community_class_key: string | null;
  community_class_label: string | null;
  setting_type: string | null;
  signed: number;
  submitted_ref: string | null;
  submitted_at: Date | string | null;
  owner_user_id: number | null;
  owner_school_code: string | null;
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

/**
 * Re-index community class on every save when gis exists (PR C).
 * ใช้ policy ปัจจุบันเสมอ — list summary columns ตรงกับเกณฑ์ classify แม้ state.gis.communityClass เก่า
 */
export function reindexCommunityOnState(state: AssessmentState): AssessmentState {
  if (!state.gis) return state;
  const communityClass = computeCommunityClass(state.gis);
  return {
    ...state,
    gis: { ...state.gis, communityClass },
  };
}

function summaryValues(state: AssessmentState) {
  const total = totalScore(state);
  const level = levelFor(total);
  // ถ้ามี gis แต่ยังไม่มี communityClass (แถวเก่า) — คำนวณสดสำหรับดัชนีรายการ
  const cc = state.gis
    ? (state.gis.communityClass ?? computeCommunityClass(state.gis))
    : null;
  return {
    unitName: state.unit.name,
    unitCode: state.unit.code,
    year: state.unit.year,
    province: state.unit.province,
    unitType: state.unit.unitType,
    totalScore: total,
    levelKey: level.key,
    levelLabel: level.label,
    communityClassKey: cc?.composite.key ?? null,
    communityClassLabel: cc?.composite.labelTh ?? null,
    settingType: state.unit.settingType || null,
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
    ownerUserId: row.owner_user_id,
    ownerSchoolCode: row.owner_school_code,
    createdAt: toIso(row.created_at) ?? "",
    updatedAt: toIso(row.updated_at) ?? "",
    communityClassKey: row.community_class_key ?? null,
    communityClassLabel: row.community_class_label ?? null,
    settingType: row.setting_type ?? null,
  };
}

function rowToRecord(row: AssessmentRow): AssessmentRecord {
  return {
    id: row.id,
    state: parseState(row.state),
    ownerUserId: row.owner_user_id,
    ownerSchoolCode: row.owner_school_code,
    createdAt: toIso(row.created_at) ?? "",
    updatedAt: toIso(row.updated_at) ?? "",
  };
}

const SUMMARY_COLUMNS =
  "id, unit_name, unit_code, assessment_year, province, unit_type, total_score, level_key, level_label, community_class_key, community_class_label, setting_type, signed, submitted_ref, submitted_at, owner_user_id, owner_school_code, created_at, updated_at";

/** ผู้เรียกที่ผ่านการยืนยันตัวตน — ใช้จำกัดขอบเขตข้อมูลตามบทบาท (school ผูกด้วยรหัสโรงเรียน) */
export type Viewer = Pick<SessionUser, "uid" | "role" | "schoolCode">;

/** ตัวเลือกแบ่งหน้า — ถ้าไม่ส่งมาจะคืนทุกแถว (คงพฤติกรรมเดิม); ส่งมาเพื่อจำกัดจำนวนต่อหน้า */
export interface PageOpts {
  limit: number;
  offset: number;
  /** กรองตาม community_class_key (เช่น highland_remote); ไม่ส่ง = ทุกคลาส */
  communityClassKey?: string;
}


function normalizePage(opts?: PageOpts): { limit: number; offset: number; communityClassKey: string | null } | null {
  if (!opts) return null;
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? Math.min(opts.limit, 200) : 20;
  const offset = Number.isInteger(opts.offset) && opts.offset > 0 ? opts.offset : 0;
  const raw = opts.communityClassKey;
  const key =
    raw === COMMUNITY_LIST_UNINDEXED_KEY || isCommunityCompositeKey(raw) ? raw : null;
  return { limit, offset, communityClassKey: key };
}

function communityFilterSql(key: string | null | undefined): { sql: string; args: string[] } {
  if (key === COMMUNITY_LIST_UNINDEXED_KEY) {
    return { sql: " AND community_class_key IS NULL", args: [] };
  }
  if (!isCommunityCompositeKey(key)) return { sql: "", args: [] };
  return { sql: " AND community_class_key = ?", args: [key] };
}

/** school เห็นเฉพาะแบบประเมินของโรงเรียนตน (owner_school_code); admin/ssra_admin เห็นทั้งหมด
 *  ส่ง opts เพื่อแบ่งหน้า (LIMIT/OFFSET) — ไม่ส่งจะคืนทั้งหมดตามเดิม */
export async function listAssessments(viewer: Viewer, opts?: PageOpts): Promise<AssessmentSummary[]> {
  const pool = await getPool();
  const page = normalizePage(opts);
  const pageSql = page ? " LIMIT ? OFFSET ?" : "";
  const pageArgs = page ? [page.limit, page.offset] : [];
  const cf = communityFilterSql(page?.communityClassKey ?? opts?.communityClassKey);
  if (viewer.role === "school") {
    if (!viewer.schoolCode) return []; // school ที่ยังไม่ผูกรหัสโรงเรียน → ไม่เห็นอะไรเลย
    const [rows] = await pool.query<AssessmentRow[]>(
      `SELECT ${SUMMARY_COLUMNS} FROM assessments WHERE owner_school_code = ?${cf.sql} ORDER BY updated_at DESC${pageSql}`,
      [viewer.schoolCode, ...cf.args, ...pageArgs]
    );
    return rows.map(rowToSummary);
  }
  const where = cf.sql ? `WHERE 1=1${cf.sql}` : "";
  const [rows] = await pool.query<AssessmentRow[]>(
    `SELECT ${SUMMARY_COLUMNS} FROM assessments ${where} ORDER BY updated_at DESC${pageSql}`,
    [...cf.args, ...pageArgs]
  );
  return rows.map(rowToSummary);
}

/** จำนวนแบบประเมินทั้งหมดในขอบเขตของผู้ชม (ใช้คำนวณจำนวนหน้า) */
export async function countAssessments(viewer: Viewer, communityClassKey?: string): Promise<number> {
  const pool = await getPool();
  const cf = communityFilterSql(communityClassKey);
  if (viewer.role === "school") {
    if (!viewer.schoolCode) return 0;
    const [rows] = await pool.query<(RowDataPacket & { n: number })[]>(
      `SELECT COUNT(*) AS n FROM assessments WHERE owner_school_code = ?${cf.sql}`,
      [viewer.schoolCode, ...cf.args]
    );
    return rows[0]?.n ?? 0;
  }
  const where = cf.sql ? `WHERE 1=1${cf.sql}` : "";
  const [rows] = await pool.query<(RowDataPacket & { n: number })[]>(
    `SELECT COUNT(*) AS n FROM assessments ${where}`,
    cf.args,
  );
  return rows[0]?.n ?? 0;
}

export async function getAssessment(id: number): Promise<AssessmentRecord | null> {
  const pool = await getPool();
  const [rows] = await pool.query<AssessmentRow[]>(
    `SELECT id, state, owner_user_id, owner_school_code, created_at, updated_at FROM assessments WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  return rowToRecord(rows[0]);
}

/** แบบประเมินของโรงเรียนสำหรับปี พ.ศ. ที่ระบุเจาะจง (unique ต่อคู่โรงเรียน-ปี)
 *  ผูกกับปีปัจจุบันเท่านั้น — ไม่ดึงฉบับปีอื่นข้ามมาแทน (บังคับ 1 โรงเรียน/1 ปี ด้วย unique key) */
export async function assessmentForSchoolYear(schoolCode: string, year: string): Promise<AssessmentRecord | null> {
  if (!schoolCode) return null;
  const pool = await getPool();
  const [rows] = await pool.query<AssessmentRow[]>(
    `SELECT id, state, owner_user_id, owner_school_code, created_at, updated_at
       FROM assessments
      WHERE owner_school_code = ? AND assessment_year = ?
      LIMIT 1`,
    [schoolCode, year]
  );
  return rows.length ? rowToRecord(rows[0]) : null;
}

/** ดึงรหัสโรงเรียนเจ้าของแบบประเมิน เพื่อตรวจสิทธิ์ในชั้น route
 *  - undefined = ไม่พบแบบประเมิน
 *  - null = มีอยู่แต่ไม่มีเจ้าของโรงเรียน (แถวที่ admin/ssra สร้าง หรือแถวเดิมก่อนมีระบบ auth)
 *  - string = รหัสโรงเรียนเจ้าของ */
export async function getAssessmentOwnerSchoolCode(id: number): Promise<string | null | undefined> {
  const pool = await getPool();
  const [rows] = await pool.query<AssessmentRow[]>(
    `SELECT owner_school_code FROM assessments WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length) return undefined;
  return rows[0].owner_school_code;
}

/** เจ้าของแบบประเมินตอนสร้าง — userId (บัญชี local) และ/หรือ schoolCode (บทบาท school) */
export interface AssessmentOwner {
  userId: number | null;
  schoolCode: string | null;
}

export async function createAssessment(state: AssessmentState, owner: AssessmentOwner): Promise<number> {
  const pool = await getPool();
  const indexed = reindexCommunityOnState(state);
  const s = summaryValues(indexed);
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO assessments
      (state, unit_name, unit_code, assessment_year, province, unit_type,
       total_score, level_key, level_label, community_class_key, community_class_label, setting_type,
       signed, submitted_ref, submitted_at, owner_user_id, owner_school_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      JSON.stringify(indexed),
      s.unitName,
      s.unitCode,
      s.year,
      s.province,
      s.unitType,
      s.totalScore,
      s.levelKey,
      s.levelLabel,
      s.communityClassKey,
      s.communityClassLabel,
      s.settingType,
      s.signed,
      s.submittedRef,
      s.submittedAt,
      owner.userId,
      owner.schoolCode,
    ]
  );
  return result.insertId;
}

export async function saveAssessment(id: number, state: AssessmentState): Promise<AssessmentSummary | null> {
  const pool = await getPool();
  const indexed = reindexCommunityOnState(state);
  const s = summaryValues(indexed);
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE assessments SET
       state = ?, unit_name = ?, unit_code = ?, assessment_year = ?, province = ?, unit_type = ?,
       total_score = ?, level_key = ?, level_label = ?,
       community_class_key = ?, community_class_label = ?, setting_type = ?,
       signed = ?, submitted_ref = ?, submitted_at = ?
     WHERE id = ?`,
    [
      JSON.stringify(indexed),
      s.unitName,
      s.unitCode,
      s.year,
      s.province,
      s.unitType,
      s.totalScore,
      s.levelKey,
      s.levelLabel,
      s.communityClassKey,
      s.communityClassLabel,
      s.settingType,
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

/**
 * บันทึกผล GIS จากแผนที่ 3 มิติลงแบบประเมินของปีปัจจุบัน แบบ atomic ทั้งก้อน (สร้าง/ปรับปรุง/ล็อก + คำตอบมิติ 3
 * ต้องอยู่ transaction เดียวกัน) ใช้แถวเดียวต่อ (owner_school_code, assessment_year) คุ้มครองด้วย
 * SELECT ... FOR UPDATE + unique key `uq_owner_school_year` กันแข่งกันสร้างซ้ำตอนมีคำขอพร้อมกัน
 */
async function saveAssessmentFromMapOnce(
  conn: PoolConnection,
  input: SaveAssessmentFromMapInput
): Promise<MapAssessmentSaveResult> {
  await conn.beginTransaction();
  try {
    const [rows] = await conn.query<AssessmentRow[]>(
      `SELECT id, state, owner_user_id, owner_school_code, created_at, updated_at
         FROM assessments
        WHERE owner_school_code = ? AND assessment_year = ?
        LIMIT 1
        FOR UPDATE`,
      [input.schoolCode, input.year]
    );

    if (rows.length) {
      const existing = rowToRecord(rows[0]);
      if (existing.state.submitted) {
        // ยื่นแล้ว — ห้ามแตะ GIS/คะแนน คืนสถานะเดิมทั้งหมด (ล็อก)
        await conn.commit();
        return { assessmentId: existing.id, action: "locked", state: existing.state };
      }
      const nextState = reindexCommunityOnState(
        applyMapGisToState(existing.state, input.gis, { syncUnitLocation: input.syncUnitLocation })
      );
      const s = summaryValues(nextState);
      await conn.query<ResultSetHeader>(
        `UPDATE assessments SET
           state = ?, unit_name = ?, unit_code = ?, assessment_year = ?, province = ?, unit_type = ?,
           total_score = ?, level_key = ?, level_label = ?,
           community_class_key = ?, community_class_label = ?, setting_type = ?,
           signed = ?, submitted_ref = ?, submitted_at = ?
         WHERE id = ?`,
        [
          JSON.stringify(nextState),
          s.unitName,
          s.unitCode,
          s.year,
          s.province,
          s.unitType,
          s.totalScore,
          s.levelKey,
          s.levelLabel,
          s.communityClassKey,
          s.communityClassLabel,
          s.settingType,
          s.signed,
          s.submittedRef,
          s.submittedAt,
          existing.id,
        ]
      );
      await conn.commit();
      return { assessmentId: existing.id, action: "updated", state: nextState };
    }

    const nextState = reindexCommunityOnState(
      applyMapGisToState(input.initialState, input.gis, { syncUnitLocation: input.syncUnitLocation })
    );
    const s = summaryValues(nextState);
    const [result] = await conn.query<ResultSetHeader>(
      `INSERT INTO assessments
        (state, unit_name, unit_code, assessment_year, province, unit_type,
         total_score, level_key, level_label, community_class_key, community_class_label, setting_type,
         signed, submitted_ref, submitted_at, owner_user_id, owner_school_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        JSON.stringify(nextState),
        s.unitName,
        s.unitCode,
        s.year,
        s.province,
        s.unitType,
        s.totalScore,
        s.levelKey,
        s.levelLabel,
        s.communityClassKey,
        s.communityClassLabel,
        s.settingType,
        s.signed,
        s.submittedRef,
        s.submittedAt,
        input.ownerUserId,
        input.schoolCode,
      ]
    );
    await conn.commit();
    return { assessmentId: result.insertId, action: "created", state: nextState };
  } catch (error) {
    await conn.rollback();
    throw error;
  }
}

export async function saveAssessmentFromMapAtomic(
  input: SaveAssessmentFromMapInput
): Promise<MapAssessmentSaveResult> {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    try {
      return await saveAssessmentFromMapOnce(conn, input);
    } catch (error) {
      // แข่งกันสร้างพร้อมกัน (สอง request ชนกันตอนยังไม่มีแถว) — unique key ทำให้ INSERT ที่แพ้ชน ER_DUP_ENTRY
      // ลองใหม่อีกครั้งเดียว: รอบสองจะเจอแถวที่ชนะแล้วจาก SELECT ... FOR UPDATE และตัดสินใจ updated/locked ตามจริง
      if ((error as { code?: string } | null)?.code !== "ER_DUP_ENTRY") throw error;
      return await saveAssessmentFromMapOnce(conn, input);
    }
  } finally {
    conn.release();
  }
}

export async function deleteAssessment(id: number): Promise<boolean> {
  const pool = await getPool();
  const [result] = await pool.query<ResultSetHeader>(`DELETE FROM assessments WHERE id = ?`, [id]);
  return result.affectedRows > 0;
}

/** เลขลำดับการยื่นสูงสุดของปีนั้น จาก submitted_ref รูปแบบ "พสศ-YYYY-NNNN" (0 ถ้ายังไม่มี)
 *  ใช้สร้างเลขที่อ้างอิงถัดไปแบบรันต่อเนื่อง — การชนกันจากการยื่นพร้อมกันกันด้วย UNIQUE key + retry ในชั้น route */
export async function maxSubmissionSeq(year: string): Promise<number> {
  const pool = await getPool();
  const [rows] = await pool.query<(RowDataPacket & { m: number | null })[]>(
    `SELECT MAX(CAST(SUBSTRING_INDEX(submitted_ref, '-', -1) AS UNSIGNED)) AS m
       FROM assessments WHERE submitted_ref LIKE ?`,
    [`พสศ-${year}-%`]
  );
  const m = Number(rows[0]?.m);
  return Number.isFinite(m) ? m : 0;
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

/** เพดานจำนวนแถวที่แดชบอร์ดจะดึงมาคำนวณสถิติในครั้งเดียว — กันหน่วยความจำ/เวลาโหลดพุ่งเมื่อข้อมูลโตมาก
 *  (ถ้าเกินเพดานนี้ หน้าแดชบอร์ดจะแจ้งผู้ใช้อย่างตรงไปตรงมาว่าคำนวณจาก "N ล่าสุด" ไม่ใช่ทั้งหมด) */
export const DASHBOARD_ROW_CAP = 5000;

/** ดึงแบบประเมินพร้อม state เต็ม (ล่าสุดก่อน) — ใช้คำนวณสถิติ/กราฟในแดชบอร์ด
 *  จำกัดที่ DASHBOARD_ROW_CAP แถวเสมอ (ปรับได้ผ่าน limit) เพื่อไม่ให้ dataset ใหญ่ทำให้หน้าโหลดช้า/ใช้ RAM มากเกิน */
export async function listAllStates(limit: number = DASHBOARD_ROW_CAP): Promise<AssessmentWithState[]> {
  const pool = await getPool();
  const cap = Number.isInteger(limit) && limit > 0 ? limit : DASHBOARD_ROW_CAP;
  const [rows] = await pool.query<AssessmentRow[]>(
    `SELECT id, state, unit_name, unit_code, province, submitted_ref, updated_at FROM assessments ORDER BY updated_at DESC LIMIT ?`,
    [cap]
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

/** จำนวนแบบประเมินทั้งหมดในระบบ (ทุกโรงเรียน) — ใช้ในแดชบอร์ดเพื่อบอกว่าคำนวณจากกี่แถวเทียบกับทั้งหมด */
export async function countAllAssessments(): Promise<number> {
  const pool = await getPool();
  const [rows] = await pool.query<(RowDataPacket & { n: number })[]>(`SELECT COUNT(*) AS n FROM assessments`);
  return rows[0]?.n ?? 0;
}

export interface OwnerCoords {
  lat: number;
  lng: number;
  name: string;
}

/** พิกัดของโรงเรียนจากแบบประเมินล่าสุดของโรงเรียน (schoolCode) ที่มี lat/lng ใช้ได้ — ตั้งจุดเริ่มต้นแผนที่ 3 มิติ */
export async function latestOwnerCoords(schoolCode: string): Promise<OwnerCoords | null> {
  if (!schoolCode) return null;
  const pool = await getPool();
  const [rows] = await pool.query<AssessmentRow[]>(
    `SELECT state, unit_name FROM assessments WHERE owner_school_code = ? ORDER BY updated_at DESC LIMIT 20`,
    [schoolCode]
  );
  for (const row of rows) {
    const state = parseState(row.state);
    const lat = Number(state.unit.lat);
    const lng = Number(state.unit.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
      return { lat, lng, name: state.unit.name || row.unit_name || "โรงเรียนของฉัน" };
    }
  }
  return null;
}

interface SchoolLocationRow extends RowDataPacket {
  lat: string | null;
  lng: string | null;
  sname: string | null;
  sc_name: string | null;
}

/** พิกัดโรงเรียนจากฐานข้อมูลหลักของระบบเดิม (legacy) ใช้เป็น fallback เมื่อโรงเรียนยังไม่มีแบบประเมินที่มีพิกัด:
 *  schoolCode (= `user`.user = master_school.sc_smis) → master_school.sc_id → school_location.id → lat/lng
 *  ตาราง master_school / school_location เป็นของระบบเดิม อ่านอย่างเดียว และอาจไม่มีในบางสภาพแวดล้อม
 *  (เช่น production ที่ยังไม่ import) — จึงห่อ try/catch แล้วคืน null เพื่อให้แผนที่ fallback เป็นมุมมองทั้งประเทศ */
export async function schoolLocationByCode(schoolCode: string): Promise<OwnerCoords | null> {
  if (!schoolCode) return null;
  const pool = await getPool();
  let rows: SchoolLocationRow[];
  try {
    [rows] = await pool.query<SchoolLocationRow[]>(
      `SELECT sl.lat AS lat, sl.lng AS lng, sl.sname AS sname, ms.sc_name AS sc_name
         FROM master_school ms
         JOIN school_location sl ON sl.id = ms.sc_id
        WHERE ms.sc_smis = ?
        LIMIT 1`,
      [schoolCode]
    );
  } catch (error) {
    console.error("[repo] schoolLocationByCode failed (legacy tables missing?):", error);
    return null;
  }
  const row = rows[0];
  if (!row) return null;
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng, name: row.sname || row.sc_name || "โรงเรียนของฉัน" };
}

export interface ProvinceInfo {
  name: string;
  lat: number;
  lng: number;
  avgElev: number; // ความสูงเฉลี่ยจังหวัด (ม.) — คอลัมน์ `high`
}

// ค่าเฉลี่ยขนาดครัวเรือนของประเทศไทยโดยประมาณ — ใช้เมื่อจังหวัดนั้นไม่มีข้อมูลหมู่บ้านใน master_viledges
// (เช่น กรุงเทพมหานคร ที่ปกครองแบบเขต/แขวง ไม่ใช่ตำบล/หมู่บ้าน จึงไม่มีแถวในตารางนี้เลย)
const FALLBACK_HOUSEHOLD_SIZE = 2.3;

interface HouseholdSizeRow extends RowDataPacket {
  totalPeople: string | number | null;
  totalFamily: string | number | null;
}

/** ขนาดครัวเรือนเฉลี่ย (คน/ครัวเรือน) ของจังหวัด จากตาราง master_viledges ของระบบเดิม (ข้อมูลหมู่บ้านจริง — คอลัมน์
 *  people/family, อ้างอิงชื่อจังหวัดตรงกับ province.PROVINCE_NAME) ใช้ประมาณจำนวนประชากรจากจำนวนอาคารในแต่ละรัศมี
 *  (ดู CesiumMap.tsx) — เป็นค่าประมาณ ไม่ใช่ข้อมูลสำมะโนประชากรรายพิกัด เพราะตารางนี้ไม่มีพิกัด lat/lng ของแต่ละหมู่บ้าน
 *  ไม่พบข้อมูลหมู่บ้านของจังหวัดนั้น (หรือ query ไม่สำเร็จ — ตารางอาจไม่มีในบางสภาพแวดล้อม) → คืนค่าเฉลี่ยประเทศแทน */
export async function provinceHouseholdSize(provinceName: string): Promise<number> {
  if (!provinceName) return FALLBACK_HOUSEHOLD_SIZE;
  try {
    const pool = await getPool();
    const [rows] = await pool.query<HouseholdSizeRow[]>(
      `SELECT SUM(people) AS totalPeople, SUM(family) AS totalFamily FROM master_viledges WHERE TRIM(province) = ?`,
      [provinceName]
    );
    const people = Number(rows[0]?.totalPeople);
    const family = Number(rows[0]?.totalFamily);
    if (Number.isFinite(people) && Number.isFinite(family) && family > 0) return people / family;
  } catch (error) {
    console.error("[repo] provinceHouseholdSize failed (legacy table missing?):", error);
  }
  return FALLBACK_HOUSEHOLD_SIZE;
}

interface ProvinceRow extends RowDataPacket {
  name: string;
  lat: string | number;
  lng: string | number;
  avgElev: number;
}

/** พิกัดศาลากลาง + ความสูงเฉลี่ยของทั้ง 77 จังหวัด จากตาราง `province` ของระบบเดิม (legacy, อ่านอย่างเดียว)
 *  lat/lng ของแถวคือพิกัดศาลากลางจังหวัด ใช้เป็นจุดเริ่มต้นเส้นทางรถยนต์ + จุดอ้างอิงความสูงเฉลี่ยจังหวัด
 *  อาจไม่มีตารางนี้ในบางสภาพแวดล้อม (เช่น production ที่ยังไม่ import legacy data) — คืน [] แล้วให้ผู้เรียก fallback */
export async function listProvinces(): Promise<ProvinceInfo[]> {
  const pool = await getPool();
  let rows: ProvinceRow[];
  try {
    [rows] = await pool.query<ProvinceRow[]>(
      `SELECT PROVINCE_NAME AS name, lat, lng, high AS avgElev FROM province`
    );
  } catch (error) {
    console.error("[repo] listProvinces failed (legacy table missing?):", error);
    return [];
  }
  return rows
    .map((r) => ({
      name: String(r.name).trim(),
      lat: Number(r.lat),
      lng: Number(r.lng),
      avgElev: Number(r.avgElev),
    }))
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
}

/** จังหวัดที่ใกล้ที่สุดจากพิกัด — เทียบระยะตรงกับพิกัดศาลากลางจังหวัดทั้ง 77 จังหวัด
 *  ⚠️ ใช้เป็น "fallback" สำหรับพิกัดอิสระเท่านั้น (เช่น ลากหมุดไปจุดที่ไม่มีข้อมูลโรงเรียน) — ไม่แม่นสำหรับ
 *  อำเภอชายขอบ เพราะอาจใกล้ศาลากลางของจังหวัดข้างเคียงมากกว่า (เช่น อ.ฝาง เชียงใหม่ ใกล้ศาลากลางเชียงราย)
 *  ถ้ารู้รหัสโรงเรียน ให้ใช้ schoolProvinceName() ซึ่งอ่านจังหวัดจริงจากทะเบียนแทน */
export function nearestProvince(provinces: ProvinceInfo[], lat: number, lng: number): ProvinceInfo | null {
  let best: ProvinceInfo | null = null;
  let bestD = Infinity;
  for (const p of provinces) {
    const d = (p.lat - lat) ** 2 + (p.lng - lng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** ชื่อจังหวัดที่โรงเรียนสังกัดจริง จากทะเบียนระบบเดิม `master_school.provinces` (คีย์ด้วย sc_smis = รหัสโรงเรียน 8 หลัก)
 *  แก้ปัญหาการเดาจังหวัดจากศาลากลางที่ใกล้ที่สุดซึ่งผิดสำหรับอำเภอชายขอบ — คืน null ถ้าไม่พบ/ตารางไม่มี */
export async function schoolProvinceName(schoolCode: string): Promise<string | null> {
  if (!schoolCode) return null;
  const pool = await getPool();
  try {
    const [rows] = await pool.query<(RowDataPacket & { provinces: string | null })[]>(
      "SELECT provinces FROM master_school WHERE sc_smis = ? LIMIT 1",
      [schoolCode]
    );
    const name = rows[0]?.provinces?.trim();
    return name ? name : null;
  } catch (error) {
    console.error("[repo] schoolProvinceName failed (legacy table missing?):", error);
    return null;
  }
}

/** ข้อมูลโรงเรียนสำหรับ prefill แบบประเมินจากแผนที่ (Task 4 /from-map) — รวมพิกัด + จังหวัดจากทะเบียนระบบเดิม
 *  คืน null ถ้าไม่พบพิกัดโรงเรียน (schoolLocationByCode ไม่พบ) — จังหวัดที่หาไม่เจอจะเป็นสตริงว่างแทน (ไม่ใช่ null ทั้งก้อน) */
export async function schoolAssessmentMaster(schoolCode: string): Promise<SchoolAssessmentMaster | null> {
  const [location, province] = await Promise.all([
    schoolLocationByCode(schoolCode),
    schoolProvinceName(schoolCode),
  ]);
  if (!location) return null;
  return {
    code: schoolCode,
    name: location.name,
    province: province ?? "",
    lat: location.lat,
    lng: location.lng,
  };
}

/** หา ProvinceInfo (พิกัดศาลากลาง + ความสูงเฉลี่ย) จากชื่อจังหวัด — เทียบแบบตัดช่องว่างปลาย, ตามด้วยเทียบแบบ substring
 *  (กันชื่อที่ต่างกันเล็กน้อย เช่น มี/ไม่มีคำว่า "จังหวัด") — คืน null ถ้าไม่พบ */
export function provinceByName(provinces: ProvinceInfo[], name: string): ProvinceInfo | null {
  const target = name.trim();
  if (!target) return null;
  return (
    provinces.find((p) => p.name === target) ??
    provinces.find((p) => p.name.includes(target) || target.includes(p.name)) ??
    null
  );
}

/** จังหวัดของโรงเรียน: ใช้จังหวัดจากทะเบียน (แม่นสุด) → จังหวัดที่ผู้ใช้กรอก → ศาลากลางที่ใกล้ที่สุด (fallback)
 *  รวม logic การเลือกไว้ที่เดียว เพื่อให้ทั้งหน้าแผนที่และ route /gis จับคู่จังหวัดตรงกัน */
export async function resolveSchoolProvince(
  provinces: ProvinceInfo[],
  opts: { schoolCode?: string | null; enteredProvince?: string | null; lat: number; lng: number }
): Promise<ProvinceInfo | null> {
  const registered = opts.schoolCode ? await schoolProvinceName(opts.schoolCode) : null;
  if (registered) {
    const match = provinceByName(provinces, registered);
    if (match) return match;
  }
  if (opts.enteredProvince) {
    const match = provinceByName(provinces, opts.enteredProvince);
    if (match) return match;
  }
  return nearestProvince(provinces, opts.lat, opts.lng);
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
