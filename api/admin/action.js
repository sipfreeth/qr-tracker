// api/admin/action.js
//
// ศูนย์รวม Action ทั้งหมดของระบบ Admin บน Vercel Serverless Function
// ช่วยประหยัดจำนวน Serverless Functions ไม่ให้เกินโควต้า 12 Functions บน Hobby Plan
//
// เรียกผ่าน query parameter 'action' เช่น:
//   GET  /api/admin/action?action=login          — แสดงฟอร์ม login
//   POST /api/admin/action?action=login           — ประมวลผล login
//   GET  /api/admin/action?action=logout          — logout
//   POST /api/admin/action?action=mark_used       — ยืนยัน redemption ว่าใช้แล้ว (สำหรับรายการ pending เก่า)
//   POST /api/admin/action?action=redemption_ship_toggle — สลับสถานะจัดส่งแล้ว/ยังไม่จัดส่ง
//   POST /api/admin/action?action=reward_create   — เพิ่มของรางวัล
//   POST /api/admin/action?action=reward_update   — แก้ของรางวัล
//   POST /api/admin/action?action=reward_toggle   — เปิด/ปิดของรางวัล
//   POST /api/admin/action?action=reward_delete   — ลบของรางวัล
//   POST /api/admin/action?action=campaign_create — เพิ่ม Campaign
//   POST /api/admin/action?action=campaign_update — แก้ Campaign
//   POST /api/admin/action?action=campaign_toggle — เปิด/ปิด Campaign
//   POST /api/admin/action?action=campaign_delete — ลบ Campaign
//   POST /api/admin/action?action=admin_create        — เพิ่มบัญชีแอดมิน (super_admin เท่านั้น)
//   POST /api/admin/action?action=admin_update_role   — เปลี่ยน role แอดมิน (super_admin เท่านั้น)
//   POST /api/admin/action?action=admin_reset_password — รีเซ็ตรหัสผ่านแอดมิน (super_admin เท่านั้น)
//   POST /api/admin/action?action=admin_delete        — ลบบัญชีแอดมิน (super_admin เท่านั้น)
//   POST /api/admin/action?action=member_adjust   — ปรับ Tier Score/Point สมาชิกด้วยมือ
//   POST /api/admin/action?action=member_delete   — ลบสมาชิก (ต้อง confirm=yes)

import bcrypt from 'bcryptjs';
import { supabase } from '../../lib/supabaseClient.js';
import { requireAdmin, requirePermission, createSessionCookie, clearSessionCookie } from '../../lib/adminAuth.js';

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return new URLSearchParams(body);
}

export default async function handler(req, res) {
  const actionParam = req.query.action;

  // ---------- 1. LOGIN (ไม่ต้อง login มาก่อน) ----------
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

      const { data: user } = await supabase
        .from('admin_users')
        .select('username, password_hash')
        .eq('username', username)
        .maybeSingle();

      const validPassword = user ? await bcrypt.compare(password, user.password_hash) : false;

      if (!user || !validPassword) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(200).send(renderLoginPage('Username หรือ Password ไม่ถูกต้อง'));
        return;
      }

      res.setHeader('Set-Cookie', createSessionCookie(username));
      res.writeHead(302, { Location: '/api/admin/dashboard' });
      res.end();
      return;
    }
    res.status(405).send('Method not allowed');
    return;
  }

  // ---------- 2. LOGOUT (ไม่ต้อง login มาก่อน) ----------
  if (actionParam === 'logout') {
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.writeHead(302, { Location: '/api/admin/action?action=login' });
    res.end();
    return;
  }

  // ---------- ทุก action ต่อจากนี้ ต้อง login ก่อน ----------
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const params = await readBody(req);

  // ---------- 3. MARK REDEMPTION USED ----------
  if (actionParam === 'mark_used') {
    const code = params.get('code');
    if (code) {
      await supabase
        .from('redemptions')
        .update({ status: 'used', used_at: new Date().toISOString() })
        .eq('redemption_code', code)
        .eq('status', 'pending');
    }
    res.writeHead(302, { Location: '/api/admin/dashboard' });
    res.end();
    return;
  }

  // ---------- 3b. TOGGLE SHIPPING STATUS (จัดส่งแล้ว / ยังไม่จัดส่ง) ----------
  if (actionParam === 'redemption_ship_toggle') {
    const redemptionId = params.get('redemption_id');
    const { data: r } = await supabase.from('redemptions').select('shipping_status').eq('id', redemptionId).single();
    if (r) {
      const newStatus = r.shipping_status === 'shipped' ? 'not_shipped' : 'shipped';
      await supabase.from('redemptions').update({ shipping_status: newStatus }).eq('id', redemptionId);
    }
    const backTo = params.get('back_to') || '/api/admin/dashboard';
    res.writeHead(302, { Location: backTo });
    res.end();
    return;
  }

  // ---------- 4. REWARD ACTIONS ----------
  if (actionParam === 'reward_create') {
    if (!requirePermission(res, admin.role, 'create_reward')) return;
    await supabase.from('rewards').insert({
      name: params.get('name'),
      points_cost: Number(params.get('points_cost')),
    });
    res.writeHead(302, { Location: '/api/admin/rewards' });
    res.end();
    return;
  }

  if (actionParam === 'reward_update') {
    if (!requirePermission(res, admin.role, 'edit_reward')) return;
    await supabase
      .from('rewards')
      .update({ name: params.get('name'), points_cost: Number(params.get('points_cost')) })
      .eq('id', params.get('id'));
    res.writeHead(302, { Location: '/api/admin/rewards' });
    res.end();
    return;
  }

  if (actionParam === 'reward_toggle') {
    if (!requirePermission(res, admin.role, 'toggle_reward')) return;
    const { data: reward } = await supabase.from('rewards').select('active').eq('id', params.get('id')).single();
    if (reward) await supabase.from('rewards').update({ active: !reward.active }).eq('id', params.get('id'));
    res.writeHead(302, { Location: '/api/admin/rewards' });
    res.end();
    return;
  }

  if (actionParam === 'reward_delete') {
    if (!requirePermission(res, admin.role, 'delete_reward')) return;
    await supabase.from('rewards').delete().eq('id', params.get('id'));
    res.writeHead(302, { Location: '/api/admin/rewards' });
    res.end();
    return;
  }

  // ---------- 5. CAMPAIGN ACTIONS ----------
  if (actionParam === 'campaign_create') {
    if (!requirePermission(res, admin.role, 'create_campaign')) return;
    await supabase.from('creatives').insert({
      creative_id: params.get('creative_id'),
      destination_url: params.get('destination_url'),
    });
    res.writeHead(302, { Location: '/api/admin/campaigns' });
    res.end();
    return;
  }

  if (actionParam === 'campaign_update') {
    if (!requirePermission(res, admin.role, 'edit_campaign')) return;
    await supabase
      .from('creatives')
      .update({ destination_url: params.get('destination_url') })
      .eq('creative_id', params.get('creative_id'));
    res.writeHead(302, { Location: '/api/admin/campaigns' });
    res.end();
    return;
  }

  if (actionParam === 'campaign_toggle') {
    if (!requirePermission(res, admin.role, 'toggle_campaign')) return;
    const { data: c } = await supabase
      .from('creatives')
      .select('active')
      .eq('creative_id', params.get('creative_id'))
      .single();
    if (c) await supabase.from('creatives').update({ active: !c.active }).eq('creative_id', params.get('creative_id'));
    res.writeHead(302, { Location: '/api/admin/campaigns' });
    res.end();
    return;
  }

  if (actionParam === 'campaign_delete') {
    if (!requirePermission(res, admin.role, 'delete_campaign')) return;
    await supabase.from('creatives').delete().eq('creative_id', params.get('creative_id'));
    res.writeHead(302, { Location: '/api/admin/campaigns' });
    res.end();
    return;
  }

  // ---------- 6. ADMIN USER ACTIONS (super_admin เท่านั้น) ----------
  if (['admin_create', 'admin_update_role', 'admin_reset_password', 'admin_delete'].includes(actionParam)) {
    if (!requirePermission(res, admin.role, 'manage_admins')) return;

    if (actionParam === 'admin_create') {
      const hash = await bcrypt.hash(params.get('password'), 10);
      await supabase.from('admin_users').insert({
        username: params.get('username'),
        password_hash: hash,
        role: params.get('role'),
      });
    }

    if (actionParam === 'admin_update_role') {
      if (params.get('username') === admin.username) {
        res.status(400).send('ไม่สามารถเปลี่ยน role ของบัญชีตัวเองได้ ให้ super_admin คนอื่นเปลี่ยนให้');
        return;
      }
      await supabase.from('admin_users').update({ role: params.get('role') }).eq('username', params.get('username'));
    }

    if (actionParam === 'admin_reset_password') {
      const hash = await bcrypt.hash(params.get('password'), 10);
      await supabase.from('admin_users').update({ password_hash: hash }).eq('username', params.get('username'));
    }

    if (actionParam === 'admin_delete') {
      if (params.get('username') === admin.username) {
        res.status(400).send('ไม่สามารถลบบัญชีตัวเองได้');
        return;
      }
      await supabase.from('admin_users').delete().eq('username', params.get('username'));
    }

    res.writeHead(302, { Location: '/api/admin/admins' });
    res.end();
    return;
  }

  // ---------- 7. MEMBER ACTIONS ----------
  if (actionParam === 'member_adjust') {
    if (!requirePermission(res, admin.role, 'edit_member')) return;
    const memberId = params.get('member_id');
    const tierScoreDelta = Number(params.get('tier_score_delta') || 0);
    const pointsDelta = Number(params.get('points_delta') || 0);
    const note = params.get('note') || '';

    if (tierScoreDelta !== 0 || pointsDelta !== 0) {
      await supabase.from('points_ledger').insert({
        member_id: memberId,
        creative_id: null,
        tier_score: tierScoreDelta,
        reward_points: pointsDelta,
        reason: `admin_adjust:${admin.username}${note ? ' - ' + note : ''}`,
      });
    }
    res.writeHead(302, { Location: `/api/admin/members?detail=${memberId}` });
    res.end();
    return;
  }

  if (actionParam === 'member_delete') {
    if (!requirePermission(res, admin.role, 'delete_member')) return;
    if (params.get('confirm') !== 'yes') {
      res.status(400).send('ต้องยืนยันการลบก่อน');
      return;
    }
    await supabase.from('members').delete().eq('id', params.get('member_id'));
    res.writeHead(302, { Location: '/api/admin/members' });
    res.end();
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
<title>Admin Login</title>
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
    <h1>Admin Login</h1>
    ${error ? `<p class="error">${error}</p>` : ''}
    <form method="POST" action="/api/admin/action?action=login">
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
