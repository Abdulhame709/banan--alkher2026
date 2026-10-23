export class HttpError extends Error {
  constructor(status, message, code = undefined) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export const ROLES = ['admin', 'accountant', 'treasurer', 'board_member', 'member'];
export const ROLE_LABELS = {
  admin: 'مدير النظام',
  accountant: 'محاسب',
  treasurer: 'أمين الصندوق',
  board_member: 'عضو مجلس الإدارة',
  member: 'عضو',
};

export const RECEIPT_TYPE_LABELS = {
  subscription: 'اشتراك شهري',
  donation: 'تبرع',
  other: 'إيراد آخر',
};

export const EXPENSE_CATEGORY_LABELS = {
  social_aid: 'مساعدات اجتماعية',
  charitable_aid: 'مساعدات خيرية',
  medical_aid: 'مساعدات طبية',
  emergency_aid: 'مساعدات طارئة',
  operational: 'مصروفات تشغيلية',
};

export const STATUS_LABELS = {
  unpaid: 'غير مسدد',
  partial: 'سداد جزئي',
  paid: 'مسدد',
  pending: 'بانتظار الاعتماد',
  approved: 'معتمد بانتظار الصرف',
  rejected: 'مرفوض',
};

export function capabilities(role) {
  const admin = role === 'admin';
  const accountant = role === 'accountant';
  const treasurer = role === 'treasurer';
  const board = role === 'board_member';
  const internal = admin || accountant || treasurer || board;
  return {
    manageMembers: admin || accountant,
    manageReceipts: admin || accountant || treasurer,
    createExpenses: admin || accountant || treasurer || board,
    approveExpenses: admin || treasurer || board,
    payExpenses: admin || treasurer,
    viewReports: internal,
    viewAudit: admin || board,
    admin: admin,
  };
}

export function requireCapability(capability) {
  return (req, res, next) => {
    if (!req.user) return next(new HttpError(401, 'يجب تسجيل الدخول أولاً'));
    const caps = capabilities(req.user.role);
    if (!caps[capability]) {
      return next(new HttpError(403, 'لا تملك صلاحية تنفيذ هذا الإجراء'));
    }
    next();
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new HttpError(401, 'يجب تسجيل الدخول أولاً'));
    if (!roles.includes(req.user.role)) {
      return next(new HttpError(403, 'لا تملك صلاحية الوصول إلى هذا القسم'));
    }
    next();
  };
}

export function str(value, { name = 'الحقل', required = false, max = 500, min = 0 } = {}) {
  if (value === null || value === undefined) {
    if (required) throw new HttpError(400, `${name} مطلوب`);
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    if (required) throw new HttpError(400, `${name} مطلوب`);
    return null;
  }
  if (text.length < min) throw new HttpError(400, `${name} يجب أن يكون ${min} أحرف على الأقل`);
  if (text.length > max) throw new HttpError(400, `${name} أطول من الحد المسموح (${max} حرف)`);
  return text;
}

export function amount(value, { name = 'المبلغ', min = 0.01, max = 1_000_000_000_000, required = true } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new HttpError(400, `${name} مطلوب`);
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new HttpError(400, `${name} غير صالح`);
  if (number < min) throw new HttpError(400, `${name} يجب أن يكون أكبر من أو يساوي ${min}`);
  if (number > max) throw new HttpError(400, `${name} أكبر من الحد المسموح`);
  return round2(number);
}

export function integer(value, { name = 'القيمة', min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new HttpError(400, `${name} غير صالح`);
  }
  return number;
}

export function oneOf(value, allowed, { name = 'القيمة' } = {}) {
  if (!allowed.includes(value)) throw new HttpError(400, `${name} غير صالح`);
  return value;
}

export function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  return false;
}

export function todayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Aden' });
}

export function isoDate(value, { name = 'التاريخ', required = true } = {}) {
  if (value === null || value === undefined || value === '') {
    if (!required) return null;
    return todayISO();
  }
  const text = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new HttpError(400, `${name} غير صالح (الصيغة المطلوبة YYYY-MM-DD)`);
  }
  return text;
}

export function normalizeMonth(value, { required = true } = {}) {
  if (!value) {
    if (!required) return null;
    const now = todayISO().slice(0, 7);
    return `${now}-01`;
  }
  const text = String(value).slice(0, 7);
  const match = /^(\d{4})-(\d{2})$/.exec(text);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    throw new HttpError(400, 'الشهر غير صالح');
  }
  return `${text}-01`;
}

export function monthLabel(month) {
  if (!month) return '';
  const [year, m] = month.split('-');
  const names = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
  ];
  return `${names[Number(m) - 1] ?? ''} ${year}`;
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function csvResponse(res, filename, headers, rows) {
  const escape = (value) => {
    let text = value === null || value === undefined ? '' : String(value);
    // Prevent spreadsheet formula injection from user-controlled text cells.
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const lines = [headers.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))];
  const body = `\uFEFF${lines.join('\r\n')}`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="banan-report.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.send(body);
}

export function pageParams(query) {
  const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(5, Number.parseInt(query.pageSize ?? '25', 10) || 25));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
