// api/office/action.js
//
// ศูนย์รวม action ของฝั่ง Office (รวมไฟล์เดียวกันแนวเดียวกับ api/admin/action.js
// เพื่อประหยัดโควต้า Serverless Functions):
//   GET/POST /api/office/action?action=login          — login
//   GET      /api/office/action?action=logout         — logout
//   POST     /api/office/action?action=get_upload_url — ขอ signed URL อัปโหลดไฟล์ (ระบุ ?slot=1/2/3)
//   POST     /api/office/action?action=save_content   — บันทึกข้อมูลหลังอัปโหลดเสร็จ (ระบุ ?slot=1/2/3)

import bcrypt from 'bcryptjs';
import { supabase } from '../../lib/supabaseClient.js';
import { createOfficeSessionCookie, clearOfficeSessionCookie, requireOffice } from '../../lib/officeAuth.js';
import { createUploadTarget, saveSlotContent } from '../../lib/officeArea.js';

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return new URLSearchParams(body);
}

export default async function handler(req, res) {
  const actionParam = req.query.action;

  // ---------- LOGIN ----------
  if (actionParam === 'login') {
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(renderLoginPage());
      return;
    }
    if (req.method === 'POST') {
      const params = await readBody(req);
      const username = (params.get('username') || '').trim();
      const password = params.get('password') || '';

      const { data: office } = await supabase
        .from('office_accounts')
        .select('id, password_hash')
        .eq('username', username)
        .maybeSingle();

      const validPassword = office ? await bcrypt.compare(password, office.password_hash) : false;

      if (!office || !validPassword) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(200).send(renderLoginPage('Username หรือ Password ไม่ถูกต้อง'));
        return;
      }

      res.setHeader('Set-Cookie', createOfficeSessionCookie(office.id));
      res.writeHead(302, { Location: '/api/office' });
      res.end();
      return;
    }
    res.status(405).send('Method not allowed');
    return;
  }

  // ---------- LOGOUT ----------
  if (actionParam === 'logout') {
    res.setHeader('Set-Cookie', clearOfficeSessionCookie());
    res.writeHead(302, { Location: '/api/office/action?action=login' });
    res.end();
    return;
  }

  // ---------- ต่อจากนี้ต้อง login (office account) ก่อน ----------
  const office = await requireOffice(req, res);
  if (!office) return;

  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  // ---------- เปลี่ยนรหัสผ่านของตัวเอง (ไม่เกี่ยวกับ slot) ----------
  if (actionParam === 'change_password') {
    const params = await readBody(req);
    const { data: row } = await supabase.from('office_accounts').select('password_hash').eq('id', office.id).single();
    const valid = row && (await bcrypt.compare(params.get('current_password') || '', row.password_hash));

    if (!valid) {
      res.status(400).send('รหัสผ่านปัจจุบันไม่ถูกต้อง');
      return;
    }

    const hash = await bcrypt.hash(params.get('new_password'), 10);
    await supabase.from('office_accounts').update({ password_hash: hash }).eq('id', office.id);
    res.writeHead(302, { Location: '/api/office' });
    res.end();
    return;
  }

  const slot = Number(req.query.slot);
  if (![1, 2, 3].includes(slot)) {
    res.status(400).send('slot ไม่ถูกต้อง');
    return;
  }

  const params = await readBody(req);

  if (actionParam === 'get_upload_url') {
    try {
      const target = await createUploadTarget(office.id, slot, params.get('file_name') || 'file');
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(JSON.stringify(target));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  if (actionParam === 'save_content') {
    try {
      await saveSlotContent({
        officeAccountId: office.id,
        slotNumber: slot,
        fileName: params.get('file_name'),
        filePath: params.get('file_path'),
        fileType: params.get('file_type'),
        displayAt: params.get('display_at') ? new Date(params.get('display_at')).toISOString() : null,
        editorLabel: `${office.username} (office)`,
      });
      res.status(200).send('ok');
    } catch (err) {
      res.status(500).send(err.message);
    }
    return;
  }

  res.status(400).send('ไม่รู้จัก action นี้');
}

function renderLoginPage(error) {
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Office Login</title>
<style>
  body { font-family: sans-serif; background: #f7f8fa; margin: 0; padding: 24px; color: #1b1f27; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { background: white; border-radius: 16px; padding: 32px; max-width: 360px; width: 100%; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  h1 { font-size: 18px; margin: 0 0 20px; }
  label { display: block; font-size: 13px; color: #6b7280; margin-bottom: 4px; }
  input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
  button { width: 100%; background: #1b1f27; color: white; border: none; padding: 12px; border-radius: 8px; font-size: 14px; cursor: pointer; }
  .error { color: #e76f51; font-size: 13px; margin-bottom: 12px; }
</style>
</head>
<body>
  <div class="card">
    <h1>Office Area Login</h1>
    ${error ? `<p class="error">${error}</p>` : ''}
    <form method="POST" action="/api/office/action?action=login">
      <label>Username</label>
      <input type="text" name="username" required autofocus />
      <label>Password</label>
      <input type="password" name="password" required />
      <button type="submit">Log in</button>
    </form>
  </div>
</body>
</html>`;
}
