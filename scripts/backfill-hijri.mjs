// Backfill Hijri year/month for monthly dues created before 0004.
// Usage: node scripts/backfill-hijri.mjs
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const keys = fs.readFileSync('SUPABASE_KEYS.txt', 'utf8');
const url = 'https://jjzyqgqeevgevmvojyvn.supabase.co';
const jwts = [...keys.matchAll(/eyJ[a-zA-Z0-9_.-]+/g)].map((match) => match[0]);
const serviceKey = jwts[1];
if (!serviceKey) throw new Error('service role key not found');

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const formatter = new Intl.DateTimeFormat('en-US-u-ca-islamic-umalqura', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  timeZone: 'UTC',
});

export function toHijri(iso) {
  const date = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  const parts = formatter.formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

const { data, error } = await supabase
  .from('fund_subscriptions')
  .select('id, due_month, hijri_year, hijri_month')
  .order('due_month');
if (error) throw error;

let updated = 0;
for (const row of data) {
  const hijri = toHijri(row.due_month);
  if (row.hijri_year === hijri.year && row.hijri_month === hijri.month) continue;
  const result = await supabase
    .from('fund_subscriptions')
    .update({ hijri_year: hijri.year, hijri_month: hijri.month })
    .eq('id', row.id);
  if (result.error) throw result.error;
  updated += 1;
}
console.log(`backfilled=${updated} total=${data.length}`);
