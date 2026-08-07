// api/sponsor/action.js
//
// ศูนย์รวม action ของฝั่ง Sponsor (รวมไฟล์เดียวแนวเดียวกับ admin/action.js และ office/action.js
// เพื่อประหยัดโควต้า Serverless Functions):
//   GET/POST ?action=signup            — สมัครสมาชิกใหม่
//   GET/POST ?action=login             — login
//   GET      ?action=logout            — logout
//   POST     ?action=update_profile    — แก้ข้อมูลบริษัท
//   POST     ?action=change_password   — เปลี่ยนรหัสผ่านตัวเอง
//   POST     ?action=get_upload_url    — ขอ signed URL อัปโหลดไฟล์เข้าคลัง
//   POST     ?action=save_content      — บันทึกไฟล์หลังอัปโหลดเสร็จ
//   POST     ?action=delete_content    — ลบไฟล์จากคลัง
//   POST     ?action=create_booking    — ยืนยันจองสล็อต

import bcrypt from 'bcryptjs';
import { supabase } from '../../lib/supabaseClient.js';
import { createSponsorSessionCookie, clearSponsorSessionCookie, requireSponsor } from '../../lib/sponsorAuth.js';
import { createUploadTarget, saveSponsorContent, createBooking } from '../../lib/sponsorArea.js';

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return new URLSearchParams(body);
}

export default async function handler(req, res) {
  const actionParam = req.query.action;

  // ---------- SIGNUP ----------
  if (actionParam === 'signup') {
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(renderSignupPage());
      return;
    }
    if (req.method === 'POST') {
      const params = await readBody(req);
      const email = (params.get('email') || '').trim().toLowerCase();

      const { data: existing } = await supabase.from('sponsors').select('id').eq('email', email).maybeSingle();
      if (existing) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(200).send(renderSignupPage('อีเมลนี้ถูกใช้สมัครไปแล้ว'));
        return;
      }

      const hash = await bcrypt.hash(params.get('password'), 10);
      const { data: newSponsor, error } = await supabase
        .from('sponsors')
        .insert({
          company_name: params.get('company_name'),
          tax_id: params.get('tax_id') || null,
          address: params.get('address') || null,
          contact_name: params.get('contact_name') || null,
          contact_phone: params.get('contact_phone') || null,
          business_type: params.get('business_type') || null,
          email,
          password_hash: hash,
        })
        .select('id')
        .single();

      if (error) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(200).send(renderSignupPage('สมัครไม่สำเร็จ ลองใหม่อีกครั้ง'));
        return;
      }

      res.setHeader('Set-Cookie', createSponsorSessionCookie(newSponsor.id));
      res.writeHead(302, { Location: '/api/sponsor?page=profile' });
      res.end();
      return;
    }
    res.status(405).send('Method not allowed');
    return;
  }

  // ---------- LOGIN ----------
  if (actionParam === 'login') {
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(renderLoginPage());
      return;
    }
    if (req.method === 'POST') {
      const params = await readBody(req);
      const email = (params.get('email') || '').trim().toLowerCase();
      const password = params.get('password') || '';

      const { data: sponsor } = await supabase.from('sponsors').select('id, password_hash').eq('email', email).maybeSingle();
      const valid = sponsor ? await bcrypt.compare(password, sponsor.password_hash) : false;

      if (!sponsor || !valid) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(200).send(renderLoginPage('อีเมลหรือรหัสผ่านไม่ถูกต้อง'));
        return;
      }

      res.setHeader('Set-Cookie', createSponsorSessionCookie(sponsor.id));
      res.writeHead(302, { Location: '/api/sponsor' });
      res.end();
      return;
    }
    res.status(405).send('Method not allowed');
    return;
  }

  // ---------- LOGOUT ----------
  if (actionParam === 'logout') {
    res.setHeader('Set-Cookie', clearSponsorSessionCookie());
    res.writeHead(302, { Location: '/api/sponsor/action?action=login' });
    res.end();
    return;
  }

  // ---------- ต่อจากนี้ต้อง login ก่อน ----------
  const sponsor = await requireSponsor(req, res);
  if (!sponsor) return;

  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const params = await readBody(req);

  if (actionParam === 'update_profile') {
    await supabase
      .from('sponsors')
      .update({
        company_name: params.get('company_name'),
        tax_id: params.get('tax_id') || null,
        address: params.get('address') || null,
        contact_name: params.get('contact_name') || null,
        contact_phone: params.get('contact_phone') || null,
        business_type: params.get('business_type') || null,
      })
      .eq('id', sponsor.id);
    res.writeHead(302, { Location: '/api/sponsor?page=profile' });
    res.end();
    return;
  }

  if (actionParam === 'change_password') {
    const valid = await bcrypt.compare(params.get('current_password') || '', sponsor.password_hash);
    if (!valid) {
      res.status(400).send('รหัสผ่านปัจจุบันไม่ถูกต้อง');
      return;
    }
    const hash = await bcrypt.hash(params.get('new_password'), 10);
    await supabase.from('sponsors').update({ password_hash: hash }).eq('id', sponsor.id);
    res.writeHead(302, { Location: '/api/sponsor?page=profile' });
    res.end();
    return;
  }

  if (actionParam === 'get_upload_url') {
    try {
      const target = await createUploadTarget(sponsor.id, params.get('file_name') || 'file');
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(JSON.stringify(target));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  if (actionParam === 'save_content') {
    try {
      await saveSponsorContent({
        sponsorId: sponsor.id,
        fileName: params.get('file_name'),
        filePath: params.get('file_path'),
        fileType: params.get('file_type'),
      });
      res.status(200).send('ok');
    } catch (err) {
      res.status(400).send(err.message);
    }
    return;
  }

  if (actionParam === 'delete_content') {
    await supabase.from('sponsor_content').delete().eq('id', params.get('content_id')).eq('sponsor_id', sponsor.id);
    res.writeHead(302, { Location: '/api/sponsor?page=content' });
    res.end();
    return;
  }

  if (actionParam === 'create_booking') {
    const officeId = params.get('office_id');
    const slotNumber = Number(params.get('slot_number'));
    const weekStart = params.get('week_start');
    const contentId = params.get('sponsor_content_id');

    // เช็คว่าไฟล์ที่เลือกเป็นของ sponsor คนนี้จริง และอนุมัติแล้วจริง (กันแก้ query เอง)
    const { data: contentRow } = await supabase
      .from('sponsor_content')
      .select('id, status')
      .eq('id', contentId)
      .eq('sponsor_id', sponsor.id)
      .maybeSingle();

    if (!contentRow || contentRow.status !== 'approved') {
      res.status(400).send('ไฟล์นี้ยังไม่ผ่านการอนุมัติ หรือไม่ใช่ของบัญชีคุณ');
      return;
    }

    const { data: office } = await supabase.from('office_accounts').select('price_per_week').eq('id', officeId).single();
    if (!office) {
      res.status(404).send('ไม่พบ Office นี้');
      return;
    }

    try {
      await createBooking({
        sponsorId: sponsor.id,
        officeAccountId: officeId,
        slotNumber,
        weekStart,
        sponsorContentId: contentId,
        price: office.price_per_week,
      });
    } catch (err) {
      res.status(400).send('จองไม่สำเร็จ (อาจมีคนจองช่วงนี้ไปก่อนแล้ว) ลองเลือกช่วงอื่น');
      return;
    }

    res.writeHead(302, { Location: '/api/sponsor?page=book&office_id=' + officeId });
    res.end();
    return;
  }

  res.status(400).send('ไม่รู้จัก action นี้');
}

function renderSignupPage(error) {
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>สมัครสมาชิก Sponsor</title>
<style>
  body { font-family: sans-serif; background: #f7f8fa; margin: 0; padding: 24px; color: #1b1f27; }
  .card { background: white; border-radius: 16px; padding: 32px; max-width: 440px; margin: 24px auto; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  h1 { font-size: 18px; margin: 0 0 20px; }
  label { display: block; font-size: 13px; color: #6b7280; margin: 12px 0 4px; }
  input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 14px; }
  button { width: 100%; background: #1b1f27; color: white; border: none; padding: 12px; border-radius: 8px; font-size: 14px; cursor: pointer; margin-top: 20px; }
  .error { color: #e76f51; font-size: 13px; margin-bottom: 12px; }
  .link { text-align: center; margin-top: 16px; font-size: 13px; }
</style>
</head>
<body>
  <div class="card">
    <h1>สมัครสมาชิก Sponsor</h1>
    ${error ? `<p class="error">${error}</p>` : ''}
    <form method="POST" action="/api/sponsor/action?action=signup">
      <label>ชื่อบริษัท *</label>
      <input type="text" name="company_name" required />
      <label>เลขประจำตัวผู้เสียภาษี</label>
      <input type="text" name="tax_id" />
      <label>ที่อยู่บริษัท</label>
      <input type="text" name="address" />
      <label>ชื่อผู้ติดต่อ</label>
      <input type="text" name="contact_name" />
      <label>เบอร์โทรติดต่อ</label>
      <input type="text" name="contact_phone" />
      <label>ประเภทธุรกิจ</label>
      <input type="text" name="business_type" />
      <label>อีเมล (ใช้ login) *</label>
      <input type="email" name="email" required />
      <label>รหัสผ่าน *</label>
      <input type="password" name="password" required minlength="6" />
      <button type="submit">สมัครสมาชิก</button>
    </form>
    <p class="link">มีบัญชีอยู่แล้ว? <a href="/api/sponsor/action?action=login">เข้าสู่ระบบ</a></p>
  </div>
</body>
</html>`;
}

function renderLoginPage(error) {
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Sponsor Login</title>
<style>
  body { font-family: sans-serif; background: #f7f8fa; margin: 0; padding: 24px; color: #1b1f27; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { background: white; border-radius: 16px; padding: 32px; max-width: 360px; width: 100%; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  h1 { font-size: 18px; margin: 0 0 20px; }
  label { display: block; font-size: 13px; color: #6b7280; margin-bottom: 4px; }
  input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
  button { width: 100%; background: #1b1f27; color: white; border: none; padding: 12px; border-radius: 8px; font-size: 14px; cursor: pointer; }
  .error { color: #e76f51; font-size: 13px; margin-bottom: 12px; }
  .link { text-align: center; margin-top: 16px; font-size: 13px; }
</style>
</head>
<body>
  <div class="card">
    <h1>Sponsor Login</h1>
    ${error ? `<p class="error">${error}</p>` : ''}
    <form method="POST" action="/api/sponsor/action?action=login">
      <label>อีเมล</label>
      <input type="email" name="email" required autofocus />
      <label>รหัสผ่าน</label>
      <input type="password" name="password" required />
      <button type="submit">เข้าสู่ระบบ</button>
    </form>
    <p class="link">ยังไม่มีบัญชี? <a href="/api/sponsor/action?action=signup">สมัครสมาชิก</a></p>
  </div>
</body>
</html>`;
}
