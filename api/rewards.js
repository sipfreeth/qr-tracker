// api/rewards.js
//
// URL: https://your-project.vercel.app/api/rewards
// ลิงก์ "ดูของรางวัล" — ล็อกอิน LINE แล้ว callback.js จะโชว์รายการของรางวัลให้เลือกแลก

export default async function handler(req, res) {
  const state = Buffer.from(
    JSON.stringify({ action: 'view_rewards' })
  ).toString('base64url');

  const lineAuthUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
  lineAuthUrl.searchParams.set('response_type', 'code');
  lineAuthUrl.searchParams.set('client_id', process.env.LINE_CHANNEL_ID);
  lineAuthUrl.searchParams.set('redirect_uri', process.env.LINE_CALLBACK_URL);
  lineAuthUrl.searchParams.set('state', state);
  lineAuthUrl.searchParams.set('scope', 'profile openid');

  res.writeHead(302, { Location: lineAuthUrl.toString() });
  res.end();
}
