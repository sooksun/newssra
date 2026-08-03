// นำเข้า dump ของฐานเดิม ssrainfo_ssra ลง MySQL ในเครื่อง เพื่อใช้เป็น snapshot สำหรับสคริปต์วิเคราะห์
//
//   node scripts/import-legacy-dump.mjs "path/to/ssrainfo_ssra.sql" [--db=ssra_live] [--all]
//
// ค่าเริ่มต้นจะดึงเฉพาะตารางที่การวิเคราะห์ใช้ (ราว 70 MB จาก 440 MB) เพื่อให้นำเข้าเร็ว
// ใส่ --all ถ้าต้องการทั้งฐาน · ต้องมี mysql client ในเครื่อง (Laragon มีให้อยู่แล้ว)
//
// ปลอดภัย: สร้างฐานใหม่แยกต่างหาก ไม่แตะฐานเดิมที่มีอยู่ เว้นแต่ระบุชื่อซ้ำเอง

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");

/** ตารางที่สคริปต์วิเคราะห์ต้องใช้ */
export const REQUIRED_TABLES = [
  "highland_eval",
  "highland_eval_real",
  "highland_eval_realupdate",
  "highland_eval_edit",
  "highland_eval_hilltrib",
  "island_eval",
  "island_eval_edit",
  "citeria_highland",
  "citeria_highland_details",
  "citeria_master02",
  "citeria_master03",
  "citeria_master04",
  "citeria_master06",
  "citeria_master07",
  "citeria_master08",
  "citeria_master09",
  "citeria_master10",
  "citeria_master16",
  "island_master01",
  "island_master03",
  "island_master05",
  "island_master09",
  "island_master10",
  "island_master11",
  "island_master12",
  "island_master13",
  "master_school",
  "master_sao",
  "master_saonew",
  "master_province",
  "master_district",
  "master_subdistrict",
  "master_highlandtype",
  "master_islandtype",
  "master_type",
  "master_yesyno",
  "master_lgo",
  "master_viledges",
  "school_confirm",
  "school",
  "school_location",
  "school_ssra",
  "school_type",
  "screening_status",
  "confirmstatus",
  "opened",
  "open_status",
  "merge_status",
  "hilltrib",
  "notpass",
  "sao_approved",
  "sao_new",
];

/** ดึงเฉพาะตารางที่ต้องการออกจาก dump ขนาดใหญ่ (สตรีมทีละบรรทัด ไม่โหลดทั้งไฟล์) */
export async function extractTables(srcFile, outFile, tables = REQUIRED_TABLES) {
  const wanted = new Set(tables);
  const out = fs.createWriteStream(outFile, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: fs.createReadStream(srcFile, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let inHeader = true;
  let emit = false;
  const seen = new Set();
  for await (const line of rl) {
    const m = line.match(/^-- .*for table `([^`]+)`/);
    if (m) {
      emit = wanted.has(m[1]);
      inHeader = false;
      if (emit) seen.add(m[1]);
    }
    if (inHeader || emit) out.write(line + "\n");
  }
  await new Promise((res) => out.end(res));
  return { found: [...seen].sort(), missing: [...wanted].filter((t) => !seen.has(t)) };
}

function findMysqlClient() {
  const fromEnv = process.env.MYSQL_CLIENT;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const roots = ["D:/laragon/bin/mysql", "C:/laragon/bin/mysql"];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r)) {
      const p = path.join(r, d, "bin", "mysql.exe");
      if (fs.existsSync(p)) return p;
    }
  }
  return "mysql"; // หวังว่าอยู่ใน PATH
}

if (import.meta.filename === process.argv[1]) {
  const args = process.argv.slice(2);
  const src = args.find((a) => !a.startsWith("--"));
  if (!src) {
    console.error('ใช้: node scripts/import-legacy-dump.mjs "path/to/dump.sql" [--db=ssra_live] [--all]');
    process.exit(1);
  }
  const dbArg = args.find((a) => a.startsWith("--db="));
  const db = dbArg ? dbArg.slice(5) : "ssra_live";
  const all = args.includes("--all");
  const srcPath = path.resolve(ROOT, src);
  if (!fs.existsSync(srcPath)) {
    console.error("ไม่พบไฟล์:", srcPath);
    process.exit(1);
  }

  const mysql = findMysqlClient();
  const size = (fs.statSync(srcPath).size / 1024 / 1024).toFixed(0);
  console.error(`ไฟล์ต้นทาง: ${srcPath} (${size} MB)`);
  console.error(`mysql client: ${mysql}`);

  let importFile = srcPath;
  if (!all) {
    importFile = path.join(path.dirname(srcPath), `.subset-${db}.sql`);
    console.error("กำลังดึงเฉพาะตารางที่ใช้วิเคราะห์…");
    const { found, missing } = await extractTables(srcPath, importFile);
    console.error(`  ได้ ${found.length} ตาราง${missing.length ? " · ไม่พบในไฟล์: " + missing.join(", ") : ""}`);
    console.error(`  ขนาดหลังตัด: ${(fs.statSync(importFile).size / 1024 / 1024).toFixed(0)} MB`);
  }

  const user = process.env.LEGACY_SNAPSHOT_USER || "root";
  const pass = process.env.LEGACY_SNAPSHOT_PASSWORD || "";
  const base = ["-h", "127.0.0.1", "-u", user, ...(pass ? [`-p${pass}`] : []), "--default-character-set=utf8mb4"];

  // ฐานเดิมของ dump ไม่มี DROP TABLE นำหน้า ถ้าฐานปลายทางมีตารางอยู่แล้วจะ import ทับไม่ได้
  // จึงต้องล้างฐานก่อน — แต่ล้างเฉพาะฐานที่สคริปต์นี้เป็นคนสร้าง (ดูจากตาราง _snapshot_meta)
  // ฐานอื่นต้องยืนยันด้วย --force เพื่อกันลบข้อมูลของจริงโดยไม่ตั้งใจ
  const probe = spawnSync(
    mysql,
    [
      ...base,
      "-N",
      "-e",
      `SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='${db}';` +
        `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${db}';` +
        `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${db}' AND table_name='_snapshot_meta';`,
    ],
    { encoding: "utf8" },
  );
  const [dbExists, tableCount, hasMeta] = probe.stdout.trim().split(/\s+/).map(Number);

  if (dbExists && tableCount > 0) {
    if (!hasMeta && !args.includes("--force")) {
      console.error(
        `\n❌ ฐาน \`${db}\` มีตารางอยู่แล้ว ${tableCount} ตาราง และไม่ใช่ snapshot ที่สคริปต์นี้สร้าง\n` +
          `   ถ้าต้องการล้างทิ้งแล้วนำเข้าใหม่ ให้ระบุ --force · หรือเลือกชื่อฐานอื่นด้วย --db=<ชื่อ>`,
      );
      process.exit(1);
    }
    console.error(`ล้างฐาน \`${db}\` (${tableCount} ตาราง) ก่อนนำเข้าใหม่…`);
    const drop = spawnSync(mysql, [...base, "-e", `DROP DATABASE \`${db}\`;`], { encoding: "utf8" });
    if (drop.status !== 0) {
      console.error("ล้างฐานไม่สำเร็จ:", drop.stderr || drop.stdout);
      process.exit(1);
    }
  }

  console.error(`สร้างฐาน \`${db}\`…`);
  const create = spawnSync(
    mysql,
    [...base, "-e", `CREATE DATABASE IF NOT EXISTS \`${db}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;`],
    { encoding: "utf8" },
  );
  if (create.status !== 0) {
    console.error("สร้างฐานไม่สำเร็จ:", create.stderr || create.stdout);
    process.exit(1);
  }

  console.error("กำลังนำเข้า… (ใช้เวลาสักครู่)");
  const imp = spawnSync(`"${mysql}" ${base.map((b) => (b.includes(" ") ? `"${b}"` : b)).join(" ")} ${db} < "${importFile}"`, {
    shell: true,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (imp.status !== 0) {
    console.error("นำเข้าไม่สำเร็จ:", imp.stderr || imp.stdout);
    process.exit(1);
  }
  if (!all && fs.existsSync(importFile)) fs.unlinkSync(importFile);

  // บันทึกที่มาของ snapshot ไว้ในฐาน เพื่อให้รายงานอ้างอิงได้ว่าข้อมูลชุดนี้มาจาก dump ไหน
  const header = fs.readFileSync(srcPath, { encoding: "utf8", flag: "r" }).slice(0, 600);
  const genAt = header.match(/^-- Generation Time:\s*(.+)$/m)?.[1]?.trim() ?? "(ไม่ทราบ)";
  const esc = (s) => String(s).replace(/'/g, "''");
  const metaSql =
    "CREATE TABLE IF NOT EXISTS `_snapshot_meta` (k VARCHAR(50) NOT NULL PRIMARY KEY, v VARCHAR(255) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;" +
    "REPLACE INTO `_snapshot_meta` (k, v) VALUES " +
    `('source_file','${esc(path.basename(srcPath))}'),` +
    `('dump_generated_at','${esc(genAt)}'),` +
    `('imported_at','${esc(new Date().toISOString())}'),` +
    `('subset','${all ? "ทั้งฐาน" : "เฉพาะตารางที่ใช้วิเคราะห์"}');`;
  const meta = spawnSync(mysql, [...base, db, "-e", metaSql], { encoding: "utf8" });
  if (meta.status !== 0) console.error("⚠️ บันทึก _snapshot_meta ไม่สำเร็จ:", meta.stderr || meta.stdout);

  const check = spawnSync(
    mysql,
    [...base, "-N", db, "-e", "SELECT COUNT(*) FROM highland_eval; SELECT COUNT(*) FROM school_confirm;"],
    { encoding: "utf8" },
  );
  console.error("นำเข้าเสร็จ · highland_eval / school_confirm =", check.stdout.trim().split(/\s+/).join(" / "));
  console.error(`\nขั้นต่อไป: ตั้ง LEGACY_SNAPSHOT_NAME=${db} ใน .env.newssra แล้วสั่ง npm run legacy:report`);
}
