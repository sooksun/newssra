// ตัวเชื่อมต่อฐานข้อมูลเดิม ssrainfo_ssra สำหรับสคริปต์วิเคราะห์ (อ่านอย่างเดียว)
//
// ลำดับการหา credential:
//   1) .env.newssra ที่ราก repo  (LEGACY_DB_*)  ← ฐานจริงบน www.ssra.info
//   2) ตัวแปรแวดล้อม LEGACY_DB_*
//   3) snapshot ในเครื่อง (Laragon) — ค่าเริ่มต้น 127.0.0.1 / ssra_hist
//
// ห้าม commit .env.newssra (อยู่ใน .gitignore แล้ว)

import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const ROOT = path.resolve(import.meta.dirname, "..");

export function loadLegacyEnv() {
  const file = path.join(ROOT, ".env.newssra");
  const out = {};
  if (fs.existsSync(file)) {
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
  }
  return { ...out, ...process.env };
}

export function legacyConfig() {
  const env = loadLegacyEnv();
  const host = env.LEGACY_DB_HOST || "127.0.0.1";
  const user = env.LEGACY_DB_USER || "root";
  const password = env.LEGACY_DB_PASSWORD ?? "";
  const database = env.LEGACY_DB_NAME || (host === "127.0.0.1" || host === "localhost" ? "ssra_hist" : "ssrainfo_ssra");
  return {
    host,
    port: Number(env.LEGACY_DB_PORT || 3306),
    user,
    password,
    database,
    charset: "utf8mb4_general_ci",
    connectTimeout: Number(env.LEGACY_DB_TIMEOUT_MS || 15000),
    // ฐานเดิมเป็น MariaDB บน shared host — บางเครื่องต้องปิด SSL
    ssl: env.LEGACY_DB_SSL === "1" ? {} : undefined,
    dateStrings: true,
  };
}

const isLocal = (cfg) => cfg.host === "127.0.0.1" || cfg.host === "localhost";

/** ป้ายกำกับแหล่งข้อมูลแบบไม่ต้องคิวรี — ใช้เมื่อยังไม่มี connection */
export function sourceLabel(cfg) {
  return isLocal(cfg)
    ? `snapshot ในเครื่อง (ฐาน ${cfg.database})`
    : `ฐานข้อมูลจริง ${cfg.user}@${cfg.host}/${cfg.database}`;
}

/**
 * ป้ายกำกับแหล่งข้อมูลฉบับเต็ม — ถ้าเป็น snapshot จะอ่านตาราง `_snapshot_meta`
 * (สร้างโดย scripts/import-legacy-dump.mjs) เพื่อบอกว่า dump ถูกสร้างเมื่อไรและนำเข้าเมื่อไร
 */
export async function describeSource(conn, cfg) {
  if (!isLocal(cfg)) return sourceLabel(cfg);
  try {
    const [rows] = await conn.query("SELECT k, v FROM `_snapshot_meta`");
    const meta = Object.fromEntries(rows.map((r) => [r.k, r.v]));
    const parts = [];
    if (meta.dump_generated_at) parts.push(`dump สร้างเมื่อ ${meta.dump_generated_at}`);
    if (meta.imported_at) parts.push(`นำเข้าเมื่อ ${meta.imported_at}`);
    if (meta.source_file) parts.push(`จากไฟล์ ${meta.source_file}`);
    return parts.length
      ? `snapshot ในเครื่อง (ฐาน ${cfg.database} — ${parts.join(" · ")})`
      : sourceLabel(cfg);
  } catch {
    return `${sourceLabel(cfg)} — ไม่มีข้อมูลกำกับว่านำเข้าจาก dump ชุดใด ให้ใช้ scripts/import-legacy-dump.mjs เพื่อบันทึกที่มา`;
  }
}

/** ค่าเชื่อมต่อ snapshot ในเครื่อง — ใช้เมื่อฐานจริงเข้าไม่ถึง */
function snapshotConfig() {
  const env = loadLegacyEnv();
  return {
    host: "127.0.0.1",
    port: Number(env.LEGACY_SNAPSHOT_PORT || 3306),
    user: env.LEGACY_SNAPSHOT_USER || "root",
    password: env.LEGACY_SNAPSHOT_PASSWORD ?? "",
    database: env.LEGACY_SNAPSHOT_NAME || "ssra_hist",
    charset: "utf8mb4_general_ci",
    dateStrings: true,
  };
}

/**
 * เชื่อมต่อฐานเดิม — ถ้าตั้งค่าฐานจริงไว้แต่ต่อไม่ติด จะถอยไปใช้ snapshot ในเครื่องให้อัตโนมัติ
 * (ตั้ง LEGACY_DB_STRICT=1 ถ้าต้องการให้ล้มเหลวไปเลยแทนการถอย)
 */
export async function connectLegacy() {
  const env = loadLegacyEnv();
  const cfg = legacyConfig();
  const remote = !(cfg.host === "127.0.0.1" || cfg.host === "localhost");
  try {
    const conn = await mysql.createConnection(cfg);
    return { conn, cfg };
  } catch (err) {
    if (!remote || env.LEGACY_DB_STRICT === "1") throw err;
    const fb = snapshotConfig();
    console.error(
      `⚠️  ต่อฐานจริง ${cfg.user}@${cfg.host}:${cfg.port} ไม่ได้ (${err.code || err.message}) — ` +
        `ใช้ snapshot ในเครื่อง ${fb.database} แทน\n` +
        `    ถ้าเป็น ETIMEDOUT: shared host มักปิดพอร์ต 3306 จากภายนอก ต้องเพิ่ม IP ของเครื่องนี้ใน cPanel > Remote MySQL ก่อน`,
    );
    const conn = await mysql.createConnection(fb);
    return { conn, cfg: fb, fellBack: true, remoteError: err.code || err.message };
  }
}
