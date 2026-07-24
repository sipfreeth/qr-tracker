// api/admin/reward-action.js
//
// action=create, update, toggle, delete
// create/toggle: super_admin, admin, staff ทำได้
// update/delete: super_admin, admin เท่านั้น (staff ทำไม่ได้)

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

  if (action === 'create') {
    if (!requirePermission(res, admin.role, 'create_reward')) return;
    await supabase.from('rewards').insert({
      name: params.get('name'),
      points_cost: Number(params.get('points_cost')),
    });
  }

  if (action === 'update') {
    if (!requirePermission(res, admin.role, 'edit_reward')) return;
    await supabase
      .from('rewards')
      .update({ name: params.get('name'), points_cost: Number(params.get('points_cost')) })
      .eq('id', params.get('id'));
  }

  if (action === 'toggle') {
    if (!requirePermission(res, admin.role, 'toggle_reward')) return;
    const { data: reward } = await supabase.from('rewards').select('active').eq('id', params.get('id')).single();
    if (reward) {
      await supabase.from('rewards').update({ active: !reward.active }).eq('id', params.get('id'));
    }
  }

  if (action === 'delete') {
    if (!requirePermission(res, admin.role, 'delete_reward')) return;
    await supabase.from('rewards').delete().eq('id', params.get('id'));
  }

  res.writeHead(302, { Location: '/api/admin/rewards' });
  res.end();
}
