// lib/tiers.js
//
// ระดับสมาชิก เรียงจากแต้มสะสมทั้งชีวิตน้อย -> มาก
// ปรับชื่อระดับ, เกณฑ์แต้ม, หรือเพิ่ม/ลดจำนวนระดับได้ตรงนี้ที่เดียว
// (ใช้ร่วมกันทั้ง api/auth/callback.js และ api/admin/dashboard.js)

export const TIERS = [
  { name: 'Bronze', min: 0, color: '#a67c52' },
  { name: 'Silver', min: 100, color: '#9ca3af' },
  { name: 'Gold', min: 300, color: '#d4a017' },
  { name: 'Platinum', min: 700, color: '#5b6472' },
];

export function getTier(lifetimePoints) {
  let current = TIERS[0];
  for (const tier of TIERS) {
    if (lifetimePoints >= tier.min) current = tier;
  }
  const next = TIERS.find((t) => t.min > lifetimePoints) || null;
  return { current, next, pointsToNext: next ? next.min - lifetimePoints : 0 };
}
