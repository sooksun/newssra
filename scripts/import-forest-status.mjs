#!/usr/bin/env node
/**
 * แปลง GeoJSON FeatureCollection (polygon ป่า) → data/forest-status/cells/{key}.json
 *
 * ใช้:
 *   node scripts/import-forest-status.mjs path/to/cover.geojson --year=2568
 *   node scripts/import-forest-status.mjs cover.geojson --year=2568 --out=data/forest-status
 *
 * พิกัดต้องเป็น WGS84 [lng, lat]
 * properties ที่รองรับ (optional): typeCode, typeLabelTh, forest_type, FOREST_TYPE, NAME
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith("--"));
const yearArg = args.find((a) => a.startsWith("--year="));
const outArg = args.find((a) => a.startsWith("--out="));
const yearBe = yearArg ? Number(yearArg.split("=")[1]) : 2568;
const outRoot = outArg ? outArg.split("=")[1] : path.join(process.cwd(), "data", "forest-status");

if (!input || !Number.isFinite(yearBe)) {
  console.error("Usage: node scripts/import-forest-status.mjs <geojson> --year=2568 [--out=data/forest-status]");
  process.exit(1);
}

const CELL = 0.5;

function cellKey(lat, lng) {
  const latCell = Math.floor(lat / CELL) * CELL;
  const lngCell = Math.floor(lng / CELL) * CELL;
  const fmt = (n) => (Object.is(n, -0) ? 0 : n).toFixed(1);
  return `${fmt(latCell)}_${fmt(lngCell)}`;
}

function ringCentroid(ring) {
  let slat = 0;
  let slng = 0;
  let n = 0;
  for (const p of ring) {
    if (!Array.isArray(p) || p.length < 2) continue;
    slng += Number(p[0]);
    slat += Number(p[1]);
    n += 1;
  }
  return n ? { lat: slat / n, lng: slng / n } : null;
}

function extractRings(geom) {
  if (!geom || typeof geom !== "object") return [];
  const t = geom.type;
  const c = geom.coordinates;
  if (t === "Polygon" && Array.isArray(c)) {
    // outer only
    return c[0] && Array.isArray(c[0]) && c[0].length >= 4 ? [c[0]] : [];
  }
  if (t === "MultiPolygon" && Array.isArray(c)) {
    return c.flatMap((poly) => (poly[0] && poly[0].length >= 4 ? [poly[0]] : []));
  }
  return [];
}

function propsType(props) {
  if (!props || typeof props !== "object") return { typeCode: null, typeLabelTh: null };
  const typeCode =
    typeof props.typeCode === "string"
      ? props.typeCode
      : typeof props.forest_type_code === "string"
        ? props.forest_type_code
        : null;
  const typeLabelTh =
    typeof props.typeLabelTh === "string"
      ? props.typeLabelTh
      : typeof props.forest_type === "string"
        ? props.forest_type
        : typeof props.FOREST_TYPE === "string"
          ? props.FOREST_TYPE
          : typeof props.NAME === "string"
            ? props.NAME
            : null;
  return { typeCode, typeLabelTh };
}

const raw = JSON.parse(await readFile(input, "utf8"));
const featuresIn = Array.isArray(raw.features) ? raw.features : [];
/** @type {Map<string, object[]>} */
const byCell = new Map();

let kept = 0;
for (const f of featuresIn) {
  const rings = extractRings(f?.geometry);
  if (!rings.length) continue;
  const { typeCode, typeLabelTh } = propsType(f.properties);
  const feature = { rings, typeCode, typeLabelTh };
  const c = ringCentroid(rings[0]);
  if (!c) continue;
  const key = cellKey(c.lat, c.lng);
  if (!byCell.has(key)) byCell.set(key, []);
  byCell.get(key).push(feature);
  kept += 1;
}

const cellsDir = path.join(outRoot, "cells");
await mkdir(cellsDir, { recursive: true });

for (const [key, features] of byCell) {
  const doc = {
    attribution: "กรมป่าไม้ — นำเข้าด้วย scripts/import-forest-status.mjs (ตรวจสอบ license ก่อนเผยแพร่)",
    dataSource: `RFD forest cover import · พ.ศ. ${yearBe}`,
    yearBe,
    authority: "rfd-forest-cover",
    gridResolutionM: null,
    features,
  };
  await writeFile(path.join(cellsDir, `${key}.json`), JSON.stringify(doc), "utf8");
}

console.log(`Wrote ${byCell.size} cells (${kept} polygons) → ${cellsDir}`);
console.log(`Year BE: ${yearBe}`);
