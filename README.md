# QR Tracker — ระบบ redirect + log สำหรับแคมเปญโฆษณา

## สิ่งที่ระบบนี้ทำ
คนสแกน QR → เข้า `your-project.vercel.app/api/qr/creativeA` → ระบบบันทึกว่า
ใครสแกน creative ไหน เมื่อไหร่ → แล้ว redirect ไปหน้าโปรโมชั่นจริงทันที

## ขั้นตอนติดตั้ง (ทำครั้งเดียว)

### 1. สร้างฐานข้อมูลบน Supabase (ฟรี)
1. ไปที่ supabase.com → สมัคร/ล็อกอิน → New Project
2. เข้า SQL Editor แล้วรันคำสั่งนี้เพื่อสร้างตาราง:

```sql
create table scan_logs (
  id bigint generated always as identity primary key,
  creative_id text not null,
  screen_id text,
  scanned_at timestamptz not null
);
```

3. ไปที่ Project Settings > API เก็บค่า 2 อันนี้ไว้:
   - `Project URL` → ใช้เป็น `SUPABASE_URL`
   - `service_role` key (ไม่ใช่ anon key) → ใช้เป็น `SUPABASE_SERVICE_KEY`

### 2. แก้ปลายทางลิงก์ในโค้ด
เปิดไฟล์ `api/qr/[creative].js` แล้วแก้ URL ใน `DESTINATIONS` ให้เป็นหน้าโปรโมชั่นจริงของลูกค้า

### 3. อัปโค้ดขึ้น GitHub
```bash
cd qr-tracker
git init
git add .
git commit -m "init qr tracker"
git remote add origin <URL ของ repo ที่สร้างใน GitHub>
git push -u origin main
```
(สร้าง repo เปล่าใน GitHub ก่อนจากหน้า github.com/new)

### 4. Deploy บน Vercel
1. เข้า vercel.com → New Project → Continue with GitHub → เลือก repo `qr-tracker`
2. ก่อนกด Deploy ให้เปิดส่วน **Environment Variables** แล้วใส่:
   - `SUPABASE_URL` = ค่าที่เก็บไว้จากขั้นตอน 1
   - `SUPABASE_SERVICE_KEY` = ค่าที่เก็บไว้จากขั้นตอน 1
3. กด Deploy รอประมาณ 1 นาที

### 5. ทดสอบ
- เปิด `https://your-project.vercel.app/api/qr/creativeA` ในเบราว์เซอร์
- ควรเด้งไปหน้าโปรโมชั่นทันที
- กลับไปดูใน Supabase > Table Editor > scan_logs ควรมีแถวใหม่ขึ้นมา

### 6. สร้าง QR code จริง
เอา URL แต่ละ creative (เช่น `.../api/qr/creativeA?screen=LOBBY-A-01`) ไปสร้าง QR
ที่เว็บฟรีอย่าง qr-code-generator.com — พารามิเตอร์ `screen` ใส่หรือไม่ใส่ก็ได้
ถ้าอยากรู้ว่าสแกนมาจากจอไหน

## ระบบสมาชิก + สะสมแต้ม (ล็อกอินด้วย LINE)

### 1. สร้างตารางสมาชิกและแต้ม
เปิด `schema-members.sql` ในโปรเจกต์นี้ → คัดลอกทั้งหมด → รันใน Supabase SQL Editor

### 2. สร้าง LINE Login Channel
1. เข้า developers.line.biz → สมัคร/ล็อกอิน
2. สร้าง **Provider** ใหม่ (ถ้ายังไม่มี) → ตั้งชื่ออะไรก็ได้
3. ในนั้นกด **Create a new channel** → เลือก **LINE Login**
4. กรอกข้อมูลพื้นฐาน (ชื่อแอป, หมวดหมู่, คำอธิบาย) → สร้าง
5. เข้าไปในช่อง **Basic settings** จะเห็น **Channel ID** และ **Channel secret** → เก็บไว้
6. ไปที่แท็บ **LINE Login** ในช่องเดียวกัน → ใส่ **Callback URL** เป็น:
   ```
   https://your-project.vercel.app/api/auth/callback
   ```
   (เปลี่ยน `your-project` เป็นโดเมนจริงของคุณ)

### 3. ใส่ Environment Variables เพิ่มใน Vercel
นอกจาก `SUPABASE_URL` กับ `SUPABASE_SERVICE_KEY` เดิม ให้เพิ่มอีก 3 ตัว:
- `LINE_CHANNEL_ID` = Channel ID จากขั้นตอน 2
- `LINE_CHANNEL_SECRET` = Channel secret จากขั้นตอน 2
- `LINE_CALLBACK_URL` = URL เดียวกับที่ใส่ใน LINE Console ขั้นตอน 2.6

ใส่เสร็จแล้ว Redeploy

### 4. ทดสอบ
เปิดลิงก์ QR เดิม (เช่น `/api/qr/brandA-video`) → ควรเด้งไปหน้า LINE ให้กดยินยอมล็อกอิน →
กดยินยอม → ควรเด้งกลับไปหน้าโปรโมชั่นจริง

เช็คใน Supabase Table Editor:
- ตาราง **members** — ควรมีแถวใหม่ (หรือสมาชิกเดิมถ้าเคยสแกนมาก่อน)
- ตาราง **points_ledger** — ควรมีแถวบันทึกว่าได้แต้มกี่แต้มจาก creative ไหน

### ปรับแต่งได้
- จำนวนแต้มต่อการสแกน 1 ครั้ง แก้ที่ตัวแปร `POINTS_PER_SCAN` ในไฟล์ `api/auth/callback.js`
- อยากให้แต้มไม่เท่ากันในแต่ละ creative (เช่น สแกนจากจอ VIP ได้แต้มเยอะกว่า) แจ้งได้ ปรับโค้ดเพิ่มได้

## ดึงข้อมูลไปทำรายงาน
เข้า Supabase > SQL Editor แล้วรัน query ตามที่ต้องการ เช่น สรุปยอดสแกนรายวันแยกตาม creative:

```sql
select
  creative_id,
  date(scanned_at) as scan_date,
  count(*) as scans
from scan_logs
group by creative_id, scan_date
order by scan_date;
```

Export ผลลัพธ์เป็น CSV แล้วส่งมาให้ผมช่วยทำเป็นรายงานได้เลย
