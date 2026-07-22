# คู่มือ Deploy ระบบประเมิน พ.ส.ศ. (newssra)

สแต็ก: Next.js (TypeScript) + MySQL • รันด้วย Docker Compose บน Ubuntu server
ตำแหน่งติดตั้งบนเซิร์ฟเวอร์: `/DATA/AppData/www/newssra`

---

## 1. พัฒนาในเครื่อง (Windows + Laragon)

```bash
npm install          # ครั้งแรกครั้งเดียว
npm run dev          # เปิด http://localhost:3000
```

- ค่าเชื่อมต่อฐานข้อมูลอยู่ใน `.env.local` (root / รหัสผ่านว่าง / database `newssra`)
- แอปสร้าง database และตารางให้อัตโนมัติเมื่อเชื่อมต่อครั้งแรก
  (หรือสั่งเอง: `npm run db:init` / import `db/schema.sql` ผ่าน phpMyAdmin ที่ http://localhost/phpmyadmin)
- ต้องเปิด MySQL ใน Laragon ไว้ก่อนใช้งาน

## 2. เตรียมไฟล์บนเซิร์ฟเวอร์

คัดลอกโปรเจกต์ทั้งโฟลเดอร์ (ยกเว้น `node_modules/`, `.next/`, `data/`, `uploads/`) ไปไว้ที่ `/DATA/AppData/www/newssra` เช่น

```bash
# ตัวอย่างด้วย rsync จากเครื่องพัฒนา
rsync -av --exclude node_modules --exclude .next --exclude data --exclude uploads ./ user@SERVER:/DATA/AppData/www/newssra/
```

หรือ `git clone` ลงที่ path นั้นโดยตรงก็ได้

## 3. ตั้งค่า .env.production (ทำเองครั้งเดียว)

```bash
cd /DATA/AppData/www/newssra
cp .env.production.example .env.production
nano .env.production        # กรอก DB_USER / DB_PASSWORD / MYSQL_* เอง
```

ค่าที่ต้องกรอก:

| ตัวแปร | ความหมาย |
|---|---|
| `DB_HOST` | `db` เมื่อใช้ MySQL container ในชุดนี้ / `host.docker.internal` เมื่อใช้ MySQL ของเครื่อง host |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | บัญชีที่แอปใช้เชื่อมต่อ (database ชื่อ `newssra` เหมือน localhost) |
| `MYSQL_DATABASE` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_ROOT_PASSWORD` | ใช้ตอน MySQL container สร้างตัวเองครั้งแรก — ให้ตรงกับ `DB_*` ด้านบน |
| `AUTH_SECRET` | **บังคับ** — กุญแจลับเซ็น session cookie (ยาว ≥ 16 ตัว) สร้างด้วย `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `SEED_ADMIN_PASSWORD` / `SEED_SSRA_PASSWORD` / `SEED_SCHOOL_PASSWORD` | รหัสผ่านเริ่มต้นของบัญชีตั้งต้น 3 บทบาท — เปลี่ยนทันทีหลังติดตั้ง |

### ระบบผู้ใช้และสิทธิ์ (3 บทบาท + เข้าสู่ระบบแบบผสม)

การเข้าสู่ระบบตรวจ 2 แหล่งตามลำดับ:
1. **ตาราง `users` (บัญชีใหม่)** — สำหรับผู้ดูแล เข้ารหัสผ่านด้วย scrypt สร้างบัญชีตั้งต้นอัตโนมัติเมื่อเชื่อมต่อ DB ครั้งแรก (idempotent)
2. **ตาราง `user` เดิม (บัญชีโรงเรียน)** — ~3,158 โรงเรียนของระบบ SSRA เดิม เข้าสู่ระบบด้วยรหัสผู้ใช้ 8 หลัก + รหัสผ่านเดิม (แอปนี้อ่านอย่างเดียว ไม่แก้ไขตารางนี้)

| บัญชี | บทบาท | สิทธิ์ |
|---|---|---|
| `admin` (ตาราง users) | ผู้ดูแลระบบ | เห็น/แก้ไขทุกโรงเรียน + แดชบอร์ด + **จัดการผู้ใช้** (`/admin/users`) |
| `ssra_admin` (ตาราง users) | เจ้าหน้าที่ สพฐ. | เห็น/แก้ไขทุกโรงเรียน + แดชบอร์ด |
| รหัส 8 หลัก (ตาราง `user`) | โรงเรียน | เห็น/แก้ไขเฉพาะแบบประเมินของโรงเรียนตน (ผูกด้วยรหัสโรงเรียน `owner_school_code`) |

- **เปลี่ยนรหัสผ่าน/เพิ่มบัญชีผู้ดูแล:** login ด้วย `admin` แล้วไปที่เมนู "จัดการผู้ใช้" (หน้านี้จัดการเฉพาะบัญชีในตาราง `users` — บัญชีโรงเรียนเดิมจัดการที่ระบบเดิม)
- session เก็บเป็น cookie ที่เซ็นด้วย HMAC (อายุ 7 วัน) — การระงับบัญชีจะมีผลเมื่อ login ครั้งถัดไป
- **ความปลอดภัยที่ควรทราบ:** รหัสผ่านในตาราง `user` เดิมเป็น **plaintext** (ตามระบบเดิม) แอปเทียบตรง ๆ ตอน login — ควรวางแผน migrate เป็นแฮชในอนาคต; และยังไม่มี rate-limit การกรอกรหัสผิด ถ้าเปิดสู่อินเทอร์เน็ตควรมี reverse proxy/WAF เสริม

## 4. รัน

```bash
cd /DATA/AppData/www/newssra
docker compose up -d --build
```

- เปิดใช้งานที่ `http://<SERVER-IP>:9950`
- **ค่าเริ่มต้นของ `docker-compose.yml` รันเฉพาะ service `app`** (service `db` ถูกคอมเมนต์ไว้) และเชื่อม MySQL ของเครื่อง host ผ่าน `host.docker.internal` — ในโหมดนี้ **ข้อมูล MySQL อยู่ในเครื่อง host ไม่ได้อยู่ใน `data/mysql`** การสำรองจึงทำที่ host โดยตรง (ดูข้อ 8)
- ถ้าเปิด service `db` (ยกเลิกคอมเมนต์) ข้อมูล MySQL จะถูกเก็บถาวรที่ `/DATA/AppData/www/newssra/data/mysql` (bind mount)
- ไฟล์หลักฐานที่อัปโหลด (ภาพ/PDF) ถูกเก็บถาวรที่ `/DATA/AppData/www/newssra/data/uploads` (bind mount) เสมอ ไม่ว่าจะใช้ topology ใด
- ตารางถูกสร้างอัตโนมัติเมื่อแอปเชื่อมต่อครั้งแรก

## 5. อัปเดตเวอร์ชัน

**ก่อนสลับเวอร์ชัน ให้รัน migration ตรวจข้อมูลก่อนเสมอ** (ระบบเก่ายังให้บริการอยู่ระหว่างนี้):

```bash
cd /DATA/AppData/www/newssra
npm run db:init
```

ตั้งแต่เวอร์ชันที่รองรับ "บันทึกจากแผนที่" เป็นต้นไป ฐานข้อมูลบังคับกติกา **1 โรงเรียน = 1 แบบประเมินต่อปี** ด้วย `UNIQUE KEY uq_owner_school_year (owner_school_code, assessment_year)` และ migration นี้เป็นแบบ **fail-closed**: ถ้าข้อมูลเดิมมีแบบประเมินซ้ำโรงเรียน+ปี มันจะ **หยุดพร้อมพิมพ์รายการ `โรงเรียน / ปี / id`** ออกมาโดยไม่ลบหรือรวมแถวให้เอง (ข้อมูลของจริงต้องให้คนตัดสินใจ) — ต้องแก้ข้อมูลซ้ำด้วยมือก่อน แล้วรันซ้ำจนผ่าน

ถ้าข้ามขั้นนี้แล้ว deploy ไปเลย แอปเวอร์ชันใหม่จะ throw ทุก request (รวมหน้า admin) จนกว่าจะแก้ข้อมูลซ้ำเสร็จ — คือระบบล่มทั้งระบบ ไม่ใช่แค่ฟีเจอร์เดียวเสีย

จากนั้นจึงอัปเดตตามปกติ:

```bash
cd /DATA/AppData/www/newssra
git pull                      # หรือ rsync ไฟล์ใหม่ทับ
docker compose up -d --build
```

## 6. กรณีใช้ MySQL ที่มีอยู่แล้วบนเครื่อง host (ไม่ใช้ container db)

1. คอมเมนต์ service `db` และบล็อก `depends_on` ของ `app` ใน `docker-compose.yml`
2. ใน `.env.production` ตั้ง `DB_HOST=host.docker.internal` และกรอกบัญชี MySQL ของเซิร์ฟเวอร์
3. สร้าง database ก่อนถ้าบัญชีไม่มีสิทธิ์ CREATE: import `db/schema.sql` หรือรัน

   ```sql
   CREATE DATABASE newssra CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

## 7. คำสั่งดูแลระบบที่ใช้บ่อย

```bash
docker compose logs -f app    # ดู log แอป
docker compose logs -f db     # ดู log MySQL (เฉพาะเมื่อเปิด service db)
docker compose restart app    # รีสตาร์ตแอป
docker compose down           # หยุดทั้งชุด (ข้อมูลใน data/ ไม่หาย)
```

## 8. สำรองและกู้คืนข้อมูล (Backup & Restore)

ต้องสำรอง **2 ส่วนคู่กันเสมอ** — ฐานข้อมูล (แบบประเมิน/ผู้ใช้/คะแนน) และไฟล์หลักฐานที่อัปโหลด
(ตามข้อกำหนดในเอกสารเกณฑ์ หลักฐานต้องเก็บอย่างน้อย 10 ปี — วางรอบสำรองและเก็บสำเนานอกเครื่องให้สอดคล้อง)

คำสั่ง `mysqldump`/`mysql` ต่างกันตาม topology ที่ใช้ (ดูข้อ 4):

**ก) ใช้ MySQL ของเครื่อง host (ค่าเริ่มต้น — service `db` ถูกคอมเมนต์):**

```bash
cd /DATA/AppData/www/newssra
set -a; . ./.env.production; set +a          # โหลดค่า DB_USER / DB_PASSWORD / DB_NAME

# 8.1 สำรองฐานข้อมูล (รันบน host ที่ติดตั้ง mysql-client)
mysqldump -h 127.0.0.1 -u "$DB_USER" -p"$DB_PASSWORD" \
  --single-transaction --routines --triggers "$DB_NAME" > "db-$(date +%F).sql"
```

**ข) ใช้ MySQL container (เปิด service `db` แล้ว — ชื่อ container ดูจาก `docker compose ps`):**

```bash
cd /DATA/AppData/www/newssra
DB_CONTAINER=$(docker compose ps -q db)      # อย่า hard-code ชื่อ container
docker exec "$DB_CONTAINER" sh -c \
  'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers "$MYSQL_DATABASE"' \
  > "db-$(date +%F).sql"
```

**8.2 สำรองไฟล์หลักฐาน (เหมือนกันทุก topology):**

```bash
cd /DATA/AppData/www/newssra
tar czf "uploads-$(date +%F).tar.gz" -C data uploads
```

**8.3 กู้คืน (Restore):**

```bash
cd /DATA/AppData/www/newssra
# ฐานข้อมูล — host MySQL:
mysql -h 127.0.0.1 -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < db-2026-07-14.sql
#           — container MySQL:
#   DB_CONTAINER=$(docker compose ps -q db)
#   docker exec -i "$DB_CONTAINER" sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < db-2026-07-14.sql

# ไฟล์หลักฐาน — คลายทับโฟลเดอร์ data/ (uploads/ จะถูกเขียนกลับที่เดิม)
tar xzf uploads-2026-07-14.tar.gz -C data
docker compose restart app
```

> แนะนำให้ทำ 8.1–8.2 เป็น cron รายวันแล้ว `rsync`/อัปโหลดไฟล์สำรองไปเก็บนอกเครื่อง (offsite) พร้อมหมุนเวียนลบของเก่าตามนโยบายเก็บรักษา; ทดสอบขั้นตอน 8.3 กับข้อมูลจริงเป็นระยะเพื่อยืนยันว่าไฟล์สำรองกู้คืนได้จริง

## ข้อควรทราบ

- ระบบมีการยืนยันตัวตนแบบ 3 บทบาท (ดูหัวข้อ "ระบบผู้ใช้และสิทธิ์" ในข้อ 3) — **ต้องตั้ง `AUTH_SECRET` และเปลี่ยนรหัสผ่านบัญชีตั้งต้นทันที** ก่อนเปิดใช้จริง
- แผนที่ 3 มิติ (`/map`, หน้าแรกหลัง login) ทำงานแบบ keyless — ไม่ต้องตั้งค่าเพิ่ม ไฟล์ static ของ Cesium ถูกคัดลอกเข้า `public/cesium` อัตโนมัติตอน `npm run build` (ผ่าน `scripts/copy-cesium.mjs`) และรวมอยู่ใน Docker image แล้ว (ใส่ `NEXT_PUBLIC_CESIUM_ION_TOKEN` เพิ่มได้ถ้าต้องการ terrain/ภาพคุณภาพสูง)
- พอร์ต 9950 เปลี่ยนได้ที่ `ports` ใน `docker-compose.yml` เช่น `"8080:3000"` (หรือกำหนด `APP_PORT` ตอนรัน)
- **Health check:** `GET /api/health` เป็น liveness (ตอบเร็ว ไม่แตะ DB) — ใช้โดย healthcheck ของ compose; เพิ่ม `?deep=1` (`GET /api/health?deep=1`) เพื่อ readiness ที่ ping ฐานข้อมูลด้วย (ตอบ 503 ถ้า DB ล่ม) เหมาะสำหรับ monitor ภายนอกที่ต้องการรู้ว่า DB ใช้งานได้จริง
