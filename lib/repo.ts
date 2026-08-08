// Repository ของแบบประเมิน — จุดเดียวที่แตะตาราง assessments
// หลักการ: state JSON คือ source of truth, summary columns คำนวณโดย server ทุกครั้งที่บันทึก

import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
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
import { COMMUNITY_LIST_UNINDEXED_KEY, isCommunityCompositeKey } from "./community-class";
import { computeCommunityClass } from "./gis";
import type { TreasuryDesignation } from "./highland-screen";
import { applyMapGisToState, fillBlankUnitFromMaster } from "./map-assessment";
import type { MapAssessmentSaveResult, SaveAssessmentFromMapInput, SchoolAssessmentMaster } from "./map-assessment";
import { isSchoolPinSubmitted, resolvePinCoord, schoolPinStatus, type SchoolPin } from "./school-pins";
import { sanitizeState } from "./state";

export type { SchoolPin } from "./school-pins";

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

interface SchoolPinRow extends RowDataPacket {
  id: number;
  owner_school_code: string | null;
  unit_name: string | null;
  level_key: string | null;
  state_name: string | null;
  lat: string | null;
  lng: string | null;
  submitted: unknown; // JSON_EXTRACT(state,'$.submitted') → boolean/1/0/"true" ตาม driver
}

function toSchoolPin(row: SchoolPinRow, coord: { lat: number; lng: number }): SchoolPin {
  return {
    id: row.id,
    name: row.state_name || row.unit_name || `แบบประเมิน #${row.id}`,
    lat: coord.lat,
    lng: coord.lng,
    status: schoolPinStatus({ submitted: isSchoolPinSubmitted(row.submitted), levelKey: row.level_key ?? "" }),
  };
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
  const cc = state.gis ? (state.gis.communityClass ?? computeCommunityClass(state.gis)) : null;
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

// ── INSERT/UPDATE ของ assessments ที่ createAssessment/saveAssessment/saveAssessmentFromMapOnce ใช้ร่วมกัน ──
// เดิม 3 ที่นี้คัดลอกรายชื่อคอลัมน์ 17 คอลัมน์ซ้ำกัน (ความเสี่ยง drift จริงเพราะเป็น summary column ที่ derive
// จาก state) — รวมไว้ที่เดียว: SHARED_SUMMARY_COLUMNS + summaryColumnValues() คุมลำดับคอลัมน์/ค่าให้ตรงกันเสมอ
// owner_user_id/owner_school_code ไม่รวมอยู่ในชุดนี้เพราะตั้งครั้งเดียวตอนสร้างแถว (INSERT เท่านั้น ไม่มีใน UPDATE)

/** ลำดับคอลัมน์ต้องตรงกับ summaryColumnValues() เป๊ะ (ทั้ง INSERT และ UPDATE ใช้ลำดับเดียวกัน) */
const SHARED_SUMMARY_COLUMNS = [
  "state",
  "unit_name",
  "unit_code",
  "assessment_year",
  "province",
  "unit_type",
  "total_score",
  "level_key",
  "level_label",
  "community_class_key",
  "community_class_label",
  "setting_type",
  "signed",
  "submitted_ref",
  "submitted_at",
] as const;

function summaryColumnValues(indexed: AssessmentState, s: ReturnType<typeof summaryValues>) {
  return [
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
  ];
}

/** ตัวรัน query ที่ createAssessment/saveAssessment ใช้ pool ตรง ๆ ส่วน saveAssessmentFromMapOnce ใช้
 *  PoolConnection ที่อยู่ใน transaction เดียวกัน — ทั้งสองแบบมี .query() หน้าตาเหมือนกัน (mysql2/promise) */
type SqlExecutor = Pool | PoolConnection;

/** INSERT แถว assessments ใหม่ — ใช้ร่วมกันทั้ง createAssessment (pool) และ saveAssessmentFromMapOnce (conn ใน transaction) */
async function insertAssessmentRow(
  executor: SqlExecutor,
  indexed: AssessmentState,
  owner: { userId: number | null; schoolCode: string | null },
): Promise<number> {
  const s = summaryValues(indexed);
  const [result] = await executor.query<ResultSetHeader>(
    `INSERT INTO assessments
      (${SHARED_SUMMARY_COLUMNS.join(", ")}, owner_user_id, owner_school_code)
     VALUES (${SHARED_SUMMARY_COLUMNS.map(() => "?").join(", ")}, ?, ?)`,
    [...summaryColumnValues(indexed, s), owner.userId, owner.schoolCode],
  );
  return result.insertId;
}

/** UPDATE แถว assessments ที่มีอยู่ — ใช้ร่วมกันทั้ง saveAssessment (pool) และ saveAssessmentFromMapOnce (conn ใน transaction)
 *  ไม่แตะ owner_user_id/owner_school_code (เจ้าของตั้งครั้งเดียวตอนสร้าง ไม่เปลี่ยนภายหลัง) */
async function updateAssessmentRow(executor: SqlExecutor, id: number, indexed: AssessmentState): Promise<number> {
  const s = summaryValues(indexed);
  const [result] = await executor.query<ResultSetHeader>(
    `UPDATE assessments SET ${SHARED_SUMMARY_COLUMNS.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
    [...summaryColumnValues(indexed, s), id],
  );
  return result.affectedRows;
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
  const key = raw === COMMUNITY_LIST_UNINDEXED_KEY || isCommunityCompositeKey(raw) ? raw : null;
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
      [viewer.schoolCode, ...cf.args, ...pageArgs],
    );
    return rows.map(rowToSummary);
  }
  const where = cf.sql ? `WHERE 1=1${cf.sql}` : "";
  const [rows] = await pool.query<AssessmentRow[]>(
    `SELECT ${SUMMARY_COLUMNS} FROM assessments ${where} ORDER BY updated_at DESC${pageSql}`,
    [...cf.args, ...pageArgs],
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
      [viewer.schoolCode, ...cf.args],
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

/** หมุดภาพรวมโรงเรียนทุกแห่งที่มีแบบประเมิน (สำหรับ admin/ssra บนแผนที่มุมมองทั้งประเทศ):
 *  แถวล่าสุดต่อ owner_school_code → พิกัดจากแบบประเมิน (fallback ทะเบียนโรงเรียน) + สถานะร่าง/ผ่าน/ไม่ผ่าน
 *  ใช้ level_key (คอลัมน์สรุป cache) เพื่อความเร็ว — สอดคล้องกับหน้า list; dashboard คือที่ recompute สด */
export async function listSchoolPins(): Promise<SchoolPin[]> {
  const pool = await getPool();
  const [rows] = await pool.query<SchoolPinRow[]>(
    `SELECT a.id, a.owner_school_code, a.unit_name, a.level_key,
            JSON_UNQUOTE(JSON_EXTRACT(a.state, '$.unit.name')) AS state_name,
            JSON_UNQUOTE(JSON_EXTRACT(a.state, '$.unit.lat'))  AS lat,
            JSON_UNQUOTE(JSON_EXTRACT(a.state, '$.unit.lng'))  AS lng,
            JSON_EXTRACT(a.state, '$.submitted')               AS submitted
       FROM assessments a
       JOIN (
         SELECT owner_school_code, MAX(updated_at) AS mx
           FROM assessments
          WHERE owner_school_code IS NOT NULL AND owner_school_code <> ''
          GROUP BY owner_school_code
       ) t ON t.owner_school_code = a.owner_school_code AND t.mx = a.updated_at
      ORDER BY a.id`,
  );

  // de-dup ต่อโรงเรียน (กัน MAX(updated_at) เสมอกัน 2 แถว) — ORDER BY a.id → แถว id สูงกว่าทับ = เลือกเสถียร
  const byCode = new Map<string, SchoolPinRow>();
  for (const row of rows) {
    if (row.owner_school_code) byCode.set(row.owner_school_code, row);
  }

  const pins: SchoolPin[] = [];
  const needFallback: { code: string; row: SchoolPinRow }[] = [];
  for (const [code, row] of byCode) {
    const coord = resolvePinCoord(row.lat, row.lng, null);
    if (coord) pins.push(toSchoolPin(row, coord));
    else needFallback.push({ code, row });
  }

  // แบบร่างที่ยังไม่กรอกพิกัด → fallback พิกัดทะเบียนโรงเรียน (school_location); หาไม่ได้ = ไม่แสดงหมุด
  // ดึงเป็นชุดเดียว (IN (...)) ไม่ใช่ query ต่อโรงเรียน — แบบร่างส่วนใหญ่ยังไม่มีพิกัด จึงเคยกลายเป็น
  // N+1 ที่ยิงหลักพัน query ต่อการเปิดแผนที่ภาพรวมหนึ่งครั้ง
  const fallbackLocations = await schoolLocationsByCodes(needFallback.map((f) => f.code));
  for (const { code, row } of needFallback) {
    const loc = fallbackLocations.get(code);
    const coord = resolvePinCoord(loc?.lat, loc?.lng, null);
    if (coord) pins.push(toSchoolPin(row, coord));
  }

  return pins;
}

export async function getAssessment(id: number): Promise<AssessmentRecord | null> {
  const pool = await getPool();
  const [rows] = await pool.query<AssessmentRow[]>(
    `SELECT id, state, owner_user_id, owner_school_code, created_at, updated_at FROM assessments WHERE id = ? LIMIT 1`,
    [id],
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
    [schoolCode, year],
  );
  return rows.length ? rowToRecord(rows[0]) : null;
}

/** ดึงรหัสโรงเรียนเจ้าของแบบประเมิน เพื่อตรวจสิทธิ์ในชั้น route
 *  - undefined = ไม่พบแบบประเมิน
 *  - null = มีอยู่แต่ไม่มีเจ้าของโรงเรียน (แถวที่ admin/ssra สร้าง หรือแถวเดิมก่อนมีระบบ auth)
 *  - string = รหัสโรงเรียนเจ้าของ */
export async function getAssessmentOwnerSchoolCode(id: number): Promise<string | null | undefined> {
  const pool = await getPool();
  const [rows] = await pool.query<AssessmentRow[]>(`SELECT owner_school_code FROM assessments WHERE id = ? LIMIT 1`, [
    id,
  ]);
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
  return insertAssessmentRow(pool, indexed, owner);
}

export async function saveAssessment(id: number, state: AssessmentState): Promise<AssessmentSummary | null> {
  const pool = await getPool();
  const indexed = reindexCommunityOnState(state);
  const affectedRows = await updateAssessmentRow(pool, id, indexed);
  if (affectedRows === 0) return null;

  const [rows] = await pool.query<AssessmentRow[]>(`SELECT ${SUMMARY_COLUMNS} FROM assessments WHERE id = ? LIMIT 1`, [
    id,
  ]);
  return rows.length ? rowToSummary(rows[0]) : null;
}

/**
 * บันทึกผล GIS จากแผนที่ 3 มิติลงแบบประเมินของปีปัจจุบัน แบบ atomic ทั้งก้อน (สร้าง/ปรับปรุง/ล็อก + คำตอบมิติ 3
 * ต้องอยู่ transaction เดียวกัน) ใช้แถวเดียวต่อ (owner_school_code, assessment_year) คุ้มครองด้วย
 * SELECT ... FOR UPDATE + unique key `uq_owner_school_year` กันแข่งกันสร้างซ้ำตอนมีคำขอพร้อมกัน
 */
async function saveAssessmentFromMapOnce(
  conn: PoolConnection,
  input: SaveAssessmentFromMapInput,
): Promise<MapAssessmentSaveResult> {
  await conn.beginTransaction();
  try {
    const [rows] = await conn.query<AssessmentRow[]>(
      `SELECT id, state, owner_user_id, owner_school_code, created_at, updated_at
         FROM assessments
        WHERE owner_school_code = ? AND assessment_year = ?
        LIMIT 1
        FOR UPDATE`,
      [input.schoolCode, input.year],
    );

    if (rows.length) {
      const existing = rowToRecord(rows[0]);
      if (existing.state.submitted) {
        // ยื่นแล้ว — ห้ามแตะ GIS/คะแนน คืนสถานะเดิมทั้งหมด (ล็อก)
        await conn.commit();
        return { assessmentId: existing.id, action: "locked", state: existing.state };
      }
      const stateWithMasterFields = input.master
        ? fillBlankUnitFromMaster(existing.state, input.master, input.year)
        : existing.state;
      const nextState = reindexCommunityOnState(
        applyMapGisToState(stateWithMasterFields, input.gis, { syncUnitLocation: input.syncUnitLocation }),
      );
      await updateAssessmentRow(conn, existing.id, nextState);
      await conn.commit();
      return { assessmentId: existing.id, action: "updated", state: nextState };
    }

    const nextState = reindexCommunityOnState(
      applyMapGisToState(input.initialState, input.gis, { syncUnitLocation: input.syncUnitLocation }),
    );
    const insertId = await insertAssessmentRow(conn, nextState, {
      userId: input.ownerUserId,
      schoolCode: input.schoolCode,
    });
    await conn.commit();
    return { assessmentId: insertId, action: "created", state: nextState };
  } catch (error) {
    await conn.rollback();
    throw error;
  }
}

/** error code ที่ "ลองใหม่อีกครั้งเดียว" แล้วมักสำเร็จ — ไม่ใช่ bug เชิงตรรกะ แค่การแข่งกันของธุรกรรมคู่ขนาน:
 *  - ER_DUP_ENTRY: สอง request ชนกันตอนยังไม่มีแถว (unique key ทำให้ INSERT ที่แพ้ชนคีย์ซ้ำ)
 *  - ER_LOCK_DEADLOCK: สอง connection ถือ gap lock จาก SELECT ... FOR UPDATE คนละลำดับกัน แล้ว MySQL
 *    เลือกยกเลิกธุรกรรมหนึ่งฝ่ายเพื่อคลายเดดล็อก — ฝ่ายที่ถูกยกเลิกไม่ได้ค้างอะไรไว้จริง ลองใหม่จึงมักผ่าน
 *  - ER_LOCK_WAIT_TIMEOUT: รอปล่อยล็อกจากอีกฝ่ายนานเกิน innodb_lock_wait_timeout — พอฝ่ายนั้นปล่อยแล้ว
 *    รอบถัดไปมักผ่านทันที
 *  ทั้งสามกรณีนี้รอบสองจะเจอแถวที่ได้ล็อกไปแล้วจาก SELECT ... FOR UPDATE และตัดสินใจ updated/locked ตามจริง */
const RETRYABLE_TRANSACTION_ERROR_CODES = new Set(["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]);

export async function saveAssessmentFromMapAtomic(input: SaveAssessmentFromMapInput): Promise<MapAssessmentSaveResult> {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    try {
      return await saveAssessmentFromMapOnce(conn, input);
    } catch (error) {
      // ลองใหม่อีกครั้งเดียวเท่านั้น (ไม่วนลูป) — ดูเหตุผลแต่ละ error code ที่คอมเมนต์ค่าคงที่ด้านบน
      const code = (error as { code?: string } | null)?.code;
      if (!code || !RETRYABLE_TRANSACTION_ERROR_CODES.has(code)) throw error;
      return await saveAssessmentFromMapOnce(conn, input);
    }
  } finally {
    conn.release();
  }
}

/** ฟังก์ชันแปลง state ที่ mutateAssessmentStateAtomic เรียกใต้ล็อกแถว — ได้รับ state สดจาก DB เสมอ
 *  คืน state ใหม่เพื่อบันทึก หรือคืน null เพื่อยกเลิก (ไม่เขียนอะไรเลย) เช่นพบว่าแถวถูกยื่นไปแล้ว */
export type AssessmentMutation = (current: AssessmentState) => AssessmentState | null;

export interface AtomicMutateResult {
  /** false = ไม่พบแถว id นี้ */
  found: boolean;
  /** false = mutate คืน null (ผู้เรียกยกเลิกเอง) — ไม่มีการเขียน */
  applied: boolean;
  /** state ที่อยู่ใน DB หลังจบ (ถ้า applied=false คือ state เดิมที่อ่านมา) */
  state: AssessmentState | null;
  summary: AssessmentSummary | null;
}

/**
 * อ่าน state ปัจจุบัน → แปลง → เขียนกลับ ภายใน transaction เดียวที่ล็อกแถวไว้ด้วย SELECT ... FOR UPDATE
 *
 * ทำไมต้องมี: ก่อนหน้านี้เส้นทางที่ "อ่านแถวมาแล้ว merge แล้วเขียนทั้งแถวกลับ" (autosave PUT, บันทึกภาพ
 * snapshot, บันทึกผลวิเคราะห์ AI) ต่างคนต่างอ่านนอกล็อก ถ้าสองคำขอคาบเกี่ยวกัน คนที่เขียนทีหลังจะทับงาน
 * ของคนแรกด้วย state ที่อ่านมาก่อนหน้า — ข้อมูลหายเงียบโดยไม่มี error ให้เห็น
 * (รูปแบบเดียวกับ saveAssessmentFromMapOnce ที่ใช้ FOR UPDATE อยู่แล้ว — รวมมาใช้ซ้ำได้ทุกเส้นทาง)
 */
export async function mutateAssessmentStateAtomic(id: number, mutate: AssessmentMutation): Promise<AtomicMutateResult> {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    try {
      const [rows] = await conn.query<AssessmentRow[]>(
        `SELECT id, state FROM assessments WHERE id = ? LIMIT 1 FOR UPDATE`,
        [id],
      );
      if (!rows.length) {
        await conn.rollback();
        return { found: false, applied: false, state: null, summary: null };
      }

      const current = parseState(rows[0].state);
      const next = mutate(current);
      if (!next) {
        await conn.rollback();
        return { found: true, applied: false, state: current, summary: null };
      }

      const indexed = reindexCommunityOnState(next);
      await updateAssessmentRow(conn, id, indexed);
      const [summaryRows] = await conn.query<AssessmentRow[]>(
        `SELECT ${SUMMARY_COLUMNS} FROM assessments WHERE id = ? LIMIT 1`,
        [id],
      );
      await conn.commit();
      return {
        found: true,
        applied: true,
        state: indexed,
        summary: summaryRows.length ? rowToSummary(summaryRows[0]) : null,
      };
    } catch (error) {
      await conn.rollback();
      throw error;
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
    [`พสศ-${year}-%`],
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
    [cap],
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
    [schoolCode],
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

interface SchoolLocationBatchRow extends SchoolLocationRow {
  sc_smis: string | null;
}

/** แปลงแถว master_school ⨝ school_location เป็นพิกัดที่ใช้ได้ — คืน null ถ้าพิกัดว่าง/เป็น (0,0) */
function rowToOwnerCoords(row: SchoolLocationRow): OwnerCoords | null {
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng, name: row.sname || row.sc_name || "โรงเรียนของฉัน" };
}

/** พิกัดทะเบียนของหลายโรงเรียนในคำขอเดียว (คีย์ = รหัส 8 หลักที่ส่งเข้ามา) — ใช้แทนการยิง
 *  schoolLocationByCode ทีละโรงเรียนในลูป; รหัสที่หาไม่พบ/พิกัดใช้ไม่ได้จะไม่มีคีย์ใน Map
 *  ตาราง legacy อาจไม่มีในบางสภาพแวดล้อม — จับ error แล้วคืน Map ว่าง (เหมือน schoolLocationByCode) */
export async function schoolLocationsByCodes(schoolCodes: string[]): Promise<Map<string, OwnerCoords>> {
  const out = new Map<string, OwnerCoords>();
  const codes = Array.from(new Set(schoolCodes.filter((c) => c)));
  if (codes.length === 0) return out;
  const pool = await getPool();
  let rows: SchoolLocationBatchRow[];
  try {
    [rows] = await pool.query<SchoolLocationBatchRow[]>(
      `SELECT ms.sc_smis AS sc_smis, sl.lat AS lat, sl.lng AS lng, sl.sname AS sname, ms.sc_name AS sc_name
         FROM master_school ms
         JOIN school_location sl ON sl.id = ms.sc_id
        WHERE ms.sc_smis IN (?)`,
      [codes],
    );
  } catch (error) {
    console.error("[repo] schoolLocationsByCodes failed (legacy tables missing?):", error);
    return out;
  }
  for (const row of rows) {
    const code = row.sc_smis?.trim();
    if (!code || out.has(code)) continue; // แถวแรกของแต่ละรหัสชนะ (เทียบเท่า LIMIT 1 ของแบบเดี่ยว)
    const coords = rowToOwnerCoords(row);
    if (coords) out.set(code, coords);
  }
  return out;
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
      [schoolCode],
    );
  } catch (error) {
    console.error("[repo] schoolLocationByCode failed (legacy tables missing?):", error);
    return null;
  }
  const row = rows[0];
  if (!row) return null;
  return rowToOwnerCoords(row);
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
      [provinceName],
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
    [rows] = await pool.query<ProvinceRow[]>(`SELECT PROVINCE_NAME AS name, lat, lng, high AS avgElev FROM province`);
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
      [schoolCode],
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
  const [location, province] = await Promise.all([schoolLocationByCode(schoolCode), schoolProvinceName(schoolCode)]);
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
  opts: { schoolCode?: string | null; enteredProvince?: string | null; lat: number; lng: number },
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

/** เพดานจำนวนแถวที่หน้าสรุปความคิดเห็นจะดึงมาในครั้งเดียว — เหตุผลเดียวกับ DASHBOARD_ROW_CAP:
 *  query นี้ดึงคอลัมน์ state (JSON เต็มก้อน) ของทุกแถว การไม่มีเพดานทำให้หน่วยความจำโตตามจำนวนแบบประเมิน */
export const FEEDBACK_ROW_CAP = 5000;

/** ดึงความคิดเห็นของผู้ทดสอบจากทุกแบบประเมิน — ใช้สรุปผลการทดสอบกับผู้เกี่ยวข้อง (ไม่ใช่หน้าจอสำหรับผู้กรอกทั่วไป)
 *  จำกัดที่ FEEDBACK_ROW_CAP แถวเสมอ (ล่าสุดก่อน) — ผู้เรียกเทียบกับ countAllAssessments() เพื่อแจ้งผู้ใช้เมื่อถูกตัด */
export async function listAllFeedback(limit: number = FEEDBACK_ROW_CAP): Promise<FeedbackEntry[]> {
  const pool = await getPool();
  const cap = Number.isInteger(limit) && limit > 0 ? limit : FEEDBACK_ROW_CAP;
  const [rows] = await pool.query<AssessmentRow[]>(
    `SELECT id, state, unit_name, unit_code, updated_at FROM assessments ORDER BY updated_at DESC LIMIT ?`,
    [cap],
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

/**
 * โรงเรียนอยู่ในบัญชีสำนักงานในพื้นที่พิเศษตามประกาศกระทรวงการคลังหรือไม่ (ปีล่าสุดที่นำเข้า)
 *
 * ตาราง treasury_special_area นำเข้าจากไฟล์ประกาศเท่านั้น (npm run treasury:import) โรงเรียนกรอกเองไม่ได้
 * ใช้เปิดประตูด่านคัดกรองที่ 1 (lib/highland-screen.ts) — **ห้ามนำไปคิดคะแนน**
 *
 * รหัส: แอปใช้รหัส 8 หลัก (sc_smis) แต่บัญชีจับคู่ไว้กับ sc_id (10 หลัก) จึง join ผ่าน master_school
 * ตารางหาย/ยังไม่ได้นำเข้า → null (ไม่ throw) เพื่อให้ประตูอื่นทำงานต่อได้ตามปกติ
 */
export async function treasuryDesignationForSchool(schoolCode: string): Promise<TreasuryDesignation | null> {
  const code = String(schoolCode || "").trim();
  if (!code) return null;
  const pool = await getPool();
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT t.fiscal_year AS fiscalYear, t.announcement_ref AS announcementRef
         FROM treasury_special_area t
         JOIN master_school m ON m.sc_id = t.school_code
        WHERE (m.sc_smis = ? OR m.sc_id = ?)
        ORDER BY t.fiscal_year DESC
        LIMIT 1`,
      [code, code],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      fiscalYear: Number(row.fiscalYear),
      announcementRef: typeof row.announcementRef === "string" ? row.announcementRef : null,
    };
  } catch (error) {
    console.error("[repo] treasuryDesignationForSchool failed (ยังไม่ได้ npm run treasury:import?):", error);
    return null;
  }
}
