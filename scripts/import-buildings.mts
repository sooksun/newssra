// Pre-warm ตารางผังอาคาร: นำเข้า Microsoft Building Footprints ของประเทศไทยทุก quadkey ลง MySQL ล่วงหน้า
// เพื่อให้ /api/buildings ตอบจาก SQL ในหลักร้อย ms เสมอ (ไม่มีใครต้องรอสตรีมไฟล์ ~นาทีอีก)
//
// รัน:  npm run buildings:import              → นำเข้าทุก quadkey ของไทยที่ยังไม่มี (ข้ามที่ทำแล้ว — สั่งซ้ำได้/ทำต่อจากที่ค้าง)
//       npm run buildings:import -- --force   → นำเข้าใหม่ทั้งหมดทับของเดิม
//       npm run buildings:import -- --quadkey 132201123   → เฉพาะ quadkey เดียว
// ใช้เวลาทั้งประเทศราว 30–90 นาที (ครั้งเดียว) ขึ้นกับเน็ต/เครื่อง — กด Ctrl+C แล้วรันใหม่ได้ ทำต่อจากเดิม
// ไฟล์เป็น .mts (บังคับ ESM) เพราะใช้ top-level await; รันผ่าน tsx (devDependency) เพื่อ import โมดูลแอปตรง ๆ ไม่มี logic ซ้ำสองที่

try {
  process.loadEnvFile(".env.local");
} catch {
  // ไม่มี .env.local ก็ใช้ env ที่ตั้งมาแล้ว (เช่น รันบนเซิร์ฟเวอร์ที่ export ค่าไว้)
}

// dynamic import หลังโหลด env — กัน import hoisting แตะโมดูลฐานข้อมูลก่อน env พร้อม
const { getPool } = await import("../lib/db");
const { importQuadkeyToDb, listThailandQuadkeys } = await import("../lib/map/msBuildings");

const args = process.argv.slice(2);
const force = args.includes("--force");
const quadkeyFlag = args.indexOf("--quadkey");
const onlyQuadkey = quadkeyFlag !== -1 ? args[quadkeyFlag + 1] : null;

const pool = await getPool();
const quadkeys = onlyQuadkey ? [onlyQuadkey] : await listThailandQuadkeys();
console.log(`[buildings:import] ประเทศไทยมี ${quadkeys.length} quadkey (zoom 9)`);

let done = new Set<string>();
try {
  const [doneRows] = await pool.query<import("mysql2/promise").RowDataPacket[]>(
    "SELECT quadkey FROM map_buildings_meta"
  );
  done = new Set((doneRows as { quadkey: string }[]).map((r) => r.quadkey));
} catch {
  // ตาราง meta ยังไม่ถูกสร้าง (ยังไม่เคยมีการนำเข้า) — importQuadkeyToDb จะสร้างให้เอง
}

let imported = 0;
let skipped = 0;
let totalBuildings = 0;
const t0 = Date.now();

for (const [i, qk] of quadkeys.entries()) {
  if (!force && done.has(qk)) {
    skipped++;
    continue;
  }
  const tStart = Date.now();
  process.stdout.write(`[${i + 1}/${quadkeys.length}] ${qk} … `);
  try {
    const count = await importQuadkeyToDb(qk);
    totalBuildings += count;
    imported++;
    console.log(`${count.toLocaleString()} อาคาร (${((Date.now() - tStart) / 1000).toFixed(1)}s)`);
  } catch (error) {
    console.log(`ล้มเหลว: ${error instanceof Error ? error.message : error} — ข้าม (รันใหม่เพื่อลองอีกครั้ง)`);
  }
}

console.log(
  `[buildings:import] เสร็จ: นำเข้า ${imported} quadkey (${totalBuildings.toLocaleString()} อาคาร), ` +
  `ข้ามที่ทำแล้ว ${skipped} — ใช้เวลา ${((Date.now() - t0) / 60000).toFixed(1)} นาที`
);
process.exit(0);
