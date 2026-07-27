// api/admin/action.js
//
// ศูนย์รวม Action ทั้งหมดของระบบ Admin บน Vercel Serverless Function
// ช่วยประหยัดจำนวน Serverless Functions ไม่ให้เกินโควต้า 12 Functions บน Hobby Plan
// UPDATE MEMBER SHIPPING STATUS
if (action === 'update_member_shipping') {

  const redemptionId = params.get('redemption_id');
  const shippingStatus = params.get('shipping_status');
  const memberId = params.get('member_id');


  if (!['pending','shipped'].includes(shippingStatus)) {
    res.status(400).send('Invalid shipping status');
    return;
  }


  await supabase
    .from('redemptions')
    .update({
      shipping_status: shippingStatus,
      shipped_at:
        shippingStatus === 'shipped'
        ? new Date().toISOString()
        : null
    })
    .eq('id', redemptionId);


  res.writeHead(302,{
    Location:`/api/admin/members?detail=${memberId}`
  });

  res.end();
  return;
}
import bcrypt from 'bcryptjs';
import { supabase } from '../../lib/supabaseClient.js';
import { requireAdmin, requirePermission, createSessionCookie, clearSessionCookie } from '../../lib/adminAuth.js';

export default async function handler(req, res) {
  // อ่าน Query parameter 'action' จาก URL เช่น /api/admin/action?action=login
  const actionParam = req.query.action;

  // 1. ACTION: LOGIN (รองรับทั้ง GET แสดงฟอร์ม และ POST ประมวลผล)
  if (actionParam === 'login') {
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(renderLoginPage());
      return;
    }

    if (req.method === 'POST') {
      const params = await parseBody(req);
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

  // 2. ACTION: LOGOUT
  if (actionParam === 'logout') {
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.writeHead(302, { Location: '/api/admin/action?action=login' });
    res.end();
    return;
  }

  // ------------------------------------------------------------------
  // ตั้งแต่ตรงนี้ไป ต้องผ่านการตรวจสอบสิทธิ์ Admin ก่อน (requireAdmin)
  // ------------------------------------------------------------------
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const params = await parseBody(req);
  const action = params.get('action') || actionParam;

  // 3. MEMBER ACTIONS (adjust, delete)
  if (action === 'member_adjust' || action === 'member_delete') {
    const memberId = params.get('member_id');

    if (action === 'member_adjust') {
      if (!requirePermission(res, admin.role, 'edit_member')) return;
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

    if (action === 'member_delete') {
      if (!requirePermission(res, admin.role, 'delete_member')) return;
      if (params.get('confirm') !== 'yes') {
        res.status(400).send('ต้องยืนยันการลบก่อน');
        return;
      }
      await supabase.from('members').delete().eq('id', memberId);
      res.writeHead(302, { Location: '/api/admin/members' });
      res.end();
      return;
    }
  }

  // 4. REWARD ACTIONS (reward_create, reward_update, reward_toggle, reward_delete)
  if (action.startsWith('reward_')) {
    const subAction = action.replace('reward_', '');

    if (subAction === 'create') {
      if (!requirePermission(res, admin.role, 'create_reward')) return;
      await supabase.from('rewards').insert({
        name: params.get('name'),
        points_cost: Number(params.get('points_cost')),
      });
    } else if (subAction === 'update') {
      if (!requirePermission(res, admin.role, 'edit_reward')) return;
      await supabase
        .from('rewards')
        .update({ name: params.get('name'), points_cost: Number(params.get('points_cost')) })
        .eq('id', params.get('id'));
    } else if (subAction === 'toggle') {
      if (!requirePermission(res, admin.role, 'toggle_reward')) return;
      const { data: reward } = await supabase.from('rewards').select('active').eq('id', params.get('id')).single();
      if (reward) {
        await supabase.from('rewards').update({ active: !reward.active }).eq('id', params.get('id'));
      }
    } else if (subAction === 'delete') {
      if (!requirePermission(res, admin.role, 'delete_reward')) return;
      await supabase.from('rewards').delete().eq('id', params.get('id'));
    }

    res.writeHead(302, { Location: '/api/admin/rewards' });
    res.end();
    return;
  }

  // 5. CAMPAIGN ACTIONS (campaign_create, campaign_update, campaign_toggle, campaign_delete)
  if (action.startsWith('campaign_')) {
    const subAction = action.replace('campaign_', '');

    if (subAction === 'create') {
      if (!requirePermission(res, admin.role, 'create_campaign')) return;
      await supabase.from('creatives').insert({
        creative_id: params.get('creative_id'),
        destination_url: params.get('destination_url'),
      });
    } else if (subAction === 'update') {
      if (!requirePermission(res, admin.role, 'edit_campaign')) return;
      await supabase
        .from('creatives')
        .update({ destination_url: params.get('destination_url') })
        .eq('creative_id', params.get('creative_id'));
    } else if (subAction === 'toggle') {
      if (!requirePermission(res, admin.role, 'toggle_campaign')) return;
      const { data: c } = await supabase
        .from('creatives')
        .select('active')
        .eq('creative_id', params.get('creative_id'))
        .single();
      if (c) {
        await supabase.from('creatives').update({ active: !c.active }).eq('creative_id', params.get('creative_id'));
      }
    } else if (subAction === 'delete') {
      if (!requirePermission(res, admin.role, 'delete_campaign')) return;
      await supabase.from('creatives').delete().eq('creative_id', params.get('creative_id'));
    }

    res.writeHead(302, { Location: '/api/admin/campaigns' });
    res.end();
    return;
  }

  // 6. MARK USED ACTION (ยืนยันใช้สิทธิ์ Redemption)
 if (action === 'mark_used') {
  const code = params.get('code');

  const receiverName = params.get('receiver_name');
  const receiverPhone = params.get('receiver_phone');
  const shippingAddress = params.get('shipping_address');


  if (!code) {
    res.status(400).send('ไม่พบโค้ด');
    return;
  }


  // หา redemption ก่อน
  const { data: redemption } = await supabase
    .from('redemptions')
    .select('member_id')
    .eq('redemption_code', code)
    .single();


  if (!redemption) {
    res.status(404).send('ไม่พบข้อมูล');
    return;
  }


  // เปลี่ยน Reward เป็นใช้แล้วทันที
  await supabase
    .from('redemptions')
    .update({
      status: 'used',
      used_at: new Date().toISOString(),
      receiver_name: receiverName,
      receiver_phone: receiverPhone,
      shipping_address: shippingAddress,
      shipping_status:'pending'
    })
    .eq('redemption_code', code);



  // เก็บ address เข้า member
  await supabase
    .from('member_addresses')
    .insert({
      member_id:redemption.member_id,
      name:receiverName,
      phone:receiverPhone,
      address:shippingAddress
    });


  res.writeHead(302,{
    Location:'/reward/success'
  });

  res.end();
  return;
}

  // 7. ADMIN USER ACTIONS (admin_create, admin_update_role, admin_reset_password, admin_delete)
  if (action.startsWith('admin_')) {
    if (!requirePermission(res, admin.role, 'manage_admins')) return;
    const subAction = action.replace('admin_', '');

    if (subAction === 'create') {
      const password = params.get('password');
      const hash = await bcrypt.hash(password, 10);
      await supabase.from('admin_users').insert({
        username: params.get('username'),
        password_hash: hash,
        role: params.get('role'),
      });
    } else if (subAction === 'update_role') {
      if (params.get('username') === admin.username) {
        res.status(400).send('ไม่สามารถเปลี่ยน role ของบัญชีตัวเองได้ ให้ super_admin คนอื่นเปลี่ยนให้');
        return;
      }
      await supabase.from('admin_users').update({ role: params.get('role') }).eq('username', params.get('username'));
    } else if (subAction === 'reset_password') {
      const hash = await bcrypt.hash(params.get('password'), 10);
      await supabase.from('admin_users').update({ password_hash: hash }).eq('username', params.get('username'));
    } else if (subAction === 'delete') {
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

  // SHIPPING STATUS
if (action === 'shipping_status') {
  const redemptionId = params.get('redemption_id');
  const shippingStatus = params.get('shipping_status');

  if (!['pending','shipping','delivered'].includes(shippingStatus)) {
    res.status(400).send('Invalid shipping status');
    return;
  }

  await supabase
    .from('reward_redemptions')
    .update({
      shipping_status: shippingStatus,
      shipped_at:
        shippingStatus === 'pending'
          ? new Date().toISOString()
          : null,
    })
    .eq('id', redemptionId);

  res.writeHead(302, {
    Location: '/api/admin/rewards',
  });

  res.end();
  return;
}
// UPDATE MEMBER SHIPPING STATUS
if (action === 'update_member_shipping') {

  const redemptionId = params.get('redemption_id');
  const shippingStatus = params.get('shipping_status');
  const memberId = params.get('member_id');


  if (!['pending','shipped'].includes(shippingStatus)) {
    res.status(400).send('Invalid shipping status');
    return;
  }


  await supabase
    .from('redemptions')
    .update({
      shipping_status: shippingStatus,
      shipped_at:
        shippingStatus === 'shipped'
        ? new Date().toISOString()
        : null
    })
    .eq('id', redemptionId);


  res.writeHead(302,{
    Location:`/api/admin/members?detail=${memberId}`
  });

  res.end();
  return;
}
  
  res.status(400).send('ไม่รู้จัก action นี้');
}

// Helper อ่าน Request Body
async function parseBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return new URLSearchParams(body);
}

// หน้า Render Login HTML
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
