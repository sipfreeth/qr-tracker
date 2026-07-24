// api/admin/mark-used.js
//
// รับ POST จากปุ่ม "ยืนยันใช้แล้ว" ในหน้า Dashboard
// เปลี่ยนสถานะ redemption จาก pending เป็น used แล้วพากลับไปหน้า dashboard

import { supabase } from '../../lib/supabaseClient.js';
import { requireAdmin } from '../../lib/adminAuth.js';

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

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
    .update({ status: 'used', used_at: new Date().toISOString() })
    .eq('redemption_code', code)
    .eq('status', 'pending'); // กันกดซ้ำ/กดพร้อมกันสองครั้ง

  res.writeHead(302, { Location: '/api/admin/dashboard' });
  res.end();
}
