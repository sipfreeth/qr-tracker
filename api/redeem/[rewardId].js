// api/redeem/[rewardId].js
//
// URL: https://your-project.vercel.app/api/redeem/3  (3 คือ id ของของรางวัลในตาราง rewards)
// กดจากปุ่ม "แลก" ในหน้ารายการของรางวัล — ล็อกอิน LINE ซ้ำเพื่อยืนยันตัวตน
// แล้ว callback.js จะเช็คแต้มและหักแต้มให้จริง

export default async function handler(req, res) {
  const { rewardId } = req.query;

  const state = Buffer.from(
    JSON.stringify({ action: 'redeem', rewardId })
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
