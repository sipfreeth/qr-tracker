// api/admin/[page].js
//
// หน้า Admin รวมทุกฟังก์ชันไว้ที่เดียว สลับด้วยแท็บเมนู:
//   /api/admin/dashboard  — สรุปยอด + กราฟเทียบ Campaign + filter ดูตาม Campaign
//   /api/admin/members    — รายชื่อสมาชิก + filter ตาม Tier + ดูรายละเอียดรายคน (ประวัติ engagement/redemption)
//   /api/admin/rewards    — จัดการของรางวัล (เพิ่ม/แก้/เปิดปิด/ลบ)
//   /api/admin/campaigns  — จัดการ Campaign (เพิ่ม/แก้/เปิดปิด/ลบ)
//   /api/admin/admins     — จัดการบัญชีแอดมิน (super_admin เท่านั้น)
//
// ต้อง login ก่อนถึงจะเข้าได้ สิทธิ์แต่ละปุ่มเช็คตาม role (lib/adminAuth.js)

import { supabase } from '../../lib/supabaseClient.js';
import { getTier, TIERS, getTierEvaluationPeriod, getCurrentYearStart } from '../../lib/tiers.js';
import { requireAdmin, can } from '../../lib/adminAuth.js';
import { listOfficeAccounts, getOfficeAccount, getSlots, renderOfficeAreaContent } from '../../lib/officeArea.js';

const PAGES = ['dashboard', 'members', 'rewards', 'campaigns', 'admins', 'office'];

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  let page = PAGES.includes(req.query.page) ? req.query.page : 'dashboard';
  if (page === 'admins' && !can(admin.role, 'manage_admins')) page = 'dashboard'; // กันเข้าตรงๆ ผ่าน URL

  let content = '';
  if (page === 'dashboard') {
    const campaignsParam = req.query.campaigns;
    const filterCampaigns = campaignsParam ? (Array.isArray(campaignsParam) ? campaignsParam : [campaignsParam]) : [];
    content = await renderDashboardTab(filterCampaigns);
  }
  if (page === 'members') content = await renderMembersTab(admin, req.query.tier || null, req.query.detail || null);
  if (page === 'rewards') content = await renderRewardsTab(admin);
  if (page === 'campaigns') content = await renderCampaignsTab(admin, req);
  if (page === 'admins') content = await renderAdminsTab(admin);
  if (page === 'office') content = await renderOfficeTab(req.query.office_id || null);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(renderLayout(page, admin, content));
}

// ---------- Dashboard tab ----------
async function renderDashboardTab(filterCampaigns) {
  const [scanLogsRes, membersRes, redemptionsRes, creativesRes] = await Promise.all([
    supabase.from('scan_logs').select('creative_id, scanned_at'),
    supabase.from('members').select('id'),
    supabase
      .from('redemptions')
      .select('id, redemption_code, points_spent, status, shipping_status, created_at, recipient_name, recipient_phone, recipient_address, rewards(name), members(display_name, line_user_id)')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('creatives').select('creative_id').order('creative_id'),
  ]);

  const scanLogs = scanLogsRes.data || [];
  const totalMembers = (membersRes.data || []).length;
  const redemptions = redemptionsRes.data || [];
  const creativeIds = (creativesRes.data || []).map((c) => c.creative_id);

  // ขอบเขตช่วงเวลา: วันนี้ (เที่ยงคืน), สัปดาห์นี้ (จันทร์), เดือนนี้ (วันที่ 1)
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayOfWeek = (now.getDay() + 6) % 7; // จันทร์ = 0
  const weekStart = new Date(todayStart);
  weekStart.setDate(todayStart.getDate() - dayOfWeek);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // สรุปยอดสแกนแยกตาม creative x ช่วงเวลา (วันนี้/สัปดาห์นี้/เดือนนี้/ทั้งหมด — เป็นยอดสะสม ไม่ใช่แยกกันเป๊ะๆ)
  const statsByCreative = {};
  for (const id of creativeIds) statsByCreative[id] = { today: 0, week: 0, month: 0, all: 0 };
  for (const row of scanLogs) {
    if (!statsByCreative[row.creative_id]) statsByCreative[row.creative_id] = { today: 0, week: 0, month: 0, all: 0 };
    const s = statsByCreative[row.creative_id];
    const scannedAt = new Date(row.scanned_at);
    s.all++;
    if (scannedAt >= monthStart) s.month++;
    if (scannedAt >= weekStart) s.week++;
    if (scannedAt >= todayStart) s.today++;
  }
  const scansToday = Object.values(statsByCreative).reduce((sum, s) => sum + s.today, 0);

  const scansByCreative = {};
  for (const row of scanLogs) scansByCreative[row.creative_id] = (scansByCreative[row.creative_id] || 0) + 1;

  const notShippedCount = redemptions.filter((r) => r.status === 'used' && r.shipping_status === 'not_shipped').length;

  const chartLabels = Object.keys(scansByCreative);
  const chartValues = Object.values(scansByCreative);

  // ---------- ส่วนเปรียบเทียบหลาย Campaign พร้อมกัน (เลือกได้จาก checkbox) ----------
  const selected = filterCampaigns.filter((id) => creativeIds.includes(id));
  let comparisonHtml = '';
  let trendChartScript = '';

  if (selected.length > 0) {
    // ยอดพีค: วันไหนสแกนเยอะสุดของแต่ละ Campaign ที่เลือก
    const dailyCountByCreative = {}; // { creative_id: { 'YYYY-MM-DD': count } }
    for (const row of scanLogs) {
      if (!selected.includes(row.creative_id)) continue;
      const dateKey = new Date(row.scanned_at).toLocaleDateString('sv-SE'); // YYYY-MM-DD
      if (!dailyCountByCreative[row.creative_id]) dailyCountByCreative[row.creative_id] = {};
      dailyCountByCreative[row.creative_id][dateKey] = (dailyCountByCreative[row.creative_id][dateKey] || 0) + 1;
    }

    const peakRows = selected
      .map((id) => {
        const days = dailyCountByCreative[id] || {};
        let peakDate = '-';
        let peakCount = 0;
        for (const [date, count] of Object.entries(days)) {
          if (count > peakCount) {
            peakCount = count;
            peakDate = date;
          }
        }
        const total = scansByCreative[id] || 0;
        return `
          <tr>
            <td>${id}</td>
            <td style="text-align:right; font-weight:700;">${total.toLocaleString()}</td>
            <td style="text-align:right;">${peakCount.toLocaleString()}</td>
            <td>${peakDate !== '-' ? new Date(peakDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}</td>
          </tr>`;
      })
      .join('');

    // แนวโน้มรายสัปดาห์ ย้อนหลัง 8 สัปดาห์ (นับจากสัปดาห์นี้ถอยไป)
    const WEEKS_TO_SHOW = 8;
    const weekBuckets = [];
    for (let i = WEEKS_TO_SHOW - 1; i >= 0; i--) {
      const start = new Date(weekStart);
      start.setDate(weekStart.getDate() - i * 7);
      weekBuckets.push(start);
    }
    const weekLabels = weekBuckets.map((d) => d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }));

    const weeklySeriesByCreative = {};
    for (const id of selected) weeklySeriesByCreative[id] = new Array(WEEKS_TO_SHOW).fill(0);
    for (const row of scanLogs) {
      if (!selected.includes(row.creative_id)) continue;
      const scannedAt = new Date(row.scanned_at);
      for (let i = 0; i < WEEKS_TO_SHOW; i++) {
        const bucketStart = weekBuckets[i];
        const bucketEnd = new Date(bucketStart);
        bucketEnd.setDate(bucketStart.getDate() + 7);
        if (scannedAt >= bucketStart && scannedAt < bucketEnd) {
          weeklySeriesByCreative[row.creative_id][i]++;
          break;
        }
      }
    }

    const palette = ['#2a78d6', '#e76f51', '#06c755', '#d4a017', '#8b5cf6', '#0891b2', '#db2777', '#65a30d'];
    const trendDatasets = selected.map((id, i) => ({
      label: id,
      data: weeklySeriesByCreative[id],
      borderColor: palette[i % palette.length],
      backgroundColor: palette[i % palette.length] + '22',
      tension: 0.3,
      fill: false,
    }));

    comparisonHtml = `
      <div class="section">
        <h2>เปรียบเทียบ ${selected.length} Campaign ที่เลือก</h2>
        <table>
          <tr><th>Campaign</th><th style="text-align:right;">สแกนทั้งหมด</th><th style="text-align:right;">ยอดสูงสุดใน 1 วัน</th><th>วันที่ทำยอดสูงสุด</th></tr>
          ${peakRows}
        </table>
      </div>
      <div class="section">
        <h2>แนวโน้มรายสัปดาห์ (ย้อนหลัง ${WEEKS_TO_SHOW} สัปดาห์)</h2>
        <div style="position:relative; height:280px;"><canvas id="trendChart"></canvas></div>
      </div>`;

    trendChartScript = `
      new Chart(document.getElementById('trendChart'), {
        type: 'line',
        data: { labels: ${JSON.stringify(weekLabels)}, datasets: ${JSON.stringify(trendDatasets)} },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false } }
      });`;
  }

  const campaignCheckboxes = creativeIds
    .map(
      (id) =>
        `<label style="display:inline-flex; align-items:center; gap:4px; margin:4px 12px 4px 0; font-size:13px;">
          <input type="checkbox" name="campaigns" value="${id}" ${selected.includes(id) ? 'checked' : ''} /> ${id}
        </label>`
    )
    .join('');

  const periodRows = Object.entries(statsByCreative)
    .sort((a, b) => b[1].all - a[1].all)
    .map(
      ([id, s]) => `
        <tr>
          <td>${id}</td>
          <td style="text-align:right;">${s.today.toLocaleString()}</td>
          <td style="text-align:right;">${s.week.toLocaleString()}</td>
          <td style="text-align:right;">${s.month.toLocaleString()}</td>
          <td style="text-align:right; font-weight:700;">${s.all.toLocaleString()}</td>
        </tr>`
    )
    .join('');

  const redemptionRows = redemptions
    .map((r) => {
      const isPending = r.status === 'pending';
      const shippingInfo = r.recipient_name
        ? `<div>${r.recipient_name}</div><div class="hint">${r.recipient_phone || ''}</div><div class="hint">${r.recipient_address || ''}</div>`
        : '<span class="muted">-</span>';
      const shipToggle =
        r.status === 'used'
          ? `<form method="POST" action="/api/admin/action?action=redemption_ship_status" style="display:inline;">
               <input type="hidden" name="redemption_id" value="${r.id}" />
               <select name="shipping_status" class="table-input" style="width:auto; display:inline-block;" onchange="this.form.submit()">
                 <option value="not_shipped" ${r.shipping_status !== 'shipped' ? 'selected' : ''}>ยังไม่จัดส่ง</option>
                 <option value="shipped" ${r.shipping_status === 'shipped' ? 'selected' : ''}>จัดส่งแล้ว</option>
               </select>
             </form>`
          : '-';
      return `
        <tr>
          <td>${new Date(r.created_at).toLocaleString('th-TH')}</td>
          <td>${r.members?.display_name || r.members?.line_user_id || '-'}</td>
          <td>${r.rewards?.name || '-'}</td>
          <td style="text-align:right;">${r.points_spent}</td>
          <td style="max-width:200px;">${shippingInfo}</td>
          <td style="text-align:center;">
            ${
              isPending
                ? `<form method="POST" action="/api/admin/action?action=mark_used" style="display:inline;">
                     <input type="hidden" name="code" value="${r.redemption_code}" />
                     <button class="btn-small">ยืนยันใช้แล้ว</button>
                   </form>`
                : shipToggle
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
      <div class="card"><p class="label">รอจัดส่ง</p><p class="value" style="color:${notShippedCount > 0 ? '#e76f51' : '#1b1f27'};">${notShippedCount}</p></div>
    </div>

    <div class="section">
      <h2>เปรียบเทียบยอดสแกนแยกตาม Campaign</h2>
      <div style="position:relative; height:260px;"><canvas id="scanChart"></canvas></div>
    </div>

    <div class="section">
      <h2>เลือก Campaign เพื่อเปรียบเทียบ (เลือกได้หลายอัน)</h2>
      <p class="hint">เหมาะสำหรับเทียบหลายสาขา/สถานที่ของแบรนด์เดียวกัน</p>
      <form method="GET" action="/api/admin/dashboard">
        <div>${campaignCheckboxes || '<span class="muted">ยังไม่มี Campaign</span>'}</div>
        <button class="btn-small" type="submit" style="margin-top:12px;">เปรียบเทียบ</button>
        ${selected.length ? '<a href="/api/admin/dashboard" class="clear-filter">ล้างการเลือก</a>' : ''}
      </form>
    </div>

    ${comparisonHtml}

    <div class="section">
      <h2>ยอดสแกนแยกตาม Campaign — วันนี้ / สัปดาห์นี้ / เดือนนี้ / ทั้งหมด</h2>
      <table>
        <tr><th>Campaign</th><th style="text-align:right;">วันนี้</th><th style="text-align:right;">สัปดาห์นี้</th><th style="text-align:right;">เดือนนี้</th><th style="text-align:right;">ทั้งหมด</th></tr>
        ${periodRows || '<tr><td colspan="5" class="muted">ยังไม่มีข้อมูล</td></tr>'}
      </table>
    </div>

    <div class="section">
      <h2>ประวัติการแลกของรางวัล / สถานะจัดส่ง (50 รายการล่าสุด)</h2>
      <table>
        <tr><th>วันที่</th><th>สมาชิก</th><th>ของรางวัล</th><th style="text-align:right;">Point</th><th>ที่อยู่จัดส่ง</th><th style="text-align:center;">สถานะ</th></tr>
        ${redemptionRows || '<tr><td colspan="6" class="muted">ยังไม่มีการแลก</td></tr>'}
      </table>
    </div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
    <script>
      new Chart(document.getElementById('scanChart'), {
        type: 'bar',
        data: {
          labels: ${JSON.stringify(chartLabels)},
          datasets: [{ label: 'จำนวนสแกน', data: ${JSON.stringify(chartValues)}, backgroundColor: '#2a78d6', borderRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
      });
      ${trendChartScript}
    </script>`;
}

// ---------- Members tab ----------
async function renderMembersTab(admin, tierFilter, detailMemberId) {
  if (detailMemberId) return renderMemberDetail(admin, detailMemberId);

  const yearStart = getCurrentYearStart();
  const [membersRes, ledgerRes, redemptionsRes] = await Promise.all([
    supabase.from('members').select('id, line_user_id, display_name, created_at'),
    supabase.from('points_ledger').select('member_id, tier_score, reward_points, created_at'),
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
          <td><a href="/api/admin/members?detail=${m.id}" class="link">${m.display_name || m.line_user_id}</a></td>
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
      <p class="hint">${filtered.length.toLocaleString()} คน — คลิกชื่อเพื่อดูรายละเอียด</p>
      <table>
        <tr><th>ชื่อ</th><th>Tier</th><th style="text-align:right;">Tier Score</th><th style="text-align:right;">Point คงเหลือ</th><th>สมัครเมื่อ</th></tr>
        ${rows || '<tr><td colspan="5" class="muted">ไม่มีสมาชิกในกลุ่มนี้</td></tr>'}
      </table>
    </div>`;
}

// ---------- Member detail (ประวัติ engagement + redemption + form แก้ไข/ลบ) ----------
async function renderMemberDetail(admin, memberId) {
  const [memberRes, ledgerRes, redemptionsRes, addressesRes] = await Promise.all([
    supabase.from('members').select('id, line_user_id, display_name, created_at').eq('id', memberId).single(),
    supabase.from('points_ledger').select('creative_id, tier_score, reward_points, reason, created_at').eq('member_id', memberId).order('created_at', { ascending: false }),
    supabase.from('redemptions').select('id, points_spent, status, shipping_status, created_at, used_at, recipient_name, recipient_phone, recipient_address, rewards(name)').eq('member_id', memberId).order('created_at', { ascending: false }),
    supabase.from('member_addresses').select('recipient_name, recipient_phone, recipient_address, created_at').eq('member_id', memberId).order('created_at', { ascending: false }),
  ]);

  const member = memberRes.data;
  if (!member) return `<div class="section"><p>ไม่พบสมาชิกนี้</p></div>`;

  const ledger = ledgerRes.data || [];
  const redemptions = redemptionsRes.data || [];
  const addresses = addressesRes.data || [];
  const tierScore = ledger.reduce((s, r) => s + r.tier_score, 0);
  const { current } = getTier(tierScore);

  const engagementRows = ledger
    .map((r) => {
      const isAdjust = r.reason?.startsWith('admin_adjust');
      return `
        <tr>
          <td>${new Date(r.created_at).toLocaleString('th-TH')}</td>
          <td>${r.creative_id || (isAdjust ? '(แอดมินปรับ)' : '-')}</td>
          <td style="text-align:right;">${r.tier_score >= 0 ? '+' : ''}${r.tier_score}</td>
          <td style="text-align:right;">${r.reward_points >= 0 ? '+' : ''}${r.reward_points}</td>
        </tr>`;
    })
    .join('');

  const redemptionRows = redemptions
    .map((r) => {
      const shipBadge =
        r.status === 'used'
          ? `<form method="POST" action="/api/admin/action?action=redemption_ship_status" style="display:inline;">
               <input type="hidden" name="redemption_id" value="${r.id}" />
               <input type="hidden" name="back_to" value="/api/admin/members?detail=${memberId}" />
               <select name="shipping_status" class="table-input" style="width:auto; display:inline-block;" onchange="this.form.submit()">
                 <option value="not_shipped" ${r.shipping_status !== 'shipped' ? 'selected' : ''}>ยังไม่จัดส่ง</option>
                 <option value="shipped" ${r.shipping_status === 'shipped' ? 'selected' : ''}>จัดส่งแล้ว</option>
               </select>
             </form>`
          : 'รอใช้';
      return `
        <tr>
          <td>${new Date(r.created_at).toLocaleString('th-TH')}</td>
          <td>${r.rewards?.name || '-'}</td>
          <td style="text-align:right;">${r.points_spent}</td>
          <td>${r.recipient_name ? `${r.recipient_name}<br/><span class="hint">${r.recipient_phone || ''}</span><br/><span class="hint">${r.recipient_address || ''}</span>` : '-'}</td>
          <td style="text-align:center;">${shipBadge}</td>
        </tr>`;
    })
    .join('');

  const addressRows = addresses
    .map(
      (a) => `
        <tr>
          <td>${new Date(a.created_at).toLocaleDateString('th-TH')}</td>
          <td>${a.recipient_name}</td>
          <td>${a.recipient_phone}</td>
          <td>${a.recipient_address}</td>
        </tr>`
    )
    .join('');

  const canEditMember = can(admin.role, 'edit_member');
  const canDeleteMember = can(admin.role, 'delete_member');

  const adjustForm = canEditMember
    ? `
    <div class="section">
      <h2>ปรับ Tier Score / Point ด้วยมือ</h2>
      <form method="POST" action="/api/admin/action?action=member_adjust" class="stack-form">
        <input type="hidden" name="member_id" value="${member.id}" />
        <label>เพิ่ม/ลด Tier Score (ใส่ค่าติดลบเพื่อหัก)</label>
        <input type="number" name="tier_score_delta" value="0" />
        <label>เพิ่ม/ลด Point (ใส่ค่าติดลบเพื่อหัก)</label>
        <input type="number" name="points_delta" value="0" />
        <label>หมายเหตุ (ไม่บังคับ)</label>
        <input type="text" name="note" placeholder="เช่น ชดเชยระบบ error" />
        <button type="submit" class="btn-primary">บันทึก</button>
      </form>
    </div>`
    : '';

  const deleteForm = canDeleteMember
    ? `
    <div class="section">
      <h2 style="color:#e76f51;">ลบสมาชิกนี้</h2>
      <p class="hint">การลบไม่สามารถย้อนกลับได้ ประวัติทั้งหมดของสมาชิกคนนี้จะหายไป</p>
      <form method="POST" action="/api/admin/action?action=member_delete" onsubmit="return confirm('ยืนยันลบสมาชิกนี้ถาวร? ข้อมูลทั้งหมดจะกู้คืนไม่ได้')">
        <input type="hidden" name="member_id" value="${member.id}" />
        <label style="font-size:13px; display:flex; align-items:center; gap:6px; margin:8px 0;">
          <input type="checkbox" name="confirm" value="yes" required />
          ฉันเข้าใจว่าการลบนี้ถาวรและไม่สามารถกู้คืนได้
        </label>
        <button type="submit" class="btn-danger">ลบสมาชิกถาวร</button>
      </form>
    </div>`
    : '';

  return `
    <a href="/api/admin/members" class="link">&larr; กลับไปรายชื่อสมาชิก</a>
    <div class="section" style="margin-top:12px;">
      <h2>${member.display_name || member.line_user_id}</h2>
      <span class="tier-tag" style="background:${current.color};">${current.name}</span>
      <p class="hint" style="margin-top:8px;">สมัครเมื่อ ${new Date(member.created_at).toLocaleDateString('th-TH')}</p>
    </div>

    <div class="section">
      <h2>ประวัติ Engagement (Campaign ที่เคย engage)</h2>
      <table>
        <tr><th>วันที่</th><th>Campaign</th><th style="text-align:right;">Tier Score</th><th style="text-align:right;">Point</th></tr>
        ${engagementRows || '<tr><td colspan="4" class="muted">ยังไม่มีประวัติ</td></tr>'}
      </table>
    </div>

    <div class="section">
      <h2>ประวัติการแลก Reward</h2>
      <table>
        <tr><th>วันที่</th><th>ของรางวัล</th><th style="text-align:right;">Point</th><th>ที่อยู่จัดส่ง</th><th style="text-align:center;">สถานะจัดส่ง</th></tr>
        ${redemptionRows || '<tr><td colspan="5" class="muted">ยังไม่เคยแลก</td></tr>'}
      </table>
    </div>

    <div class="section">
      <h2>ที่อยู่ที่เคยใช้จัดส่ง</h2>
      <table>
        <tr><th>วันที่</th><th>ชื่อ</th><th>เบอร์โทร</th><th>ที่อยู่</th></tr>
        ${addressRows || '<tr><td colspan="4" class="muted">ยังไม่มีที่อยู่บันทึกไว้</td></tr>'}
      </table>
    </div>

    ${adjustForm}
    ${deleteForm}`;
}

// ---------- Rewards tab ----------
async function renderRewardsTab(admin) {
  const { data: rewards } = await supabase.from('rewards').select('id, name, points_cost, active').order('id');
  const canEdit = can(admin.role, 'edit_reward');
  const canDelete = can(admin.role, 'delete_reward');

  const rows = (rewards || [])
    .map((r) => {
      const editableCells = canEdit
        ? `
          <td>
            <form method="POST" action="/api/admin/action?action=reward_update" class="inline-form">
              <input type="hidden" name="id" value="${r.id}" />
              <input type="text" name="name" value="${r.name}" class="table-input" />
          </td>
          <td><input type="number" name="points_cost" value="${r.points_cost}" class="table-input small" /></td>
          <td style="text-align:center;"><button class="btn-small">บันทึก</button></form></td>`
        : `<td>${r.name}</td><td>${r.points_cost}</td><td></td>`;

      const deleteCell = canDelete
        ? `<td style="text-align:center;">
            <form method="POST" action="/api/admin/action?action=reward_delete" onsubmit="return confirm('ลบของรางวัลนี้?')" style="display:inline;">
              <input type="hidden" name="id" value="${r.id}" />
              <button class="btn-small btn-danger">ลบ</button>
            </form>
          </td>`
        : `<td></td>`;

      return `
        <tr>
          ${editableCells}
          <td style="text-align:center;">
            <form method="POST" action="/api/admin/action?action=reward_toggle" class="inline-form">
              <input type="hidden" name="id" value="${r.id}" />
              <button class="btn-small ${r.active ? '' : 'btn-muted'}">${r.active ? 'เปิดใช้อยู่' : 'ปิดใช้อยู่'}</button>
            </form>
          </td>
          ${deleteCell}
        </tr>`;
    })
    .join('');

  return `
    <div class="section">
      <h2>เพิ่มของรางวัลใหม่</h2>
      <form method="POST" action="/api/admin/action?action=reward_create" class="stack-form">
        <label>ชื่อของรางวัล</label>
        <input type="text" name="name" required />
        <label>ใช้กี่ Point</label>
        <input type="number" name="points_cost" required min="1" />
        <button type="submit" class="btn-primary">เพิ่มของรางวัล</button>
      </form>
    </div>
    <div class="section">
      <h2>รายการของรางวัลทั้งหมด</h2>
      ${!canEdit ? '<p class="hint">คุณดูและเปิด/ปิดใช้งานได้ แต่แก้ไข/ลบไม่ได้</p>' : ''}
      <table>
        <tr><th>ชื่อ</th><th>Point</th><th></th><th style="text-align:center;">สถานะ</th><th></th></tr>
        ${rows || '<tr><td colspan="5" class="muted">ยังไม่มีของรางวัล</td></tr>'}
      </table>
    </div>`;
}

// ---------- Campaigns tab ----------
async function renderCampaignsTab(admin, req) {
  const { data: creatives } = await supabase.from('creatives').select('creative_id, destination_url, active').order('creative_id');
  const canEdit = can(admin.role, 'edit_campaign');
  const canDelete = can(admin.role, 'delete_campaign');

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const baseUrl = `${proto}://${req.headers.host}`;

  const rows = (creatives || [])
    .map((c) => {
      const qrLink = `${baseUrl}/api/qr/${c.creative_id}`;
      const editableCells = canEdit
        ? `
          <td>
            <form method="POST" action="/api/admin/action?action=campaign_update" class="inline-form">
              <input type="hidden" name="creative_id" value="${c.creative_id}" />
              <input type="text" name="destination_url" value="${c.destination_url}" class="table-input" />
          </td>
          <td style="text-align:center;"><button class="btn-small">บันทึก</button></form></td>`
        : `<td>${c.destination_url}</td><td></td>`;

      const deleteCell = canDelete
        ? `<td style="text-align:center;">
            <form method="POST" action="/api/admin/action?action=campaign_delete" onsubmit="return confirm('ลบ Campaign นี้?')" style="display:inline;">
              <input type="hidden" name="creative_id" value="${c.creative_id}" />
              <button class="btn-small btn-danger">ลบ</button>
            </form>
          </td>`
        : `<td></td>`;

      return `
        <tr>
          <td style="font-family:monospace;">${c.creative_id}</td>
          <td>
            <div style="display:flex; gap:6px; align-items:center;">
              <input type="text" readonly value="${qrLink}" class="table-input" style="font-size:12px;" onclick="this.select()" />
              <button type="button" class="btn-small" onclick="navigator.clipboard.writeText('${qrLink}'); this.textContent='ก็อปแล้ว'; setTimeout(()=>this.textContent='ก็อปลิงก์', 1500);">ก็อปลิงก์</button>
            </div>
          </td>
          ${editableCells}
          <td style="text-align:center;">
            <form method="POST" action="/api/admin/action?action=campaign_toggle" class="inline-form">
              <input type="hidden" name="creative_id" value="${c.creative_id}" />
              <button class="btn-small ${c.active ? '' : 'btn-muted'}">${c.active ? 'เปิดใช้อยู่' : 'ปิดใช้อยู่'}</button>
            </form>
          </td>
          ${deleteCell}
        </tr>`;
    })
    .join('');

  return `
    <div class="section">
      <h2>เพิ่ม Campaign ใหม่</h2>
      <form method="POST" action="/api/admin/action?action=campaign_create" class="stack-form">
        <label>Campaign ID (ใช้ในลิงก์ QR เช่น brandA-video)</label>
        <input type="text" name="creative_id" required pattern="[a-zA-Z0-9\\-_]+" />
        <label>URL ปลายทาง</label>
        <input type="url" name="destination_url" required placeholder="https://..." />
        <button type="submit" class="btn-primary">เพิ่ม Campaign</button>
      </form>
    </div>
    <div class="section">
      <h2>Campaign ทั้งหมด</h2>
      ${!canEdit ? '<p class="hint">คุณดูและเปิด/ปิดใช้งานได้ แต่แก้ไข/ลบไม่ได้</p>' : ''}
      <table>
        <tr><th>Campaign ID</th><th>ลิงก์ QR</th><th>URL ปลายทาง</th><th></th><th style="text-align:center;">สถานะ</th><th></th></tr>
        ${rows || '<tr><td colspan="6" class="muted">ยังไม่มี Campaign</td></tr>'}
      </table>
    </div>`;
}

// ---------- Admins tab (super_admin เท่านั้น) ----------
async function renderAdminsTab(admin) {
  const { data: admins } = await supabase.from('admin_users').select('username, role, created_at').order('created_at');

  const roleOptions = (selected) =>
    ['super_admin', 'admin', 'staff']
      .map((r) => `<option value="${r}" ${r === selected ? 'selected' : ''}>${r}</option>`)
      .join('');

  const rows = (admins || [])
    .map((a) => {
      const isSelf = a.username === admin.username;
      return `
        <tr>
          <td>${a.username}${isSelf ? ' <span class="hint">(คุณ)</span>' : ''}</td>
          <td>
            ${
              isSelf
                ? a.role
                : `<form method="POST" action="/api/admin/action?action=admin_update_role" class="inline-form">
                     <input type="hidden" name="username" value="${a.username}" />
                     <select name="role" class="table-input">${roleOptions(a.role)}</select>
                   </td>
                   <td style="text-align:center;"><button class="btn-small">บันทึก</button></form>`
            }
          </td>
          <td>${new Date(a.created_at).toLocaleDateString('th-TH')}</td>
          <td style="text-align:center;">
            ${
              isSelf
                ? ''
                : `<form method="POST" action="/api/admin/action?action=admin_delete" onsubmit="return confirm('ลบบัญชี ${a.username}?')" style="display:inline;">
                     <input type="hidden" name="username" value="${a.username}" />
                     <button class="btn-small btn-danger">ลบ</button>
                   </form>`
            }
          </td>
        </tr>`;
    })
    .join('');

  return `
    <div class="section">
      <h2>เพิ่มบัญชีแอดมิน/เจ้าหน้าที่ใหม่</h2>
      <form method="POST" action="/api/admin/action?action=admin_create" class="stack-form">
        <label>Username</label>
        <input type="text" name="username" required />
        <label>Password</label>
        <input type="password" name="password" required />
        <label>Role</label>
        <select name="role" style="padding:8px; border:1px solid #e5e7eb; border-radius:6px;">
          <option value="staff">staff</option>
          <option value="admin">admin</option>
          <option value="super_admin">super_admin</option>
        </select>
        <button type="submit" class="btn-primary">เพิ่มบัญชี</button>
      </form>
    </div>
    <div class="section">
      <h2>บัญชีแอดมินทั้งหมด</h2>
      <p class="hint">super_admin: ทำได้ทุกอย่าง | admin: ทำได้เกือบทุกอย่างยกเว้นจัดการบัญชีแอดมิน | staff: สร้าง/เปิดปิด Campaign และ Reward ได้ แก้ไข/ลบไม่ได้ แตะข้อมูลสมาชิกไม่ได้</p>
      <table>
        <tr><th>Username</th><th>Role</th><th>สร้างเมื่อ</th><th></th></tr>
        ${rows || '<tr><td colspan="4" class="muted">ไม่มีบัญชี</td></tr>'}
      </table>
    </div>`;
}

// ---------- Office Area tab (admin/staff เข้าดู/แก้ office ไหนก็ได้) ----------
async function renderOfficeTab(selectedOfficeId) {
  const offices = await listOfficeAccounts();

  if (!offices.length) {
    return `<div class="section"><p class="muted">ยังไม่มีบัญชี Office เลย — เพิ่มได้ผ่าน SQL (ดู migration-office-area.sql)</p></div>`;
  }

  const activeId = selectedOfficeId || offices[0].id;
  const officeAccount = await getOfficeAccount(activeId);

  const officeOptions = offices
    .map((o) => `<option value="${o.id}" ${String(o.id) === String(activeId) ? 'selected' : ''}>${o.office_name} (${o.username})</option>`)
    .join('');

  const picker = `
    <div class="section">
      <h2>เลือก Office</h2>
      <form method="GET" action="/api/admin/office" style="display:flex; gap:8px; align-items:center;">
        <select name="office_id" class="table-input" style="max-width:280px;" onchange="this.form.submit()">
          ${officeOptions}
        </select>
      </form>
    </div>`;

  if (!officeAccount) {
    return picker + `<div class="section"><p class="muted">ไม่พบ Office นี้</p></div>`;
  }

  const slots = await getSlots(officeAccount.id);
  const officeContent = renderOfficeAreaContent({
    officeAccount,
    slots,
    canEdit: true,
    uploadUrlAction: `/api/admin/action?action=office_get_upload_url&office=${officeAccount.id}`,
    saveAction: `/api/admin/action?action=office_save_content&office=${officeAccount.id}`,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });

  return picker + officeContent;
}

// ---------- Layout ----------
function renderLayout(activePage, admin, content) {
  const tabs = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'members', label: 'Members' },
    { key: 'rewards', label: 'Rewards' },
    { key: 'campaigns', label: 'Campaigns' },
    { key: 'office', label: 'Office Area' },
  ];
  if (can(admin.role, 'manage_admins')) tabs.push({ key: 'admins', label: 'Admins' });

  const nav = tabs
    .map((t) => `<a href="/api/admin/${t.key}" class="tab ${activePage === t.key ? 'active' : ''}">${t.label}</a>`)
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
  .link { color: #2a78d6; text-decoration: none; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 8px; }
  th { text-align: left; color: #6b7280; font-weight: 500; padding: 6px 4px; border-bottom: 1px solid #e5e7eb; }
  td { padding: 8px 4px; border-bottom: 1px solid #f0f0f0; }
  .stat-pill { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; border: 1.5px solid; border-radius: 10px; padding: 8px 16px; margin-right: 8px; font-size: 13px; font-weight: 600; text-decoration: none; }
  .clear-filter { font-size: 12px; color: #2a78d6; margin-left: 8px; }
  .btn-small { background: #06c755; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; }
  .btn-muted { background: #9ca3af; }
  .btn-danger { background: #e76f51; }
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
    <div class="brand">QR Tracker Admin</div>
    <nav>${nav}</nav>
    <div class="user-info">
      <span>${admin.username} (${admin.role})</span>
      <a href="/api/admin/action?action=logout" class="logout-link">Logout</a>
    </div>
  </header>
  <main>${content}</main>
</body>
</html>`;
}
