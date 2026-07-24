// api/admin/admin-user-action.js
//
// จัดการบัญชีแอดมิน (สร้าง/แก้/ลบ/เปลี่ยน role) — super_admin เท่านั้นที่ทำได้

import bcrypt from 'bcryptjs';
import { supabase } from '../../lib/supabaseClient.js';
import { requireAdmin, requirePermission } from '../../lib/adminAuth.js';

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!requirePermission(res, admin.role, 'manage_admins')) return;
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  let body = '';
  for await (const chunk of req) body += chunk;
  const params = new URLSearchParams(body);
  const action = params.get('action');

  if (action === 'create') {
    const password = params.get('password');
    const hash = await bcrypt.hash(password, 10);
    await supabase.from('admin_users').insert({
      username: params.get('username'),
      password_hash: hash,
      role: params.get('role'),
    });
  }

  if (action === 'update_role') {
    // กันตัวเอง (super_admin คนเดียว) ลดสิทธิ์ตัวเองจนไม่มีใครจัดการระบบได้
    if (params.get('username') === admin.username) {
      res.status(400).send('ไม่สามารถเปลี่ยน role ของบัญชีตัวเองได้ ให้ super_admin คนอื่นเปลี่ยนให้');
      return;
    }
    await supabase.from('admin_users').update({ role: params.get('role') }).eq('username', params.get('username'));
  }

  if (action === 'reset_password') {
    const hash = await bcrypt.hash(params.get('password'), 10);
    await supabase.from('admin_users').update({ password_hash: hash }).eq('username', params.get('username'));
  }

  if (action === 'delete') {
    if (params.get('username') === admin.username) {
      res.status(400).send('ไม่สามารถลบบัญชีตัวเองได้');
      return;
    }
    await supabase.from('admin_users').delete().eq('username', params.get('username'));
  }

  res.writeHead(302, { Location: '/api/admin/admins' });
  res.end();
}
