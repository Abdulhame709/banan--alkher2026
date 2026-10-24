import {
  formatHijriDate,
  formatHijriDateTime,
  hijriMonthLabel,
  hijriMonthKeyFromDate,
  hijriMonthOptions,
  currentHijriMonthKey,
} from './hijri';

export const CURRENCY_SHORT = 'ر.ي';
export const CURRENCY_NAME = 'ريال يمني';

const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '0';
  return numberFormatter.format(Math.trunc(Number(value)));
}

export function money(value: number | null | undefined, withCurrency = true): string {
  const text = formatNumber(value);
  return withCurrency ? `${text} ${CURRENCY_SHORT}` : text;
}

/** All user-facing dates are Hijri. */
export function formatDate(value: string | null | undefined): string {
  return formatHijriDate(value);
}

export function formatDateTime(value: string | null | undefined): string {
  return formatHijriDateTime(value);
}

export function formatGregorianDate(value: string | null | undefined): string {
  if (!value) return '—';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  if (!year || !month || !day) return String(value);
  return `${Number(day)}/${Number(month)}/${year}`;
}

/** Accepts a Gregorian date/month (from the database) and returns its Hijri label. */
export function monthLabel(month: string | null | undefined): string {
  if (!month) return '—';
  return hijriMonthLabel(hijriMonthKeyFromDate(month));
}

export function todayISO(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function todayHijriMonth(): string {
  return currentHijriMonthKey();
}

export function monthInput(offset = 0): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Hijri month options (values are 1447-01 style keys). */
export function monthOptions(back = 15, forward = 3): Array<{ value: string; label: string }> {
  return hijriMonthOptions(back, forward);
}

export function refReceipt(receiptNo: number): string {
  return `REC-${String(receiptNo).padStart(4, '0')}`;
}
export function refExpense(requestNo: number): string {
  return `EXP-${String(requestNo).padStart(4, '0')}`;
}

export const ROLE_LABELS: Record<string, string> = {
  admin: 'مدير النظام',
  fund_manager: 'مدير الصندوق',
  secretary_general: 'الأمين العام',
  accountant: 'محاسب',
  treasurer: 'أمين الصندوق',
  board_member: 'عضو مجلس الإدارة',
  member: 'عضو',
};

export const RECEIPT_TYPE_LABELS: Record<string, string> = {
  subscription: 'اشتراك شهري',
  donation: 'تبرع',
  other: 'إيراد آخر',
};

export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  social_aid: 'مساعدات اجتماعية',
  charitable_aid: 'مساعدات خيرية',
  medical_aid: 'مساعدات طبية',
  emergency_aid: 'مساعدات طارئة',
  operational: 'مصروفات تشغيلية',
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'نقداً',
  bank_transfer: 'حوالة بنكية',
};

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'gold';

export function subscriptionStatus(status: string): { label: string; tone: Tone } {
  if (status === 'paid') return { label: 'مسدد', tone: 'success' };
  if (status === 'partial') return { label: 'سداد جزئي (قديم)', tone: 'warning' };
  return { label: 'غير مسدد', tone: 'danger' };
}

export function expenseStatus(status: string): { label: string; tone: Tone } {
  switch (status) {
    case 'approved':
      return { label: 'معتمد نهائياً — بانتظار الصرف', tone: 'info' };
    case 'paid':
      return { label: 'تم الصرف', tone: 'success' };
    case 'rejected':
      return { label: 'مرفوض', tone: 'danger' };
    default:
      return { label: 'بانتظار الاعتماد', tone: 'warning' };
  }
}

export const ENTITY_LABELS: Record<string, string> = {
  member: 'الأعضاء',
  subscription: 'الاستحقاقات',
  receipt: 'سندات القبض',
  expense_request: 'طلبات الصرف',
  user: 'المستخدمون',
  settings: 'الإعدادات',
  auth: 'الدخول',
  system: 'النظام',
};

/* ------------------------- amount in Arabic words ------------------------ */
const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const TEENS = [
  'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر',
  'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر',
];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];

function underHundred(n: number): string {
  if (n === 0) return '';
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n - 10];
  const ones = n % 10;
  return ones ? `${ONES[ones]} و${TENS[Math.floor(n / 10)]}` : TENS[Math.floor(n / 10)];
}

function underThousand(n: number): string {
  if (n === 0) return '';
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(HUNDREDS[hundreds]);
  if (rest) parts.push(underHundred(rest));
  return parts.join(' و');
}

function scaleName(value: number, singular: string, dual: string, plural: string): string {
  if (value === 1) return singular;
  if (value === 2) return dual;
  if (value >= 3 && value <= 10) return plural;
  return singular;
}

export function numberToArabicWords(input: number): string {
  const amount = Math.abs(Number(input));
  const integer = Math.floor(amount + 1e-9);
  const fraction = Math.round((amount - integer) * 100);

  if (integer === 0 && fraction === 0) return 'صفر ريال يمني';

  const parts: string[] = [];
  let remaining = integer;

  const billions = Math.floor(remaining / 1_000_000_000);
  remaining %= 1_000_000_000;
  const millions = Math.floor(remaining / 1_000_000);
  remaining %= 1_000_000;
  const thousands = Math.floor(remaining / 1000);
  remaining %= 1000;

  if (billions) {
    if (billions === 1) parts.push('مليار');
    else if (billions === 2) parts.push('ملياران');
    else parts.push(`${underThousand(billions)} ${scaleName(billions, 'مليار', 'ملياران', 'مليارات')}`);
  }
  if (millions) {
    if (millions === 1) parts.push('مليون');
    else if (millions === 2) parts.push('مليونان');
    else parts.push(`${underThousand(millions)} ${scaleName(millions, 'مليون', 'مليونان', 'ملايين')}`);
  }
  if (thousands) {
    if (thousands === 1) parts.push('ألف');
    else if (thousands === 2) parts.push('ألفان');
    else parts.push(`${underThousand(thousands)} ${scaleName(thousands, 'ألف', 'ألفان', 'آلاف')}`);
  }
  if (remaining) parts.push(underThousand(remaining));

  let words = parts.join(' و');
  if (amount !== Number(input)) words = `سالب ${words}`;
  if (!words) words = 'صفر';

  let result = `${words} ريال يمني`;
  if (fraction) result += ` و${underHundred(fraction)} فلس`;
  return result;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2);
  return words.map((word) => word.charAt(0)).join('');
}
