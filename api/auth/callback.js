// api/auth/callback.js
//
// LINE จะ redirect กลับมาที่นี่หลังคนกดยินยอมล็อกอิน ไม่ว่าจะมาจาก
// การสแกน QR (api/qr/[creative].js) หรือมาจากลิงก์เช็คแต้ม (api/points.js)
// เช็คจาก state ว่ามาจากทางไหน แล้วทำหน้าที่ต่างกัน

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const POINTS_PER_SCAN = 10; // ปรับจำนวนแต้มต่อครั้งได้ตรงนี้

export default async function handler(req, res) {
  const { code, state } = req.query;

  if (!code || !state) {
    res.status(400).send('ล็อกอินไม่สำเร็จ (ขาดข้อมูลจำเป็น)');
    return;
  }

  let parsedState;
  try {
    parsedState = JSON.parse(Buffer.from(state, 'base64url').toString());
  } catch {
    res.status(400).send('state ไม่ถูกต้อง');
    return;
  }

  // ขั้นที่ 1: เอา code ไปแลก token กับ LINE (เหมือนกันทั้ง 2 ทาง)
  const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.LINE_CALLBACK_URL,
      client_id: process.env.LINE_CHANNEL_ID,
      client_secret: process.env.LINE_CHANNEL_SECRET,
    }),
  });

  if (!tokenRes.ok) {
    console.error('แลก token กับ LINE ไม่สำเร็จ:', await tokenRes.text());
    res.status(502).send('เชื่อมต่อ LINE ไม่สำเร็จ ลองใหม่อีกครั้ง');
    return;
  }

  const tokenData = await tokenRes.json();
  const payload = JSON.parse(
    Buffer.from(tokenData.id_token.split('.')[1], 'base64url').toString()
  );
  const lineUserId = payload.sub;
  const displayName = payload.name || null;
  const pictureUrl = payload.picture || null;

  // ขั้นที่ 2: หาสมาชิกเดิม หรือสร้างใหม่ถ้ายังไม่เคยเจอ (เหมือนกันทั้ง 2 ทาง)
  let { data: member } = await supabase
    .from('members')
    .select('id, points_balance, display_name, picture_url')
    .eq('line_user_id', lineUserId)
    .single();

  if (!member) {
    const { data: newMember, error: insertError } = await supabase
      .from('members')
      .insert({ line_user_id: lineUserId, display_name: displayName, picture_url: pictureUrl })
      .select('id, points_balance, display_name, picture_url')
      .single();

    if (insertError) {
      console.error('สร้างสมาชิกไม่สำเร็จ:', insertError);
      res.status(500).send('เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
      return;
    }
    member = newMember;
  }

  // ทางที่ 1: มาจากลิงก์เช็คแต้ม — ไม่ต้องบวกแต้ม แค่โชว์หน้าสรุป
  if (parsedState.action === 'view_points') {
    const { data: history } = await supabase
      .from('points_ledger')
      .select('points, creative_id, reason, created_at')
      .eq('member_id', member.id)
      .order('created_at', { ascending: false })
      .limit(20);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(renderPointsPage(member, history || []));
    return;
  }

  // ทางที่ 3: มาจากลิงก์ดูของรางวัล — โชว์รายการให้เลือกแลก
  if (parsedState.action === 'view_rewards') {
    const { data: rewards } = await supabase
      .from('rewards')
      .select('id, name, points_cost')
      .eq('active', true)
      .order('points_cost', { ascending: true });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(renderRewardsPage(member, rewards || []));
    return;
  }

  // ทางที่ 4: มาจากการกดแลกของรางวัล — เช็คแต้มแล้วหัก ถ้าพอ
  if (parsedState.action === 'redeem') {
    const { data: reward } = await supabase
      .from('rewards')
      .select('id, name, points_cost')
      .eq('id', parsedState.rewardId)
      .single();

    if (!reward) {
      res.status(404).send('ไม่พบของรางวัลนี้');
      return;
    }

    if (member.points_balance < reward.points_cost) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(renderErrorPage('แต้มไม่พอ', `ต้องใช้ ${reward.points_cost} แต้ม แต่คุณมี ${member.points_balance} แต้ม`));
      return;
    }

    const redemptionCode = Math.floor(100000 + Math.random() * 900000).toString();
    const newBalance = member.points_balance - reward.points_cost;

    const { error: redemptionError } = await supabase.from('redemptions').insert({
      member_id: member.id,
      reward_id: reward.id,
      points_spent: reward.points_cost,
      redemption_code: redemptionCode,
    });

    if (redemptionError) {
      res.status(500).send('เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
      return;
    }

    await supabase.from('points_ledger').insert({
      member_id: member.id,
      creative_id: null,
      points: -reward.points_cost,
      reason: `redeem_reward:${reward.id}`,
    });
    await supabase.from('members').update({ points_balance: newBalance }).eq('id', member.id);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(renderRedeemSuccessPage(reward, redemptionCode, newBalance));
    return;
  }

  // ทางที่ 2: มาจากการสแกน QR — บวกแต้ม แล้ว redirect ไปโปรโมชั่นจริง
  const { creative, destination } = parsedState;

  // เช็คก่อนว่าคนนี้เคยได้แต้มจาก creative นี้ไปแล้วหรือยัง (ให้แต้มแค่ครั้งแรกครั้งเดียว)
  const { data: existingAward } = await supabase
    .from('points_ledger')
    .select('id')
    .eq('member_id', member.id)
    .eq('creative_id', creative)
    .maybeSingle();

  let newBalance = member.points_balance;
  let alreadyClaimed = false;

  if (existingAward) {
    // เคยได้แต้มจาก QR อันนี้ไปแล้ว ไม่บวกซ้ำ ใช้ยอดเดิม
    alreadyClaimed = true;
  } else {
    const { error: ledgerError } = await supabase.from('points_ledger').insert({
      member_id: member.id,
      creative_id: creative,
      points: POINTS_PER_SCAN,
      reason: 'scan_qr',
    });

    if (ledgerError) {
      // เผื่อกรณี race condition (สแกนพร้อมกัน 2 ครั้งในเสี้ยววินาที) — unique constraint กันซ้ำอีกชั้น
      alreadyClaimed = true;
    } else {
      newBalance = member.points_balance + POINTS_PER_SCAN;
      await supabase.from('members').update({ points_balance: newBalance }).eq('id', member.id);
    }
  }

  const finalUrl = new URL(destination);
  finalUrl.searchParams.set('points', newBalance);
  if (alreadyClaimed) finalUrl.searchParams.set('already_claimed', '1');
  res.writeHead(302, { Location: finalUrl.toString() });
  res.end();
}

function renderRewardsPage(member, rewards) {
  const items = rewards
    .map((r) => {
      const canAfford = member.points_balance >= r.points_cost;
      return `
        <div class="reward ${canAfford ? '' : 'disabled'}">
          <div>
            <div class="reward-name">${r.name}</div>
            <div class="reward-cost">${r.points_cost} แต้ม</div>
          </div>
          ${
            canAfford
              ? `<a class="btn" href="/api/redeem/${r.id}">แลกเลย</a>`
              : `<span class="btn btn-disabled">แต้มไม่พอ</span>`
          }
        </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>ของรางวัล</title>
<style>
  body { font-family: sans-serif; background: #f7f8fa; margin: 0; padding: 24px; color: #1b1f27; }
  .card { background: white; border-radius: 16px; padding: 24px; max-width: 480px; margin: 0 auto; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .balance { font-size: 28px; font-weight: 700; color: #06c755; margin: 8px 0 20px; }
  .reward { display: flex; justify-content: space-between; align-items: center; padding: 14px 0; border-bottom: 1px solid #f0f0f0; }
  .reward.disabled { opacity: 0.5; }
  .reward-name { font-weight: 600; }
  .reward-cost { font-size: 13px; color: #6b7280; }
  .btn { background: #06c755; color: white; text-decoration: none; padding: 8px 16px; border-radius: 8px; font-size: 14px; }
  .btn-disabled { background: #e5e7eb; color: #9ca3af; padding: 8px 16px; border-radius: 8px; font-size: 14px; }
</style>
</head>
<body>
  <div class="card">
    <p style="color:#6b7280; margin:0;">แต้มของฉัน</p>
    <p class="balance">${member.points_balance.toLocaleString()} แต้ม</p>
    ${items || '<p style="color:#6b7280;">ยังไม่มีของรางวัลตอนนี้</p>'}
  </div>
</body>
</html>`;
}

function renderRedeemSuccessPage(reward, code, newBalance) {
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>แลกสำเร็จ</title>
<style>
  body { font-family: sans-serif; background: #f7f8fa; margin: 0; padding: 24px; color: #1b1f27; text-align: center; }
  .card { background: white; border-radius: 16px; padding: 32px 24px; max-width: 420px; margin: 40px auto 0; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .code { font-size: 40px; font-weight: 700; letter-spacing: 6px; color: #06c755; margin: 16px 0; }
  .hint { color: #6b7280; font-size: 14px; margin-top: 16px; }
</style>
</head>
<body>
  <div class="card">
    <p>แลก <strong>${reward.name}</strong> สำเร็จ</p>
    <p class="code">${code}</p>
    <p class="hint">โชว์โค้ดนี้ให้พนักงานหน้าร้าน เพื่อรับของรางวัล</p>
    <p class="hint">แต้มคงเหลือ: ${newBalance.toLocaleString()} แต้ม</p>
  </div>
</body>
</html>`;
}

function renderErrorPage(title, message) {
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<style>
  body { font-family: sans-serif; background: #f7f8fa; margin: 0; padding: 24px; color: #1b1f27; text-align: center; }
  .card { background: white; border-radius: 16px; padding: 32px 24px; max-width: 420px; margin: 40px auto 0; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
</style>
</head>
<body>
  <div class="card">
    <p style="font-size:18px; font-weight:700;">${title}</p>
    <p style="color:#6b7280;">${message}</p>
  </div>
</body>
</html>`;
}

function renderPointsPage(member, history) {
  const rows = history
    .map(
      (h) => `
        <tr>
          <td>${new Date(h.created_at).toLocaleString('th-TH')}</td>
          <td>${h.creative_id || '-'}</td>
          <td style="text-align:right; color:#1baf7a;">+${h.points}</td>
        </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>แต้มสะสมของฉัน</title>
<style>
  body { font-family: sans-serif; background: #f7f8fa; margin: 0; padding: 24px; color: #1b1f27; }
  .card { background: white; border-radius: 16px; padding: 24px; max-width: 480px; margin: 0 auto; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .balance { font-size: 40px; font-weight: 700; color: #06c755; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px; }
  th { text-align: left; color: #6b7280; font-weight: 500; padding: 6px 4px; border-bottom: 1px solid #e5e7eb; }
  td { padding: 8px 4px; border-bottom: 1px solid #f0f0f0; }
</style>
</head>
<body>
  <div class="card">
    <p style="color:#6b7280; margin:0;">แต้มสะสมของฉัน${member.display_name ? ` — ${member.display_name}` : ''}</p>
    <p class="balance">${member.points_balance.toLocaleString()} แต้ม</p>
    <h3 style="margin-top:24px;">ประวัติล่าสุด</h3>
    <table>
      <tr><th>วันที่</th><th>ที่มา</th><th style="text-align:right;">แต้ม</th></tr>
      ${rows || '<tr><td colspan="3" style="color:#6b7280;">ยังไม่มีประวัติ</td></tr>'}
    </table>
  </div>
</body>
</html>`;
}
