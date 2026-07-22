// แผงวิเคราะห์ GIS สำหรับโหมดแบบประเมิน — แยกจาก CesiumMap (Phase 5)
// Pure presentational: ไม่แตะ Cesium / OSRM / fetch — parent ส่ง preview + handlers

"use client";

import {
  avgSpeedSeverity,
  explainEffectiveTh,
  explainGainTh,
  explainRcrTh,
  explainSpeedTh,
  explainTtrTh,
  rcrSeverity,
  severityLabelTh,
} from "@/lib/gis";
import MapCommunityClassPreview from "@/components/map/MapCommunityClassPreview";
import { GIS_DESTINATION_LABELS } from "@/lib/types";
import type { GisAnalysis, GisAutoScore, GisCommunityClass, GisDestinationType } from "@/lib/types";
import type { MapAssessmentSaveAction } from "@/lib/map-assessment";

/** จุดหมายเพิ่มที่ผู้ใช้เลือกเองได้สูงสุด (ไม่รวมศาลากลาง) — ต้องตรงกับ logic ใน CesiumMap */
export const MAX_GIS_DESTINATIONS = 3;

/** คะแนนตัวเลือกตัวชี้วัด 3.2 ตาม index (ล้อ lib/criteria.ts) — preview เท่านั้น */
const LEVEL32_POINTS = [0, 4, 6, 8, 10] as const;

const DEST_TYPES: GisDestinationType[] = ["district_office", "hospital", "other"];

function fmt(v: number): string {
  return Math.round(v).toLocaleString("th-TH");
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที`;
}

export interface GisDestError {
  key: string;
  destinationType: GisDestinationType;
  name: string;
  error: string;
}

/** ปุ่มใต้ช่องยืนยันพิกัด — เพิ่มผลค้นหาเป็นจุดหมายวิเคราะห์ (อำเภอ/รพ.) */
export function GisDestAddBar({
  pickedDestType,
  onPickedDestTypeChange,
  addingDest,
  destCount,
  onAdd,
}: {
  pickedDestType: GisDestinationType;
  onPickedDestTypeChange: (t: GisDestinationType) => void;
  addingDest: boolean;
  destCount: number;
  onAdd: () => void;
}) {
  const full = destCount >= MAX_GIS_DESTINATIONS;
  return (
    <div className="map-gis-dest-add">
      <span className="map-gis-dest-label">หรือใช้เป็นจุดหมายวิเคราะห์เส้นทาง (เช่น อำเภอ/รพ.)</span>
      <div className="map-gis-dest-types">
        {DEST_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className={`map-route-btn${pickedDestType === t ? " map-route-btn-active" : ""}`}
            onClick={() => onPickedDestTypeChange(t)}
          >
            {GIS_DESTINATION_LABELS[t]}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="map-confirm-coord-btn map-gis-dest-btn"
        disabled={addingDest || full}
        onClick={onAdd}
      >
        {addingDest
          ? "กำลังคำนวณเส้นทาง…"
          : full
            ? `ครบ ${MAX_GIS_DESTINATIONS} จุดหมายแล้ว`
            : "เพิ่มเป็นจุดหมายวิเคราะห์"}
      </button>
    </div>
  );
}

/** เป้าหมายแบบประเมินที่แผงนี้ผูกอยู่ — โครงสร้างย่อยของ MapAssessment (เลี่ยง import วนกับ CesiumMap) */
export interface GisAssessmentTarget {
  id: number;
  submitted: boolean;
}

/** ข้อความยืนยันผลบันทึกตามชนิดการบันทึก (สร้าง/ปรับปรุง/ล็อก) — ต้องตรงกับ action จาก /api/assessments/from-map */
const SAVE_ACTION_MESSAGES: Record<MapAssessmentSaveAction, string> = {
  created: "สร้างแบบประเมินปีปัจจุบันและกรอกข้อมูลแล้ว",
  updated: "ปรับปรุงแบบร่างปีปัจจุบันแล้ว",
  locked: "แบบประเมินปีปัจจุบันส่งแล้ว จึงเปิดดูได้อย่างเดียว",
};

interface Props {
  /** null = ยังไม่มีแบบประเมินปีปัจจุบัน (ปุ่มบันทึกจะ"สร้าง"ให้) — ไม่ block การแสดงผล preview */
  assessment: GisAssessmentTarget | null;
  /** เฉพาะบัญชีโรงเรียนที่มีรหัสเท่านั้นจึงบันทึกได้ — false = ดูผลอย่างเดียว (เช่น admin เปิด ?assessment=ID) */
  canSaveAssessment: boolean;
  previewGis: GisAnalysis | null;
  previewAuto?: GisAutoScore | null;
  previewSeverity?: number | null;
  previewCommunity?: GisCommunityClass | null;
  destErrors?: GisDestError[];
  destCount?: number;
  /** สุ่มความสูงตามเส้นทางหลักเสร็จแล้ว — จำเป็นก่อนบันทึก (ความสูงจุดโรงเรียน + จุดสูงสุดเส้นทาง) */
  routeElevationReady?: boolean;
  saveState?: "idle" | "saving";
  saveAction?: MapAssessmentSaveAction | null;
  saveErr?: string;
  onSave: () => void;
  onRemoveDestination?: (key: string) => void;
}

export default function GisAssessmentPanel({
  assessment,
  canSaveAssessment,
  previewGis,
  previewAuto = null,
  previewSeverity = null,
  previewCommunity = null,
  destErrors = [],
  destCount = 0,
  routeElevationReady = false,
  saveState = "idle",
  saveAction = null,
  saveErr = "",
  onSave,
  onRemoveDestination = () => {},
}: Props) {
  const routes = previewGis?.routes ?? [];
  const primary = routes[0];
  const submitted = assessment?.submitted ?? false;
  const saving = saveState === "saving";
  const hasProvinceRoute = routes.some((r) => r.destinationType === "province_hall");

  // ข้อมูลที่ยังขาดก่อนบันทึกได้ — แจ้งผู้ใช้เป็นรายการชัดเจน (ตรงกับ disabled ของปุ่ม)
  const missingData: string[] = [];
  if (!hasProvinceRoute) missingData.push("เส้นทางจากศาลากลางจังหวัด");
  if (!routeElevationReady) missingData.push("ระดับความสูงจุดโรงเรียน");
  const saveDisabled = submitted || !hasProvinceRoute || !routeElevationReady || saving;

  return (
    <div className="map-gis">
      <h3 className="map-gis-title">วิเคราะห์เพื่อแบบประเมิน (GIS)</h3>

      {routes.length > 0 ? (
        routes.map((r) => (
          <div className="map-gis-route" key={`${r.destinationType}-${r.destLat}-${r.destLng}`}>
            <div className="map-gis-route-head">
              <strong>{GIS_DESTINATION_LABELS[r.destinationType]}</strong>
              {r.destinationType !== "province_hall" ? (
                <button
                  type="button"
                  className="map-gis-remove"
                  onClick={() =>
                    onRemoveDestination(
                      `${r.destinationType}-${r.destLat.toFixed(5)}-${r.destLng.toFixed(5)}`,
                    )
                  }
                  aria-label={`ลบจุดหมาย ${r.destinationName}`}
                >
                  ลบ
                </button>
              ) : null}
            </div>
            <dl className="map-stats map-gis-stats">
              <div>
                <dt>ระยะเส้นตรง / ตามถนนจริง</dt>
                <dd>
                  {r.straightDistanceKm.toFixed(1)} / {r.roadDistanceKm.toFixed(1)} กม. •{" "}
                  {fmtDuration(r.travelTimeMin * 60)}
                </dd>
              </div>
              <div>
                <dt>ความคดเคี้ยว (RCR)</dt>
                <dd>
                  {r.roadCircuityRatio.toFixed(2)} เท่า — {severityLabelTh(rcrSeverity(r.roadCircuityRatio))}
                </dd>
              </div>
              <div>
                <dt>เทียบเวลาพื้นที่ปกติ (TTR)</dt>
                <dd>
                  {r.travelTimeRatio.toFixed(2)} เท่า • ระยะทางสมมูล {r.effectiveDistanceKm.toFixed(0)} กม.
                </dd>
              </div>
              <div>
                <dt>ความเร็วเฉลี่ย</dt>
                <dd>
                  {r.averageSpeedKmh.toFixed(0)} กม./ชม. — {severityLabelTh(avgSpeedSeverity(r.averageSpeedKmh))}
                </dd>
              </div>
              <div>
                <dt>ไต่ระดับสะสม (ขึ้น/ลง)</dt>
                <dd>
                  {r.elevationGainM !== null
                    ? `${fmt(r.elevationGainM)} / ${fmt(r.elevationLossM ?? 0)} ม.`
                    : "กำลังสุ่มความสูง…"}
                </dd>
              </div>
            </dl>
          </div>
        ))
      ) : (
        <p className="map-note">รอข้อมูลเส้นทางจากศาลากลางจังหวัด…</p>
      )}

      {destErrors.map((d) => (
        <p key={d.key} className="map-note map-note-error">
          {GIS_DESTINATION_LABELS[d.destinationType]} {d.name}: {d.error}{" "}
          <button type="button" className="map-gis-remove" onClick={() => onRemoveDestination(d.key)}>
            ลบ
          </button>
        </p>
      ))}

      {primary ? (
        <ul className="map-gis-explain">
          {[
            explainRcrTh(primary.roadCircuityRatio),
            explainTtrTh(primary.travelTimeRatio),
            explainSpeedTh(primary.averageSpeedKmh),
            explainGainTh(primary.elevationGainM),
            explainEffectiveTh(primary.roadDistanceKm, primary.effectiveDistanceKm),
          ]
            .filter(Boolean)
            .map((text, i) => (
              <li key={i}>{text}</li>
            ))}
        </ul>
      ) : null}

      {previewSeverity !== null ? (
        <p className="map-gis-severity">
          GIS ประเมิน “ความยากลำบากในการเดินทางเข้าถึง” (ตัวชี้วัด 3.2) ระดับ {previewSeverity} (
          {severityLabelTh(previewSeverity)}) ={" "}
          <strong>{LEVEL32_POINTS[previewSeverity as 0 | 1 | 2 | 3 | 4]} คะแนน</strong>
        </p>
      ) : null}
      {previewCommunity ? <MapCommunityClassPreview community={previewCommunity} /> : null}
      {previewAuto ? (
        <p className="map-gis-auto">
          คะแนน GIS อัตโนมัติ:{" "}
          <strong>
            {previewAuto.total} / {previewAuto.maxComputable} คะแนนที่คำนวณได้
          </strong>{" "}
          (จากเต็ม {previewAuto.max} — องค์ประกอบที่ยังไม่มีข้อมูลไม่ถูกนับ)
        </p>
      ) : null}

      <p className="map-note">
        เพิ่มจุดหมาย (อำเภอ/รพ.) ได้จากช่องค้นหาด้านบน: ค้นหา → เลือกประเภท → “เพิ่มเป็นจุดหมายวิเคราะห์” (
        {destCount}/{MAX_GIS_DESTINATIONS})
      </p>

      {canSaveAssessment ? (
        <div className="map-gis-save">
          {submitted ? (
            <p className="map-note map-note-error">แบบประเมินปีปัจจุบันส่งแล้ว จึงเปิดดูได้อย่างเดียว</p>
          ) : missingData.length > 0 ? (
            <p className="map-note">ยังบันทึกไม่ได้ — รอข้อมูล: {missingData.join(" • ")}</p>
          ) : null}
          <button type="button" className="map-gis-save-btn" onClick={onSave} disabled={saveDisabled}>
            {saving ? "กำลังบันทึก…" : "บันทึกข้อมูลประกอบเกณฑ์และกรอกแบบประเมิน"}
          </button>
          {saveAction ? <p className="map-note map-gis-saved">✓ {SAVE_ACTION_MESSAGES[saveAction]}</p> : null}
          {saveErr ? <p className="map-note map-note-error">{saveErr}</p> : null}
          <p className="map-note map-gis-disclaimer">
            บันทึกครั้งเดียวจะสร้าง/ปรับปรุงแบบประเมินปีปัจจุบันของโรงเรียน กรอกข้อมูลประกอบ
            และคำนวณคะแนนด้านที่ 3 (คมนาคม) ให้อัตโนมัติ — ความสูงสุ่มจากเบราว์เซอร์ (Terrarium DEM)
            เป็นค่าโดยประมาณ ระยะทาง/เวลา/อัตราส่วนทุกตัว ระบบคำนวณยืนยันฝั่งเซิร์ฟเวอร์อีกครั้งตอนบันทึก
          </p>
        </div>
      ) : (
        <p className="map-note">
          {assessment
            ? "เปิดดูผลวิเคราะห์อย่างเดียว — บันทึกลงแบบประเมินได้เฉพาะบัญชีโรงเรียนเจ้าของ"
            : "เปิดดูผลวิเคราะห์อย่างเดียว"}
        </p>
      )}
    </div>
  );
}
