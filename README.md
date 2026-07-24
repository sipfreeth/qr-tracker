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

## Admin Dashboard

### 1. ตั้งรหัสผ่านสำหรับเข้า Dashboard
เพิ่ม Environment Variable ใหม่ใน Vercel:
- `ADMIN_PASSWORD` = ตั้งรหัสผ่านอะไรก็ได้ (ยิ่งยากยิ่งดี เพราะหน้านี้เห็นข้อมูลสมาชิกทั้งหมด)

### 2. เข้าใช้งาน
เปิด:
```
https://your-project.vercel.app/api/admin/dashboard
```
เบราว์เซอร์จะเด้ง popup ให้กรอก username (ใส่อะไรก็ได้) และ password (ใส่ค่า `ADMIN_PASSWORD` ที่ตั้งไว้)

### สิ่งที่เห็นในหน้านี้
- ยอดสแกนทั้งหมด / วันนี้
- จำนวนสมาชิกแยกตาม Tier
- ยอดสแกนแยกตาม Creative (ดูว่าตัวไหนปังสุด)
- ประวัติการแลกของรางวัล พร้อมปุ่ม **"ยืนยันใช้แล้ว"** กดเปลี่ยนสถานะจาก pending เป็น used ได้ในหน้าเดียว (แทนที่จะต้องเข้า Supabase มือ)

## อัปเกรด: แยก Tier Score กับ Point (ทำครั้งเดียว ถ้าเคยติดตั้งระบบแต้มเดิมไปแล้ว)

ระบบใหม่แยก 2 อย่างออกจากกันชัดเจน:
- **Tier Score** — ได้จาก engagement (1 ครั้ง = 1 คะแนน) ใช้ตัดสิน Tier เท่านั้น ไม่มีวันถูกใช้หมด
  Tier ของปีนี้ทั้งปีถูกล็อกจากยอด Tier Score ของปีที่แล้วทั้งปี (สมาชิกใหม่ปีนี้ใช้ยอดสะสมปัจจุบันไปพลางก่อน)
- **Point** — ได้จาก engagement เดียวกัน (1 ครั้ง = 5 แต้ม ปรับได้ที่ `REWARD_POINTS_PER_ENGAGEMENT` ในไฟล์ `api/auth/callback.js`)
  ใช้แลก Reward เท่านั้น หมดอายุทุกสิ้นปีถ้าไม่ใช้
- ทั้งสองอย่างได้จาก 1 Campaign (creative) แค่ครั้งเดียว ห้ามซ้ำ (กติกาเดิมที่มีอยู่แล้ว)

### วิธีอัปเกรด
1. รัน `migration-split-tier-and-points.sql` ใน Supabase SQL Editor
2. แทนที่ไฟล์ `lib/tiers.js`, `api/auth/callback.js`, `api/admin/dashboard.js` ด้วยเวอร์ชันใหม่
3. Redeploy

### ปรับ Tier ได้ที่ `lib/tiers.js`
```js
export const TIERS = [
  { name: 'Explorer', min: 0, color: '#9ca3af' },
  { name: 'Insider', min: 100, color: '#2a78d6' },
  { name: 'Ambassador', min: 200, color: '#d4a017' },
  { name: 'Legend', min: 400, color: '#8b5cf6' },
];
```

## Admin Panel รวม (Dashboard / Members / Rewards / Campaigns) + Login

ตั้งแต่เวอร์ชันนี้ Admin Panel รวมทุกฟังก์ชันไว้หน้าเดียว สลับด้วยแท็บเมนู และมีระบบ Login/Logout จริง
รองรับแอดมิน/เจ้าหน้าที่หลายคน (แยกบัญชีกัน) แทนที่ระบบรหัสผ่านเดียว (Basic Auth) แบบเดิม

### 1. รัน Migration สร้างตาราง admin_users
รัน `migration-admin-login.sql` ใน Supabase SQL Editor — **แก้รหัสผ่านใน SQL ก่อนรัน** อย่าใช้ค่าตัวอย่าง

### 2. เพิ่ม Environment Variable ใหม่ใน Vercel
- `ADMIN_SECRET` = ตั้งข้อความสุ่มยาวๆ อะไรก็ได้ (ใช้เซ็นรับรอง session ไม่ใช่รหัสผ่านที่ต้องจำ) เช่น `openssl rand -hex 32` หรือพิมพ์มั่วๆ ยาวๆ ก็ได้
- (ลบ `ADMIN_PASSWORD` เดิมทิ้งได้ ไม่ใช้แล้ว ระบบเปลี่ยนไปใช้ตาราง `admin_users` แทน)

### 3. เข้าใช้งาน
```
https://your-project.vercel.app/api/admin/login
```
ล็อกอินด้วย username/password ที่ตั้งไว้ตอนรัน SQL ในขั้นที่ 1

### หน้าเมนูที่มี
- **Dashboard** — สรุปยอดสแกน, รอยืนยัน Redemption พร้อมปุ่มกดยืนยัน
- **Members** — รายชื่อสมาชิกทั้งหมด กดฟิลเตอร์ดูตาม Tier ได้
- **Rewards** — เพิ่ม/แก้ชื่อและ Point ที่ต้องใช้/เปิดปิดของรางวัล ได้จากหน้าเว็บเลย (ไม่ต้องเข้า Supabase อีกแล้ว)
- **Campaigns** — เพิ่ม/แก้ URL ปลายทางของแต่ละ Campaign (creative) ได้จากหน้าเว็บเลย

### เพิ่มเจ้าหน้าที่คนใหม่
รัน SQL นี้ใน Supabase (เปลี่ยน username/รหัสผ่านตามจริง):
```sql
insert into admin_users (username, password_hash)
values ('ชื่อเจ้าหน้าที่', crypt('รหัสผ่านของเจ้าหน้าที่คนนี้', gen_salt('bf')));
```

## อัปเดตใหญ่: Role, CRUD เต็มรูปแบบ, ประวัติสมาชิก, Dashboard + กราฟ + Filter

### 1. รัน Migration
รัน `migration-roles-and-crud.sql` ใน Supabase SQL Editor — **แก้ `username = 'admin'` ในบรรทัด update ให้ตรงกับบัญชีของคุณก่อนรัน**

### 2. Role ที่มี
| Role | ทำได้ |
|---|---|
| **super_admin** | ทุกอย่าง รวมถึงจัดการบัญชีแอดมิน (แท็บ Admins) |
| **admin** | เหมือน super_admin ทุกอย่าง **ยกเว้น** จัดการบัญชีแอดมิน (สร้าง/แก้/ลบ/เปลี่ยน role คนอื่นไม่ได้) |
| **staff** | สร้าง Campaign/Reward ได้ เปิด-ปิดใช้งานได้ แต่แก้ไข/ลบไม่ได้ และแตะข้อมูลสมาชิกไม่ได้เลย |

เพิ่มเจ้าหน้าที่คนใหม่ได้จากแท็บ **Admins** ในหน้าเว็บเลย (super_admin เท่านั้นที่เห็นแท็บนี้) ไม่ต้องรัน SQL มือแล้ว

### 3. สิ่งที่เพิ่มในแต่ละแท็บ
- **Dashboard** — กราฟแท่งเทียบยอดสแกนแต่ละ Campaign + filter ดูว่าใคร engage กับ Campaign ไหนบ้าง
- **Members** — คลิกชื่อสมาชิกเพื่อดูรายละเอียด: ประวัติ Engagement ทุกครั้ง (Campaign ไหน ได้ Tier Score/Point เท่าไหร่), ประวัติการแลก Reward ทั้งหมด, ฟอร์มปรับ Tier Score/Point ด้วยมือ (super_admin/admin เท่านั้น), ปุ่มลบสมาชิกแบบต้องติ๊กยืนยัน + popup ยืนยันอีกชั้น (2 ชั้นตามที่ขอ)
- **Rewards / Campaigns** — เพิ่ม/แก้/เปิดปิด/**ลบ** ได้ในหน้าเดียว (staff เห็นแค่เปิดปิด แก้ไข/ลบไม่ได้)

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
