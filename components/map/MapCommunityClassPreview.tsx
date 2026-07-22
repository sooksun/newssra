// Preview จำแนกชุมชน 3 แกน บนแผงแผนที่ (แยกจาก CesiumMap god-file — PR A)

import { communityAxisATierLabelTh } from "@/lib/community-class";
import type { GisCommunityClass } from "@/lib/types";

interface Props {
  community: GisCommunityClass;
}

export default function MapCommunityClassPreview({ community }: Props) {
  return (
    <div className={`map-community-class map-community-${community.composite.tone}`}>
      <p className="map-community-title">
        ระดับความทุรกันดาร (แกน A+B): <strong>{community.composite.labelTh}</strong>
      </p>
      <ul className="map-community-axes">
        <li>
          <span className="map-community-axis">A ภูมิประเทศ</span>
          {community.axisA.highland ? "พื้นที่สูง" : "ไม่ใช่พื้นที่สูง"}
          {" · "}
          {communityAxisATierLabelTh(community.axisA.tier)}
          {community.axisA.reasons[0] ? ` — ${community.axisA.reasons[0]}` : ""}
        </li>
        <li>
          <span className="map-community-axis">B การเข้าถึง</span>
          {community.axisB.label}
          {community.axisB.severity !== null ? ` (ระดับ ${community.axisB.severity})` : ""}
        </li>
        <li>
          <span className="map-community-axis">C ความหนาแน่น</span>
          {community.axisC ? community.axisC.label : "ยังไม่มีข้อสรุปพื้นที่ (วาด polygon หรือดูวงรัศมี)"}
          <span className="map-community-c-note"> — แกนเมือง/ชนบท ไม่ใช่ระดับความทุรกันดาร</span>
        </li>
        {community.wscProxy ? (
          <li>
            <span className="map-community-axis">WSC</span>
            {community.wscProxy.labelTh}
            {community.wscProxy.meanSlopePct !== null ? ` · ลาด ${community.wscProxy.meanSlopePct}%` : ""}
            <span className="map-community-c-note"> — ประมาณจาก slope ไม่ใช่แผนที่ราชการ</span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
