// api/admin/campaign-action.js
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
    await supabase.from('creatives').insert({
      creative_id: params.get('creative_id'),
      destination_url: params.get('destination_url'),
    });
  }

  if (action === 'update') {
    await supabase
      .from('creatives')
      .update({ destination_url: params.get('destination_url') })
      .eq('creative_id', params.get('creative_id'));
  }

  res.writeHead(302, { Location: '/api/admin/campaigns' });
  res.end();
}
