// api/admin/[page].js
//
// หน้า Admin รวมทุกฟังก์ชันไว้ที่เดียว สลับด้วยแท็บเมนู:
//   /api/admin/dashboard  — สรุปยอดแคมเปญ + รอยืนยัน Redemption
//   /api/admin/members    — รายชื่อสมาชิก + filter ตาม Tier
//   /api/admin/rewards    — จัดการของรางวัล (เพิ่ม/แก้/เปิดปิด)
//   /api/admin/campaigns  — จัดการ Campaign/creative (เพิ่ม/แก้ปลายทาง QR)
//
// ต้อง login ก่อนถึงจะเข้าได้ (เช็คผ่าน lib/adminAuth.js)

import { createClient } from '@supabase/supabase-js';
import { getTier, TIERS, getTierEvaluationPeriod, getCurrentYearStart } from '../../lib/tiers.js';
import { requireAdmin } from '../../lib/adminAuth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PAGES = ['dashboard', 'members', 'rewards', 'campaigns'];

export default async function handler(req, res) {
  const username = requireAdmin(req, res);
  if (!username) return; // requireAdmin จัดการ redirect ไปหน้า login ให้แล้ว

  const page = PAGES.includes(req.query.page) ? req.query.page : 'dashboard';

  let content = '';
  if (page === 'dashboard') content = await renderDashboardTab(req.query.tier || null);
  if (page === 'members') content = await renderMembersTab(req.query.tier || null);
  if (page === 'rewards') content = await renderRewardsTab();
  if (page === 'campaigns') content = await renderCampaignsTab();

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(renderLayout(page, username, content));
}

// ---------- Dashboard tab ----------
async function renderDashboardTab() {
  const [scanLogsRes, membersRes, redemptionsRes] = await Promise.all([
    supabase.from('scan_logs').select('creative_id, scanned_at'),
    supabase.from('members').select('id'),
    supabase
      .from('redemptions')
      .select('id, redemption_code, points_spent, status, created_at, rewards(name), members(display_name, line_user_id)')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const scanLogs = scanLogsRes.data || [];
  const totalMembers = (membersRes.data || []).length;
  const redemptions = redemptionsRes.data || [];

  const scansByCreative = {};
  const today = new Date().toDateString();
  let scansToday = 0;
  for (const row of scanLogs) {
    scansByCreative[row.creative_id] = (scansByCreative[row.creative_id] || 0) + 1;
    if (new Date(row.scanned_at).toDateString() === today) scansToday++;
  }

  const pendingCount = redemptions.filter((r) => r.status === 'pending').length;

  const creativeRows = Object.entries(scansByCreative)
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => `<tr><td>${id}</td><td style="text-align:right;">${count}</td></tr>`)
    .join('');

  const redemptionRows = redemptions
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

  return `
    <div class="grid">
      <div class="card"><p class="label">สแกนทั้งหมด</p><p class="value">${scanLogs.length.toLocaleString()}</p></div>
      <div class="card"><p class="label">สแกนวันนี้</p><p class="value">${scansToday.toLocaleString()}</p></div>
      <div class="card"><p class="label">สมาชิกทั้งหมด</p><p class="value">${totalMembers.toLocaleString()}</p></div>
      <div class="card"><p class="label">รอยืนยัน Redemption</p><p class="value" style="color:${pendingCount > 0 ? '#e76f51' : '#1b1f27'};">${pendingCount}</p></div>
    </div>

    <div class="section">
      <h2>ยอดสแกนแยกตาม Campaign</h2>
      <table>
        <tr><th>Creative</th><th style="text-align:right;">จำนวนสแกน</th></tr>
        ${creativeRows || '<tr><td colspan="2" class="muted">ยังไม่มีข้อมูล</td></tr>'}
      </table>
    </div>

    <div class="section">
      <h2>ประวัติการแลกของรางวัล (50 รายการล่าสุด)</h2>
      <table>
        <tr><th>วันที่</th><th>สมาชิก</th><th>ของรางวัล</th><th style="text-align:center;">โค้ด</th><th style="text-align:right;">Point</th><th style="text-align:center;">สถานะ</th></tr>
        ${redemptionRows || '<tr><td colspan="6" class="muted">ยังไม่มีการแลก</td></tr>'}
      </table>
    </div>`;
}

// ---------- Members tab ----------
async function renderMembersTab(tierFilter) {
  const yearStart = getCurrentYearStart();
  const [membersRes, ledgerRes, redemptionsRes] = await Promise.all([
    supabase.from('members').select('id, line_user_id, display_name, created_at'),
    supabase.from('points_ledger').select('member_id, tier_score, reward_points, created_at').eq('reason', 'scan_qr'),
    supabase.from('redemptions').select('member_id, points_spent, created_at'),
  ]);

  const members = membersRes.data || [];
  const ledger = ledgerRes.data || [];
  const redemptions = redemptionsRes.data || [];

  const spentThisYearByMember = {};
  for (const r of redemptions) {
    if (new Date(r.created_at) >= new Date(yearStart)) {
      spentThisYearByMember[r.member_id] = (spentThisYearByMember[r.member_id] || 0) + r.points_spent;
    }
  }

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

  const filtered = tierFilter ? membersWithStats.filter((m) => m.tier.name === tierFilter) : membersWithStats;

  const tierPills = TIERS.map((t) => {
    const isActive = tierFilter === t.name;
    return `
      <a href="/api/admin/members?tier=${encodeURIComponent(t.name)}" class="stat-pill" style="border-color:${t.color}; ${isActive ? `background:${t.color}1a;` : ''}">
        <span style="color:${t.color};">${t.name}</span>
        <strong>${tierCounts[t.name] || 0}</strong>
      </a>`;
  }).join('');

  const clearFilter = tierFilter ? `<a href="/api/admin/members" class="clear-filter">ล้างฟิลเตอร์</a>` : '';

  const rows = filtered
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

  return `
    <div class="section">
      <h2>สมาชิกแยกตาม Tier</h2>
      <p class="hint">Tier ปีนี้ล็อกจากยอด Tier Score ของปีที่แล้ว — กดป้ายเพื่อกรอง</p>
      <div>${tierPills}${clearFilter}</div>
    </div>
    <div class="section">
      <h2>รายชื่อสมาชิก${tierFilter ? ` — Tier ${tierFilter}` : ''}</h2>
      <p class="hint">${filtered.length.toLocaleString()} คน</p>
      <table>
        <tr><th>ชื่อ</th><th>Tier</th><th style="text-align:right;">Tier Score</th><th style="text-align:right;">Point คงเหลือ</th><th>สมัครเมื่อ</th></tr>
        ${rows || '<tr><td colspan="5" class="muted">ไม่มีสมาชิกในกลุ่มนี้</td></tr>'}
      </table>
    </div>`;
}

// ---------- Rewards tab ----------
async function renderRewardsTab() {
  const { data: rewards } = await supabase.from('rewards').select('id, name, points_cost, active').order('id');

  const rows = (rewards || [])
    .map(
      (r) => `
        <tr>
          <td>
            <form method="POST" action="/api/admin/reward-action" class="inline-form">
              <input type="hidden" name="action" value="update" />
              <input type="hidden" name="id" value="${r.id}" />
              <input type="text" name="name" value="${r.name}" class="table-input" />
          </td>
          <td>
              <input type="number" name="points_cost" value="${r.points_cost}" class="table-input small" />
          </td>
          <td style="text-align:center;">
              <button class="btn-small">บันทึก</button>
            </form>
          </td>
          <td style="text-align:center;">
            <form method="POST" action="/api/admin/reward-action" class="inline-form">
              <input type="hidden" name="action" value="toggle" />
              <input type="hidden" name="id" value="${r.id}" />
              <button class="btn-small ${r.active ? '' : 'btn-muted'}">${r.active ? 'เปิดใช้อยู่' : 'ปิดใช้อยู่'}</button>
            </form>
          </td>
        </tr>`
    )
    .join('');

  return `
    <div class="section">
      <h2>เพิ่มของรางวัลใหม่</h2>
      <form method="POST" action="/api/admin/reward-action" class="stack-form">
        <input type="hidden" name="action" value="create" />
        <label>ชื่อของรางวัล</label>
        <input type="text" name="name" required />
        <label>ใช้กี่ Point</label>
        <input type="number" name="points_cost" required min="1" />
        <button type="submit" class="btn-primary">เพิ่มของรางวัล</button>
      </form>
    </div>
    <div class="section">
      <h2>รายการของรางวัลทั้งหมด</h2>
      <table>
        <tr><th>ชื่อ</th><th>Point</th><th style="text-align:center;"></th><th style="text-align:center;">สถานะ</th></tr>
        ${rows || '<tr><td colspan="4" class="muted">ยังไม่มีของรางวัล</td></tr>'}
      </table>
    </div>`;
}

// ---------- Campaigns tab ----------
async function renderCampaignsTab() {
  const { data: creatives } = await supabase.from('creatives').select('creative_id, destination_url').order('creative_id');

  const rows = (creatives || [])
    .map(
      (c) => `
        <tr>
          <td style="font-family:monospace;">${c.creative_id}</td>
          <td>
            <form method="POST" action="/api/admin/campaign-action" class="inline-form">
              <input type="hidden" name="action" value="update" />
              <input type="hidden" name="creative_id" value="${c.creative_id}" />
              <input type="text" name="destination_url" value="${c.destination_url}" class="table-input" />
          </td>
          <td style="text-align:center;">
              <button class="btn-small">บันทึก</button>
            </form>
          </td>
        </tr>`
    )
    .join('');

  return `
    <div class="section">
      <h2>เพิ่ม Campaign ใหม่</h2>
      <form method="POST" action="/api/admin/campaign-action" class="stack-form">
        <input type="hidden" name="action" value="create" />
        <label>Campaign ID (ใช้ในลิงก์ QR เช่น brandA-video)</label>
        <input type="text" name="creative_id" required pattern="[a-zA-Z0-9\\-_]+" />
        <label>URL ปลายทาง</label>
        <input type="url" name="destination_url" required placeholder="https://..." />
        <button type="submit" class="btn-primary">เพิ่ม Campaign</button>
      </form>
    </div>
    <div class="section">
      <h2>Campaign ทั้งหมด</h2>
      <p class="hint">แก้ URL ปลายทางแล้วกดบันทึกที่แถวนั้นได้เลย</p>
      <table>
        <tr><th>Campaign ID</th><th>URL ปลายทาง</th><th></th></tr>
        ${rows || '<tr><td colspan="3" class="muted">ยังไม่มี Campaign</td></tr>'}
      </table>
    </div>`;
}

// ---------- Layout ----------
function renderLayout(activePage, username, content) {
  const tabs = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'members', label: 'Members' },
    { key: 'rewards', label: 'Rewards' },
    { key: 'campaigns', label: 'Campaigns' },
  ];

  const nav = tabs
    .map(
      (t) => `<a href="/api/admin/${t.key}" class="tab ${activePage === t.key ? 'active' : ''}">${t.label}</a>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Admin — ${activePage}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: sans-serif; background: #f7f8fa; margin: 0; color: #1b1f27; }
  header { background: white; border-bottom: 1px solid #e5e7eb; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; }
  .brand { font-weight: 700; padding: 16px 0; }
  nav { display: flex; gap: 4px; }
  .tab { padding: 16px 12px; text-decoration: none; color: #6b7280; font-size: 14px; border-bottom: 2px solid transparent; }
  .tab.active { color: #1b1f27; font-weight: 700; border-bottom-color: #1b1f27; }
  .user-info { display: flex; align-items: center; gap: 12px; font-size: 13px; color: #6b7280; }
  .logout-link { color: #e76f51; text-decoration: none; }
  main { padding: 24px; max-width: 960px; margin: 0 auto; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { background: white; border-radius: 12px; padding: 16px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
  .card .label { font-size: 13px; color: #6b7280; margin: 0 0 4px; }
  .card .value { font-size: 28px; font-weight: 700; margin: 0; }
  .section { background: white; border-radius: 12px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
  h2 { font-size: 16px; margin: 0 0 4px; }
  .hint, .muted { font-size: 12px; color: #9ca3af; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 8px; }
  th { text-align: left; color: #6b7280; font-weight: 500; padding: 6px 4px; border-bottom: 1px solid #e5e7eb; }
  td { padding: 8px 4px; border-bottom: 1px solid #f0f0f0; }
  .stat-pill { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; border: 1.5px solid; border-radius: 10px; padding: 8px 16px; margin-right: 8px; font-size: 13px; font-weight: 600; text-decoration: none; }
  .clear-filter { font-size: 12px; color: #2a78d6; margin-left: 8px; }
  .btn-small { background: #06c755; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; }
  .btn-muted { background: #9ca3af; }
  .btn-primary { background: #1b1f27; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; cursor: pointer; margin-top: 8px; }
  .badge-used { color: #9ca3af; font-size: 12px; }
  .tier-tag { color: white; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 999px; }
  .inline-form { display: contents; }
  .stack-form { display: flex; flex-direction: column; max-width: 400px; }
  .stack-form label { font-size: 13px; color: #6b7280; margin: 10px 0 4px; }
  .stack-form input { padding: 8px 10px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 14px; }
  .table-input { width: 100%; padding: 6px 8px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 13px; }
  .table-input.small { width: 80px; }
</style>
</head>
<body>
  <header>
    <div class="brand">${'QR Tracker Admin'}</div>
    <nav>${nav}</nav>
    <div class="user-info">
      <span>${username}</span>
      <a href="/api/admin/logout" class="logout-link">Logout</a>
    </div>
  </header>
  <main>${content}</main>
</body>
</html>`;
}
