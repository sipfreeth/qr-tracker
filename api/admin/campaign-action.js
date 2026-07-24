// api/admin/campaign-action.js
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
    if (!requirePermission(res, admin.role, 'create_campaign')) return;
    await supabase.from('creatives').insert({
      creative_id: params.get('creative_id'),
      destination_url: params.get('destination_url'),
    });
  }

  if (action === 'update') {
    if (!requirePermission(res, admin.role, 'edit_campaign')) return;
    await supabase
      .from('creatives')
      .update({ destination_url: params.get('destination_url') })
      .eq('creative_id', params.get('creative_id'));
  }

  if (action === 'toggle') {
    if (!requirePermission(res, admin.role, 'toggle_campaign')) return;
    const { data: c } = await supabase
      .from('creatives')
      .select('active')
      .eq('creative_id', params.get('creative_id'))
      .single();
    if (c) {
      await supabase.from('creatives').update({ active: !c.active }).eq('creative_id', params.get('creative_id'));
    }
  }

  if (action === 'delete') {
    if (!requirePermission(res, admin.role, 'delete_campaign')) return;
    await supabase.from('creatives').delete().eq('creative_id', params.get('creative_id'));
  }

  res.writeHead(302, { Location: '/api/admin/campaigns' });
  res.end();
}
