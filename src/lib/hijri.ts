// Umm al-Qura Hijri calendar helpers.
// Display uses the browser's built-in Islamic calendar; conversion uses a
// monotonic binary search so no external dependency is required.

export const HIJRI_MONTHS = [
  'محرم',
  'صفر',
  'ربيع الأول',
  'ربيع الآخر',
  'جمادى الأولى',
  'جمادى الآخرة',
  'رجب',
  'شعبان',
  'رمضان',
  'شوال',
  'ذو القعدة',
  'ذو الحجة',
];

const formatter = new Intl.DateTimeFormat('en-US-u-ca-islamic-umalqura', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  timeZone: 'UTC',
});

export interface HijriDate {
  year: number;
  month: number;
  day: number;
}

function utcNoon(iso: string): Date {
  return new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
}

export function toHijri(value: string | Date | null | undefined): HijriDate {
  if (!value) return { year: 0, month: 0, day: 0 };
  const date = value instanceof Date ? value : utcNoon(value);
  const parts = formatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function hijriKey(date: Date): number {
  const parts = formatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return get('year') * 10000 + get('month') * 100 + get('day');
}

function targetKey(year: number, month: number, day: number): number {
  return year * 10000 + month * 100 + day;
}

export function fromHijri(year: number, month: number, day = 1): string | null {
  if (!year || !month || !day) return null;
  const target = targetKey(year, month, day);
  // Average Islamic year is ~354.367 days. This estimate is within a few days
  // of the Umm al-Qura date; the search window leaves ample safety margin.
  const estimate = Date.UTC(622, 6, 19) + Math.round(
    ((year - 1) * 354.367 + (month - 1) * 29.5306 + (day - 1)) * 86400000
  );
  let low = estimate - 500 * 86400000;
  let high = estimate + 500 * 86400000;
  while (low <= high) {
    const mid = low + Math.floor((high - low) / 2);
    const key = hijriKey(new Date(mid));
    if (key < target) low = mid + 86400000;
    else high = mid - 86400000;
  }
  // The loop lands either on the target day or on the last instant before it,
  // depending on where the estimate falls. Check both positions.
  for (const offset of [0, 86400000]) {
    const candidate = new Date(low + offset);
    if (hijriKey(candidate) === target) return candidate.toISOString().slice(0, 10);
  }
  return null;
}

export function hijriMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function parseHijriMonthKey(value: string | null | undefined): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{1,2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1300 || year > 1600 || month < 1 || month > 12) return null;
  return { year, month };
}

export function hijriMonthKeyFromDate(value: string | null | undefined): string {
  const hijri = toHijri(value);
  return hijri.year ? hijriMonthKey(hijri.year, hijri.month) : '';
}

export function hijriMonthLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = parseHijriMonthKey(value);
  if (!parsed) {
    const hijri = toHijri(value);
    if (!hijri.year) return String(value);
    return `${HIJRI_MONTHS[hijri.month - 1]} ${hijri.year} هـ`;
  }
  return `${HIJRI_MONTHS[parsed.month - 1]} ${parsed.year} هـ`;
}

export function hijriMonthStartISO(value: string | null | undefined): string | null {
  const parsed = parseHijriMonthKey(value);
  if (!parsed) return null;
  return fromHijri(parsed.year, parsed.month, 1);
}

export function currentHijriMonthKey(date = new Date()): string {
  const hijri = toHijri(date);
  return hijriMonthKey(hijri.year, hijri.month);
}

export function currentHijriYear(date = new Date()): number {
  return toHijri(date).year;
}

export function hijriMonthOptions(back = 18, forward = 3): Array<{ value: string; label: string }> {
  const current = toHijri(new Date());
  const options: Array<{ value: string; label: string }> = [];
  for (let offset = forward; offset >= -back; offset -= 1) {
    const index = (current.year * 12 + (current.month - 1)) + offset;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    const value = hijriMonthKey(year, month);
    options.push({ value, label: hijriMonthLabel(value) });
  }
  return options;
}

export function hijriMonthRange(fromKey: string, toKey: string): Array<{ value: string; label: string; year: number; month: number }> {
  const from = parseHijriMonthKey(fromKey);
  const to = parseHijriMonthKey(toKey);
  if (!from || !to) return [];
  let start = from.year * 12 + (from.month - 1);
  let end = to.year * 12 + (to.month - 1);
  if (start > end) [start, end] = [end, start];
  if (end - start > 240) return [];
  const months: Array<{ value: string; label: string; year: number; month: number }> = [];
  for (let index = start; index <= end; index += 1) {
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    const value = hijriMonthKey(year, month);
    months.push({ value, label: hijriMonthLabel(value), year, month });
  }
  return months;
}

export function formatHijriDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const hijri = toHijri(value);
  if (!hijri.year) return String(value);
  return `${hijri.day} ${HIJRI_MONTHS[hijri.month - 1]} ${hijri.year} هـ`;
}

export function formatHijriDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const datePart = formatHijriDate(value);
  const text = value instanceof Date ? value.toISOString() : String(value);
  const time = text.slice(11, 16);
  return time ? `${datePart} — ${time}` : datePart;
}

export function hijriYearOptions(center = currentHijriYear(), span = 8): number[] {
  const years: number[] = [];
  for (let year = center - span; year <= center + span; year += 1) years.push(year);
  return years;
}
