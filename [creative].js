// api/qr/[creative].js
//
// URL รูปแบบ: https://your-project.vercel.app/api/qr/creativeA
// ทำ 2 อย่าง:
//   1. บันทึก log ลง Supabase (creative_id, timestamp, screen_id ถ้ามี)
//   2. Redirect คนไปหน้าโปรโมชั่นจริงของลูกค้า

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  const { creative } = req.query;
  const screenId = req.query.screen || null; // เผื่ออยากส่ง ?screen=LOBBY-A-01 มาด้วย

  // ดึงปลายทางจากตาราง creatives แทนการเขียนตายตัวในโค้ด
  // แก้/เพิ่ม creative ใหม่ได้จากหน้า Table Editor โดยไม่ต้อง deploy ใหม่
  const { data, error } = await supabase
    .from('creatives')
    .select('destination_url')
    .eq('creative_id', creative)
    .single();

  if (error || !data) {
    res.status(404).send('ไม่พบ creative นี้');
    return;
  }

  const destination = data.destination_url;

  // บันทึก log — ถ้าบันทึกไม่สำเร็จก็ยัง redirect ต่อ ไม่ให้คนสแกนรอ/เจอหน้า error
  try {
    await supabase.from('scan_logs').insert({
      creative_id: creative,
      screen_id: screenId,
      scanned_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('บันทึก log ไม่สำเร็จ:', err);
  }

  res.writeHead(302, { Location: destination });
  res.end();
}
