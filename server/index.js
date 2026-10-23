import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { db, ROOT_DIR } from './db.js';
import { attachUser, authRouter, purgeExpiredSessions } from './auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { membersRouter } from './routes/members.js';
import { subscriptionsRouter } from './routes/subscriptions.js';
import { receiptsRouter } from './routes/receipts.js';
import { expensesRouter } from './routes/expenses.js';
import { reportsRouter } from './routes/reports.js';
import { adminRouter } from './routes/admin.js';
import { filesRouter } from './routes/files.js';
import { HttpError } from './helpers.js';

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const isProduction = process.env.NODE_ENV === 'production';
const distDir = path.join(ROOT_DIR, 'dist');

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (isProduction) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
    );
  }
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(cookieParser());

/* Same-origin guard for state-changing requests (defence in depth with SameSite=Lax). */
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        return next(new HttpError(403, 'طلب غير موثوق: المصدر لا يطابق النطاق'));
      }
    } catch {
      return next(new HttpError(403, 'طلب غير موثوق'));
    }
  }
  next();
});

app.use(attachUser);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'صندوق بنان الخير للبنيان',
    time: new Date().toISOString(),
  });
});

app.use('/api', authRouter);
app.use('/api', filesRouter);
app.use('/api', dashboardRouter);
app.use('/api', membersRouter);
app.use('/api', subscriptionsRouter);
app.use('/api', receiptsRouter);
app.use('/api', expensesRouter);
app.use('/api', reportsRouter);
app.use('/api', adminRouter);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'المسار المطلوب غير موجود' });
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1h', etag: true }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else if (isProduction) {
  app.get('/', (req, res) => {
    res
      .status(503)
      .type('text/plain; charset=utf-8')
      .send('قم ببناء واجهة المستخدم أولاً: npm run build');
  });
}

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? 'حجم الملف أكبر من الحد المسموح (8 ميجابايت)'
        : 'تعذر رفع الملف';
    return res.status(400).json({ error: message });
  }
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  if (String(error?.message ?? '').includes('UNIQUE constraint failed')) {
    return res.status(409).json({ error: 'توجد بيانات مسجلة مسبقاً تتعارض مع هذا الإجراء' });
  }
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'صيغة البيانات المرسلة غير صحيحة' });
  }
  console.error('[server error]', error);
  res.status(500).json({ error: 'حدث خطأ غير متوقع في الخادم. يرجى المحاولة مرة أخرى' });
});

const server = app.listen(PORT, () => {
  const count = db.prepare('SELECT COUNT(*) AS c FROM fund_user_profiles').get().c;
  console.log(`\n  صندوق بنان الخير للبنيان — النظام المحاسبي`);
  console.log(`  http://localhost:${PORT}`);
  console.log(
    count === 0
      ? '  لا يوجد مستخدمون بعد: أول حساب يسجّل سيحصل على صلاحية مدير النظام.\n'
      : `  المستخدمون المسجلون: ${count}\n`
  );
});

purgeExpiredSessions();
const housekeeping = setInterval(purgeExpiredSessions, 60 * 60 * 1000);
housekeeping.unref();

function shutdown() {
  server.close(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
