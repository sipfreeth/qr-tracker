// api/redeem/confirm.js
//
// รับข้อมูลจากฟอร์มที่อยู่จัดส่ง (หลังกดแลกของรางวัลใน callback.js)
// เช็ค token, เช็คแต้มอีกครั้ง (กันแต้มเปลี่ยนระหว่างกรอกฟอร์ม), หักแต้ม, บันทึกที่อยู่
// สถานะการแลกตั้งเป็น 'used' ทันที (ไม่มี pending) ส่วนสถานะจัดส่งเริ่มที่ 'not_shipped'
// และบันทึกที่อยู่นี้เก็บสะสมไว้ในประวัติของสมาชิกด้วย (member_addresses)

import { supabase } from '../../lib/supabaseClient.js';
import { verifyRedeemToken } from '../../lib/memberToken.js';
import { getCurrentYearStart } from '../../lib/tiers.js';

async function getSpendableBalance(memberId) {
  const yearStart = getCurrentYearStart();
  const [earnedRes, spentRes] = await Promise.all([
    supabase.from('points_ledger').select('reward_points').eq('member_id', memberId).gte('created_at', yearStart),
    supabase.from('redemptions').select('points_spent').eq('member_id', memberId).gte('created_at', yearStart),
  ]);
  const earned = (earnedRes.data || []).reduce((sum, row) => sum + row.reward_points, 0);
  const spent = (spentRes.data || []).reduce((sum, row) => sum + row.points_spent, 0);
  return earned - spent;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  let body = '';
  for await (const chunk of req) body += chunk;
  const params = new URLSearchParams(body);

  const tokenData = verifyRedeemToken(params.get('token'));
  if (!tokenData) {
    res.status(400).send('ลิงก์หมดอายุหรือไม่ถูกต้อง กรุณากลับไปกดแลกของรางวัลใหม่อีกครั้ง');
    return;
  }

  const { memberId, rewardId } = tokenData;
  const recipientName = params.get('recipient_name');
  const recipientPhone = params.get('recipient_phone');
  const recipientAddress = params.get('recipient_address');

  if (!recipientName || !recipientPhone || !recipientAddress) {
    res.status(400).send('กรุณากรอกข้อมูลให้ครบ');
    return;
  }

  const { data: reward } = await supabase.from('rewards').select('id, name, points_cost').eq('id', rewardId).single();
  if (!reward) {
    res.status(404).send('ไม่พบของรางวัลนี้');
    return;
  }

  // เช็คแต้มอีกครั้ง เผื่อระหว่างกรอกฟอร์มมีการใช้แต้มที่อื่นไปแล้ว
  const spendableBalance = await getSpendableBalance(memberId);
  if (spendableBalance < reward.points_cost) {
    res.status(200).send('แต้มไม่พอแล้ว (อาจมีการใช้แต้มไปที่อื่นระหว่างที่กรอกฟอร์ม) กรุณาลองใหม่');
    return;
  }

  const redemptionCode = Math.floor(100000 + Math.random() * 900000).toString();

  const [{ error }] = await Promise.all([
    supabase.from('redemptions').insert({
      member_id: memberId,
      reward_id: reward.id,
      points_spent: reward.points_cost,
      redemption_code: redemptionCode,
      status: 'used',
      used_at: new Date().toISOString(),
      shipping_status: 'not_shipped',
      recipient_name: recipientName,
      recipient_phone: recipientPhone,
      recipient_address: recipientAddress,
    }),
    // เก็บที่อยู่นี้ไว้ในประวัติของสมาชิกด้วย เผื่อใช้ซ้ำครั้งหน้า
    supabase.from('member_addresses').insert({
      member_id: memberId,
      recipient_name: recipientName,
      recipient_phone: recipientPhone,
      recipient_address: recipientAddress,
    }),
  ]);

  if (error) {
    res.status(500).send('เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(renderSuccessPage(reward, spendableBalance - reward.points_cost));
}

function renderSuccessPage(reward, newBalance) {
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>แลกสำเร็จ</title>
<style>
  body { font-family: sans-serif; background: #f7f8fa; margin: 0; padding: 24px; color: #1b1f27; text-align: center; }
  .card { background: white; border-radius: 16px; padding: 32px 24px; max-width: 420px; margin: 40px auto 0; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .hint { color: #6b7280; font-size: 14px; margin-top: 12px; }
</style>
</head>
<body>
  <div class="card">
    <p style="font-size:20px;">🎉</p>
    <p>แลก <strong>${reward.name}</strong> สำเร็จ</p>
    <p class="hint">ทีมงานจะจัดส่งของรางวัลไปตามที่อยู่ที่แจ้งไว้เร็วๆ นี้</p>
    <p class="hint">Point คงเหลือ: ${newBalance.toLocaleString()}</p>
  </div>
</body>
</html>`;
}
