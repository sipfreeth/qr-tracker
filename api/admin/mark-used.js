// api/admin/mark-used.js
//
// รับ POST จากปุ่ม "ยืนยันใช้แล้ว" ในหน้า dashboard
// เปลี่ยนสถานะ redemption จาก pending เป็น used แล้วพากลับไปหน้า dashboard

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function checkAuth(req) {
  const header = req.headers.authorization || '';
  const [, base64] = header.split(' ');
  if (!base64) return false;
  const [, password] = Buffer.from(base64, 'base64').toString().split(':');
  return password === process.env.ADMIN_PASSWORD;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Dashboard"');
    res.status(401).send('ต้องล็อกอินก่อนเข้าหน้านี้');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  // อ่าน form data (application/x-www-form-urlencoded) จาก request body
  let body = '';
  for await (const chunk of req) body += chunk;
  const params = new URLSearchParams(body);
  const code = params.get('code');

  if (!code) {
    res.status(400).send('ไม่พบโค้ด');
    return;
  }

  await supabase
    .from('redemptions')
    .update({ status: 'used' })
    .eq('redemption_code', code)
    .eq('status', 'pending'); // กันกดซ้ำ/กดพร้อมกันสองครั้ง

  res.writeHead(302, { Location: '/api/admin/dashboard' });
  res.end();
}
