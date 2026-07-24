// api/admin/dashboard.js
//
// URL: https://your-project.vercel.app/api/admin/dashboard
// ป้องกันด้วย Basic Auth (username อะไรก็ได้ / password = ADMIN_PASSWORD ที่ตั้งไว้ใน Env Variables)
//
// เพิ่ม ?tier=Gold ต่อท้าย URL เพื่อดูเฉพาะสมาชิก Tier นั้น

import { createClient } from '@supabase/supabase-js';
import { getTier, TIERS, getTierEvaluationPeriod, getCurrentYearStart } from '../../lib/tiers.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function checkAuth(req) {
  const header = req.headers.authorization || '';
  const [, base64] = header.split(' ');
  if (!base64) return false;
  const [, password] = Buffer.from(base64, 'base64').toString().split(':');
  return password === process.env.ADMIN_PASSWORD;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Dashboard"');
    res.status(401).send('ต้องล็อกอินก่อนเข้าหน้านี้');
    return;
  }

  const tierFilter = req.query.tier || null;
  const yearStart = getCurrentYearStart();

  const [scanLogsRes, membersRes, redemptionsRes, allLedgerRes] = await Promise.all([
    supabase.from('scan_logs').select('creative_id, scanned_at'),
    supabase.from('members').select('id, line_user_id, display_name, created_at'),
    supabase
      .from('redemptions')
      .select('id, member_id, redemption_code, points_spent, status, created_at, rewards(name), members(display_name, line_user_id)')
      .order('created_at', { ascending: false })
      .limit(50),
    // ดึง ledger ทั้งหมดมาคำนวณเองในโค้ด (ง่ายกว่าคิว query แยกทีละคนเวลามีสมาชิกไม่เยอะ)
    supabase.from('points_ledger').select('member_id, tier_score, reward_points, created_at').eq('reason', 'scan_qr'),
  ]);

  const scanLogs = scanLogsRes.data || [];
  const members = membersRes.data || [];
  const redemptions = redemptionsRes.data || [];
  const ledger = allLedgerRes.data || [];

  // สรุปยอดสแกนแยกตาม creative
  const scansByCreative = {};
  const today = new Date().toDateString();
  let scansToday = 0;
  for (const row of scanLogs) {
    scansByCreative[row.creative_id] = (scansByCreative[row.creative_id] || 0) + 1;
    if (new Date(row.scanned_at).toDateString() === today) scansToday++;
  }

  // Point ที่ใช้ไปปีนี้ต่อสมาชิก (สำหรับคำนวณ Point คงเหลือ)
  const spentThisYearByMember = {};
  for (const r of redemptions) {
    if (new Date(r.created_at) >= new Date(yearStart)) {
      spentThisYearByMember[r.member_id] = (spentThisYearByMember[r.member_id] || 0) + r.points_spent;
    }
  }

  const totalTierScoreIssued = ledger.reduce((sum, row) => sum + row.tier_score, 0);
  const totalPointsIssued = ledger.reduce((sum, row) => sum + row.reward_points, 0);

  // คำนวณ Tier Score (ช่วงประเมิน) และ Point คงเหลือ (ปีนี้) ต่อสมาชิกแต่ละคน
  const membersWithStats = members.map((m) => {
    const { start, end } = getTierEvaluationPeriod(m.created_at);
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : null;

    let tierScore = 0;
    let pointsEarnedThisYear = 0;
    for (const row of ledger) {
      if (row.member_id !== m.id) continue;
      const rowDate = new Date(row.created_at);
      if (rowDate >= startDate && (!endDate || rowDate < endDate)) tierScore += row.tier_score;
      if (rowDate >= new Date(yearStart)) pointsEarnedThisYear += row.reward_points;
    }

    const spendableBalance = pointsEarnedThisYear - (spentThisYearByMember[m.id] || 0);
    return { ...m, tierScore, spendableBalance, tier: getTier(tierScore).current };
  });

  const tierCounts = Object.fromEntries(TIERS.map((t) => [t.name, 0]));
  for (const m of membersWithStats) tierCounts[m.tier.name]++;

  const pendingCount = redemptions.filter((r) => r.status === 'pending').length;
  const filteredMembers = tierFilter ? membersWithStats.filter((m) => m.tier.name === tierFilter) : membersWithStats;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(renderDashboard({
    totalScans: scanLogs.length,
    scansToday,
    scansByCreative,
    totalMembers: members.length,
    tierCounts,
    totalTierScoreIssued,
    totalPointsIssued,
    redemptions,
    pendingCount,
    members: filteredMembers,
    tierFilter,
  }));
}

function renderDashboard(d) {
  const creativeRows = Object.entries(d.scansByCreative)
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => `<tr><td>${id}</td><td style="text-align:right;">${count}</td></tr>`)
    .join('');

  const tierRows = TIERS.map((t) => {
    const isActive = d.tierFilter === t.name;
    return `
      <a href="/api/admin/dashboard?tier=${encodeURIComponent(t.name)}" class="stat-pill" style="border-color:${t.color}; ${isActive ? `background:${t.color}1a;` : ''}">
        <span style="color:${t.color};">${t.name}</span>
        <strong>${d.tierCounts[t.name] || 0}</strong>
      </a>`;
  }).join('');

  const clearFilterLink = d.tierFilter ? `<a href="/api/admin/dashboard" class="clear-filter">ล้างฟิลเตอร์ (ดูทั้งหมด)</a>` : '';

  const memberRows = d.members
    .sort((a, b) => b.tierScore - a.tierScore)
    .map(
      (m) => `
        <tr>
          <td>${m.display_name || m.line_user_id}</td>
          <td><span class="tier-tag" style="background:${m.tier.color};">${m.tier.name}</span></td>
          <td style="text-align:right;">${m.tierScore.toLocaleString()}</td>
          <td style="text-align:right;">${m.spendableBalance.toLocaleString()}</td>
          <td>${new Date(m.created_at).toLocaleDateString('th-TH')}</td>
        </tr>`
    )
    .join('');

  const redemptionRows = d.redemptions
    .map((r) => {
      const isPending = r.status === 'pending';
      return `
        <tr>
          <td>${new Date(r.created_at).toLocaleString('th-TH')}</td>
          <td>${r.members?.display_name || r.members?.line_user_id || '-'}</td>
          <td>${r.rewards?.name || '-'}</td>
          <td style="text-align:center; font-family:monospace;">${r.redemption_code}</td>
          <td style="text-align:right;">${r.points_spent}</td>
          <td style="text-align:center;">
            ${
              isPending
                ? `<form method="POST" action="/api/admin/mark-used" style="display:inline;">
                     <input type="hidden" name="code" value="${r.redemption_code}" />
                     <button class="btn-small">ยืนยันใช้แล้ว</button>
                   </form>`
                : `<span class="badge-used">ใช้แล้ว</span>`
            }
          </td>
        </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Dashboard</title>
<style>
  body { font-family: sans-serif; background: #f7f8fa; margin: 0; padding: 24px; color: #1b1f27; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { background: white; border-radius: 12px; padding: 16px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
  .card .label { font-size: 13px; color: #6b7280; margin: 0 0 4px; }
  .card .value { font-size: 28px; font-weight: 700; margin: 0; }
  .section { background: white; border-radius: 12px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
  h2 { font-size: 16px; margin: 0 0 4px; display: inline-block; }
  .hint { font-size: 12px; color: #9ca3af; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; color: #6b7280; font-weight: 500; padding: 6px 4px; border-bottom: 1px solid #e5e7eb; }
  td { padding: 8px 4px; border-bottom: 1px solid #f0f0f0; }
  .stat-pill { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; border: 1.5px solid; border-radius: 10px; padding: 8px 16px; margin-right: 8px; font-size: 13px; font-weight: 600; text-decoration: none; cursor: pointer; }
  .btn-small { background: #06c755; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; }
  .badge-used { color: #9ca3af; font-size: 12px; }
  .tier-tag { color: white; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 999px; }
  .clear-filter { font-size: 12px; color: #2a78d6; margin-left: 8px; }
</style>
</head>
<body>
  <h1 style="font-size:20px;">Campaign Dashboard</h1>

  <div class="grid">
    <div class="card"><p class="label">สแกนทั้งหมด</p><p class="value">${d.totalScans.toLocaleString()}</p></div>
    <div class="card"><p class="label">สแกนวันนี้</p><p class="value">${d.scansToday.toLocaleString()}</p></div>
    <div class="card"><p class="label">สมาชิกทั้งหมด</p><p class="value">${d.totalMembers.toLocaleString()}</p></div>
    <div class="card"><p class="label">Tier Score ที่แจกไปทั้งหมด</p><p class="value">${d.totalTierScoreIssued.toLocaleString()}</p></div>
    <div class="card"><p class="label">Point ที่แจกไปทั้งหมด</p><p class="value">${d.totalPointsIssued.toLocaleString()}</p></div>
    <div class="card"><p class="label">รอยืนยัน Redemption</p><p class="value" style="color:${d.pendingCount > 0 ? '#e76f51' : '#1b1f27'};">${d.pendingCount}</p></div>
  </div>

  <div class="section">
    <h2>สมาชิกแยกตาม Tier</h2>
    <p class="hint">Tier ปีนี้ล็อกจากยอด Tier Score ของปีที่แล้ว (สมาชิกใหม่ปีนี้ใช้ยอดสะสมปัจจุบัน) — กดป้ายเพื่อดูรายชื่อ</p>
    <div>${tierRows}${clearFilterLink}</div>
  </div>

  <div class="section">
    <h2>รายชื่อสมาชิก${d.tierFilter ? ` — Tier ${d.tierFilter}` : ''}</h2>
    <p class="hint">${d.members.length.toLocaleString()} คน</p>
    <table>
      <tr><th>ชื่อ</th><th>Tier</th><th style="text-align:right;">Tier Score</th><th style="text-align:right;">Point คงเหลือ</th><th>สมัครเมื่อ</th></tr>
      ${memberRows || '<tr><td colspan="5" style="color:#6b7280;">ไม่มีสมาชิกในกลุ่มนี้</td></tr>'}
    </table>
  </div>

  <div class="section">
    <h2>ยอดสแกนแยกตาม Creative</h2>
    <table>
      <tr><th>Creative</th><th style="text-align:right;">จำนวนสแกน</th></tr>
      ${creativeRows || '<tr><td colspan="2" style="color:#6b7280;">ยังไม่มีข้อมูล</td></tr>'}
    </table>
  </div>

  <div class="section">
    <h2>ประวัติการแลกของรางวัล (50 รายการล่าสุด)</h2>
    <table>
      <tr><th>วันที่</th><th>สมาชิก</th><th>ของรางวัล</th><th style="text-align:center;">โค้ด</th><th style="text-align:right;">Point</th><th style="text-align:center;">สถานะ</th></tr>
      ${redemptionRows || '<tr><td colspan="6" style="color:#6b7280;">ยังไม่มีการแลก</td></tr>'}
    </table>
  </div>
</body>
</html>`;
}
