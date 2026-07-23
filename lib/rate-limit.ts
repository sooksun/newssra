// ตัวจำกัดอัตราการเรียก (rate limiter) แบบ in-memory — ไม่มี dependency เพิ่ม
// ใช้ป้องกัน brute-force ที่หน้า login (นับเฉพาะครั้งที่ "ล้มเหลว" แล้วล็อกชั่วคราวเมื่อเกินเพดาน)
//
// ข้อจำกัดที่ทราบ (เหมาะกับ pilot/single-instance):
//   • เก็บสถานะในหน่วยความจำของ process เดียว → ถ้า scale หลาย instance/รีสตาร์ต ตัวนับจะรีเซ็ต
//     ระบบนี้ deploy เป็น container เดียว (ดู docker-compose.yml) จึงเพียงพอ; ถ้าย้ายไป multi-instance
//     ควรเปลี่ยนไปใช้ store ร่วม (เช่น Redis) โดยคงสัญญา check()/fail()/clear() เดิมไว้

export interface RateLimitStatus {
  blocked: boolean;
  /** วินาทีที่ต้องรอจนกว่าจะลองใหม่ได้ (0 เมื่อไม่ถูกบล็อก) */
  retryAfterSec: number;
}

interface Entry {
  fails: number;
  windowStart: number; // เวลาเริ่มหน้าต่างนับปัจจุบัน (ms)
  blockedUntil: number; // 0 = ไม่ถูกบล็อก
}

export interface RateLimiterOptions {
  /** จำนวนครั้งที่ล้มเหลวได้สูงสุดภายในหนึ่งหน้าต่างก่อนโดนล็อก */
  maxFails: number;
  /** ความยาวหน้าต่างนับ (ms) */
  windowMs: number;
  /** ระยะเวลาล็อกเมื่อเกินเพดาน (ms) */
  blockMs: number;
}

const PRUNE_THRESHOLD = 5000; // เริ่มกวาด entry ที่หมดอายุเมื่อ map ใหญ่เกินนี้ (กันหน่วยความจำโต)

export class RateLimiter {
  private readonly map = new Map<string, Entry>();
  constructor(private readonly opts: RateLimiterOptions) {}

  /** ตรวจว่า key นี้ถูกล็อกอยู่หรือไม่ (ไม่นับเป็นความพยายาม) */
  check(key: string, now: number = Date.now()): RateLimitStatus {
    const entry = this.map.get(key);
    if (entry && entry.blockedUntil > now) {
      return { blocked: true, retryAfterSec: Math.ceil((entry.blockedUntil - now) / 1000) };
    }
    return { blocked: false, retryAfterSec: 0 };
  }

  /** บันทึกความพยายามที่ล้มเหลวหนึ่งครั้ง; ล็อกเมื่อครบเพดานในหน้าต่างเดียวกัน */
  fail(key: string, now: number = Date.now()): RateLimitStatus {
    this.maybePrune(now);
    let entry = this.map.get(key);
    if (!entry || now - entry.windowStart > this.opts.windowMs) {
      entry = { fails: 0, windowStart: now, blockedUntil: 0 };
    }
    entry.fails += 1;
    if (entry.fails >= this.opts.maxFails) {
      entry.blockedUntil = now + this.opts.blockMs;
    }
    this.map.set(key, entry);
    return this.check(key, now);
  }

  /** ล้างตัวนับของ key (เรียกเมื่อเข้าสู่ระบบสำเร็จ) */
  clear(key: string): void {
    this.map.delete(key);
  }

  private maybePrune(now: number): void {
    if (this.map.size < PRUNE_THRESHOLD) return;
    for (const [key, entry] of this.map) {
      const stale = entry.blockedUntil <= now && now - entry.windowStart > this.opts.windowMs;
      if (stale) this.map.delete(key);
    }
  }
}

// ตัวจำกัดของหน้า login — แยกเป็นสอง namespace ในตัวเดียว (key "ip:*" และ "user:*")
// เพดานตั้งให้ผู้ใช้ปกติที่พิมพ์รหัสผิดไม่กี่ครั้งไม่โดน แต่การไล่เดารหัสจะถูกหยุด
export const loginRateLimiter = new RateLimiter({
  maxFails: 10,
  windowMs: 15 * 60 * 1000, // 15 นาที
  blockMs: 15 * 60 * 1000, // ล็อก 15 นาที
});

// ตัวจำกัดคำขอ /api/buildings ต่อผู้ใช้ — กันการไล่ pan/zoom หรือสคริปต์ที่กระตุ้นการนำเข้า
// quadkey ใหม่ (สตรีมไฟล์ Microsoft หลายสิบวินาที + insert แถวจำนวนมาก) รัว ๆ
// ใช้ pattern check()+countRequest(): นับทุกคำขอเป็นโควตา (ไม่ใช่เฉพาะที่ล้มเหลว)
export const buildingsRateLimiter = new RateLimiter({
  maxFails: 40, // 40 คำขอ/นาที/ผู้ใช้ (การ pan แผนที่ปกติต่ำกว่านี้มาก)
  windowMs: 60 * 1000,
  blockMs: 60 * 1000,
});

// ตัวจำกัดการเรียกวิเคราะห์ภูมิประเทศด้วย AI ต่อผู้ใช้ — แต่ละครั้งส่ง 9 ภาพเข้า OpenRouter (มีค่าใช้จ่าย)
// เพดานต่ำกว่า buildings มาก เพราะเป็นงานหนัก/มีต้นทุน: จับภาพใหม่แล้ววิเคราะห์เป็นการกระทำตั้งใจ ไม่ควรรัว
export const terrainAnalyzeRateLimiter = new RateLimiter({
  maxFails: 10, // 10 ครั้ง/ชั่วโมง/ผู้ใช้
  windowMs: 60 * 60 * 1000,
  blockMs: 15 * 60 * 1000, // ล็อก 15 นาทีเมื่อเกิน
});

/** ดึง IP ผู้เรียกจาก header ของ reverse proxy — คืน null ถ้าระบุไม่ได้ (จะได้ไม่ล็อกรวมกันทั้งระบบด้วย key เดียว) */
export function clientIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip")?.trim();
  return real || null;
}
