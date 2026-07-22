// api/auth/callback.js
//
// LINE จะ redirect กลับมาที่นี่หลังคนกดยินยอมล็อกอิน
// ทำ 3 อย่าง:
//   1. เอา code ที่ได้ไปแลก access token + ข้อมูลโปรไฟล์กับ LINE
//   2. บันทึก/อัปเดตสมาชิกในตาราง members แล้วบวกแต้ม
//   3. Redirect ไปหน้าโปรโมชั่นจริงตามที่ตั้งไว้

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

  let creative, destination;
  try {
    ({ creative, destination } = JSON.parse(
      Buffer.from(state, 'base64url').toString()
    ));
  } catch {
    res.status(400).send('state ไม่ถูกต้อง');
    return;
  }

  // ขั้นที่ 1: เอา code ไปแลก token กับ LINE
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

  // ID token เป็น JWT ที่มีข้อมูลโปรไฟล์อยู่ในนั้น (sub = LINE user id)
  const payload = JSON.parse(
    Buffer.from(tokenData.id_token.split('.')[1], 'base64url').toString()
  );
  const lineUserId = payload.sub;
  const displayName = payload.name || null;
  const pictureUrl = payload.picture || null;

  // ขั้นที่ 2: หาสมาชิกเดิม หรือสร้างใหม่ถ้ายังไม่เคยสแกน
  let { data: member } = await supabase
    .from('members')
    .select('id, points_balance')
    .eq('line_user_id', lineUserId)
    .single();

  if (!member) {
    const { data: newMember, error: insertError } = await supabase
      .from('members')
      .insert({ line_user_id: lineUserId, display_name: displayName, picture_url: pictureUrl })
      .select('id, points_balance')
      .single();

    if (insertError) {
      console.error('สร้างสมาชิกไม่สำเร็จ:', insertError);
      res.status(500).send('เกิดข้อผิดพลาด ลองสแกนใหม่อีกครั้ง');
      return;
    }
    member = newMember;
  }

  // ขั้นที่ 3: บวกแต้ม แล้วอัปเดตยอดสะสม
  await supabase.from('points_ledger').insert({
    member_id: member.id,
    creative_id: creative,
    points: POINTS_PER_SCAN,
    reason: 'scan_qr',
  });

  await supabase
    .from('members')
    .update({ points_balance: member.points_balance + POINTS_PER_SCAN })
    .eq('id', member.id);

  // ขั้นที่ 4: ไปหน้าโปรโมชั่นจริง พร้อมแนบยอดแต้มไปโชว์ได้ (ถ้าหน้านั้นรองรับ)
  const finalUrl = new URL(destination);
  finalUrl.searchParams.set('points', member.points_balance + POINTS_PER_SCAN);
  res.writeHead(302, { Location: finalUrl.toString() });
  res.end();
}
