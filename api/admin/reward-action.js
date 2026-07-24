// api/admin/reward-action.js
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../../lib/adminAuth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  let body = '';
  for await (const chunk of req) body += chunk;
  const params = new URLSearchParams(body);
  const action = params.get('action');

  if (action === 'create') {
    await supabase.from('rewards').insert({
      name: params.get('name'),
      points_cost: Number(params.get('points_cost')),
    });
  }

  if (action === 'update') {
    await supabase
      .from('rewards')
      .update({
        name: params.get('name'),
        points_cost: Number(params.get('points_cost')),
      })
      .eq('id', params.get('id'));
  }

  if (action === 'toggle') {
    const { data: reward } = await supabase.from('rewards').select('active').eq('id', params.get('id')).single();
    if (reward) {
      await supabase.from('rewards').update({ active: !reward.active }).eq('id', params.get('id'));
    }
  }

  res.writeHead(302, { Location: '/api/admin/rewards' });
  res.end();
}
