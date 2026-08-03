// ค่าสถิติฐานจากผลการประเมินเดิม (ssrainfo_ssra) — ใช้เป็นข้อมูลอ้างอิงของเกณฑ์ปี 2569
//
// **ไฟล์นี้สร้างอัตโนมัติ — อย่าแก้ด้วยมือ**
// สร้างใหม่ด้วย: node scripts/analyze-legacy-items.mjs && node scripts/emit-legacy-baseline.mjs
//
// ที่มา: snapshot ในเครื่อง (ฐาน ssra_live — dump สร้างเมื่อ Aug 01, 2026 at 04:08 PM · นำเข้าเมื่อ 2026-08-01T09:23:53.639Z · จากไฟล์ ssrainfo_ssra (3).sql)
// ประชากร: พื้นที่สูง 1481 แห่ง · พื้นที่เกาะ 123 แห่ง
//          (รอบประเมินล่าสุดของแต่ละโรงเรียน เฉพาะที่ยืนยันสถานะปี 2569 (school_confirm.area_type=1))
// รายงานประกอบ: docs/ANALYSIS-เกณฑ์เดิมรายข้อ.md

export const LEGACY_BASELINE_META = {
  "generatedAt": "2026-08-01T09:55:37.703Z",
  "source": "snapshot ในเครื่อง (ฐาน ssra_live — dump สร้างเมื่อ Aug 01, 2026 at 04:08 PM · นำเข้าเมื่อ 2026-08-01T09:23:53.639Z · จากไฟล์ ssrainfo_ssra (3).sql)",
  "passThreshold": 70,
  "populations": {
    "highland": {
      "rowsAll": 1986,
      "schools": 1886,
      "analysed": 1481,
      "rule": "รอบประเมินล่าสุดของแต่ละโรงเรียน เฉพาะที่ยืนยันสถานะปี 2569 (school_confirm.area_type=1)"
    },
    "island": {
      "rowsAll": 130,
      "schools": 126,
      "analysed": 123,
      "rule": "รอบประเมินล่าสุดของแต่ละโรงเรียน เฉพาะที่ยืนยันสถานะปี 2569 (school_confirm.area_type=2)"
    }
  },
  "yearCoverage": {
    "highland": {
      "2560": 1,
      "2565": 1623,
      "2566": 228,
      "2567": 61,
      "2569": 73
    },
    "island": {
      "2565": 118,
      "2566": 4,
      "2568": 4,
      "2569": 4
    }
  }
} as const;

/** สรุปพฤติกรรมรายข้อของเกณฑ์เดิม — verdict: free = แจกฟรี, floor = ส่วนใหญ่ได้ 0, discriminating = จำแนกได้, weak = อ่อน */
export const LEGACY_HIGHLAND_ITEM_BASELINE = [
  {
    "no": 1,
    "key": "citeria01",
    "short": "ความสูงจุดสูงสุด",
    "group": "geo",
    "max": 30,
    "meanScore": 29.46,
    "sharePct": 98.21,
    "fullPct": 87.58,
    "zeroPct": 0.41,
    "itemRestR": 0.03,
    "D": 0.04,
    "flipPct": 24.31,
    "verdict": "free"
  },
  {
    "no": 2,
    "key": "citeria02",
    "short": "ชายแดน",
    "group": "admin",
    "max": 5,
    "meanScore": 2.83,
    "sharePct": 56.54,
    "fullPct": 16.48,
    "zeroPct": 13.17,
    "itemRestR": 0.15,
    "D": 0.24,
    "flipPct": 2.57,
    "verdict": "weak"
  },
  {
    "no": 3,
    "key": "citeria03",
    "short": "เขต อปท.",
    "group": "admin",
    "max": 5,
    "meanScore": 4.82,
    "sharePct": 96.42,
    "fullPct": 82.44,
    "zeroPct": 0.07,
    "itemRestR": 0.18,
    "D": 0.05,
    "flipPct": 6.08,
    "verdict": "free"
  },
  {
    "no": 4,
    "key": "citeria041",
    "short": "ถนนรถ 2 ล้อไปไม่ได้",
    "group": "access",
    "max": 5,
    "meanScore": 0.58,
    "sharePct": 11.62,
    "fullPct": 10.26,
    "zeroPct": 87.17,
    "itemRestR": 0.38,
    "D": 0.34,
    "flipPct": 10.47,
    "verdict": "floor"
  },
  {
    "no": 5,
    "key": "citeria05",
    "short": "ระยะทางถึงศาลากลาง",
    "group": "geo",
    "max": 5,
    "meanScore": 4.64,
    "sharePct": 92.72,
    "fullPct": 74.68,
    "zeroPct": 0.61,
    "itemRestR": 0.12,
    "D": 0.06,
    "flipPct": 5.87,
    "verdict": "free"
  },
  {
    "no": 6,
    "key": "citeria06",
    "short": "ขนส่งสาธารณะ",
    "group": "access",
    "max": 5,
    "meanScore": 4.63,
    "sharePct": 92.56,
    "fullPct": 79.27,
    "zeroPct": 0.07,
    "itemRestR": 0.13,
    "D": 0.11,
    "flipPct": 6.08,
    "verdict": "free"
  },
  {
    "no": 7,
    "key": "citeria07",
    "short": "แหล่งน้ำ",
    "group": "utility",
    "max": 6,
    "meanScore": 4.8,
    "sharePct": 80.05,
    "fullPct": 48.95,
    "zeroPct": 0.07,
    "itemRestR": 0.28,
    "D": 0.25,
    "flipPct": 6.01,
    "verdict": "weak"
  },
  {
    "no": 8,
    "key": "citeria08",
    "short": "ไฟฟ้า",
    "group": "utility",
    "max": 3,
    "meanScore": 0.31,
    "sharePct": 10.26,
    "fullPct": 10.26,
    "zeroPct": 89.74,
    "itemRestR": 0.45,
    "D": 0.33,
    "flipPct": 6.35,
    "verdict": "floor"
  },
  {
    "no": 9,
    "key": "citeria09",
    "short": "โทรศัพท์",
    "group": "utility",
    "max": 3,
    "meanScore": 0.98,
    "sharePct": 32.82,
    "fullPct": 7.43,
    "zeroPct": 17.89,
    "itemRestR": 0.4,
    "D": 0.24,
    "flipPct": 3.71,
    "verdict": "weak"
  },
  {
    "no": 10,
    "key": "citeria10",
    "short": "อินเทอร์เน็ต",
    "group": "utility",
    "max": 3,
    "meanScore": 0.35,
    "sharePct": 11.7,
    "fullPct": 3.58,
    "zeroPct": 76.91,
    "itemRestR": 0.43,
    "D": 0.26,
    "flipPct": 5.47,
    "verdict": "floor"
  },
  {
    "no": 11,
    "key": "citeria11",
    "short": "% ชาติพันธุ์",
    "group": "learner",
    "max": 5,
    "meanScore": 3.39,
    "sharePct": 67.83,
    "fullPct": 45.31,
    "zeroPct": 16.21,
    "itemRestR": 0.47,
    "D": 0.71,
    "flipPct": 6.35,
    "verdict": "discriminating"
  },
  {
    "no": 12,
    "key": "citeria12",
    "short": "จำนวนกลุ่มชาติพันธุ์",
    "group": "learner",
    "max": 5,
    "meanScore": 1.93,
    "sharePct": 38.56,
    "fullPct": 9.18,
    "zeroPct": 16.21,
    "itemRestR": 0.01,
    "D": 0.16,
    "flipPct": 4.46,
    "verdict": "weak"
  },
  {
    "no": 13,
    "key": "citeria13",
    "short": "นักเรียนยากจน",
    "group": "learner",
    "max": 5,
    "meanScore": 4.07,
    "sharePct": 81.45,
    "fullPct": 62.26,
    "zeroPct": 5.4,
    "itemRestR": 0.29,
    "D": 0.35,
    "flipPct": 6.28,
    "verdict": "discriminating"
  },
  {
    "no": 14,
    "key": "citeria14",
    "short": "นักเรียนพักนอน",
    "group": "learner",
    "max": 5,
    "meanScore": 0.91,
    "sharePct": 18.23,
    "fullPct": 9.45,
    "zeroPct": 71.17,
    "itemRestR": 0.24,
    "D": 0.33,
    "flipPct": 8.85,
    "verdict": "floor"
  },
  {
    "no": 15,
    "key": "citeria15",
    "short": "สาขา",
    "group": "structure",
    "max": 5,
    "meanScore": 0.29,
    "sharePct": 5.85,
    "fullPct": 1.35,
    "zeroPct": 91.42,
    "itemRestR": 0.23,
    "D": 0.14,
    "flipPct": 9.72,
    "verdict": "floor"
  },
  {
    "no": 16,
    "key": "citeria16",
    "short": "ประกาศคลัง",
    "group": "admin",
    "max": 5,
    "meanScore": 1.77,
    "sharePct": 35.31,
    "fullPct": 35.31,
    "zeroPct": 64.69,
    "itemRestR": 0.49,
    "D": 0.87,
    "flipPct": 10.13,
    "verdict": "discriminating"
  }
] as const;

export const LEGACY_ISLAND_ITEM_BASELINE = [
  {
    "no": 1,
    "key": "citeria01",
    "short": "เป็นเกาะ",
    "group": "screen",
    "max": 0,
    "meanScore": 0,
    "sharePct": 0,
    "fullPct": 0,
    "zeroPct": 100,
    "itemRestR": 0,
    "D": 0,
    "flipPct": 0,
    "verdict": "floor"
  },
  {
    "no": 2,
    "key": "citeria02",
    "short": "เขต อปท.",
    "group": "admin",
    "max": 10,
    "meanScore": 8.39,
    "sharePct": 83.9,
    "fullPct": 54.47,
    "zeroPct": 0,
    "itemRestR": 0.25,
    "D": 0.18,
    "flipPct": 11.38,
    "verdict": "weak"
  },
  {
    "no": 3,
    "key": "citeria03",
    "short": "ลักษณะที่ตั้ง",
    "group": "geo",
    "max": 16,
    "meanScore": 15.87,
    "sharePct": 99.19,
    "fullPct": 99.19,
    "zeroPct": 0.81,
    "itemRestR": -0.03,
    "D": 0.03,
    "flipPct": 15.45,
    "verdict": "free"
  },
  {
    "no": 4,
    "key": "citeria04",
    "short": "พาหนะหลัก",
    "group": "access",
    "max": 20,
    "meanScore": 11.91,
    "sharePct": 59.55,
    "fullPct": 21.14,
    "zeroPct": 0,
    "itemRestR": 0.33,
    "D": 0.55,
    "flipPct": 15.45,
    "verdict": "discriminating"
  },
  {
    "no": 5,
    "key": "citeria05",
    "short": "ระยะทางบก",
    "group": "access",
    "max": 5,
    "meanScore": 4.51,
    "sharePct": 90.2,
    "fullPct": 78.05,
    "zeroPct": 0,
    "itemRestR": -0.19,
    "D": -0.04,
    "flipPct": 7.32,
    "verdict": "free"
  },
  {
    "no": 6,
    "key": "citeria06",
    "short": "ระยะทางน้ำ",
    "group": "access",
    "max": 5,
    "meanScore": 2.99,
    "sharePct": 59.74,
    "fullPct": 45.53,
    "zeroPct": 0.81,
    "itemRestR": -0.04,
    "D": 0.22,
    "flipPct": 7.32,
    "verdict": "weak"
  },
  {
    "no": 7,
    "key": "citeria07",
    "short": "เวลาเดินทาง",
    "group": "access",
    "max": 5,
    "meanScore": 3.55,
    "sharePct": 70.94,
    "fullPct": 39.02,
    "zeroPct": 0.81,
    "itemRestR": -0.04,
    "D": 0.11,
    "flipPct": 4.88,
    "verdict": "weak"
  },
  {
    "no": 8,
    "key": "citeria08",
    "short": "ค่าโดยสาร",
    "group": "access",
    "max": 5,
    "meanScore": 2.77,
    "sharePct": 55.46,
    "fullPct": 21.95,
    "zeroPct": 0.81,
    "itemRestR": 0.17,
    "D": 0.37,
    "flipPct": 5.69,
    "verdict": "discriminating"
  },
  {
    "no": 9,
    "key": "citeria09",
    "short": "เดินทางต่อ",
    "group": "access",
    "max": 5,
    "meanScore": 2.25,
    "sharePct": 45.04,
    "fullPct": 0.81,
    "zeroPct": 0,
    "itemRestR": 0.35,
    "D": 0.14,
    "flipPct": 4.88,
    "verdict": "weak"
  },
  {
    "no": 10,
    "key": "citeria10",
    "short": "ไฟฟ้า",
    "group": "utility",
    "max": 5,
    "meanScore": 0.85,
    "sharePct": 17.07,
    "fullPct": 17.07,
    "zeroPct": 82.93,
    "itemRestR": 0.52,
    "D": 0.61,
    "flipPct": 9.76,
    "verdict": "floor"
  },
  {
    "no": 11,
    "key": "citeria11",
    "short": "แหล่งน้ำ",
    "group": "utility",
    "max": 10,
    "meanScore": 5.64,
    "sharePct": 56.42,
    "fullPct": 9.76,
    "zeroPct": 14.63,
    "itemRestR": 0.26,
    "D": 0.33,
    "flipPct": 8.13,
    "verdict": "discriminating"
  },
  {
    "no": 12,
    "key": "citeria12",
    "short": "อินเทอร์เน็ต",
    "group": "utility",
    "max": 5,
    "meanScore": 2.28,
    "sharePct": 45.53,
    "fullPct": 0.81,
    "zeroPct": 0,
    "itemRestR": 0.45,
    "D": 0.15,
    "flipPct": 4.88,
    "verdict": "weak"
  },
  {
    "no": 13,
    "key": "citeria13",
    "short": "โทรศัพท์",
    "group": "utility",
    "max": 5,
    "meanScore": 2.59,
    "sharePct": 51.71,
    "fullPct": 0.81,
    "zeroPct": 0,
    "itemRestR": 0.33,
    "D": 0.12,
    "flipPct": 4.07,
    "verdict": "weak"
  },
  {
    "no": 14,
    "key": "citeria14",
    "short": "ประกาศคลัง",
    "group": "admin",
    "max": 2,
    "meanScore": 0.83,
    "sharePct": 41.46,
    "fullPct": 41.46,
    "zeroPct": 58.54,
    "itemRestR": 0.65,
    "D": 0.88,
    "flipPct": 4.07,
    "verdict": "discriminating"
  },
  {
    "no": 15,
    "key": "citeria15",
    "short": "นักเรียนยากจน",
    "group": "learner",
    "max": 2,
    "meanScore": 1,
    "sharePct": 49.8,
    "fullPct": 22.76,
    "zeroPct": 5.69,
    "itemRestR": 0.29,
    "D": 0.3,
    "flipPct": 2.44,
    "verdict": "discriminating"
  }
] as const;

/** กลุ่มข้อมูลพื้นฐาน — คะแนนเต็มที่จัดสรรไว้ vs คะแนนที่ถูกใช้จริง */
export const LEGACY_GROUP_BASELINE = [
  {
    "key": "geo",
    "label": "ภูมิศาสตร์ (วัดอัตโนมัติ)",
    "source": "Google Maps Elevation/Directions API — ระบบคำนวณให้ ไม่ต้องกรอก",
    "verifiable": "auto",
    "items": [
      1,
      5
    ],
    "maxScore": 35,
    "meanScore": 34.1,
    "utilisationPct": 97.43
  },
  {
    "key": "admin",
    "label": "เขตปกครองและสถานะทางการ",
    "source": "ทะเบียนราชการ (อปท./ชายแดน/ประกาศกระทรวงการคลัง) — ตรวจสอบย้อนได้",
    "verifiable": "registry",
    "items": [
      2,
      3,
      16
    ],
    "maxScore": 15,
    "meanScore": 9.42,
    "utilisationPct": 62.8
  },
  {
    "key": "access",
    "label": "การเข้าถึงและคมนาคม",
    "source": "โรงเรียนกรอก + เขตรับรอง (ยังไม่มีชั้นข้อมูลกลาง)",
    "verifiable": "declared",
    "items": [
      4,
      6
    ],
    "maxScore": 10,
    "meanScore": 5.21,
    "utilisationPct": 52.1
  },
  {
    "key": "utility",
    "label": "สาธารณูปโภคพื้นฐาน",
    "source": "โรงเรียนกรอก (น้ำ/ไฟ/โทรศัพท์/อินเทอร์เน็ต)",
    "verifiable": "declared",
    "items": [
      7,
      8,
      9,
      10
    ],
    "maxScore": 15,
    "meanScore": 6.44,
    "utilisationPct": 42.93
  },
  {
    "key": "learner",
    "label": "ลักษณะผู้เรียน",
    "source": "DMC/ทะเบียนนักเรียน + ระบบ ปัจจัยพื้นฐานนักเรียนยากจน (กสศ.)",
    "verifiable": "registry",
    "items": [
      11,
      12,
      13,
      14
    ],
    "maxScore": 20,
    "meanScore": 10.3,
    "utilisationPct": 51.5
  },
  {
    "key": "structure",
    "label": "โครงสร้างสถานศึกษา",
    "source": "ทะเบียนโรงเรียน (สาขา/ห้องเรียนสาขา)",
    "verifiable": "registry",
    "items": [
      15
    ],
    "maxScore": 5,
    "meanScore": 0.29,
    "utilisationPct": 5.8
  }
] as const;

/** การกระจายคะแนนรวมและจำนวนที่ผ่านแต่ละจุดตัด (พื้นที่สูง) */
export const LEGACY_TOTAL_DISTRIBUTION = {
  "n": 1481,
  "mean": 65.76,
  "sd": 9.07,
  "p10": 55,
  "p25": 59.36,
  "p50": 64.98,
  "p75": 72,
  "p90": 77.63,
  "cuts": [
    {
      "cut": 50,
      "pass": 1470,
      "pct": 99.26
    },
    {
      "cut": 55,
      "pass": 1337,
      "pct": 90.28
    },
    {
      "cut": 60,
      "pass": 1078,
      "pct": 72.79
    },
    {
      "cut": 65,
      "pass": 739,
      "pct": 49.9
    },
    {
      "cut": 68,
      "pass": 576,
      "pct": 38.89
    },
    {
      "cut": 70,
      "pass": 490,
      "pct": 33.09
    },
    {
      "cut": 72,
      "pass": 375,
      "pct": 25.32
    },
    {
      "cut": 75,
      "pass": 233,
      "pct": 15.73
    },
    {
      "cut": 80,
      "pass": 111,
      "pct": 7.49
    }
  ],
  "nearCut": {
    "65-70": 249,
    "70-75": 257,
    "65-75": 506,
    "pctInBand": 34.17
  },
  "histogram": [
    {
      "lo": 0,
      "hi": 5,
      "n": 0
    },
    {
      "lo": 5,
      "hi": 10,
      "n": 0
    },
    {
      "lo": 10,
      "hi": 15,
      "n": 0
    },
    {
      "lo": 15,
      "hi": 20,
      "n": 1
    },
    {
      "lo": 20,
      "hi": 25,
      "n": 0
    },
    {
      "lo": 25,
      "hi": 30,
      "n": 0
    },
    {
      "lo": 30,
      "hi": 35,
      "n": 2
    },
    {
      "lo": 35,
      "hi": 40,
      "n": 3
    },
    {
      "lo": 40,
      "hi": 45,
      "n": 2
    },
    {
      "lo": 45,
      "hi": 50,
      "n": 3
    },
    {
      "lo": 50,
      "hi": 55,
      "n": 133
    },
    {
      "lo": 55,
      "hi": 60,
      "n": 259
    },
    {
      "lo": 60,
      "hi": 65,
      "n": 339
    },
    {
      "lo": 65,
      "hi": 70,
      "n": 249
    },
    {
      "lo": 70,
      "hi": 75,
      "n": 257
    },
    {
      "lo": 75,
      "hi": 80,
      "n": 122
    },
    {
      "lo": 80,
      "hi": 85,
      "n": 72
    },
    {
      "lo": 85,
      "hi": 90,
      "n": 28
    },
    {
      "lo": 90,
      "hi": 95,
      "n": 10
    },
    {
      "lo": 95,
      "hi": 100,
      "n": 1
    }
  ]
} as const;

/** การกระจายความสูงจริง + ผลของสูตรสองแบบ (ดูรายงานหัวข้อ 7) */
export const LEGACY_ELEVATION = {
  "percentiles": {
    "p10": 475,
    "p25": 500,
    "p50": 760,
    "p75": 1074,
    "p90": 1350
  },
  "mean": 827.47,
  "sd": 355.48,
  "below500Pct": 12.42,
  "histogram": [
    {
      "lo": 0,
      "hi": 200,
      "n": 10
    },
    {
      "lo": 200,
      "hi": 400,
      "n": 91
    },
    {
      "lo": 400,
      "hi": 500,
      "n": 83
    },
    {
      "lo": 500,
      "hi": 600,
      "n": 314
    },
    {
      "lo": 600,
      "hi": 700,
      "n": 121
    },
    {
      "lo": 700,
      "hi": 800,
      "n": 198
    },
    {
      "lo": 800,
      "hi": 900,
      "n": 158
    },
    {
      "lo": 900,
      "hi": 1000,
      "n": 82
    },
    {
      "lo": 1000,
      "hi": 1200,
      "n": 182
    },
    {
      "lo": 1200,
      "hi": 1500,
      "n": 180
    },
    {
      "lo": 1500,
      "hi": 2000,
      "n": 62
    }
  ],
  "formulaFitByYear": [
    {
      "year": 2560,
      "n": 0,
      "fitLinear600": 0,
      "fitBase15": 0
    },
    {
      "year": 2565,
      "n": 1623,
      "fitLinear600": 1495,
      "fitBase15": 1113
    },
    {
      "year": 2566,
      "n": 217,
      "fitLinear600": 16,
      "fitBase15": 210
    },
    {
      "year": 2567,
      "n": 52,
      "fitLinear600": 4,
      "fitBase15": 49
    },
    {
      "year": 2569,
      "n": 49,
      "fitLinear600": 3,
      "fitBase15": 49
    }
  ],
  "bunchingAt500": {
    "exactly500": 198,
    "in480to494": 23,
    "in506to520": 21,
    "roundedToHundred": 214,
    "roundedToTen": 340,
    "nonZero": 1472,
    "byYear": [
      {
        "year": 2560,
        "n": 1,
        "exactly500": 0,
        "pct": 0
      },
      {
        "year": 2565,
        "n": 1623,
        "exactly500": 87,
        "pct": 5.36
      },
      {
        "year": 2566,
        "n": 228,
        "exactly500": 121,
        "pct": 53.07
      },
      {
        "year": 2567,
        "n": 61,
        "exactly500": 25,
        "pct": 40.98
      },
      {
        "year": 2569,
        "n": 73,
        "exactly500": 0,
        "pct": 0
      }
    ]
  },
  "underBase15": {
    "n": 1481,
    "mean": 29.46,
    "sd": 2.38,
    "min": 0,
    "p10": 29.25,
    "p25": 30,
    "p50": 30,
    "p75": 30,
    "p90": 30,
    "max": 30,
    "fullPct": 87.58
  },
  "underLinear600": {
    "n": 1481,
    "mean": 27.73,
    "sd": 4.29,
    "min": 0,
    "p10": 23.75,
    "p25": 25,
    "p50": 30,
    "p75": 30,
    "p90": 30,
    "max": 30,
    "fullPct": 66.37
  }
} as const;

/** เปอร์เซ็นไทล์ของค่าดิบรายข้อที่เป็นตัวเลข — ใช้ตั้ง "ระดับ" แบบอิงการกระจายจริง */
export const LEGACY_NUMERIC_PERCENTILES = {
  "1": {
    "short": "ความสูงจุดสูงสุด",
    "unit": "เมตร",
    "percentiles": {
      "10": 475,
      "25": 500,
      "40": 655,
      "50": 760,
      "60": 885,
      "75": 1074,
      "80": 1137,
      "90": 1350,
      "95": 1488
    }
  },
  "4": {
    "short": "ถนนรถ 2 ล้อไปไม่ได้",
    "unit": "กิโลเมตร",
    "percentiles": {
      "10": 0,
      "25": 0,
      "40": 0,
      "50": 0,
      "60": 0,
      "75": 0,
      "80": 0,
      "90": 5,
      "95": 15
    }
  },
  "5": {
    "short": "ระยะทางถึงศาลากลาง",
    "unit": "กิโลเมตร",
    "percentiles": {
      "10": 56,
      "25": 79,
      "40": 94,
      "50": 106,
      "60": 121,
      "75": 146,
      "80": 154,
      "90": 184,
      "95": 202
    }
  },
  "11": {
    "short": "% ชาติพันธุ์",
    "unit": "ร้อยละ",
    "percentiles": {
      "10": 0,
      "25": 30.42,
      "40": 74.91,
      "50": 95.72,
      "60": 100,
      "75": 100,
      "80": 100,
      "90": 100,
      "95": 100
    }
  },
  "12": {
    "short": "จำนวนกลุ่มชาติพันธุ์",
    "unit": "กลุ่ม",
    "percentiles": {
      "10": 0,
      "25": 1,
      "40": 1,
      "50": 1,
      "60": 2,
      "75": 3,
      "80": 3,
      "90": 4,
      "95": 5
    }
  },
  "13": {
    "short": "นักเรียนยากจน",
    "unit": "คน",
    "percentiles": {
      "10": 9,
      "25": 27,
      "40": 48,
      "50": 62,
      "60": 81,
      "75": 122,
      "80": 144,
      "90": 223,
      "95": 308
    }
  },
  "14": {
    "short": "นักเรียนพักนอน",
    "unit": "คน",
    "percentiles": {
      "10": 0,
      "25": 0,
      "40": 0,
      "50": 0,
      "60": 0,
      "75": 10,
      "80": 18,
      "90": 48,
      "95": 79
    }
  },
  "15": {
    "short": "สาขา",
    "unit": "แห่ง",
    "percentiles": {
      "10": 0,
      "25": 0,
      "40": 0,
      "50": 0,
      "60": 0,
      "75": 0,
      "80": 0,
      "90": 0,
      "95": 1
    }
  }
} as const;

/** ผลการจำลองทางเลือกน้ำหนัก (ดูรายงานหัวข้อ 9) */
export const LEGACY_WEIGHT_SIMULATIONS = [
  {
    "label": "S0 — เกณฑ์ปัจจุบัน (ฐาน 15 + เพดาน 500 ม.)",
    "mean": 65.76,
    "sd": 9.07,
    "pass70": 490,
    "passRate": 33.09,
    "changedPassStatus": 0,
    "changedPct": 0,
    "spearmanVsCurrent": 1,
    "cutForSameCount": 70
  },
  {
    "label": "S1 — ข้อ 1 กลับไปใช้สูตรเชิงเส้น 0–600 ม. (แบบรอบ 2565)",
    "mean": 64.03,
    "sd": 10.31,
    "pass70": 459,
    "passRate": 30.99,
    "changedPassStatus": 31,
    "changedPct": 2.09,
    "spearmanVsCurrent": 0.96,
    "cutForSameCount": 69
  },
  {
    "label": "S2 — ข้อ 1 เชิงเส้น 0–1,000 ม. เต็ม 30 (ตัดคะแนนฐาน)",
    "mean": 58.61,
    "sd": 12.88,
    "pass70": 341,
    "passRate": 23.02,
    "changedPassStatus": 149,
    "changedPct": 10.06,
    "spearmanVsCurrent": 0.9,
    "cutForSameCount": 65.14
  },
  {
    "label": "S3 — ลดน้ำหนักข้อ 1 เหลือ 15 แล้วโยกไปข้อที่จำแนกได้ (4/8/10/14/16 ×2)",
    "mean": 54.95,
    "sd": 13.16,
    "pass70": 206,
    "passRate": 13.91,
    "changedPassStatus": 286,
    "changedPct": 19.31,
    "spearmanVsCurrent": 0.98,
    "cutForSameCount": 59.84
  },
  {
    "label": "S4 — ตัดข้อที่แทบไม่จำแนก (1/3/5/6) ออก แล้วปรับสเกลเป็น 100",
    "mean": 40.39,
    "sd": 15.2,
    "pass70": 58,
    "passRate": 3.92,
    "changedPassStatus": 432,
    "changedPct": 29.17,
    "spearmanVsCurrent": 0.96,
    "cutForSameCount": 46.95
  }
] as const;

/**
 * จำแนกรายการประเมินตาม "ชนิดของค่าที่วัด" — กำหนดว่าสถิติแบบใดใช้ได้ ต้อง validate อย่างไร
 * และเทียบข้ามโรงเรียนได้ตรง ๆ หรือไม่ (ดูรายงานหัวข้อ 5)
 */
export const LEGACY_MEASUREMENT = {
  "highland": {
    "split": {
      "quantitativeWeight": 65,
      "quantitativePct": 65,
      "qualitativeWeight": 35,
      "qualitativePct": 35
    },
    "byOrigin": {
      "auto": {
        "weight": 35,
        "pct": 35,
        "label": "ระบบวัดให้อัตโนมัติ (GIS)"
      },
      "derived": {
        "weight": 10,
        "pct": 10,
        "label": "ระบบคำนวณจากข้อมูลอื่น"
      },
      "entered": {
        "weight": 55,
        "pct": 55,
        "label": "ผู้ใช้กรอก"
      }
    },
    "normalization": {
      "countItems": [
        {
          "no": 12,
          "short": "จำนวนกลุ่มชาติพันธุ์",
          "normalized": false
        },
        {
          "no": 13,
          "short": "นักเรียนยากจน",
          "normalized": true
        },
        {
          "no": 14,
          "short": "นักเรียนพักนอน",
          "normalized": false
        },
        {
          "no": 15,
          "short": "สาขา",
          "normalized": false
        }
      ],
      "normalizedWeight": 10,
      "unnormalizedCountWeight": 15
    },
    "taxonomy": [
      {
        "key": "continuous",
        "label": "ค่าวัดต่อเนื่อง",
        "description": "ค่าที่วัดได้เป็นหน่วยจริง เช่น เมตร กิโลเมตร นาที บาท — มีศูนย์แท้ เทียบสัดส่วนได้",
        "validStats": "ค่าเฉลี่ย · มัธยฐาน · SD · เปอร์เซ็นไทล์ · ช่วงควอไทล์",
        "invalidStats": "—",
        "validation": "ต้องไม่ติดลบ · ต้องอยู่ในพิสัยที่เป็นไปได้จริง · ถ้ามาจาก GIS ต้องล็อกไม่ให้แก้ด้วยมือ",
        "items": [
          1,
          4,
          5
        ],
        "weight": 40,
        "weightPct": 40,
        "utilisation": 86.7
      },
      {
        "key": "count",
        "label": "จำนวนนับ",
        "description": "นับเป็นหน่วย เช่น คน กลุ่ม แห่ง — เป็นจำนวนเต็ม และผูกกับขนาดของโรงเรียน",
        "validStats": "ค่าเฉลี่ย · มัธยฐาน · SD · เปอร์เซ็นไทล์ (แต่ควรดูคู่กับร้อยละต่อขนาดโรงเรียนเสมอ)",
        "invalidStats": "การเทียบข้ามโรงเรียนโดยไม่ปรับขนาด",
        "validation": "จำนวนเต็ม ≥ 0 · ต้องไม่เกินจำนวนนักเรียนทั้งหมดเมื่อเป็นการนับตัวนักเรียน",
        "items": [
          12,
          13,
          14,
          15
        ],
        "weight": 20,
        "weightPct": 20,
        "utilisation": 36
      },
      {
        "key": "ordinal",
        "label": "ข้อความเชิงคุณภาพ (เรียงระดับได้)",
        "description": "ตัวเลือกที่มีลำดับความลำบากชัดเจน แต่ระยะห่างระหว่างตัวเลือกไม่เท่ากันและวัดไม่ได้",
        "validStats": "ฐานนิยม · มัธยฐานของระดับ · การแจกแจงความถี่",
        "invalidStats": "**ค่าเฉลี่ยของรหัสตัวเลือก** — ตัวเลข 1–5 เป็นชื่อของระดับ ไม่ใช่ปริมาณ",
        "validation": "ค่าที่รับได้ต้องอยู่ในรายการตัวเลือกเท่านั้น · ต้องมีหลักฐานประกอบเมื่อเลือกระดับที่ให้คะแนนสูง",
        "items": [
          2,
          3,
          6
        ],
        "weight": 15,
        "weightPct": 15,
        "utilisation": 81.87
      },
      {
        "key": "multiset",
        "label": "ข้อความเชิงคุณภาพ (เลือกได้หลายข้อ)",
        "description": "ผลลัพธ์เป็นเซตของตัวเลือก ไม่ใช่ค่าเดียว — สรุปเป็นตัวเลขเดียวได้ต่อเมื่อประกาศกติกาย่อรวมไว้ชัดเจน",
        "validStats": "ความถี่รายตัวเลือก · จำนวนตัวเลือกที่เลือกต่อแห่ง",
        "invalidStats": "ค่าเฉลี่ยของรหัส · การถือว่า id สูงสุดแทนทั้งเซตโดยไม่ประกาศกติกา",
        "validation": "ทุกรหัสต้องอยู่ในรายการ · ต้องระบุกติกาย่อเซตเป็นคะแนนไว้ในเกณฑ์",
        "items": [
          7,
          8,
          9,
          10
        ],
        "weight": 15,
        "weightPct": 15,
        "utilisation": 42.93
      },
      {
        "key": "percent",
        "label": "ร้อยละ / สัดส่วน",
        "description": "จำนวนหนึ่งเทียบกับฐานของโรงเรียนนั้น — ปรับขนาดแล้ว เทียบข้ามโรงเรียนได้โดยตรง",
        "validStats": "ค่าเฉลี่ย · มัธยฐาน · SD · เปอร์เซ็นไทล์",
        "invalidStats": "—",
        "validation": "อยู่ในช่วง 0–100 · ตัวหารต้องไม่เป็นศูนย์",
        "items": [
          11
        ],
        "weight": 5,
        "weightPct": 5,
        "utilisation": 67.8
      },
      {
        "key": "binary",
        "label": "ข้อความเชิงคุณภาพสองค่า",
        "description": "ใช่/ไม่ใช่ · มี/ไม่มี — เป็นสถานะ ไม่ใช่ปริมาณ",
        "validStats": "สัดส่วนที่ตอบว่าใช่",
        "invalidStats": "ค่าเฉลี่ย · SD ของรหัส",
        "validation": "รับได้เฉพาะสองค่า · ถ้าอ้างอิงประกาศราชการต้องตรวจกับทะเบียนได้",
        "items": [
          16
        ],
        "weight": 5,
        "weightPct": 5,
        "utilisation": 35.4
      }
    ],
    "items": [
      {
        "no": 1,
        "short": "ความสูงจุดสูงสุด",
        "max": 30,
        "measure": "continuous",
        "scale": "ratio",
        "unit": "เมตร",
        "origin": "auto",
        "normalized": null,
        "collectedAs": "ความสูง ณ จุดสูงสุดของเส้นทาง (เมตร)",
        "scoredAs": "ด่านผ่าน/ไม่ผ่านที่ 500 ม. + คะแนนต่อเนื่องที่ตันตั้งแต่ 500 ม.",
        "mismatch": "เก็บเป็นค่าต่อเนื่องถึง 1,819 ม. แต่คะแนนตันที่ 500 ม. — ข้อมูลที่วัดมาได้ถูกทิ้งไปเกือบทั้งช่วง"
      },
      {
        "no": 2,
        "short": "ชายแดน",
        "max": 5,
        "measure": "ordinal",
        "scale": "ordinal",
        "unit": null,
        "origin": "entered",
        "normalized": null,
        "collectedAs": "ระดับความใกล้ชายแดน 5 ระดับ (หมู่บ้าน → ไม่ติดชายแดน)",
        "scoredAs": "แปลงระดับเป็นคะแนน 5/4/3/2/0",
        "mismatch": null
      },
      {
        "no": 3,
        "short": "เขต อปท.",
        "max": 5,
        "measure": "ordinal",
        "scale": "ordinal",
        "unit": null,
        "origin": "entered",
        "normalized": null,
        "collectedAs": "ประเภท อปท. 4 ระดับ (อบต. → เทศบาลนคร)",
        "scoredAs": "แปลงระดับเป็นคะแนน 5/4/3/0",
        "mismatch": "ตรวจกับทะเบียน อปท. ได้อยู่แล้ว แต่ระบบให้โรงเรียนเลือกเอง"
      },
      {
        "no": 4,
        "short": "ถนนรถ 2 ล้อไปไม่ได้",
        "max": 5,
        "measure": "continuous",
        "scale": "ratio",
        "unit": "กิโลเมตร",
        "origin": "entered",
        "normalized": null,
        "collectedAs": "คำถามสองชั้น — มี/ไม่มีเส้นทางลำบาก (binary) แล้วจึงกรอกระยะทาง (กม.)",
        "scoredAs": "1 กม. = 1 คะแนน เพดาน 5 กม.",
        "mismatch": null
      },
      {
        "no": 5,
        "short": "ระยะทางถึงศาลากลาง",
        "max": 5,
        "measure": "continuous",
        "scale": "ratio",
        "unit": "กิโลเมตร",
        "origin": "auto",
        "normalized": null,
        "collectedAs": "ระยะทางถนนถึงศาลากลางจังหวัด (กม.)",
        "scoredAs": "สัดส่วนของเพดาน 80 กม.",
        "mismatch": "เพดาน 80 กม. ต่ำกว่ามัธยฐานจริง (106 กม.) — 3 ใน 4 ของโรงเรียนชนเพดาน"
      },
      {
        "no": 6,
        "short": "ขนส่งสาธารณะ",
        "max": 5,
        "measure": "ordinal",
        "scale": "ordinal",
        "unit": null,
        "origin": "entered",
        "normalized": null,
        "collectedAs": "ความถี่รถประจำทาง 5 ระดับ (ไม่มีรถ → เกิน 6 เที่ยว/วัน)",
        "scoredAs": "แปลงระดับเป็นคะแนน 5/4/3/1/1",
        "mismatch": "ระดับ 4 กับ 5 ให้คะแนนเท่ากัน — เหลือระดับที่ใช้จริง 4 ระดับ"
      },
      {
        "no": 7,
        "short": "แหล่งน้ำ",
        "max": 6,
        "measure": "multiset",
        "scale": "ordinal",
        "unit": null,
        "origin": "entered",
        "normalized": null,
        "collectedAs": "เลือกแหล่งน้ำได้หลายแหล่ง จาก 6 ตัวเลือก",
        "scoredAs": "ใช้ id สูงสุดที่เลือก (= แหล่งที่ทันสมัยที่สุด) แปลงเป็นคะแนน",
        "mismatch": "กรอกครบตามจริงแล้วเสียคะแนน เพราะกติกาหยิบตัวเลือกที่ได้คะแนนต่ำสุดมาใช้"
      },
      {
        "no": 8,
        "short": "ไฟฟ้า",
        "max": 3,
        "measure": "multiset",
        "scale": "ordinal",
        "unit": null,
        "origin": "entered",
        "normalized": null,
        "collectedAs": "เลือกระบบไฟฟ้าได้หลายแบบ จาก 2 ตัวเลือก",
        "scoredAs": "ใช้ id สูงสุดที่เลือก",
        "mismatch": "โรงเรียนที่มีทั้งโซลาร์เซลล์และไฟฟ้าส่วนภูมิภาคได้ 0 คะแนน เท่ากับที่มีไฟฟ้าปกติอย่างเดียว"
      },
      {
        "no": 9,
        "short": "โทรศัพท์",
        "max": 3,
        "measure": "multiset",
        "scale": "ordinal",
        "unit": null,
        "origin": "entered",
        "normalized": null,
        "collectedAs": "เลือกระบบโทรศัพท์ได้หลายแบบ จาก 4 ตัวเลือก",
        "scoredAs": "ใช้ id สูงสุดที่เลือก",
        "mismatch": "เช่นเดียวกับข้อ 7"
      },
      {
        "no": 10,
        "short": "อินเทอร์เน็ต",
        "max": 3,
        "measure": "multiset",
        "scale": "ordinal",
        "unit": null,
        "origin": "entered",
        "normalized": null,
        "collectedAs": "เลือกระบบอินเทอร์เน็ตได้หลายแบบ จาก 4 ตัวเลือก",
        "scoredAs": "ใช้ id สูงสุดที่เลือก",
        "mismatch": "เช่นเดียวกับข้อ 7"
      },
      {
        "no": 11,
        "short": "% ชาติพันธุ์",
        "max": 5,
        "measure": "percent",
        "scale": "ratio",
        "unit": "ร้อยละ",
        "origin": "derived",
        "normalized": true,
        "collectedAs": "ระบบคำนวณจากจำนวนนักเรียนแต่ละกลุ่มชาติพันธุ์ หารด้วยนักเรียนทั้งหมด",
        "scoredAs": "สัดส่วนตรงของ 100%",
        "mismatch": null
      },
      {
        "no": 12,
        "short": "จำนวนกลุ่มชาติพันธุ์",
        "max": 5,
        "measure": "count",
        "scale": "ratio",
        "unit": "กลุ่ม",
        "origin": "derived",
        "normalized": false,
        "collectedAs": "ระบบนับจำนวนกลุ่มชาติพันธุ์ที่กรอกไว้",
        "scoredAs": "1 กลุ่ม = 1 คะแนน เพดาน 5 กลุ่ม",
        "mismatch": null
      },
      {
        "no": 13,
        "short": "นักเรียนยากจน",
        "max": 5,
        "measure": "count",
        "scale": "ratio",
        "unit": "คน",
        "origin": "entered",
        "normalized": true,
        "collectedAs": "จำนวนนักเรียนยากจน/ยากจนพิเศษ (คน)",
        "scoredAs": "แปลงเป็น **ร้อยละ** ของนักเรียนทั้งหมด เพดาน 50%",
        "mismatch": "เก็บเป็นจำนวนคน แต่คิดคะแนนเป็นร้อยละ — ต่างจากข้อ 14 ที่เก็บเป็นคนแล้วคิดเป็นคน"
      },
      {
        "no": 14,
        "short": "นักเรียนพักนอน",
        "max": 5,
        "measure": "count",
        "scale": "ratio",
        "unit": "คน",
        "origin": "entered",
        "normalized": false,
        "collectedAs": "จำนวนนักเรียนพักนอน (คน)",
        "scoredAs": "จำนวนคนตรง ๆ เพดาน 50 คน",
        "mismatch": "ไม่ปรับตามขนาดโรงเรียน — โรงเรียน 60 คนที่พักนอนทั้งหมดได้คะแนนเท่ากับโรงเรียน 800 คนที่พักนอน 50 คน"
      },
      {
        "no": 15,
        "short": "สาขา",
        "max": 5,
        "measure": "count",
        "scale": "ratio",
        "unit": "แห่ง",
        "origin": "entered",
        "normalized": false,
        "collectedAs": "จำนวนโรงเรียนสาขา/ห้องเรียนสาขา (แห่ง)",
        "scoredAs": "แปลงเป็นช่วง 1→3, 2→4, ≥3→5 คะแนน",
        "mismatch": "จำนวนนับที่ถูกยุบเป็นช่วงเพียง 3 ช่วง"
      },
      {
        "no": 16,
        "short": "ประกาศคลัง",
        "max": 5,
        "measure": "binary",
        "scale": "nominal",
        "unit": null,
        "origin": "entered",
        "normalized": null,
        "collectedAs": "เป็นพื้นที่พิเศษตามประกาศกระทรวงการคลังหรือไม่ (ใช่/ไม่ใช่)",
        "scoredAs": "ใช่ = 5 คะแนน · ไม่ใช่ = 0",
        "mismatch": "อ้างอิงประกาศราชการที่ตรวจสอบได้ แต่ระบบให้โรงเรียนตอบเอง ไม่ได้เชื่อมทะเบียน"
      }
    ]
  },
  "island": {
    "split": {
      "quantitativeWeight": 22,
      "quantitativePct": 22,
      "qualitativeWeight": 78,
      "qualitativePct": 78
    },
    "byOrigin": {
      "auto": {
        "weight": 0,
        "pct": 0,
        "label": "ระบบวัดให้อัตโนมัติ (GIS)"
      },
      "derived": {
        "weight": 0,
        "pct": 0,
        "label": "ระบบคำนวณจากข้อมูลอื่น"
      },
      "entered": {
        "weight": 100,
        "pct": 100,
        "label": "ผู้ใช้กรอก"
      }
    },
    "taxonomy": [
      {
        "key": "ordinal",
        "label": "ข้อความเชิงคุณภาพ (เรียงระดับได้)",
        "items": [
          2,
          4,
          9,
          11,
          12,
          13
        ],
        "weight": 55,
        "weightPct": 55,
        "utilisation": 60.11
      },
      {
        "key": "binary",
        "label": "ข้อความเชิงคุณภาพสองค่า",
        "items": [
          1,
          3,
          10,
          14
        ],
        "weight": 23,
        "weightPct": 23,
        "utilisation": 76.3
      },
      {
        "key": "continuous",
        "label": "ค่าวัดต่อเนื่อง",
        "items": [
          5,
          6,
          7,
          8
        ],
        "weight": 20,
        "weightPct": 20,
        "utilisation": 69.1
      },
      {
        "key": "count",
        "label": "จำนวนนับ",
        "items": [
          15
        ],
        "weight": 2,
        "weightPct": 2,
        "utilisation": 50
      }
    ],
    "items": [
      {
        "no": 1,
        "short": "เป็นเกาะ",
        "max": 0,
        "measure": "binary",
        "scale": "nominal",
        "unit": null,
        "origin": "entered",
        "mismatch": null
      },
      {
        "no": 2,
        "short": "เขต อปท.",
        "max": 10,
        "measure": "ordinal",
        "scale": "ordinal",
        "unit": null,
        "origin": "entered",
        "mismatch": "ระดับต่ำสุดยังได้ 4 คะแนน — ไม่มีใครได้ 0 จากข้อนี้"
      },
      {
        "no": 3,
        "short": "ลักษณะที่ตั้ง",
        "max": 16,
        "measure": "binary",
        "scale": "nominal",
        "unit": null,
        "origin": "entered",
        "mismatch": "คำถามใช่/ไม่ใช่ข้อเดียวถือน้ำหนัก 16 คะแนน"
      },
      {
        "no": 4,
        "short": "พาหนะหลัก",
        "max": 20,
        "measure": "ordinal",
        "scale": "ordinal",
        "unit": null,
        "origin": "entered",
        "mismatch": "ข้อเชิงคุณภาพข้อเดียวถือน้ำหนักสูงสุดของเกณฑ์ (20 คะแนน)"
      },
      {
        "no": 5,
        "short": "ระยะทางบก",
        "max": 5,
        "measure": "continuous",
        "scale": "ratio",
        "unit": "กิโลเมตร",
        "origin": "entered",
        "mismatch": null
      },
      {
        "no": 6,
        "short": "ระยะทางน้ำ",
        "max": 5,
        "measure": "continuous",
        "scale": "ratio",
        "unit": "กิโลเมตร",
        "origin": "entered",
        "mismatch": null
      },
      {
        "no": 7,
        "short": "เวลาเดินทาง",
        "max": 5,
        "measure": "continuous",
        "scale": "ratio",
        "unit": "นาที",
        "origin": "entered",
        "mismatch": null
      },
      {
        "no": 8,
        "short": "ค่าโดยสาร",
        "max": 5,
        "measure": "continuous",
        "scale": "ratio",
        "unit": "บาท",
        "origin": "entered",
        "mismatch": "ค่าเงินไม่ได้ปรับตามปี — เทียบข้ามรอบประเมินโดยตรงไม่ได้"
      },
      {
        "no": 9,
        "short": "เดินทางต่อ",
        "max": 5,
        "measure": "ordinal",
        "scale": "ordinal",
        "unit": null,
        "origin": "entered",
        "mismatch": "ระดับต่ำสุดยังได้ 1 คะแนน"
      },
      {
        "no": 10,
        "short": "ไฟฟ้า",
        "max": 5,
        "measure": "binary",
        "scale": "nominal",
        "unit": null,
        "origin": "entered",
        "mismatch": null
      },
      {
        "no": 11,
        "short": "แหล่งน้ำ",
        "max": 10,
        "measure": "ordinal",
        "scale": "ordinal",
        "unit": null,
        "origin": "entered",
        "mismatch": "คำถามเดียวกับข้อ 7 ของพื้นที่สูง แต่คนละรูปแบบการตอบ — เทียบสองพื้นที่ตรง ๆ ไม่ได้"
      },
      {
        "no": 12,
        "short": "อินเทอร์เน็ต",
        "max": 5,
        "measure": "ordinal",
        "scale": "ordinal",
        "unit": null,
        "origin": "entered",
        "mismatch": "ระดับต่ำสุดยังได้ 2 คะแนน"
      },
      {
        "no": 13,
        "short": "โทรศัพท์",
        "max": 5,
        "measure": "ordinal",
        "scale": "ordinal",
        "unit": null,
        "origin": "entered",
        "mismatch": "ระดับต่ำสุดยังได้ 2 คะแนน"
      },
      {
        "no": 14,
        "short": "ประกาศคลัง",
        "max": 2,
        "measure": "binary",
        "scale": "nominal",
        "unit": null,
        "origin": "entered",
        "mismatch": null
      },
      {
        "no": 15,
        "short": "นักเรียนยากจน",
        "max": 2,
        "measure": "count",
        "scale": "ratio",
        "unit": "คน",
        "origin": "entered",
        "mismatch": null
      }
    ]
  }
} as const;

/** คุณภาพข้อมูลที่โค้ดเกณฑ์ใหม่ต้อง validate (สัดส่วนที่พบในข้อมูลเดิม) */
export const LEGACY_DATA_QUALITY = {
  "n": 1481,
  "stuSumZero": {
    "n": 1,
    "pct": 0.07
  },
  "elevZero": {
    "n": 9,
    "pct": 0.61
  },
  "elevBelowAvg": {
    "n": 59,
    "pct": 3.98
  },
  "noLatLng": {
    "n": 3,
    "pct": 0.2
  },
  "distanceZero": {
    "n": 9,
    "pct": 0.61
  },
  "waterBlank": {
    "n": 1,
    "pct": 0.07
  },
  "powerBlank": {
    "n": 1,
    "pct": 0.07
  },
  "phoneBlank": {
    "n": 1,
    "pct": 0.07
  },
  "netBlank": {
    "n": 1,
    "pct": 0.07
  },
  "poorGtStudents": {
    "n": 19,
    "pct": 1.28
  },
  "boardingGtStudents": {
    "n": 0,
    "pct": 0
  },
  "ethnicGtStudents": {
    "n": 0,
    "pct": 0
  },
  "noRefdocWhenPositive": {
    "n": 427,
    "pct": 28.83
  }
} as const;

/**
 * ค่าที่กรอกอยู่ในเปอร์เซ็นไทล์ใดของประชากรจริง — ใช้แปลงค่าดิบเป็น "ระดับ" โดยอิงการกระจายจริง
 * คืนค่า 0–100 (โดยประมาณจากตารางเปอร์เซ็นไทล์ที่ส่งออกไว้)
 */
export function legacyPercentileOf(itemNo: number, value: number): number | null {
  const entry = (LEGACY_NUMERIC_PERCENTILES as Record<string, { percentiles: Record<string, number> }>)[String(itemNo)];
  if (!entry) return null;
  const points = Object.entries(entry.percentiles)
    .map(([p, v]) => ({ p: Number(p), v }))
    .sort((a, b) => a.p - b.p);
  if (value <= points[0].v) return points[0].p;
  for (let i = 1; i < points.length; i++) {
    if (value <= points[i].v) {
      const lo = points[i - 1];
      const hi = points[i];
      const t = hi.v === lo.v ? 0 : (value - lo.v) / (hi.v - lo.v);
      return Math.round(lo.p + (hi.p - lo.p) * t);
    }
  }
  return points[points.length - 1].p;
}

/** จุดตัดที่ทำให้จำนวนโรงเรียนผ่านเท่ากับจำนวนเป้าหมาย (อิงการกระจายคะแนนรวมเดิม) */
export function legacyCutForCount(target: number): number | null {
  const cuts = LEGACY_TOTAL_DISTRIBUTION.cuts;
  let best: { cut: number; diff: number } | null = null;
  for (const c of cuts) {
    const diff = Math.abs(c.pass - target);
    if (!best || diff < best.diff) best = { cut: c.cut, diff };
  }
  return best ? best.cut : null;
}
