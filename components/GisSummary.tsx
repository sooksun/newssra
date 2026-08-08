// ส่วนแสดงผลวิเคราะห์ GIS ในหน้าแบบประเมิน (read-only) — ข้อมูลถูกเขียนจากหน้าแผนที่เท่านั้น
// แสดงทั้งบนจอและตอนพิมพ์ (print จัดรูปเป็น section แบบราชการใน globals.css; ปุ่ม/ลิงก์ถูกซ่อน)

import Link from "next/link";
import {
  avgSpeedSeverity,
  computeCommunityClass,
  derive32Severity,
  deriveD3Responses,
  effectiveScoringVersion,
  elevationGainSeverity,
  futureIndicators,
  primaryRoute,
  rcrSeverity,
  severityLabelTh,
  suggestSettingTypeFromGis,
  ttrSeverity,
} from "@/lib/gis";
import { terrainSignatureFromGis } from "@/lib/terrain-signature";
import { terrainDifficultyFromGis } from "@/lib/terrain-difficulty";
import { communityAxisATierLabelTh } from "@/lib/community-class";
import { landformAppLabelNoteTh, officialElevBandTh } from "@/lib/landform-legend";
import LandformLegendTip from "@/components/LandformLegendTip";
import { SECTOR_LABELS_TH, sectorFlagVisible } from "@/lib/gis-sectors";
import { GIS_DESTINATION_LABELS } from "@/lib/types";
import type { AssessmentState, GisSectorElevation, GisSectorPoint } from "@/lib/types";

interface Props {
  state: AssessmentState;
  assessmentId: number;
}

function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที`;
}

/** ตัวจัดรูปค่ากลาง — ใช้ทั่วส่วนหลักฐาน GIS: ไม่มีข้อมูล (null/undefined) แสดง "ไม่มีข้อมูล" เสมอ ห้ามเดา/แทนค่าอื่น */
function valueOrMissing(value: number | null | undefined, suffix = ""): string {
  return value === null || value === undefined ? "ไม่มีข้อมูล" : `${value.toLocaleString("th-TH")}${suffix}`;
}

/** ช่องความสูงของธง 8 ทิศ: ความสูงจริง + ส่วนต่างจากโรงเรียน (ไม่มีข้อมูลแสดง "ไม่มีข้อมูล" ตามกติกาเดิม) */
function sectorPointCell(point: GisSectorPoint | null): string {
  if (!point) return "ไม่มีข้อมูล";
  const delta =
    point.deltaFromSchoolM === null
      ? ""
      : ` (${point.deltaFromSchoolM >= 0 ? "+" : "−"}${Math.abs(point.deltaFromSchoolM).toLocaleString("th-TH")} ม.)`;
  return `${point.elevationM.toLocaleString("th-TH")} ม.${delta}`;
}

function sectorCoordCell(point: GisSectorPoint | null): string {
  return point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : "ไม่มีข้อมูล";
}

/** ธงที่ขึ้นจริงบนแผนที่ของทิศนี้ — จุดที่ต่างจากโรงเรียนไม่ถึง ±K ไม่ปักธง แต่ค่ายังอยู่ในตาราง */
function sectorFlagCell(sector: GisSectorElevation): string {
  const shown = [
    sectorFlagVisible(sector.highest) ? "สูงสุด (ม่วง)" : "",
    sectorFlagVisible(sector.lowest) ? "ต่ำสุด (ฟ้า)" : "",
  ].filter(Boolean);
  if (shown.length === 0) return "ไม่ปักธง";
  return shown.join(" + ");
}

function fmtAnalyzedAt(iso: string): string {
  if (!iso) return "ไม่มีข้อมูล";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "ไม่มีข้อมูล";
  return d.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
}

export default function GisSummary({ state, assessmentId }: Props) {
  const gis = state.gis;

  if (!gis) {
    return (
      <section className="panel gis-summary gis-summary-empty">
        <div className="panel-head">
          <div>
            <p className="eyebrow">ผลวิเคราะห์เชิงพื้นที่ (GIS)</p>
            <h2>ยังไม่มีผลวิเคราะห์จากแผนที่</h2>
          </div>
        </div>
        <p className="gis-empty-note">
          เปิดแผนที่ 3 มิติเพื่อให้ระบบคำนวณระยะทางจริง ความคดเคี้ยวของเส้นทาง เวลาเดินทาง และความสูงของพื้นที่
          แล้วนำผลมาช่วยคำนวณคะแนนด้านที่ 3 (คมนาคม) อัตโนมัติ
        </p>
        <div className="gis-actions">
          <Link className="ghost-btn" href={`/map?assessment=${assessmentId}`}>
            เปิดแผนที่ 3 มิติเพื่อวิเคราะห์พิกัด (GIS)
          </Link>
        </div>
      </section>
    );
  }

  const isV2 = effectiveScoringVersion(state) === "v2-gis";
  const derived = deriveD3Responses(gis);
  const gisSeverity = derive32Severity(gis);
  const auto = gis.autoScore;
  // แถวเก่าอาจยังไม่มี communityClass ใน JSON — คำนวณสดจาก gis (pure เดียวกับ server)
  const community = gis.communityClass ?? computeCommunityClass(gis, gis.savedAt);
  const suggestedSetting = suggestSettingTypeFromGis(gis);
  // ลายเซ็นภูมิประเทศ — คำนวณสดจาก gis ที่บันทึกไว้ (pure) จึงไม่ต้องเก็บซ้ำและแถวเก่าก็แสดงได้
  const tsRoute = primaryRoute(gis);
  const terrain = terrainSignatureFromGis(gis, {
    route: tsRoute,
    accessSeverity: gisSeverity,
    severityComponents: tsRoute
      ? {
          rcr: rcrSeverity(tsRoute.roadCircuityRatio),
          ttr: ttrSeverity(tsRoute.travelTimeRatio),
          avgSpeed: avgSpeedSeverity(tsRoute.averageSpeedKmh),
          gain: elevationGainSeverity(tsRoute.elevationGainM),
        }
      : null,
    declaredSettingType: state.unit.settingType,
    aiSettingType: state.unit.settingSuggestion?.settingType ?? null,
  });

  // เกณฑ์ความยากลำบากของพื้นที่ 5 ระดับ — ใช้แกนภูมิประเทศ · การเข้าถึง · ขนาดชุมชน · พื้นที่ป่า
  const difficulty = terrainDifficultyFromGis(gis, { route: tsRoute });
  const future = futureIndicators(gis);
  const settingMismatch = suggestedSetting && state.unit.settingType && state.unit.settingType !== suggestedSetting;

  // เทียบค่าที่ GIS derive กับค่าที่อยู่ในแบบประเมินจริงตอนนี้ (ผู้ใช้อาจแก้มือหลัง apply — ธง V19/V20 จับความต่าง)
  const comparisons: { id: string; label: string; gisValue: string; currentValue: string }[] = [];
  if (derived["3.1"]) {
    comparisons.push({
      id: "3.1",
      label: "3.1 เวลาเดินทางจากเขต/สกร.อำเภอ",
      gisValue: `${derived["3.1"].minutes} นาที / ${derived["3.1"].km} กม.`,
      currentValue: state.responses["3.1"]?.minutes
        ? `${state.responses["3.1"].minutes} นาที / ${state.responses["3.1"].km ?? "—"} กม.`
        : "ยังไม่กรอก",
    });
  }
  if (derived["3.2"]) {
    const current = state.responses["3.2"]?.level;
    comparisons.push({
      id: "3.2",
      label: "3.2 ความยากลำบากในการเข้าถึง",
      gisValue: `ระดับ ${derived["3.2"].level} (${severityLabelTh(Number(derived["3.2"].level))})`,
      currentValue: current !== undefined && current !== "" ? `ระดับ ${current}` : "ยังไม่เลือก",
    });
  }
  if (derived["3.3"]) {
    comparisons.push({
      id: "3.3",
      label: "3.3 การเข้าถึงบริการฉุกเฉิน",
      gisValue: `${derived["3.3"].minutes} นาที (${derived["3.3"].unitName})`,
      currentValue: state.responses["3.3"]?.minutes ? `${state.responses["3.3"].minutes} นาที` : "ยังไม่กรอก",
    });
  }

  return (
    <section className="panel gis-summary">
      <div className="panel-head">
        <div>
          <p className="eyebrow">ผลวิเคราะห์เชิงพื้นที่ (GIS)</p>
          <h2>ข้อมูลประกอบเกณฑ์จากแผนที่ 3 มิติ</h2>
        </div>
        {isV2 ? <span className="config-badge gis-badge-v2">คะแนนด้านคมนาคมคำนวณจาก GIS (v2)</span> : null}
      </div>

      <div className="gis-meta">
        <span>
          พิกัดที่วิเคราะห์: {gis.center.lat.toFixed(5)}, {gis.center.lng.toFixed(5)}
        </span>
        {gis.center.nearestProvinceName ? <span>จังหวัดใกล้สุด: {gis.center.nearestProvinceName}</span> : null}
        {gis.savedAt ? <span>บันทึกเมื่อ: {new Date(gis.savedAt).toLocaleString("th-TH")}</span> : null}
      </div>

      <div className="gis-terrain-signature">
        <h3>ระดับความยากลำบากของพื้นที่ (5 ระดับ)</h3>
        <p className="gis-terrain-label">
          <strong>
            {difficulty.level === null
              ? "ยังประเมินไม่ได้"
              : `ระดับ ${difficulty.level} — ${difficulty.difficultyLabelTh}`}
          </strong>
          <span className="gis-terrain-rule">{difficulty.areaLabelTh}</span>
          {difficulty.forestSupports ? <span className="gis-terrain-rule">พื้นที่ป่าหนุน +1 ระดับ</span> : null}
        </p>
        {difficulty.missing.length > 0 ? (
          <ul className="gis-terrain-missing">
            {difficulty.missing.map((item) => (
              <li key={item}>ยังขาด: {item}</li>
            ))}
          </ul>
        ) : null}
        <dl className="gis-evidence-grid">
          {difficulty.evidence.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="gis-terrain-signature">
        <h3>ลายเซ็นภูมิประเทศ (จำแนกอัตโนมัติ)</h3>
        <p className="gis-terrain-label">
          <strong>{terrain.labelTh}</strong>
          <span className="gis-terrain-rule">กฎ {terrain.ruleId}</span>
          {terrain.nearBoundary ? <span className="gis-terrain-warn">ใกล้เส้นแบ่ง — ควรให้ผู้ตรวจยืนยัน</span> : null}
        </p>
        <p className="gis-terrain-group">กลุ่ม: {terrain.groupLabelTh}</p>
        {terrain.reviewFlags.length > 0 ? (
          <ul className="gis-terrain-missing">
            {terrain.reviewFlags.map((item) => (
              <li key={item}>ควรให้ผู้ตรวจยืนยัน: {item}</li>
            ))}
          </ul>
        ) : null}
        {terrain.missing.length > 0 ? (
          <ul className="gis-terrain-missing">
            {terrain.missing.map((item) => (
              <li key={item}>ยังขาด: {item}</li>
            ))}
          </ul>
        ) : null}
        <dl className="gis-evidence-grid">
          {terrain.evidence.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
        {gis.forestAnalysis || gis.forestOverlay ? (
          <div className="gis-forest-overlay">
            <h3>ชั้นป่า 3 ชั้น (สถานภาพ · เขตกฎหมาย · บริบท)</h3>
            {gis.forestAnalysis ? (
              <>
                <p className="gis-terrain-label">
                  <strong>
                    บริบทป่า:{" "}
                    {gis.forestAnalysis.contextStrength === "strong"
                      ? "ถูกล้อมด้วยพื้นที่ป่า (แข็ง)"
                      : gis.forestAnalysis.contextStrength === "weak"
                        ? "มีพื้นที่ป่าในรัศมี (อ่อน)"
                        : gis.forestAnalysis.contextStrength === "none"
                          ? "บริบทรอบไม่ใช่พื้นที่ป่าชัดเจน"
                          : "ยังไม่มีชั้นสภาพพื้นที่ป่า"}
                  </strong>
                  {gis.forestAnalysis.metrics.insideSource === "status" ? (
                    <span className="gis-terrain-rule">inside จากสถานภาพป่า</span>
                  ) : gis.forestAnalysis.metrics.insideSource === "legal" ? (
                    <span className="gis-terrain-warn">inside จากเขตกฎหมาย (ยังไม่ใช่สถานภาพป่า)</span>
                  ) : null}
                </p>
                <dl className="gis-evidence-grid">
                  <div>
                    <dt>forest_inside</dt>
                    <dd>
                      {gis.forestAnalysis.metrics.forest_inside === null
                        ? "ไม่มีข้อมูล"
                        : gis.forestAnalysis.metrics.forest_inside === 1
                          ? "1 (ทับ)"
                          : "0"}
                    </dd>
                  </div>
                  <div>
                    <dt>forest_distance_m</dt>
                    <dd>
                      {gis.forestAnalysis.metrics.forest_distance_m === null
                        ? "ไม่มีข้อมูล"
                        : `${gis.forestAnalysis.metrics.forest_distance_m.toLocaleString("th-TH")} ม.`}
                    </dd>
                  </div>
                  <div>
                    <dt>ป่าในรัศมี 1 / 3 / 5 กม.</dt>
                    <dd>
                      {[
                        gis.forestAnalysis.metrics.forest_1km_pct,
                        gis.forestAnalysis.metrics.forest_3km_pct,
                        gis.forestAnalysis.metrics.forest_5km_pct,
                      ]
                        .map((p) => (p === null ? "—" : `${p}%`))
                        .join(" / ")}
                    </dd>
                  </div>
                  <div>
                    <dt>ชนิดป่า</dt>
                    <dd>{gis.forestAnalysis.metrics.forest_type ?? "ไม่มีข้อมูล"}</dd>
                  </div>
                  <div>
                    <dt>protected_area / reserve_forest</dt>
                    <dd>
                      {gis.forestAnalysis.metrics.protected_area === null
                        ? "—"
                        : gis.forestAnalysis.metrics.protected_area}{" "}
                      /{" "}
                      {gis.forestAnalysis.metrics.reserve_forest === null
                        ? "—"
                        : gis.forestAnalysis.metrics.reserve_forest}
                    </dd>
                  </div>
                </dl>
                {gis.forestAnalysis.missing.length > 0 ? (
                  <ul className="gis-terrain-missing">
                    {gis.forestAnalysis.missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
            {gis.forestOverlay ? (
              <>
                <p className="gis-terrain-group">
                  เขตกฎหมาย:{" "}
                  {gis.forestOverlay.status === "in"
                    ? "ทับแนวเขต"
                    : gis.forestOverlay.status === "near"
                      ? "ชิดแนวเขต (≤ 1 กม.)"
                      : gis.forestOverlay.status === "out"
                        ? "นอกแนวเขตในรัศมีที่ตรวจ"
                        : "ไม่มีข้อมูล"}
                  {gis.forestOverlay.dataAuthority === "osm-reference" ? " · อ้างอิง OSM" : " · ทางการ"}
                </p>
                {gis.forestOverlay.zones.length > 0 ? (
                  <ul className="gis-terrain-missing">
                    {gis.forestOverlay.zones.map((z) => (
                      <li key={`${z.name}-${z.relation}`}>
                        {z.relation === "in" ? "ทับ" : "ชิด"} {z.name}
                        {z.relation === "near" ? ` · ${z.distanceM.toLocaleString("th-TH")} ม.` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
            <p className="gis-empty-note">
              สถานภาพป่า (กรมป่าไม้) กับแนวเขตกฎหมายเป็นคนละชั้น — อย่าตีความเป็น “อยู่ในป่า” จาก 0/1 เดียว
            </p>
          </div>
        ) : null}

        {terrain.margins.length > 0 ? (
          <details className="gis-terrain-margins">
            <summary>ระยะห่างจากเส้นแบ่งที่ใช้ตัดสิน ({terrain.margins.length} เงื่อนไข)</summary>
            <table className="gis-table">
              <thead>
                <tr>
                  <th>เงื่อนไข</th>
                  <th>ค่าที่วัดได้</th>
                  <th>เกณฑ์</th>
                  <th>ห่างจากเกณฑ์</th>
                </tr>
              </thead>
              <tbody>
                {terrain.margins.map((m) => (
                  <tr key={m.key} className={m.near ? "gis-margin-near" : undefined}>
                    <td>{m.label}</td>
                    <td>
                      {m.value.toLocaleString("th-TH")} {m.unit}
                    </td>
                    <td>
                      {m.threshold.toLocaleString("th-TH")} {m.unit}
                    </td>
                    <td>
                      {m.marginM >= 0 ? "+" : "−"}
                      {Math.abs(m.marginM).toLocaleString("th-TH")} {m.unit}
                      {m.near ? " (ในแถบความไม่แน่นอน)" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ) : null}
        <p className="gis-note">
          ข้อมูลประกอบเท่านั้น ไม่รวมกับคะแนน 100 คะแนนทางการ — เกณฑ์เวอร์ชัน {terrain.version}
        </p>
      </div>

      {gis.elevation ? (
        <div className="gis-elevation">
          <dl className="gis-evidence-grid">
            <div>
              <dt>ระดับความสูงจุดตั้งโรงเรียน</dt>
              <dd>{valueOrMissing(gis.elevation.schoolMarkerElevationM, " ม.")}</dd>
            </div>
            <div>
              <dt>ความสูงเฉลี่ยพื้นที่วิเคราะห์</dt>
              <dd>{valueOrMissing(gis.elevation.meanElevationM, " ม.")}</dd>
            </div>
            <div>
              <dt>ความสูงต่ำสุด / สูงสุด</dt>
              <dd>
                {valueOrMissing(gis.elevation.minElevationM, " ม.")} /{" "}
                {valueOrMissing(gis.elevation.maxElevationM, " ม.")}
              </dd>
            </div>
            <div>
              <dt>ผลต่างความสูงสูงสุด−ต่ำสุด (relief)</dt>
              <dd>{valueOrMissing(gis.elevation.reliefM, " ม.")}</dd>
            </div>
            <div>
              <dt>ความสูงสุดในรัศมี 1 กม.</dt>
              <dd>{valueOrMissing(gis.elevation.localMaxElevation1KmM, " ม.")}</dd>
            </div>
            <div>
              <dt>ความลาดชันเฉลี่ย / สูงสุด</dt>
              <dd>
                {valueOrMissing(gis.elevation.meanSlopePct, "%")} / {valueOrMissing(gis.elevation.maxSlopePct, "%")}
              </dd>
            </div>
            {gis.elevation.slopeClass ? (
              <div>
                <dt>ชั้นความลาดชัน (LDD)</dt>
                <dd>{gis.elevation.slopeClass}</dd>
              </div>
            ) : null}
          </dl>
          {gis.elevation.landformTh ? (
            <span className="gis-landform-line">
              ลักษณะพื้นที่: {gis.elevation.landformTh} <LandformLegendTip />
            </span>
          ) : (
            <span className="gis-landform-line">
              เกณฑ์ถ้อยคำภูมิประเทศ <LandformLegendTip />
            </span>
          )}
          {officialElevBandTh(gis.elevation.schoolMarkerElevationM) ? (
            <span className="gis-elev-band">{officialElevBandTh(gis.elevation.schoolMarkerElevationM)}</span>
          ) : null}
          {gis.elevation.routeFullMaxElev != null ? (
            <span className="gis-elev-band">
              ความสูงสุดตลอดเส้นทางทั้งเส้น (เกต SSRA): {gis.elevation.routeFullMaxElev.toLocaleString("th-TH")} ม.
              {gis.elevation.routeTailMaxElev != null
                ? ` · ช่วง 5 กม.สุดท้าย (landform): ${gis.elevation.routeTailMaxElev.toLocaleString("th-TH")} ม.`
                : ""}
            </span>
          ) : null}
          {gis.elevation.provinceAvgElev != null ? (
            <span className="gis-elev-band">
              ความสูงเฉลี่ยจังหวัด (อ้างอิง): {gis.elevation.provinceAvgElev.toLocaleString("th-TH")} ม.
            </span>
          ) : null}
          {gis.elevation.landformTh ? (
            <span className="gis-landform-note">{landformAppLabelNoteTh(gis.elevation.landformTh)}</span>
          ) : null}
        </div>
      ) : null}

      <div className={`gis-community-class gis-community-${community.composite.tone}`}>
        <p className="gis-community-title">
          ระดับความทุรกันดาร (แกน A+B): <strong>{community.composite.labelTh}</strong>
          <span className="gis-community-key"> ({community.composite.key})</span>
        </p>
        <dl className="gis-community-axes">
          <div>
            <dt>
              A ภูมิประเทศ / พื้นที่สูง <LandformLegendTip />
            </dt>
            <dd>
              {community.axisA.highland ? "เข้าเกณฑ์พื้นที่สูง" : "ไม่เข้าเกณฑ์พื้นที่สูง"}
              {" · "}
              {communityAxisATierLabelTh(community.axisA.tier)}
              {community.axisA.reasons.length > 0 ? (
                <ul className="gis-community-reasons">
                  {community.axisA.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>B การเข้าถึง / ความห่างไกล</dt>
            <dd>
              {community.axisB.label}
              {community.axisB.severity !== null ? ` (ระดับ ${community.axisB.severity})` : ""}
            </dd>
          </div>
          <div>
            <dt>C ความหนาแน่น (เมือง–ชนบท)</dt>
            <dd>
              {community.axisC ? (
                <>
                  {community.axisC.label}
                  {community.axisC.popDensityPerKm2 !== null
                    ? ` · ${community.axisC.popDensityPerKm2.toLocaleString("th-TH")} คน/ตร.กม.`
                    : ""}
                </>
              ) : (
                "ยังไม่มีข้อสรุปจากผังอาคาร"
              )}
              <span className="gis-community-c-note"> — แกนนี้ไม่ใช่ระดับความทุรกันดาร</span>
            </dd>
          </div>
          {community.wscProxy ? (
            <div>
              <dt>WSC 1–5 (ประมาณ)</dt>
              <dd>
                <strong>{community.wscProxy.labelTh}</strong>
                {community.wscProxy.meanSlopePct !== null ? ` · ลาดชันเฉลี่ย ${community.wscProxy.meanSlopePct}%` : ""}
                <span className="gis-community-c-note"> — {community.wscProxy.hint}</span>
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      {suggestedSetting ? (
        <p className="gis-setting-suggest">
          {state.unit.settingType === suggestedSetting ? (
            <>
              ลักษณะที่ตั้งในแบบประเมิน: <strong>{state.unit.settingType}</strong> (สอดคล้องกับที่ GIS แนะนำ)
            </>
          ) : state.unit.settingType === "" ? (
            <>
              GIS แนะนำลักษณะที่ตั้ง: <strong>{suggestedSetting}</strong>
              {" — "}
              {isV2
                ? "ระบบเติมให้อัตโนมัติเมื่อบันทึกผลวิเคราะห์แบบนำไปคำนวณคะแนน (ถ้าช่องยังว่าง) — แก้ได้ที่ข้อมูลจุดจัดการศึกษา"
                : "บันทึกผลวิเคราะห์พร้อมนำไปคำนวณคะแนนด้านที่ 3 เพื่อเติมค่าอัตโนมัติ (เมื่อช่องยังว่าง) หรือเลือกเองที่ข้อมูลจุดจัดการศึกษา"}
            </>
          ) : settingMismatch ? (
            <>
              ลักษณะที่ตั้งที่เลือก: <strong>{state.unit.settingType}</strong>
              {" · "}
              GIS แนะนำ: <strong>{suggestedSetting}</strong> — ไม่บังคับให้ตรง ใช้ประกอบดุลยพินิจ
            </>
          ) : null}
        </p>
      ) : null}

      {/* สถานะการเข้าถึงด้วยถนน — บอกผู้ตรวจว่าตัวเลขเส้นทางด้านล่างเชื่อได้แค่ไหน (หรือทำไมถึงไม่มี) */}
      {gis.routeAccess && gis.routeAccess.status !== "reachable" ? (
        <p className={`gis-route-access gis-route-access-${gis.routeAccess.status}`}>
          <strong>การเข้าถึงด้วยถนน:</strong> {gis.routeAccess.note}
        </p>
      ) : null}

      {gis.routes.length > 0 ? (
        <div className="gis-table-wrap">
          <table className="gis-table">
            <thead>
              <tr>
                <th>จุดหมาย</th>
                <th>เส้นตรง (กม.)</th>
                <th>ถนนจริง (กม.)</th>
                <th>เวลา</th>
                <th>RCR</th>
                <th>TTR</th>
                <th>ระยะสมมูล (กม.)</th>
                <th>ความเร็วเฉลี่ย</th>
                <th>ไต่สะสม (ม.)</th>
              </tr>
            </thead>
            <tbody>
              {gis.routes.map((r, i) => (
                <tr key={i}>
                  <td>
                    {GIS_DESTINATION_LABELS[r.destinationType]}
                    {r.destinationName && r.destinationType !== "province_hall" ? ` — ${r.destinationName}` : ""}
                  </td>
                  <td>{r.straightDistanceKm.toFixed(1)}</td>
                  <td>
                    {r.roadDistanceKm.toFixed(1)}
                    {r.walkLeg ? <small> + เดิน {r.walkLeg.distanceKm.toFixed(1)}</small> : null}
                  </td>
                  <td>
                    {fmtMin(r.travelTimeMin)}
                    {r.walkLeg ? <small> + เดิน {fmtMin(r.walkLeg.travelTimeMin)}</small> : null}
                  </td>
                  <td>
                    {r.roadCircuityRatio.toFixed(2)} ({severityLabelTh(rcrSeverity(r.roadCircuityRatio))})
                  </td>
                  <td>{r.travelTimeRatio.toFixed(2)}</td>
                  <td>{r.effectiveDistanceKm.toFixed(0)}</td>
                  <td>
                    {r.averageSpeedKmh.toFixed(0)} กม./ชม. ({severityLabelTh(avgSpeedSeverity(r.averageSpeedKmh))})
                  </td>
                  <td>{r.elevationGainM !== null ? r.elevationGainM.toLocaleString("th-TH") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {gis.routes.some((r) => r.highestPoint) ? (
        <dl className="gis-evidence-grid gis-route-highest">
          {gis.routes
            .filter((r) => r.highestPoint)
            .map((r, i) => (
              <div key={i}>
                <dt>
                  จุดสูงสุดบนเส้นทาง — {GIS_DESTINATION_LABELS[r.destinationType]}
                  {r.destinationName && r.destinationType !== "province_hall" ? ` — ${r.destinationName}` : ""}
                </dt>
                <dd>
                  {valueOrMissing(r.highestPoint?.elevationM, " ม.")}
                  {r.highestPoint ? ` (${r.highestPoint.lat.toFixed(5)}, ${r.highestPoint.lng.toFixed(5)})` : ""}
                </dd>
              </div>
            ))}
        </dl>
      ) : null}

      {gis.routes.some((r) => r.ridgeCrossings) ? (
        <dl className="gis-evidence-grid gis-route-ridges">
          {gis.routes
            .filter((r) => r.ridgeCrossings)
            .map((r, i) => (
              <div key={i}>
                <dt>
                  ภูเขาที่ต้องข้ามบนเส้นทาง — {GIS_DESTINATION_LABELS[r.destinationType]}
                  {r.destinationName && r.destinationType !== "province_hall" ? ` — ${r.destinationName}` : ""}
                </dt>
                <dd>
                  {r.ridgeCrossings!.count.toLocaleString("th-TH")} ลูก · สันเขาจริงที่แนวข้างยืนยัน{" "}
                  {r.ridgeCrossings!.confirmedCount.toLocaleString("th-TH")} ลูก
                  <small>
                    {" "}
                    (นับจุดที่ไต่ขึ้นและลง ≥{r.ridgeCrossings!.prominenceM} ม. บนแนวถนน แล้วยืนยันด้วยแนวขนานซ้าย-ขวา ±
                    {r.ridgeCrossings!.sideOffsetM} ม.)
                  </small>
                </dd>
              </div>
            ))}
        </dl>
      ) : null}

      {gisSeverity !== null ? (
        <p className="gis-severity-line">
          GIS ประเมินความยากลำบากในการเข้าถึง (3.2) ระดับ {gisSeverity} ({severityLabelTh(gisSeverity)})
        </p>
      ) : null}

      {auto ? (
        <div className="gis-auto-score">
          <strong>
            คะแนน GIS อัตโนมัติ: {auto.total} / {auto.maxComputable} คะแนนที่คำนวณได้ (จากเต็ม {auto.max})
          </strong>
          <span className="gis-auto-note">
            คะแนนประกอบการพิจารณา — ไม่รวมกับคะแนนทางการ 100 คะแนน; องค์ประกอบที่ยังไม่มีข้อมูล (เช่น
            พื้นที่ชายแดน/เขตเทศบาล) ไม่ถูกนับ
          </span>
        </div>
      ) : null}

      {future.length > 0 ? (
        <div className="gis-compare gis-future">
          <p className="gis-compare-title">
            เกณฑ์เสนอเพิ่ม (อนาคต) — <strong>ไม่นับรวมในคะแนน 100</strong>
          </p>
          <div className="gis-table-wrap">
            <table className="gis-table gis-compare-table">
              <thead>
                <tr>
                  <th>เกณฑ์</th>
                  <th>ค่าที่วัดได้</th>
                  <th>ระดับ</th>
                  <th>คำอธิบาย</th>
                </tr>
              </thead>
              <tbody>
                {future.map((f, i) => (
                  <tr key={f.id}>
                    <td>
                      {i + 1}) {f.title}
                    </td>
                    <td>{f.valueLabel}</td>
                    <td>
                      {f.score} / {f.maxScore} ({severityLabelTh(f.severity)})
                    </td>
                    <td>{f.explain}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <span className="gis-auto-note">
            คำนวณอัตโนมัติจากเส้นทางหลัก (ที่ว่าการอำเภอ/ศาลากลาง) ที่บันทึกจากแผนที่ — เกณฑ์ทดลองเพื่อประกอบการพิจารณา
            ไม่มีผลต่อคะแนนรวมและการยื่นแบบประเมิน
          </span>
        </div>
      ) : null}

      {gis.radiusSummaries && gis.radiusSummaries.length > 0 ? (
        <div className="gis-table-wrap">
          <p className="gis-compare-title">อาคารและประชากรโดยประมาณในรัศมีรอบจุดวิเคราะห์</p>
          <table className="gis-table gis-radius-table">
            <thead>
              <tr>
                <th>รัศมี (ม.)</th>
                <th>จำนวนอาคาร</th>
                <th>ประชากรโดยประมาณ</th>
                <th>ความหนาแน่นประชากร</th>
              </tr>
            </thead>
            <tbody>
              {gis.radiusSummaries.map((r) => (
                <tr key={r.radiusM}>
                  <td>{r.radiusM.toLocaleString("th-TH")}</td>
                  <td>{r.buildingCount.toLocaleString("th-TH")} หลัง</td>
                  <td>{valueOrMissing(r.estPopulation, " คน")}</td>
                  <td>{valueOrMissing(r.popDensityPerKm2, " คน/ตร.กม.")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {gis.sectorElevations && gis.sectorElevations.length > 0 ? (
        <div className="gis-table-wrap">
          <p className="gis-compare-title">
            จุดสูงสุด/ต่ำสุดของภูมิประเทศ 8 ทิศ ในรัศมี{" "}
            {((gis.sectorConfig?.radiusM ?? 0) / 1000).toLocaleString("th-TH")} กม.
          </p>
          <table className="gis-table gis-sector-table">
            <thead>
              <tr>
                <th>ทิศ</th>
                <th>จุดสูงสุด</th>
                <th>พิกัดจุดสูงสุด</th>
                <th>จุดต่ำสุด</th>
                <th>พิกัดจุดต่ำสุด</th>
                <th>ต่างในทิศ</th>
                <th>ธงบนแผนที่</th>
              </tr>
            </thead>
            <tbody>
              {gis.sectorElevations.map((s) => (
                <tr key={s.sector}>
                  <td>{SECTOR_LABELS_TH[s.sector]}</td>
                  <td>{sectorPointCell(s.highest)}</td>
                  <td>{sectorCoordCell(s.highest)}</td>
                  <td>{sectorPointCell(s.lowest)}</td>
                  <td>{sectorCoordCell(s.lowest)}</td>
                  <td>{valueOrMissing(s.reliefM, " ม.")}</td>
                  <td>{sectorFlagCell(s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <span className="gis-auto-note">
            ค่าในวงเล็บคือส่วนต่างจากความสูงที่ตั้งโรงเรียน ({valueOrMissing(gis.sectorConfig?.schoolElevationM, " ม.")}
            {gis.sectorConfig?.schoolElevationSource === "grid-center"
              ? " — จากกริดภูมิประเทศ เพราะยังไม่มีเส้นทางให้สุ่มความสูงที่หมุดโรงเรียน"
              : ""}
            ) · แผนที่ปักธงเฉพาะจุดที่ต่างจากความสูงโรงเรียนตั้งแต่ ±
            {(gis.sectorConfig?.thresholdM ?? 0).toLocaleString("th-TH")} ม. ขึ้นไป จุดที่ต่างน้อยกว่านั้นไม่ปักธง
            แต่ยังบันทึกค่าไว้ในตารางนี้ — ข้อมูลประกอบเท่านั้น ไม่มีผลต่อคะแนนรวม
          </span>
        </div>
      ) : null}

      {gis.areaSummary ? (
        <div className="gis-area-summary">
          <p className="gis-area-title">ข้อสรุปพื้นที่และประชากร (จากผังอาคาร)</p>
          <dl className="gis-area-grid">
            <div>
              <dt>ขนาดพื้นที่</dt>
              <dd>
                {gis.areaSummary.areaKm2.toFixed(2)} ตร.กม. (
                {Math.round(gis.areaSummary.areaKm2 * 625).toLocaleString("th-TH")} ไร่)
              </dd>
            </div>
            <div>
              <dt>จำนวนอาคาร</dt>
              <dd>
                {gis.areaSummary.buildingCount.toLocaleString("th-TH")} หลัง (
                {gis.areaSummary.buildingDensityPerKm2.toLocaleString("th-TH")} หลัง/ตร.กม.)
              </dd>
            </div>
            <div>
              <dt>ประชากรโดยประมาณ</dt>
              <dd>
                {gis.areaSummary.estPopulation !== null
                  ? `${gis.areaSummary.estPopulation.toLocaleString("th-TH")} คน`
                  : "—"}
                {gis.areaSummary.popDensityPerKm2 !== null
                  ? ` (${gis.areaSummary.popDensityPerKm2.toLocaleString("th-TH")} คน/ตร.กม.)`
                  : ""}
              </dd>
            </div>
            {gis.areaSummary.settlementLabel ? (
              <div>
                <dt>ความหนาแน่นการตั้งถิ่นฐาน (แกน C)</dt>
                <dd>
                  <strong>{gis.areaSummary.settlementLabel}</strong>
                  <span className="gis-community-c-note"> — ไม่ใช่ระดับความทุรกันดาร/พื้นที่สูง</span>
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}

      {comparisons.length > 0 ? (
        <div className="gis-compare">
          <p className="gis-compare-title">ค่าที่ GIS คำนวณได้ เทียบกับค่าในแบบประเมินปัจจุบัน</p>
          <div className="gis-table-wrap">
            <table className="gis-table gis-compare-table">
              <thead>
                <tr>
                  <th>ตัวชี้วัด</th>
                  <th>ค่าจาก GIS</th>
                  <th>ค่าในแบบประเมิน</th>
                </tr>
              </thead>
              <tbody>
                {comparisons.map((c) => (
                  <tr key={c.id}>
                    <td>{c.label}</td>
                    <td>{c.gisValue}</td>
                    <td>{c.currentValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {gis.dataSources ? (
        <ul className="gis-source-list">
          <li>แหล่งข้อมูลภูมิประเทศ: {gis.dataSources.terrain}</li>
          <li>แหล่งข้อมูลเส้นทาง: {gis.dataSources.routing}</li>
          <li>แหล่งข้อมูลอาคาร: {gis.dataSources.buildings ?? "ไม่มีข้อมูล"}</li>
          <li>วิธีประมาณประชากร: {gis.dataSources.populationMethod ?? "ไม่มีข้อมูล"}</li>
          <li>วิเคราะห์เมื่อ: {fmtAnalyzedAt(gis.dataSources.analyzedAt)}</li>
        </ul>
      ) : null}

      <p className="gis-disclaimer">
        ความสูงสุ่มจากเบราว์เซอร์ (Terrarium DEM) เป็นค่าโดยประมาณ • ระยะทาง/เวลา/อัตราส่วนคำนวณและตรวจสอบ
        ฝั่งเซิร์ฟเวอร์จากข้อมูลเส้นทาง OSRM ณ เวลาที่บันทึก
      </p>

      <div className="gis-actions">
        <Link className="ghost-btn" href={`/map?assessment=${assessmentId}`}>
          {state.submitted ? "เปิดแผนที่เพื่อดูผลวิเคราะห์" : "เปิดแผนที่เพื่อวิเคราะห์ใหม่"}
        </Link>
      </div>
    </section>
  );
}
