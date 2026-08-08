import assert from "node:assert/strict";
import test from "node:test";
import { buildForestAnalysis, type ForestStatusLayer } from "./forest-layers";
import { classifyHighlandScreen } from "./highland-screen";
import type { ForestOverlayResult } from "./map/forestBoundaries";

function forest(
  status: ForestOverlayResult["status"],
  authority: ForestOverlayResult["dataAuthority"] = "osm-reference",
): ForestOverlayResult {
  return {
    version: "fo-2",
    status,
    nearestDistanceM: status === "in" ? 0 : status === "near" ? 500 : status === "out" ? 5000 : null,
    zones:
      status === "in" || status === "near"
        ? [
            {
              name: "ป่าทดสอบ",
              kind: "national_park",
              relation: status === "in" ? "in" : "near",
              distanceM: status === "in" ? 0 : 500,
            },
          ]
        : [],
    dataAuthority: authority,
    dataSource: authority === "authoritative" ? "ทางการ" : "OSM",
    attribution: "©",
    calculatedAt: "t",
  };
}

function rfd(over: Partial<ForestStatusLayer> = {}): ForestStatusLayer {
  return {
    inside: 0,
    distanceM: 200,
    pct1km: 10,
    pct3km: 15,
    pct5km: 20,
    yearBe: 2568,
    gridResolutionM: 10,
    authority: "rfd-forest-cover",
    dataSource: "RFD",
    attribution: "กรมป่าไม้",
    ...over,
  };
}

test("elev ≥ 500 → candidate โดยไม่ต้องมีป่า", () => {
  const r = classifyHighlandScreen({
    schoolElevationM: 620,
    provinceAvgElev: 200,
    routeFullMaxElev: null,
    landformTh: "",
    accessSeverity: 1,
  });
  assert.equal(r.candidate, true);
  assert.equal(r.elevGate, true);
});

test("forestIn จาก OSM อ้างอิงอย่างเดียว + elev ต่ำ → ไม่ผ่านประตู", () => {
  const r = classifyHighlandScreen({
    schoolElevationM: 120,
    provinceAvgElev: 200,
    routeFullMaxElev: 150,
    landformTh: "พื้นราบปกติ",
    accessSeverity: 0,
    forestOverlay: forest("in", "osm-reference"),
  });
  assert.equal(r.elevGate, false);
  assert.equal(r.candidate, false);
  assert.equal(r.forestLegalContributes, false);
  assert.ok(r.reasons.some((x) => x.includes("OSM") || x.includes("อ้างอิง")));
});

test("forestIn ชั้นกฎหมายทางการ + elev ต่ำ → ผ่านประตู", () => {
  const r = classifyHighlandScreen({
    schoolElevationM: 120,
    provinceAvgElev: 200,
    routeFullMaxElev: 150,
    landformTh: "พื้นราบปกติ",
    accessSeverity: 0,
    forestOverlay: forest("in", "authoritative"),
  });
  assert.equal(r.candidate, true);
  assert.equal(r.forestLegalContributes, true);
});

test("RFD status context strong + elev ต่ำ → ผ่านประตู (core layer)", () => {
  const r = classifyHighlandScreen({
    schoolElevationM: 120,
    provinceAvgElev: 200,
    routeFullMaxElev: null,
    landformTh: "พื้นราบปกติ",
    accessSeverity: 0,
    forestAnalysis: buildForestAnalysis({
      status: rfd({ inside: 0, pct1km: 62.4, pct3km: 78.1, pct5km: 83.7 }),
      calculatedAt: "t",
    }),
  });
  assert.equal(r.forestContext, "strong");
  assert.equal(r.candidate, true);
  assert.equal(r.forestStatusContributes, true);
  assert.equal(r.forestMetrics?.forest_1km_pct, 62.4);
});

test("RFD context weak อย่างเดียว → ไม่ผ่าน; คู่ access ≥ 2 → ผ่าน", () => {
  const alone = classifyHighlandScreen({
    schoolElevationM: 120,
    provinceAvgElev: 200,
    routeFullMaxElev: null,
    landformTh: "พื้นราบปกติ",
    accessSeverity: 0,
    forestAnalysis: buildForestAnalysis({
      status: rfd({ inside: 0, pct1km: 20, pct3km: 25 }),
      calculatedAt: "t",
    }),
  });
  assert.equal(alone.forestContext, "weak");
  assert.equal(alone.candidate, false);

  const withAccess = classifyHighlandScreen({
    schoolElevationM: 120,
    provinceAvgElev: 200,
    routeFullMaxElev: null,
    landformTh: "พื้นราบปกติ",
    accessSeverity: 2,
    forestAnalysis: buildForestAnalysis({
      status: rfd({ inside: 0, pct1km: 20, pct3km: 25 }),
      calculatedAt: "t",
    }),
  });
  assert.equal(withAccess.candidate, true);
});

test("เมืองบนดอย: elev สูง + ชุมชนใหญ่ + ป่า 1 กม. ต่ำ → candidate แต่ reviewFlag", () => {
  const r = classifyHighlandScreen({
    schoolElevationM: 900,
    provinceAvgElev: 300,
    routeFullMaxElev: null,
    landformTh: "",
    accessSeverity: 0,
    popDensityPerKm2: 1200,
    forestAnalysis: buildForestAnalysis({
      status: rfd({ inside: 0, pct1km: 5, pct3km: 8, distanceM: 3000 }),
      calculatedAt: "t",
    }),
  });
  assert.equal(r.candidate, true); // จาก elev
  assert.equal(r.highElevUrban, true);
  assert.ok(r.reviewFlags.some((f) => f.includes("เมืองบนดอย") || f.includes("ชุมชนใหญ่")));
});

test("เกาะ + forestIn ทางการ → ไม่ดันประตู highland จากป่า", () => {
  const r = classifyHighlandScreen({
    schoolElevationM: 30,
    provinceAvgElev: 40,
    routeFullMaxElev: null,
    landformTh: "พื้นราบปกติ",
    accessSeverity: 3,
    forestOverlay: forest("in", "authoritative"),
    isIsland: true,
  });
  assert.equal(r.candidate, false);
  assert.ok(r.reasons.some((x) => x.includes("เกาะ")));
});

test("terrain highland (หุบเขา) → candidate", () => {
  const r = classifyHighlandScreen({
    schoolElevationM: 400,
    provinceAvgElev: 350,
    routeFullMaxElev: null,
    landformTh: "โรงเรียนในหุบเขาแคบ",
    accessSeverity: 2,
  });
  assert.equal(r.terrainHighland, true);
  assert.equal(r.candidate, true);
});

// ── ประตูที่ 6: ประกาศกระทรวงการคลัง (บัญชีสำนักงานในพื้นที่พิเศษ) ──────────────

test("ประกาศคลัง → ผ่านประตูแม้ไม่มีสัญญาณภูมิประเทศเลย", () => {
  const plain = {
    schoolElevationM: 120,
    provinceAvgElev: 200,
    routeFullMaxElev: null,
    landformTh: "",
    accessSeverity: 0,
  };
  const without = classifyHighlandScreen(plain);
  assert.equal(without.candidate, false);

  const withTreasury = classifyHighlandScreen({
    ...plain,
    treasuryDesignation: { fiscalYear: 2569, announcementRef: "กค 0408.5/ว 95" },
  });
  assert.equal(withTreasury.candidate, true);
  assert.equal(withTreasury.treasuryDesignated, true);
  assert.ok(withTreasury.reasons.some((r) => r.includes("กระทรวงการคลัง")));
  assert.ok(withTreasury.reasons.some((r) => r.includes("2569")));
});

test("ประกาศคลังไม่แตะสัญญาณอื่น — elevGate/terrain/ป่า ต้องคงค่าเดิม", () => {
  const base = {
    schoolElevationM: 120,
    provinceAvgElev: 200,
    routeFullMaxElev: null,
    landformTh: "",
    accessSeverity: 0,
  };
  const r = classifyHighlandScreen({ ...base, treasuryDesignation: { fiscalYear: 2569 } });
  assert.equal(r.elevGate, false);
  assert.equal(r.terrainHighland, false);
  assert.equal(r.forestStatusContributes, false);
  assert.equal(r.forestLegalContributes, false);
});

test("ไม่มีประกาศคลัง → treasuryDesignated=false และไม่มีเหตุผลเรื่องประกาศ", () => {
  const r = classifyHighlandScreen({
    schoolElevationM: 620,
    provinceAvgElev: 200,
    routeFullMaxElev: null,
    landformTh: "",
    accessSeverity: 1,
  });
  assert.equal(r.treasuryDesignated, false);
  assert.ok(!r.reasons.some((x) => x.includes("กระทรวงการคลัง")));
});

test("ประกาศคลังใช้กับเกาะได้ด้วย — ประตูนี้ไม่ผูกกับป่า/พื้นที่สูง", () => {
  const r = classifyHighlandScreen({
    schoolElevationM: 15,
    provinceAvgElev: 100,
    routeFullMaxElev: null,
    landformTh: "",
    accessSeverity: 1,
    isIsland: true,
    treasuryDesignation: { fiscalYear: 2569 },
  });
  assert.equal(r.candidate, true);
  assert.equal(r.treasuryDesignated, true);
});

test("ประกาศคลังที่ไม่มีเลขที่ประกาศ → ยังผ่าน และเหตุผลไม่มีวงเล็บว่าง", () => {
  const r = classifyHighlandScreen({
    schoolElevationM: 120,
    provinceAvgElev: 200,
    routeFullMaxElev: null,
    landformTh: "",
    accessSeverity: 0,
    treasuryDesignation: { fiscalYear: 2569 },
  });
  assert.equal(r.candidate, true);
  const line = r.reasons.find((x) => x.includes("กระทรวงการคลัง")) ?? "";
  assert.ok(!line.includes("()"), `เหตุผลต้องไม่มีวงเล็บว่าง: ${line}`);
});
