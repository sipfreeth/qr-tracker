// api/admin/member-action.js
//
// action=adjust: เพิ่ม/ลด Tier Score หรือ Point ให้สมาชิกด้วยมือ (บันทึกเป็นประวัติ ไม่ใช่แก้ตัวเลขตรงๆ)
// action=delete: ลบสมาชิก — ต้องส่ง confirm=yes มาด้วยเท่านั้นถึงจะลบจริง (การ์ดยืนยันชั้นที่ 2 อยู่ใน UI)
// ทั้งหมดนี้ super_admin และ admin เท่านั้นที่ทำได้ staff ห้ามแตะ

import { supabase } from '../../lib/supabaseClient.js';
import { requireAdmin, requirePermission } from '../../lib/adminAuth.js';

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
  const action = params.get('action');
  const memberId = params.get('member_id');

  if (action === 'adjust') {
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

  if (action === 'delete') {
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

  res.status(400).send('ไม่รู้จัก action นี้');
}
