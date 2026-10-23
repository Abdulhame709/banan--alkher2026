import crypto from 'node:crypto';
import { promisify } from 'node:util';
import express from 'express';
import { db, audit, getSettings } from './db.js';
import {
  asyncHandler,
  capabilities,
  HttpError,
  ROLE_LABELS,
  str,
  todayISO,
} from './helpers.js';

const scrypt = promisify(crypto.scrypt);
export const SESSION_COOKIE = 'banan_session';
const SESSION_DAYS = 30;

/* ------------------------------ passwords ------------------------------ */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), 64, {
    N: 16384,
    r: 8,
    p: 1,
  });
  const expected = Buffer.from(hashHex, 'hex');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

/* ------------------------------ sessions ------------------------------- */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  };
}

function startSession(res, userId, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    hashToken(token),
    userId,
    now.toISOString(),
    expires.toISOString(),
    String(req.headers['user-agent'] ?? '').slice(0, 300),
    String(req.ip ?? '').slice(0, 80)
  );
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}

export function attachUser(req, res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return next();
    const row = db
      .prepare(
        `SELECT p.*, u.email AS auth_email
           FROM sessions s
           JOIN auth_users u ON u.id = s.user_id
           JOIN fund_user_profiles p ON p.user_id = u.id
          WHERE s.token_hash = ? AND s.expires_at > ?`
      )
      .get(hashToken(token), new Date().toISOString());
    if (row && row.active) {
      req.user = {
        id: row.user_id,
        full_name: row.full_name,
        email: row.auth_email || row.email,
        phone: row.phone,
        role: row.role,
        role_label: ROLE_LABELS[row.role],
        active: Boolean(row.active),
        linked_member_id: row.linked_member_id,
        created_at: row.created_at,
      };
      req.sessionTokenHash = hashToken(token);
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'يجب تسجيل الدخول أولاً'));
  next();
}

function publicSettings() {
  const settings = getSettings();
  return {
    fund_name: settings.fund_name,
    logo_url: settings.logo_url ? `/api/logo?v=${encodeURIComponent(settings.updated_at)}` : null,
    currency: settings.currency,
    default_monthly_fee: settings.default_monthly_fee,
    allow_signups: Boolean(settings.allow_signups),
    allow_self_approval_demo: Boolean(settings.allow_self_approval_demo),
  };
}

function authPayload(user) {
  return {
    user,
    capabilities: capabilities(user.role),
    settings: publicSettings(),
  };
}

/* --------------------------- login throttling -------------------------- */
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function loginLimiter(req, res, next) {
  const key = `${req.ip}:${String(req.body?.email ?? '').toLowerCase()}`;
  const now = Date.now();
  const record = attempts.get(key);
  if (record && record.resetAt > now && record.count >= MAX_ATTEMPTS) {
    return next(new HttpError(429, 'محاولات دخول كثيرة. يرجى المحاولة بعد 15 دقيقة'));
  }
  req.loginAttemptKey = key;
  next();
}

function recordFailure(key) {
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || record.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    record.count += 1;
  }
}

export const authRouter = express.Router();

authRouter.get('/public/settings', (req, res) => {
  res.json({ settings: publicSettings() });
});

authRouter.post(
  '/auth/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    if (!email || !password) {
      throw new HttpError(400, 'البريد الإلكتروني وكلمة المرور مطلوبان');
    }
    const account = db.prepare('SELECT * FROM auth_users WHERE email = ?').get(email);
    const valid = account ? await verifyPassword(password, account.password_hash) : false;
    if (!account || !valid) {
      recordFailure(req.loginAttemptKey);
      throw new HttpError(401, 'البريد الإلكتروني أو كلمة المرور غير صحيحة');
    }
    const profile = db.prepare('SELECT * FROM fund_user_profiles WHERE user_id = ?').get(account.id);
    if (!profile) throw new HttpError(403, 'الحساب غير مهيأ. تواصل مع مدير النظام');
    if (!profile.active) throw new HttpError(403, 'هذا الحساب موقوف. تواصل مع مدير النظام');
    attempts.delete(req.loginAttemptKey);
    startSession(res, account.id, req);
    const user = {
      id: account.id,
      full_name: profile.full_name,
      email: account.email,
      phone: profile.phone,
      role: profile.role,
      role_label: ROLE_LABELS[profile.role],
      active: Boolean(profile.active),
      linked_member_id: profile.linked_member_id,
      created_at: profile.created_at,
    };
    audit({
      action: 'تسجيل دخول',
      entityType: 'auth',
      entityId: account.id,
      actor: user,
      details: 'تم تسجيل الدخول إلى النظام',
    });
    res.json(authPayload(user));
  })
);

authRouter.post(
  '/auth/signup',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const settings = getSettings();
    const profileCount = db.prepare('SELECT COUNT(*) AS c FROM fund_user_profiles').get().c;
    const isFirstUser = profileCount === 0;
    if (!isFirstUser && !settings.allow_signups) {
      throw new HttpError(403, 'التسجيل الذاتي متوقف. يتولى مدير النظام إنشاء الحسابات');
    }
    const fullName = str(req.body?.full_name, {
      name: 'الاسم الكامل',
      required: true,
      min: 3,
      max: 120,
    });
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
      throw new HttpError(400, 'البريد الإلكتروني غير صالح');
    }
    const password = String(req.body?.password ?? '');
    if (password.length < 8) throw new HttpError(400, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل');
    if (password.length > 200) throw new HttpError(400, 'كلمة المرور طويلة جداً');
    const phone = str(req.body?.phone, { name: 'رقم الهاتف', max: 30 });

    if (db.prepare('SELECT 1 FROM auth_users WHERE email = ?').get(email)) {
      throw new HttpError(409, 'يوجد حساب مسجل بهذا البريد الإلكتروني');
    }

    const passwordHash = await hashPassword(password);
    const id = crypto.randomUUID();

    try {
      db.prepare(
        `INSERT INTO auth_users (id, email, password_hash, full_name, phone)
         VALUES (?, ?, ?, ?, ?)`
      ).run(id, email, passwordHash, fullName, phone);
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) {
        throw new HttpError(409, 'يوجد حساب مسجل بهذا البريد الإلكتروني');
      }
      throw error;
    }

    const profile = db.prepare('SELECT * FROM fund_user_profiles WHERE user_id = ?').get(id);
    const user = {
      id,
      full_name: profile.full_name,
      email,
      phone: profile.phone,
      role: profile.role,
      role_label: ROLE_LABELS[profile.role],
      active: Boolean(profile.active),
      linked_member_id: null,
      created_at: profile.created_at,
    };
    audit({
      action: isFirstUser ? 'تهيئة حساب مدير النظام' : 'تسجيل مستخدم جديد',
      entityType: 'user',
      entityId: id,
      actor: user,
      details: isFirstUser
        ? 'تم إنشاء أول حساب ومنحه صلاحية مدير النظام تلقائياً'
        : `تم تسجيل حساب جديد بالدور: ${ROLE_LABELS[profile.role]}`,
    });
    startSession(res, id, req);
    res.status(201).json(authPayload(user));
  })
);

authRouter.post('/auth/logout', (req, res) => {
  if (req.sessionTokenHash) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionTokenHash);
  }
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/auth/me', requireAuth, (req, res) => {
  res.json(authPayload(req.user));
});

authRouter.patch(
  '/auth/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const fullName = str(req.body?.full_name, {
      name: 'الاسم الكامل',
      required: true,
      min: 3,
      max: 120,
    });
    const phone = str(req.body?.phone, { name: 'رقم الهاتف', max: 30 });
    const currentPassword = req.body?.current_password
      ? String(req.body.current_password)
      : null;
    const newPassword = req.body?.new_password ? String(req.body.new_password) : null;

    if (newPassword) {
      if (newPassword.length < 8) throw new HttpError(400, 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل');
      const account = db.prepare('SELECT password_hash FROM auth_users WHERE id = ?').get(req.user.id);
      if (!currentPassword || !(await verifyPassword(currentPassword, account.password_hash))) {
        throw new HttpError(400, 'كلمة المرور الحالية غير صحيحة');
      }
      const hash = await hashPassword(newPassword);
      db.prepare('UPDATE auth_users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(
        req.user.id,
        req.sessionTokenHash
      );
    }

    db.prepare('UPDATE auth_users SET full_name = ?, phone = ? WHERE id = ?').run(
      fullName,
      phone,
      req.user.id
    );
    db.prepare('UPDATE fund_user_profiles SET full_name = ?, phone = ? WHERE user_id = ?').run(
      fullName,
      phone,
      req.user.id
    );
    audit({
      action: 'تحديث الملف الشخصي',
      entityType: 'user',
      entityId: req.user.id,
      actor: { ...req.user, full_name: fullName },
      details: newPassword ? 'تحديث البيانات وكلمة المرور' : 'تحديث البيانات الشخصية',
    });
    res.json({ ok: true, full_name: fullName, phone });
  })
);

/* Housekeeping: drop expired sessions. */
export function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
}
export { todayISO };
