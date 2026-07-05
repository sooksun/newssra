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

## 4. รัน

```bash
cd /DATA/AppData/www/newssra
docker compose up -d --build
```

- เปิดใช้งานที่ `http://<SERVER-IP>:9950`
- ข้อมูล MySQL ถูกเก็บถาวรที่ `/DATA/AppData/www/newssra/data/mysql` (bind mount)
- ไฟล์หลักฐานที่อัปโหลด (ภาพ/PDF) ถูกเก็บถาวรที่ `/DATA/AppData/www/newssra/data/uploads` (bind mount)
- ตารางถูกสร้างอัตโนมัติเมื่อแอปเชื่อมต่อครั้งแรก

## 5. อัปเดตเวอร์ชัน

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
docker compose logs -f db     # ดู log MySQL
docker compose restart app    # รีสตาร์ตแอป
docker compose down           # หยุดทั้งชุด (ข้อมูลใน data/ ไม่หาย)

# สำรองฐานข้อมูล
docker exec newssra-db mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" newssra > backup-$(date +%F).sql
```

## ข้อควรทราบ

- ระบบยังไม่มีการยืนยันตัวตน (ตามขอบเขต prototype) — ถ้าเปิดออกอินเทอร์เน็ตควรวางไว้หลัง reverse proxy ที่มี auth หรือจำกัดวงด้วย firewall/VPN ก่อน
- พอร์ต 9950 เปลี่ยนได้ที่ `ports` ใน `docker-compose.yml` เช่น `"8080:3000"` (หรือกำหนด `APP_PORT` ตอนรัน)
