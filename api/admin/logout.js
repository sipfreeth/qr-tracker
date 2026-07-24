// api/admin/logout.js
import { clearSessionCookie } from '../../lib/adminAuth.js';

export default async function handler(req, res) {
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.writeHead(302, { Location: '/api/admin/login' });
  res.end();
}
