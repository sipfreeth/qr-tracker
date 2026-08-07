// lib/sponsorArea.js
//
// โค้ดกลางของระบบ Sponsor: คลัง Content, ปฏิทินความว่างของสล็อต, การจอง
// อัปโหลดไฟล์ตรงไป Supabase Storage เหมือนระบบ Office Area (เลี่ยงข้อจำกัดขนาด request ของ Vercel)

import { supabase } from './supabaseClient.js';

const BUCKET = 'sponsor-content';
const MAX_FILES_PER_SPONSOR = 6;
const WEEKS_TO_SHOW = 8;

// ---------- Content Library ----------
export async function getSponsorContent(sponsorId) {
  const { data } = await supabase
    .from('sponsor_content')
    .select('*')
    .eq('sponsor_id', sponsorId)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function countSponsorContent(sponsorId) {
  const { count } = await supabase
    .from('sponsor_content')
    .select('id', { count: 'exact', head: true })
    .eq('sponsor_id', sponsorId);
  return count || 0;
}

export async function createUploadTarget(sponsorId, fileName) {
  const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const path = `${sponsorId}/${Date.now()}-${safeName}`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw error;
  return { path, token: data.token };
}

export async function saveSponsorContent({ sponsorId, fileName, filePath, fileType }) {
  const currentCount = await countSponsorContent(sponsorId);
  if (currentCount >= MAX_FILES_PER_SPONSOR) {
    throw new Error(`อัปโหลดได้สูงสุด ${MAX_FILES_PER_SPONSOR} ไฟล์ต่อบัญชี กรุณาลบไฟล์เก่าก่อน`);
  }
  const { error } = await supabase.from('sponsor_content').insert({
    sponsor_id: sponsorId,
    file_name: fileName,
    file_path: filePath,
    file_type: fileType,
    status: 'pending',
  });
  if (error) throw error;
}

export async function getSignedContentUrl(filePath) {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(filePath, 3600);
  return data?.signedUrl || null;
}

// ---------- ปฏิทินความว่างของสล็อต ----------
function getNextMonday(from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const dayOfWeek = d.getDay(); // 0 = อาทิตย์
  const daysUntilMonday = (8 - dayOfWeek) % 7 || 7; // จันทร์หน้าเสมอ (ไม่นับสัปดาห์นี้ เพราะต้องจองล่วงหน้า)
  d.setDate(d.getDate() + daysUntilMonday);
  return d;
}

// คืน array ของสัปดาห์ที่จองได้ (เริ่มจากจันทร์หน้า ไปอีก WEEKS_TO_SHOW สัปดาห์)
export function getBookableWeeks() {
  const firstMonday = getNextMonday();
  const weeks = [];
  for (let i = 0; i < WEEKS_TO_SHOW; i++) {
    const start = new Date(firstMonday);
    start.setDate(firstMonday.getDate() + i * 7);
    weeks.push(start);
  }
  return weeks;
}

// คืนตารางความว่าง { [slot_number]: { [week_start_iso]: booking หรือ null } } ของ office หนึ่งอัน
export async function getAvailability(officeAccountId) {
  const weeks = getBookableWeeks();
  const lastWeek = new Date(weeks[weeks.length - 1]);
  lastWeek.setDate(lastWeek.getDate() + 7);

  const { data: bookings } = await supabase
    .from('slot_bookings')
    .select('slot_number, week_start, payment_status')
    .eq('office_account_id', officeAccountId)
    .gte('week_start', weeks[0].toISOString().slice(0, 10))
    .lt('week_start', lastWeek.toISOString().slice(0, 10));

  const bookedMap = {};
  for (const b of bookings || []) {
    bookedMap[`${b.slot_number}_${b.week_start}`] = b;
  }

  return { weeks, bookedMap };
}

// ---------- สร้างการจอง ----------
export async function createBooking({ sponsorId, officeAccountId, slotNumber, weekStart, sponsorContentId, price }) {
  const { error } = await supabase.from('slot_bookings').insert({
    sponsor_id: sponsorId,
    office_account_id: officeAccountId,
    slot_number: slotNumber,
    week_start: weekStart,
    sponsor_content_id: sponsorContentId,
    price,
    payment_status: 'unpaid',
  });
  if (error) throw error;
}

export { MAX_FILES_PER_SPONSOR, WEEKS_TO_SHOW };
