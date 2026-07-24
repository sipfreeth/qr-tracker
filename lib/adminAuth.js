// lib/adminAuth.js
//
// ระบบ Login/Logout สำหรับ Admin/เจ้าหน้าที่ ใช้ signed cookie (ไม่ต้องมี session table แยก)
// รหัสผ่านเก็บแบบ hash (bcrypt) ในตาราง admin_users ไม่เก็บเป็น plain text

import crypto from 'crypto';

const COOKIE_NAME = 'admin_session';
const SESSION_HOURS = 12;

function sign(value) {
  return crypto.createHmac('sha256', process.env.ADMIN_SECRET).update(value).digest('hex');
}

export function createSessionCookie(username) {
  const expires = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const payload = `${username}.${expires}`;
  const sig = sign(payload);
  const token = Buffer.from(`${payload}.${sig}`).toString('base64url');
  return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_HOURS * 3600}; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

// คืนชื่อ username ถ้า cookie ยังใช้ได้ ไม่งั้นคืน null
export function getSessionUser(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;

  let decoded;
  try {
    decoded = Buffer.from(match.split('=')[1], 'base64url').toString();
  } catch {
    return null;
  }

  const parts = decoded.split('.');
  if (parts.length !== 3) return null;
  const [username, expires, sig] = parts;

  if (sign(`${username}.${expires}`) !== sig) return null; // ลายเซ็นไม่ตรง แปลว่าปลอม
  if (Date.now() > Number(expires)) return null; // หมดอายุ

  return username;
}

// ใช้ในทุกหน้าที่ต้อง login ก่อนดู — ถ้ายังไม่ login จะ redirect ไปหน้า login ให้อัตโนมัติ
export function requireAdmin(req, res) {
  const username = getSessionUser(req);
  if (!username) {
    res.writeHead(302, { Location: '/api/admin/login' });
    res.end();
    return null;
  }
  return username;
}
