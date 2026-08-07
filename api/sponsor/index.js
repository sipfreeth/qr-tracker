// api/sponsor/index.js
//
// หน้าหลักของ Sponsor รวมทุกฟังก์ชันไว้ที่เดียว สลับด้วยแท็บเมนู (คล้าย admin/[page].js):
//   ?page=content  — คลัง Content (อัปโหลด/ดูสถานะอนุมัติ)
//   ?page=book     — จองสล็อต (เลือก Office แล้วดูปฏิทินความว่าง)
//   ?page=profile  — แก้ไขข้อมูลบริษัท + เปลี่ยนรหัสผ่าน
// ค่าเริ่มต้นคือ content

import { supabase } from '../../lib/supabaseClient.js';
import { requireSponsor } from '../../lib/sponsorAuth.js';
import {
  getSponsorContent,
  getSignedContentUrl,
  getAvailability,
  MAX_FILES_PER_SPONSOR,
} from '../../lib/sponsorArea.js';

const PAGES = ['content', 'book', 'profile'];

export default async function handler(req, res) {
  const sponsor = await requireSponsor(req, res);
  if (!sponsor) return;

  const page = PAGES.includes(req.query.page) ? req.query.page : 'content';

  let content = '';
  if (page === 'content') content = await renderContentTab(sponsor);
  if (page === 'book') content = await renderBookTab(sponsor, req.query);
  if (page === 'profile') content = renderProfileTab(sponsor);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(renderLayout(page, sponsor, content));
}

// ---------- Content Library tab ----------
async function renderContentTab(sponsor) {
  const items = await getSponsorContent(sponsor.id);

  const rows = await Promise.all(
    items.map(async (item) => {
      const url = await getSignedContentUrl(item.file_path);
      const preview =
        item.file_type === 'video'
          ? `<video src="${url}" controls style="width:100%; max-height:140px; border-radius:8px;"></video>`
          : `<img src="${url}" style="width:100%; max-height:140px; object-fit:cover; border-radius:8px;" />`;
      const statusLabel = { pending: 'รอตรวจสอบ', approved: 'อนุมัติแล้ว', rejected: 'ไม่ผ่าน' }[item.status];
      const statusColor = { pending: '#d4a017', approved: '#06c755', rejected: '#e76f51' }[item.status];
      return `
        <div class="content-card">
          ${preview}
          <p style="font-size:13px; font-weight:600; margin:8px 0 2px;">${item.file_name}</p>
          <span class="tier-tag" style="background:${statusColor};">${statusLabel}</span>
          <form method="POST" action="/api/sponsor/action?action=delete_content" onsubmit="return confirm('ลบไฟล์นี้?')" style="margin-top:8px;">
            <input type="hidden" name="content_id" value="${item.id}" />
            <button class="btn-small btn-danger" type="submit">ลบ</button>
          </form>
        </div>`;
    })
  );

  const canUploadMore = items.length < MAX_FILES_PER_SPONSOR;

  const uploadForm = canUploadMore
    ? `
      <div class="section">
        <h2>อัปโหลดไฟล์ใหม่</h2>
        <p class="hint">JPEG, PNG, MP4 — ไม่เกิน 125MB — ใช้ได้สูงสุด ${MAX_FILES_PER_SPONSOR} ไฟล์ต่อบัญชี (ตอนนี้มี ${items.length}/${MAX_FILES_PER_SPONSOR})</p>
        <form class="sponsor-upload-form">
          <input type="file" name="file" accept="image/jpeg,image/png,video/mp4" required />
          <button type="submit" class="btn-primary" style="margin-top:10px;">อัปโหลด</button>
          <p class="upload-status hint" style="margin-top:8px;"></p>
        </form>
      </div>`
    : `<div class="section"><p class="muted">ใช้ครบ ${MAX_FILES_PER_SPONSOR} ไฟล์แล้ว ลบไฟล์เก่าก่อนถึงจะอัปโหลดเพิ่มได้</p></div>`;

  return `
    ${uploadForm}
    <div class="section">
      <h2>ไฟล์ทั้งหมดของฉัน</h2>
      <div class="content-grid">${rows.join('') || '<p class="muted">ยังไม่มีไฟล์</p>'}</div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
    <script>
      const sb = supabase.createClient(${JSON.stringify(process.env.SUPABASE_URL)}, ${JSON.stringify(process.env.SUPABASE_ANON_KEY)});
      const form = document.querySelector('.sponsor-upload-form');
      if (form) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fileInput = form.querySelector('input[name="file"]');
          const statusEl = form.querySelector('.upload-status');
          const file = fileInput.files[0];
          if (!file) return;
          if (file.size > 125 * 1024 * 1024) { statusEl.textContent = 'ไฟล์ใหญ่เกิน 125MB'; return; }

          statusEl.textContent = 'กำลังขอสิทธิ์อัปโหลด...';
          try {
            const urlRes = await fetch('/api/sponsor/action?action=get_upload_url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: 'file_name=' + encodeURIComponent(file.name),
            });
            const urlData = await urlRes.json();
            if (!urlRes.ok) throw new Error(urlData.error || 'ขอสิทธิ์อัปโหลดไม่สำเร็จ');

            statusEl.textContent = 'กำลังอัปโหลดไฟล์...';
            const { error: uploadError } = await sb.storage.from('sponsor-content').uploadToSignedUrl(urlData.path, urlData.token, file);
            if (uploadError) throw uploadError;

            statusEl.textContent = 'กำลังบันทึกข้อมูล...';
            const fileType = file.type.startsWith('video') ? 'video' : 'image';
            const saveRes = await fetch('/api/sponsor/action?action=save_content', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ file_path: urlData.path, file_name: file.name, file_type: fileType }).toString(),
            });
            if (!saveRes.ok) throw new Error(await saveRes.text());

            statusEl.textContent = 'อัปโหลดสำเร็จ กำลังโหลดหน้าใหม่...';
            setTimeout(() => window.location.reload(), 800);
          } catch (err) {
            statusEl.textContent = 'เกิดข้อผิดพลาด: ' + err.message;
          }
        });
      }
    </script>`;
}

// ---------- Book tab ----------
async function renderBookTab(sponsor, query) {
  const selectedOfficeId = query.office_id || null;
  const { data: offices } = await supabase.from('office_accounts').select('id, office_name, price_per_week').order('office_name');

  if (!offices || !offices.length) {
    return `<div class="section"><p class="muted">ยังไม่มี Office ให้จองตอนนี้</p></div>`;
  }

  const activeId = selectedOfficeId || offices[0].id;
  const activeOffice = offices.find((o) => String(o.id) === String(activeId)) || offices[0];

  const approvedContent = (await getSponsorContent(sponsor.id)).filter((c) => c.status === 'approved');

  // ---------- ขั้นยืนยันการจอง (มาจากการกดลิงก์ "จอง" ในตาราง) ----------
  if (query.confirm_slot && query.confirm_week) {
    const slotNum = Number(query.confirm_slot);
    const weekIso = query.confirm_week;
    const weekDate = new Date(weekIso);
    const weekEnd = new Date(weekDate);
    weekEnd.setDate(weekDate.getDate() + 6);

    const contentOptions = approvedContent
      .map((c) => `<option value="${c.id}">${c.file_name}</option>`)
      .join('');

    return `
      <div class="section">
        <h2>ยืนยันการจอง</h2>
        <p><strong>${activeOffice.office_name}</strong> — Slot ${slotNum}</p>
        <p class="hint">สัปดาห์ ${weekDate.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} — ${weekEnd.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
        <p style="font-size:20px; font-weight:700; margin:12px 0;">${Number(activeOffice.price_per_week).toLocaleString()} บาท</p>
        <form method="POST" action="/api/sponsor/action?action=create_booking" class="stack-form">
          <input type="hidden" name="office_id" value="${activeOffice.id}" />
          <input type="hidden" name="slot_number" value="${slotNum}" />
          <input type="hidden" name="week_start" value="${weekIso}" />
          <label>เลือกไฟล์ที่จะแสดง (จากไฟล์ที่อนุมัติแล้ว)</label>
          <select name="sponsor_content_id" required>
            ${contentOptions}
          </select>
          <button type="submit" class="btn-primary" style="margin-top:12px;">ยืนยันการจอง</button>
        </form>
        <p class="hint" style="margin-top:12px;">ยืนยันแล้วสถานะจะเป็น "รอชำระเงิน" — ทีมงานจะติดต่อกลับเพื่อแจ้งช่องทางชำระเงิน</p>
        <a href="/api/sponsor?page=book&office_id=${activeOffice.id}" class="hint">&larr; กลับไปเลือกช่องอื่น</a>
      </div>`;
  }

  const officeOptions = offices
    .map((o) => `<option value="${o.id}" ${String(o.id) === String(activeId) ? 'selected' : ''}>${o.office_name} — ${Number(o.price_per_week).toLocaleString()} บาท/สัปดาห์</option>`)
    .join('');

  const picker = `
    <div class="section">
      <h2>เลือก Office</h2>
      <form method="GET" action="/api/sponsor">
        <input type="hidden" name="page" value="book" />
        <select name="office_id" class="table-input" style="max-width:320px;" onchange="this.form.submit()">
          ${officeOptions}
        </select>
      </form>
    </div>`;

  const { weeks, bookedMap } = await getAvailability(activeOffice.id);

  const headerCells = weeks
    .map((w) => `<th style="text-align:center; font-size:12px;">${w.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</th>`)
    .join('');

  const slotRows = [1, 2, 3]
    .map((slotNum) => {
      const cells = weeks
        .map((w) => {
          const weekIso = w.toISOString().slice(0, 10);
          const booking = bookedMap[`${slotNum}_${weekIso}`];
          if (booking) {
            return `<td style="text-align:center; background:#f0f0f0; color:#9ca3af; font-size:12px;">ไม่ว่าง</td>`;
          }
          if (!approvedContent.length) {
            return `<td style="text-align:center; font-size:12px; color:#9ca3af;">ว่าง</td>`;
          }
          return `<td style="text-align:center;">
            <a href="/api/sponsor?page=book&office_id=${activeOffice.id}&confirm_slot=${slotNum}&confirm_week=${weekIso}" class="btn-small">จอง</a>
          </td>`;
        })
        .join('');
      return `<tr><td style="font-weight:600;">Slot ${slotNum}</td>${cells}</tr>`;
    })
    .join('');

  const calendar = `
    <div class="section">
      <h2>${activeOffice.office_name} — ${Number(activeOffice.price_per_week).toLocaleString()} บาท/สัปดาห์</h2>
      <p class="hint">จองล่วงหน้าเท่านั้น (สัปดาห์ถัดไปเป็นต้นไป เพื่อให้ทีมงานมีเวลาตรวจสอบเนื้อหา)</p>
      ${!approvedContent.length ? '<p class="hint" style="color:#e76f51;">คุณยังไม่มีไฟล์ที่ผ่านการอนุมัติ ต้องอัปโหลดและรออนุมัติก่อนถึงจะจองได้</p>' : ''}
      <div style="overflow-x:auto;">
        <table>
          <tr><th></th>${headerCells}</tr>
          ${slotRows}
        </table>
      </div>
    </div>`;

  return picker + calendar;
}

// ---------- Profile tab ----------
function renderProfileTab(sponsor) {
  return `
    <div class="section">
      <h2>ข้อมูลบริษัท</h2>
      <form method="POST" action="/api/sponsor/action?action=update_profile" class="stack-form">
        <label>ชื่อบริษัท</label>
        <input type="text" name="company_name" value="${sponsor.company_name || ''}" required />
        <label>เลขประจำตัวผู้เสียภาษี</label>
        <input type="text" name="tax_id" value="${sponsor.tax_id || ''}" />
        <label>ที่อยู่</label>
        <input type="text" name="address" value="${sponsor.address || ''}" />
        <label>ชื่อผู้ติดต่อ</label>
        <input type="text" name="contact_name" value="${sponsor.contact_name || ''}" />
        <label>เบอร์โทร</label>
        <input type="text" name="contact_phone" value="${sponsor.contact_phone || ''}" />
        <label>ประเภทธุรกิจ</label>
        <input type="text" name="business_type" value="${sponsor.business_type || ''}" />
        <button type="submit" class="btn-primary" style="margin-top:12px;">บันทึก</button>
      </form>
    </div>
    <div class="section">
      <h2>เปลี่ยนรหัสผ่าน</h2>
      <form method="POST" action="/api/sponsor/action?action=change_password" class="stack-form">
        <label>รหัสผ่านปัจจุบัน</label>
        <input type="password" name="current_password" required />
        <label>รหัสผ่านใหม่</label>
        <input type="password" name="new_password" required minlength="6" />
        <button type="submit" class="btn-primary" style="margin-top:12px;">บันทึกรหัสผ่านใหม่</button>
      </form>
    </div>`;
}

// ---------- Layout ----------
function renderLayout(activePage, sponsor, content) {
  const tabs = [
    { key: 'content', label: 'Content Library' },
    { key: 'book', label: 'จองสล็อต' },
    { key: 'profile', label: 'Profile' },
  ];
  const nav = tabs
    .map((t) => `<a href="/api/sponsor?page=${t.key}" class="tab ${activePage === t.key ? 'active' : ''}">${t.label}</a>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Sponsor — ${sponsor.company_name}</title>
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
  main { padding: 24px; max-width: 900px; margin: 0 auto; }
  .section { background: white; border-radius: 12px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
  h2 { font-size: 16px; margin: 0 0 4px; }
  .hint, .muted { font-size: 12px; color: #9ca3af; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
  th, td { padding: 8px 6px; border-bottom: 1px solid #f0f0f0; }
  .btn-small { background: #06c755; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; text-decoration: none; display: inline-block; }
  .btn-danger { background: #e76f51; }
  .btn-primary { background: #1b1f27; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; cursor: pointer; }
  .tier-tag { color: white; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 999px; }
  .stack-form { display: flex; flex-direction: column; max-width: 420px; }
  .stack-form label { font-size: 13px; color: #6b7280; margin: 10px 0 4px; }
  .stack-form input { padding: 8px 10px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 14px; }
  .table-input { padding: 8px 10px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 14px; }
  .content-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px; margin-top: 12px; }
  .content-card { border: 1px solid #f0f0f0; border-radius: 10px; padding: 10px; }
</style>
</head>
<body>
  <header>
    <div class="brand">${sponsor.company_name}</div>
    <nav>${nav}</nav>
    <div class="user-info">
      <a href="/api/sponsor/action?action=logout" class="logout-link">Logout</a>
    </div>
  </header>
  <main>${content}</main>
</body>
</html>`;
}
