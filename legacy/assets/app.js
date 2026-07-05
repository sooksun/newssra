const PASS_THRESHOLD = 70;
const STORAGE_KEY = "newssra-pss-assessment-v1";

const DIMENSIONS = [
  {
    no: 1,
    title: "การจัดการศึกษาให้แก่ผู้เรียนที่มีความหลากหลายและความจำเป็นพิเศษ",
    short: "ผู้เรียนหลากหลาย",
    max: 30,
    note: "ฐานประชากรผู้เรียนใช้ยอด ณ 10 มิ.ย. ตามระบบทะเบียนต้นทาง และเก็บเฉพาะยอดรวม",
    ids: ["1.1", "1.2", "1.3", "1.4"]
  },
  {
    no: 2,
    title: "ขาดแคลนบุคลากรอย่างต่อเนื่อง",
    short: "บุคลากร",
    max: 10,
    note: "ข้อมูลด้านนี้ควรยืนยันโดยสำนักงานเขตพื้นที่หรือ สกร.จังหวัด เพราะเป็นฐานอัตรากำลัง",
    ids: ["2.1", "2.2", "2.3"]
  },
  {
    no: 3,
    title: "ความยากลำบากของการคมนาคม",
    short: "คมนาคม",
    max: 30,
    note: "ประเมินจากที่ตั้งจริงของจุดจัดการศึกษา ไม่ใช่เฉลี่ยทั้งรหัสโรงเรียน",
    ids: ["3.1", "3.2", "3.3"]
  },
  {
    no: 4,
    title: "ขาดแคลนปัจจัยพื้นฐานในการจัดการเรียนการสอนและการดำรงชีพ",
    short: "ปัจจัยพื้นฐาน",
    max: 20,
    note: "พิจารณาไฟฟ้า น้ำ และระบบสื่อสารที่ใช้งานจริงในสถานศึกษา",
    ids: ["4.1", "4.2", "4.3"]
  },
  {
    no: 5,
    title: "ความเสี่ยงอันตรายในการจัดการศึกษาและการปฏิบัติงาน",
    short: "ความเสี่ยง",
    max: 10,
    note: "สถานะพื้นที่ควรเติมจากทะเบียนกลางตามประกาศราชการ โรงเรียนโต้แย้งได้พร้อมหลักฐาน",
    ids: ["5.1", "5.2"]
  }
];

const INDICATORS = {
  "1.1": {
    title: "ร้อยละของผู้เรียนกลุ่มชาติพันธุ์",
    max: 10,
    kind: "fields",
    desc: "ระบบคิดจากจำนวนผู้เรียนกลุ่มชาติพันธุ์หารด้วยผู้เรียนทั้งหมด",
    evidence: "ยอดรวมจาก DMC หรือระบบทะเบียนต้นทาง ห้ามแนบรายชื่อรายบุคคล",
    fields: [{ key: "count", label: "จำนวนผู้เรียนกลุ่มชาติพันธุ์", unit: "คน", type: "number" }]
  },
  "1.2": {
    title: "จำนวนผู้เรียนพักนอน",
    max: 10,
    kind: "fields",
    desc: "นับเฉพาะที่พักซึ่งสถานศึกษาจัดให้และกำกับดูแลเองต่อเนื่องไม่น้อยกว่า 1 ภาคเรียน",
    evidence: "คำสั่งเวรพักนอนปีปัจจุบัน และภาพเรือนนอนพร้อมพิกัด",
    requiredEvidenceWhenPositive: true,
    fields: [{ key: "count", label: "จำนวนผู้เรียนพักนอน", unit: "คน", type: "number" }]
  },
  "1.3": {
    title: "ร้อยละของผู้เรียนกลุ่มเปราะบาง",
    max: 5,
    kind: "fields",
    desc: "นับหัวไม่ซ้ำคน เช่น ยากจนพิเศษ พิการ รหัส G กำพร้าหรือถูกทอดทิ้ง",
    evidence: "ยอดรวมจาก กสศ. ระบบเรียนรวม หรือ DMC พร้อมหนังสือรับรองยอด",
    fields: [{ key: "count", label: "จำนวนผู้เรียนเปราะบาง", unit: "คน", type: "number" }]
  },
  "1.4": {
    title: "จำนวนภาษาของผู้เรียนที่ไม่ใช้ภาษาไทยเป็นภาษาหลัก",
    max: 5,
    kind: "fields",
    desc: "นับเฉพาะภาษาที่มีผู้เรียนใช้ตั้งแต่ 5 คนขึ้นไป หรือ 5% ของผู้เรียนทั้งหมดขึ้นไป",
    evidence: "แบบสรุปผลสำรวจภาษารายห้อง ลงนามโดยผู้อำนวยการ",
    fields: [{ key: "langs", label: "จำนวนภาษา", unit: "ภาษา", type: "number" }]
  },
  "2.1": {
    title: "อัตรากำลังสายงานการสอนต่ำกว่าเกณฑ์ ก.ค.ศ.",
    max: 3,
    kind: "fields",
    desc: "คำนวณร้อยละความขาดแคลนจากกรอบอัตรากำลังเทียบครูปฏิบัติงานจริง",
    evidence: "รายงานอัตรากำลัง HRMS/P-OBEC ที่เขตรับรอง",
    fields: [
      { key: "frame", label: "กรอบอัตรากำลังตามเกณฑ์", unit: "อัตรา", type: "number" },
      { key: "actual", label: "ครูปฏิบัติงานจริง", unit: "อัตรา", type: "number" }
    ]
  },
  "2.2": {
    title: "ตำแหน่งว่างต่อเนื่องไม่น้อยกว่า 1 ปี",
    max: 4,
    kind: "level",
    desc: "ตำแหน่งครูหรือผู้บริหารที่ว่างเกิน 12 เดือนนับถึงวันตัดยอด",
    evidence: "ทะเบียนตำแหน่งว่างของเขต และประกาศรับย้ายหรือบรรจุ",
    options: [
      { points: 0, label: "ไม่มีตำแหน่งว่างต่อเนื่องเกิน 12 เดือน" },
      { points: 2, label: "ว่าง 1 ตำแหน่ง ต่อเนื่อง 12-24 เดือน" },
      { points: 3, label: "ว่าง 1 ตำแหน่งเกิน 24 เดือน หรือว่างพร้อมกัน 2 ตำแหน่งขึ้นไป แต่ละตำแหน่งเกิน 12 เดือน" },
      { points: 4, label: "ว่าง 2 ตำแหน่งขึ้นไปเกิน 24 เดือน หรือประกาศรับแล้วไม่มีผู้ยื่น 2 รอบติดกัน" }
    ]
  },
  "2.3": {
    title: "อัตราการหมุนเวียนออกของครู เฉลี่ย 3 ปี",
    max: 3,
    kind: "fields",
    desc: "รวมย้ายออก ลาออก และโอน ไม่รวมเกษียณหรือเสียชีวิต",
    evidence: "ทะเบียนการย้าย ลาออก หรือโอนย้อนหลัง 3 ปี รับรองโดยเขต",
    fields: [{ key: "rate", label: "อัตราหมุนเวียนออกเฉลี่ย", unit: "%", type: "number" }]
  },
  "3.1": {
    title: "ระยะเวลาเดินทางจากเขตหรือ สกร.อำเภอ ถึงสถานศึกษา",
    max: 10,
    kind: "fields",
    desc: "เที่ยวเดียว ด้วยเส้นทางและพาหนะที่ใช้จริงเป็นปกติในฤดูแล้ง",
    evidence: "พิกัด GPS ภาพเส้นทางจากแผนที่ และภาพถ่ายสภาพเส้นทางอย่างน้อย 3 จุด",
    fields: [
      { key: "minutes", label: "เวลาเดินทาง", unit: "นาที", type: "number" },
      { key: "km", label: "ระยะทาง", unit: "กม.", type: "number" }
    ]
  },
  "3.2": {
    title: "ความยากลำบากในการเดินทางเข้าถึงสถานศึกษา",
    max: 10,
    kind: "level",
    evidence: "ภาพถ่ายเส้นทางพร้อมพิกัดทั้งฤดูฝนและฤดูแล้ง และหนังสือรับรองจาก อปท. หรือฝ่ายปกครอง",
    options: [
      { points: 0, label: "ถนนลาดยางหรือคอนกรีตถึงสถานศึกษา รถทั่วไปเข้าถึงสะดวกตลอดปี" },
      { points: 4, label: "เข้าถึงได้ตลอดปีด้วยรถทั่วไป แต่บางช่วงเป็นลูกรัง ชำรุด หรือลาดชัน ต้องระวังสูง" },
      { points: 6, label: "บางฤดูกาลรถทั่วไปเข้าไม่ถึง ต้องใช้ 4WD วิบาก เรือ หรือถูกตัดขาดรวมเกิน 15 วันต่อปี" },
      { points: 8, label: "ตลอดทั้งปีต้องใช้พาหนะพิเศษจึงเข้าถึงได้" },
      { points: 10, label: "ต้องใช้พาหนะมากกว่า 1 ประเภทต่อเที่ยว หรือเดินเท้าตั้งแต่ 2 กม. หรือขึ้นกับสภาพอากาศ/ระดับน้ำ" }
    ]
  },
  "3.3": {
    title: "การเข้าถึงบริการฉุกเฉิน",
    max: 10,
    kind: "fields",
    desc: "เวลาที่หน่วยบริการฉุกเฉินของรัฐใกล้ที่สุดเดินทางถึงสถานศึกษาในสภาวะปกติ",
    evidence: "ชื่อและพิกัดหน่วยบริการใกล้สุด พร้อมหนังสือรับรองระยะเวลาเข้าถึง",
    fields: [
      { key: "minutes", label: "เวลาที่หน่วยฉุกเฉินมาถึง", unit: "นาที", type: "number" },
      { key: "unitName", label: "ชื่อหน่วยบริการใกล้สุด", unit: "", type: "text" }
    ]
  },
  "4.1": {
    title: "การเข้าถึงระบบไฟฟ้า",
    max: 8,
    kind: "level",
    evidence: "บิลค่าไฟฟ้า หนังสือรับรองจากการไฟฟ้า หรือภาพระบบผลิตไฟพร้อมพิกัด",
    options: [
      { points: 0, label: "ไฟฟ้าจากระบบจำหน่ายสาธารณะครอบคลุมทุกอาคาร ใช้งานได้ปกติ" },
      { points: 4, label: "มีไฟฟ้าสาธารณะ แต่ไม่ครอบคลุมทุกอาคาร หรือแรงดันตก/ดับบ่อยเฉลี่ยตั้งแต่ 4 ครั้งต่อเดือน" },
      { points: 6, label: "ไม่มีไฟฟ้าสาธารณะ ใช้ระบบผลิตเองได้บางช่วงเวลาหรือบางอาคาร" },
      { points: 8, label: "ไม่มีไฟฟ้าสาธารณะ และระบบผลิตเองจำกัดมาก ต่ำกว่า 6 ชั่วโมงต่อวัน หรือไม่มีไฟใช้เลย" }
    ]
  },
  "4.2": {
    title: "การเข้าถึงน้ำเพื่ออุปโภคบริโภค",
    max: 8,
    kind: "level",
    evidence: "ภาพแหล่งน้ำหรือระบบน้ำ บิลค่าน้ำ หลักฐานขนน้ำ และหนังสือรับรองจาก อปท.",
    options: [
      { points: 0, label: "มีระบบประปาเพียงพอตลอดปี" },
      { points: 4, label: "มีระบบประปาแต่ไม่สม่ำเสมอ ขาดช่วงรวมตั้งแต่ 30 วันต่อปี หรือคุณภาพไม่เหมาะอุปโภค" },
      { points: 6, label: "ไม่มีระบบประปา แต่จัดหาน้ำใช้เองได้พอ เช่น น้ำฝน น้ำภูเขา หรือบ่อ" },
      { points: 8, label: "ไม่มีระบบประปา และขาดแคลนเป็นประจำ ต้องขนหรือซื้อน้ำจากภายนอก" }
    ]
  },
  "4.3": {
    title: "การเข้าถึงระบบสื่อสารและอินเทอร์เน็ต",
    max: 4,
    kind: "level",
    evidence: "ผลทดสอบความเร็วอย่างน้อย 3 ครั้งต่างวันกัน พร้อมเวลา ตำแหน่ง และเครือข่าย",
    options: [
      { points: 0, label: "อินเทอร์เน็ตความเร็วสูงใช้จัดการเรียนการสอนได้ต่อเนื่องเป็นปกติ" },
      { points: 2, label: "ใช้ได้แต่ไม่เสถียร หลุดหรือช้าจนกระทบการสอนเป็นประจำ" },
      { points: 3, label: "ใช้ได้เฉพาะบางจุดของสถานศึกษา หรือบางช่วงเวลา" },
      { points: 4, label: "ไม่มีอินเทอร์เน็ตและไม่มีสัญญาณโทรศัพท์ในบริเวณสถานศึกษา" }
    ]
  },
  "5.1": {
    title: "พื้นที่เสี่ยงด้านความมั่นคงตามประกาศราชการ",
    max: 5,
    kind: "level",
    evidence: "เลขที่หรือชื่อประกาศจากทะเบียนกลาง หรือหนังสือรับรองกรณีโต้แย้ง",
    options: [
      { points: 0, label: "ปกติ ไม่อยู่ในพื้นที่ประกาศใด" },
      { points: 3, label: "พื้นที่เฝ้าระวังด้านความมั่นคง หรือพื้นที่ชายแดนที่มีมาตรการพิเศษ" },
      { points: 5, label: "พื้นที่เสี่ยงสูง อยู่ในประกาศสถานการณ์ฉุกเฉิน กฎอัยการศึก หรือมีเหตุความไม่สงบย้อนหลังภายใน 3 ปี" }
    ]
  },
  "5.2": {
    title: "พื้นที่เสี่ยงภัยยาเสพติดหรือเส้นทางลำเลียงยาเสพติด",
    max: 5,
    kind: "level",
    evidence: "หนังสือรับรองสถานะพื้นที่จาก ศอ.ปส.จังหวัด ที่ทำการปกครองอำเภอ หรือสถานีตำรวจภูธร",
    options: [
      { points: 0, label: "ไม่เป็นทั้งพื้นที่แพร่ระบาดและเส้นทางลำเลียง" },
      { points: 3, label: "เป็นพื้นที่แพร่ระบาด หรือเส้นทางลำเลียง อย่างใดอย่างหนึ่ง" },
      { points: 5, label: "เป็นทั้งพื้นที่แพร่ระบาดและเส้นทางลำเลียง" }
    ]
  }
};

let state = makeBlankState();

function makeBlankState() {
  const responses = {};
  const evidence = {};
  Object.keys(INDICATORS).forEach((id) => {
    responses[id] = {};
    evidence[id] = { ready: false, note: "" };
  });

  return {
    unit: {
      name: "",
      code: "",
      year: "2569",
      totalStudents: "",
      areaOffice: "",
      province: "",
      lat: "",
      lng: "",
      unitType: "โรงเรียน"
    },
    responses,
    evidence,
    signed: false,
    submitted: null
  };
}

function makeDemoState() {
  const demo = makeBlankState();
  demo.unit = {
    name: "โรงเรียนบ้านห้วยเย็นวิทยา ห้องเรียนสาขาดอยผาแดง",
    code: "50100199",
    year: "2569",
    totalStudents: "128",
    areaOffice: "สพป.เชียงใหม่ เขต 3",
    province: "เชียงใหม่",
    lat: "18.789100",
    lng: "98.983200",
    unitType: "ห้องเรียนสาขา"
  };
  demo.responses = {
    "1.1": { count: "92" },
    "1.2": { count: "20" },
    "1.3": { count: "40" },
    "1.4": { langs: "3" },
    "2.1": { frame: "12", actual: "9" },
    "2.2": { level: "1" },
    "2.3": { rate: "22" },
    "3.1": { minutes: "145", km: "38" },
    "3.2": { level: "3" },
    "3.3": { minutes: "50", unitName: "รพ.สต.บ้านห้วยเย็น" },
    "4.1": { level: "2" },
    "4.2": { level: "1" },
    "4.3": { level: "2" },
    "5.1": { level: "1" },
    "5.2": { level: "1" }
  };
  Object.keys(INDICATORS).forEach((id) => {
    demo.evidence[id] = { ready: true, note: id === "1.2" ? "มีคำสั่งเวรพักนอนและภาพเรือนนอนพร้อมพิกัด" : "" };
  });
  return demo;
}

function num(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isBlank(value) {
  return value === undefined || value === null || value === "";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scoreIndicator(id) {
  const data = state.responses[id] || {};
  const total = num(state.unit.totalStudents);

  switch (id) {
    case "1.1": {
      if (isBlank(data.count) || total <= 0) return null;
      const percent = num(data.count) / total * 100;
      if (percent < 5) return 0;
      if (percent <= 20) return 2;
      if (percent <= 40) return 4;
      if (percent <= 60) return 6;
      if (percent <= 80) return 8;
      return 10;
    }
    case "1.2": {
      if (isBlank(data.count)) return null;
      const count = num(data.count);
      if (count <= 0) return 0;
      if (count <= 10) return 4;
      if (count <= 20) return 6;
      if (count <= 30) return 7;
      if (count <= 40) return 8;
      if (count <= 60) return 9;
      return 10;
    }
    case "1.3": {
      if (isBlank(data.count) || total <= 0) return null;
      const percent = num(data.count) / total * 100;
      if (percent < 1) return 0;
      if (percent <= 6) return 1;
      if (percent <= 11) return 2;
      if (percent <= 16) return 3;
      if (percent <= 21) return 4;
      return 5;
    }
    case "1.4": {
      if (isBlank(data.langs)) return null;
      return clamp(Math.floor(num(data.langs)), 0, 5);
    }
    case "2.1": {
      if (isBlank(data.frame) || isBlank(data.actual)) return null;
      const frame = num(data.frame);
      if (frame <= 0) return 0;
      const deficit = (frame - num(data.actual)) / frame * 100;
      if (deficit <= 0) return 0;
      if (deficit <= 10) return 1;
      if (deficit <= 20) return 2;
      return 3;
    }
    case "2.2":
    case "3.2":
    case "4.1":
    case "4.2":
    case "4.3":
    case "5.1":
    case "5.2": {
      if (isBlank(data.level)) return null;
      const option = INDICATORS[id].options[Number(data.level)];
      return option ? option.points : null;
    }
    case "2.3": {
      if (isBlank(data.rate)) return null;
      const rate = num(data.rate);
      if (rate < 10) return 0;
      if (rate <= 20) return 1;
      if (rate <= 30) return 2;
      return 3;
    }
    case "3.1": {
      if (isBlank(data.minutes)) return null;
      const minutes = num(data.minutes);
      if (minutes <= 30) return 0;
      if (minutes <= 60) return 3;
      if (minutes <= 120) return 6;
      if (minutes <= 180) return 8;
      return 10;
    }
    case "3.3": {
      if (isBlank(data.minutes)) return null;
      const minutes = num(data.minutes);
      if (minutes <= 15) return 0;
      if (minutes <= 30) return 3;
      if (minutes <= 60) return 6;
      if (minutes <= 120) return 8;
      return 10;
    }
    default:
      return null;
  }
}

function totalScore() {
  return Object.keys(INDICATORS).reduce((sum, id) => {
    const score = scoreIndicator(id);
    return sum + (score === null ? 0 : score);
  }, 0);
}

function dimScore(dimension) {
  return dimension.ids.reduce((sum, id) => {
    const score = scoreIndicator(id);
    return sum + (score === null ? 0 : score);
  }, 0);
}

function answeredCount() {
  return Object.keys(INDICATORS).filter((id) => scoreIndicator(id) !== null).length;
}

function levelFor(score) {
  if (score >= PASS_THRESHOLD) {
    return {
      key: "level-3",
      label: "ระดับ 3 ยุ่งยากมากที่สุด",
      short: "ได้รับ พ.ส.ศ. 2,000 บาท/เดือน",
      detail: `ผ่านเกณฑ์ ${PASS_THRESHOLD} คะแนน`
    };
  }
  if (score >= 60) {
    return {
      key: "level-2",
      label: "ระดับ 2 ยุ่งยากมาก",
      short: "ขึ้นทะเบียนรอพิจารณา",
      detail: `ต้องการอีก ${PASS_THRESHOLD - score} คะแนนเพื่อถึงระดับ 3`
    };
  }
  if (score >= 50) {
    return {
      key: "level-1",
      label: "ระดับ 1 ยุ่งยาก",
      short: "ขึ้นทะเบียนรอพิจารณา",
      detail: `ต้องการอีก ${PASS_THRESHOLD - score} คะแนนเพื่อถึงระดับ 3`
    };
  }
  return {
    key: "neutral",
    label: "ยังไม่จัดระดับ",
    short: "ยังไม่เข้าเกณฑ์รับเงินเพิ่ม พ.ส.ศ.",
    detail: `ต้องการอีก ${PASS_THRESHOLD - score} คะแนนเพื่อถึงระดับ 3`
  };
}

function indicatorPercent(id) {
  const total = num(state.unit.totalStudents);
  if (total <= 0) return null;
  return num(state.responses[id]?.count) / total * 100;
}

function flags() {
  const items = [];
  const total = num(state.unit.totalStudents);

  ["1.1", "1.2", "1.3"].forEach((id) => {
    const count = state.responses[id]?.count;
    if (!isBlank(count) && total > 0 && num(count) > total) {
      items.push({
        code: "V00",
        id,
        tone: "block",
        text: `${id} จำนวนที่กรอกมากกว่าผู้เรียนทั้งหมด ต้องตรวจแก้ก่อนส่ง`
      });
    }
  });

  if (num(state.responses["1.2"]?.count) >= 1 && !state.evidence["1.2"]?.ready) {
    items.push({
      code: "V02",
      id: "1.2",
      tone: "block",
      text: "มีผู้เรียนพักนอน แต่ยังไม่ยืนยันคำสั่งเวรพักนอนและหลักฐานเรือนนอน"
    });
  }

  if (Number(state.responses["3.2"]?.level) >= 3 && !isBlank(state.responses["3.1"]?.minutes) && num(state.responses["3.1"]?.minutes) <= 30) {
    items.push({
      code: "V04",
      id: "3.2",
      tone: "warn",
      text: "เลือกความยากลำบากการเข้าถึงระดับสูง แต่เวลาเดินทางจากเขตไม่เกิน 30 นาที"
    });
  }

  const electricity = Number(state.responses["4.1"]?.level);
  const internet = Number(state.responses["4.3"]?.level);
  if ((electricity === 2 || electricity === 3) && internet === 0) {
    items.push({
      code: "V06",
      id: "4.1",
      tone: "warn",
      text: "ระบุว่าไม่มีไฟฟ้าสาธารณะ แต่อินเทอร์เน็ตใช้งานปกติ กรรมการควรตรวจประกอบ"
    });
  }

  if (internet === 3) {
    items.push({
      code: "V07",
      id: "4.3",
      tone: "info",
      text: "ระบุว่าไม่มีสัญญาณสื่อสาร ระบบควรบันทึกสถานที่ที่ใช้ยื่นแบบออนไลน์"
    });
  }

  const score = totalScore();
  if (score >= 65 && score <= 74) {
    items.push({
      code: "V09",
      id: null,
      tone: "info",
      text: "คะแนนรวมอยู่ในแถบ 65-74 ต้องเข้าคิวตรวจภาคสนาม 100% ก่อนประกาศผล"
    });
  }

  return items;
}

function unitComplete() {
  const unit = state.unit;
  return Boolean(unit.name && unit.code && unit.year && num(unit.totalStudents) > 0 && unit.areaOffice && unit.province);
}

function canSubmit() {
  return unitComplete() && answeredCount() === Object.keys(INDICATORS).length && state.signed && !flags().some((item) => item.tone === "block");
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    state = mergeState(makeBlankState(), saved);
  } catch (error) {
    console.warn("Cannot load saved assessment", error);
  }
}

function mergeState(base, saved) {
  return {
    ...base,
    ...saved,
    unit: { ...base.unit, ...(saved.unit || {}) },
    responses: { ...base.responses, ...(saved.responses || {}) },
    evidence: { ...base.evidence, ...(saved.evidence || {}) }
  };
}

function renderCriteria() {
  const nav = document.querySelector("#sectionNav");
  nav.innerHTML = DIMENSIONS.map((dim) => `
    <a href="#dimension-${dim.no}">
      <span class="nav-no">${dim.no}</span>
      <span class="nav-title">${dim.short}</span>
      <span class="nav-score" id="nav-score-${dim.no}">0/${dim.max}</span>
    </a>
  `).join("");

  const container = document.querySelector("#criteriaSections");
  container.innerHTML = DIMENSIONS.map((dim) => `
    <section class="panel dimension-panel" id="dimension-${dim.no}">
      <div class="dimension-head">
        <div>
          <p class="eyebrow">ด้านที่ ${dim.no} จาก 5</p>
          <h2>${dim.title}</h2>
          <p>${dim.note}</p>
        </div>
        <div class="dimension-score" id="dim-score-${dim.no}">0/${dim.max}</div>
      </div>
      <div class="indicator-grid">
        ${dim.ids.map((id) => renderIndicator(id)).join("")}
      </div>
    </section>
  `).join("");
}

function renderIndicator(id) {
  const indicator = INDICATORS[id];
  const body = indicator.kind === "level"
    ? renderLevelOptions(id, indicator)
    : renderFields(id, indicator);

  return `
    <article class="indicator-card" data-card="${id}">
      <div class="indicator-head">
        <div>
          <div class="indicator-title">
            <span class="mini-tag">${id}</span>
            <strong>${indicator.title}</strong>
          </div>
          <p class="indicator-desc">${indicator.desc || ""}</p>
        </div>
        <div class="score-badge" id="score-${cssId(id)}">0/${indicator.max}</div>
      </div>
      ${body}
      ${renderEvidence(id, indicator)}
      <div class="computed-line" id="result-${cssId(id)}">ยังไม่กรอกข้อมูล</div>
      <div class="flag-list" id="flags-${cssId(id)}"></div>
    </article>
  `;
}

function renderFields(id, indicator) {
  return `
    <div class="input-grid">
      ${indicator.fields.map((field) => {
        const value = state.responses[id]?.[field.key] || "";
        return `
          <label class="input-wrap">
            <span>${field.label}</span>
            <input
              type="${field.type}"
              ${field.type === "number" ? "min=\"0\" step=\"any\"" : ""}
              data-response="${id}"
              data-key="${field.key}"
              value="${escapeAttr(value)}"
              placeholder="${field.unit || "กรอกข้อมูล"}">
            ${field.unit ? `<small>${field.unit}</small>` : ""}
          </label>
        `;
      }).join("")}
    </div>
  `;
}

function renderLevelOptions(id, indicator) {
  const selected = state.responses[id]?.level;
  return `
    <div class="level-options" role="group" aria-label="${indicator.title}">
      ${indicator.options.map((option, index) => `
        <button
          type="button"
          class="level-option ${String(selected) === String(index) ? "active" : ""}"
          data-level="${id}"
          data-level-index="${index}">
          <span class="point-chip">${option.points}</span>
          <span>${option.label}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function renderEvidence(id, indicator) {
  return `
    <div class="evidence-box">
      <div class="evidence-row">
        <p><strong>หลักฐาน:</strong> ${indicator.evidence}</p>
        <label class="evidence-check">
          <input type="checkbox" data-evidence-ready="${id}" ${state.evidence[id]?.ready ? "checked" : ""}>
          หลักฐานพร้อมตรวจ
        </label>
      </div>
      <textarea data-evidence-note="${id}" placeholder="บันทึกเลขที่เอกสาร ชื่อไฟล์ หรือคำชี้แจงประกอบ">${escapeHtml(state.evidence[id]?.note || "")}</textarea>
    </div>
  `;
}

function renderUnitInputs() {
  document.querySelectorAll("[data-unit]").forEach((input) => {
    input.value = state.unit[input.dataset.unit] || "";
  });
  document.querySelectorAll("[data-unit-choice]").forEach((button) => {
    const key = button.dataset.unitChoice;
    button.classList.toggle("active", state.unit[key] === button.dataset.value);
  });
  document.querySelector("#signedCheck").checked = state.signed;
}

function updateComputed() {
  const score = totalScore();
  const level = levelFor(score);
  const angle = clamp(score, 0, 100) * 3.6;
  const flagItems = flags();
  const answered = answeredCount();
  const totalIndicators = Object.keys(INDICATORS).length;

  document.documentElement.style.setProperty("--score-angle", `${angle}deg`);
  document.querySelector("#totalScore").textContent = score;
  document.querySelector("#summaryTotal").textContent = score;

  const levelPill = document.querySelector("#levelPill");
  levelPill.className = `level-pill ${level.key}`;
  levelPill.textContent = level.label;
  document.querySelector("#scoreNote").textContent = level.detail;
  document.querySelector("#summaryLevel").textContent = level.label;
  document.querySelector("#summaryRight").textContent = level.short;

  Object.keys(INDICATORS).forEach((id) => updateIndicator(id, flagItems));
  DIMENSIONS.forEach((dim) => {
    const earned = dimScore(dim);
    const text = `${earned}/${dim.max}`;
    document.querySelector(`#dim-score-${dim.no}`).textContent = text;
    document.querySelector(`#nav-score-${dim.no}`).textContent = text;
  });

  renderDimensionSummary();
  renderFlagSummary(flagItems);
  renderReadiness(answered, totalIndicators, flagItems);
  updateSubmit(answered, totalIndicators, flagItems);
  saveState();
}

function updateIndicator(id, flagItems) {
  const score = scoreIndicator(id);
  const indicator = INDICATORS[id];
  const badge = document.querySelector(`#score-${cssId(id)}`);
  badge.textContent = `${score === null ? 0 : score}/${indicator.max}`;
  badge.classList.toggle("has-score", score !== null && score > 0);

  document.querySelectorAll(`[data-level="${id}"]`).forEach((button) => {
    button.classList.toggle("active", state.responses[id]?.level === button.dataset.levelIndex);
  });

  const result = document.querySelector(`#result-${cssId(id)}`);
  const resultText = computedText(id, score);
  result.textContent = resultText.text;
  result.className = `computed-line ${resultText.tone}`;

  const localFlags = flagItems.filter((item) => item.id === id);
  document.querySelector(`#flags-${cssId(id)}`).innerHTML = localFlags.map(renderFlag).join("");
}

function computedText(id, score) {
  const response = state.responses[id] || {};
  if (score === null) return { text: "ยังไม่กรอกข้อมูล", tone: "" };

  if (id === "1.1" || id === "1.3") {
    const percent = indicatorPercent(id);
    if (percent === null) return { text: "ต้องกรอกผู้เรียนทั้งหมดก่อนคำนวณ", tone: "warn" };
    return { text: `${percent.toFixed(2)}% ของผู้เรียนทั้งหมด - ได้ ${score} คะแนน`, tone: score > 0 ? "good" : "" };
  }

  if (id === "2.1") {
    const frame = num(response.frame);
    const deficit = frame <= 0 ? 0 : Math.max(0, (frame - num(response.actual)) / frame * 100);
    return { text: `ขาดแคลน ${deficit.toFixed(1)}% - ได้ ${score} คะแนน`, tone: score > 0 ? "good" : "" };
  }

  return { text: `ได้ ${score} คะแนน`, tone: score > 0 ? "good" : "" };
}

function renderDimensionSummary() {
  const html = DIMENSIONS.map((dim) => {
    const earned = dimScore(dim);
    const percent = dim.max ? earned / dim.max * 100 : 0;
    return `
      <div class="dimension-row">
        <span class="nav-no">${dim.no}</span>
        <strong>${dim.short}</strong>
        <strong>${earned}/${dim.max}</strong>
        <div class="bar"><span style="width:${percent}%"></span></div>
      </div>
    `;
  }).join("");
  document.querySelector("#dimensionSummary").innerHTML = html;
}

function renderFlagSummary(flagItems) {
  const target = document.querySelector("#flagSummary");
  if (!flagItems.length) {
    target.innerHTML = `<div class="empty-state">ไม่มีข้อสังเกตที่ต้องแก้ไข</div>`;
    return;
  }
  target.innerHTML = `<div class="flag-list">${flagItems.map(renderFlag).join("")}</div>`;
}

function renderFlag(item) {
  return `
    <div class="flag ${item.tone}">
      <strong>${item.code}</strong>
      <span>${item.text}</span>
    </div>
  `;
}

function renderReadiness(answered, totalIndicators, flagItems) {
  const blockers = flagItems.filter((item) => item.tone === "block").length;
  const items = [
    { done: unitComplete(), text: "กรอกข้อมูลจุดจัดการศึกษาครบถ้วน" },
    { done: answered === totalIndicators, text: `กรอกตัวชี้วัดครบ ${answered}/${totalIndicators} รายการ` },
    { done: blockers === 0, text: blockers === 0 ? "ไม่มีธงบล็อกการส่ง" : `มีธงบล็อก ${blockers} รายการ` },
    { done: state.signed, text: "ลงนามรับรองข้อมูลก่อนส่ง" }
  ];
  document.querySelector("#readyList").innerHTML = items.map((item) => `
    <li class="ready-item ${item.done ? "done" : ""}">
      <span class="ready-dot">${item.done ? "✓" : ""}</span>
      <span>${item.text}</span>
    </li>
  `).join("");
}

function updateSubmit(answered, totalIndicators, flagItems) {
  const button = document.querySelector("#submitBtn");
  const hint = document.querySelector("#submitHint");
  const blockers = flagItems.some((item) => item.tone === "block");
  const ready = canSubmit();

  button.disabled = !ready;
  if (!unitComplete()) {
    button.textContent = "กรอกข้อมูลจุดจัดการศึกษาให้ครบก่อนส่ง";
    hint.textContent = "ต้องมีชื่อ รหัส ปีประเมิน ยอดผู้เรียน หน่วยงานต้นทาง และจังหวัด";
  } else if (answered !== totalIndicators) {
    button.textContent = "กรอกข้อมูลให้ครบก่อนส่ง";
    hint.textContent = `เหลือ ${totalIndicators - answered} ตัวชี้วัด`;
  } else if (blockers) {
    button.textContent = "แก้ธงที่บล็อกก่อนส่ง";
    hint.textContent = "รายการสีแดงต้องแก้ไขหรือยืนยันหลักฐานให้ครบ";
  } else if (!state.signed) {
    button.textContent = "ลงนามรับรองก่อนส่ง";
    hint.textContent = "ติ๊กคำรับรองข้อมูลด้านบน";
  } else {
    button.textContent = "ลงนามรับรองและส่งแบบประเมิน";
    hint.textContent = "ระบบจะสร้างเลขที่อ้างอิงในเครื่องนี้";
  }
}

function attachEvents() {
  const form = document.querySelector("#assessmentForm");

  form.addEventListener("input", (event) => {
    const unitKey = event.target.dataset.unit;
    const responseId = event.target.dataset.response;
    const evidenceNote = event.target.dataset.evidenceNote;

    if (unitKey) {
      state.unit[unitKey] = event.target.value;
      updateComputed();
      return;
    }
    if (responseId) {
      const key = event.target.dataset.key;
      state.responses[responseId][key] = event.target.value;
      updateComputed();
      return;
    }
    if (evidenceNote) {
      state.evidence[evidenceNote].note = event.target.value;
      updateComputed();
    }
  });

  form.addEventListener("change", (event) => {
    const evidenceReady = event.target.dataset.evidenceReady;
    if (evidenceReady) {
      state.evidence[evidenceReady].ready = event.target.checked;
      updateComputed();
      return;
    }
    if (event.target.id === "signedCheck") {
      state.signed = event.target.checked;
      updateComputed();
    }
  });

  form.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-unit-choice]");
    if (choice) {
      state.unit[choice.dataset.unitChoice] = choice.dataset.value;
      renderUnitInputs();
      updateComputed();
      return;
    }

    const levelButton = event.target.closest("[data-level]");
    if (levelButton) {
      state.responses[levelButton.dataset.level].level = levelButton.dataset.levelIndex;
      updateComputed();
    }
  });

  document.querySelector("#demoBtn").addEventListener("click", () => {
    state = makeDemoState();
    renderAll();
    toast("เติมข้อมูลตัวอย่างแล้ว");
  });

  document.querySelector("#resetBtn").addEventListener("click", resetState);
  document.querySelector("#printBtn").addEventListener("click", () => window.print());
  document.querySelector("#exportBtn").addEventListener("click", exportJson);
  document.querySelector("#submitBtn").addEventListener("click", submitAssessment);
}

function submitAssessment() {
  if (!canSubmit()) return;
  state.submitted = {
    at: new Date().toISOString(),
    ref: `พสศ-${state.unit.year || "2569"}-${Math.floor(Math.random() * 9000) + 1000}`,
    total: totalScore(),
    level: levelFor(totalScore()).label
  };
  state.signed = true;
  saveState();
  toast(`ส่งแบบประเมินแล้ว เลขที่อ้างอิง ${state.submitted.ref}`);
}

function resetState() {
  const confirmed = window.confirm("ต้องการล้างข้อมูลแบบประเมินในเครื่องนี้หรือไม่");
  if (!confirmed) return;
  state = makeBlankState();
  localStorage.removeItem(STORAGE_KEY);
  renderAll();
  toast("ล้างข้อมูลแล้ว");
}

function exportJson() {
  const payload = {
    exportedAt: new Date().toISOString(),
    unit: state.unit,
    scores: Object.fromEntries(Object.keys(INDICATORS).map((id) => [id, scoreIndicator(id)])),
    total: totalScore(),
    level: levelFor(totalScore()),
    flags: flags(),
    responses: state.responses,
    evidence: state.evidence,
    submitted: state.submitted
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pss-assessment-${state.unit.code || "draft"}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast("ส่งออกไฟล์ JSON แล้ว");
}

function renderAll() {
  renderUnitInputs();
  renderCriteria();
  renderUnitInputs();
  updateComputed();
}

function cssId(id) {
  return id.replace(".", "-");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

let toastTimer = null;
function toast(message) {
  const node = document.querySelector("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 2600);
}

loadState();
renderAll();
attachEvents();
