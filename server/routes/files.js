import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { db, getSettings, UPLOAD_DIR } from '../db.js';
import { requireAuth } from '../auth.js';
import {
  asyncHandler,
  HttpError,
  requireRole,
  ROLE_LABELS,
} from '../helpers.js';

export const filesRouter = express.Router();

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
const ALL_MIMES = [...IMAGE_MIMES, 'application/pdf'];

function makeUploader(allowedMimes) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace('.jpeg', '.jpg');
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  });
  return multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowedMimes.includes(file.mimetype) || !CONTENT_TYPES[ext]) {
        return cb(new HttpError(400, 'نوع الملف غير مدعوم. المسموح: صور PNG/JPG/WebP أو PDF'));
      }
      if (file.mimetype === 'application/pdf' && ext !== '.pdf') {
        return cb(new HttpError(400, 'امتداد ملف PDF غير صالح'));
      }
      if (file.mimetype.startsWith('image/') && ext === '.pdf') {
        return cb(new HttpError(400, 'امتداد الصورة غير صالح'));
      }
      cb(null, true);
    },
  });
}

const upload = makeUploader(ALL_MIMES);

const internal = requireRole('admin', 'accountant', 'treasurer', 'board_member');

filesRouter.post(
  '/uploads',
  internal,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'لم يتم اختيار ملف');
    res.status(201).json({
      file: req.file.filename,
      name: req.file.originalname,
      size: req.file.size,
      mime: req.file.mimetype,
    });
  })
);

filesRouter.post(
  '/uploads/logo',
  requireRole('admin'),
  makeUploader(IMAGE_MIMES).single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'لم يتم اختيار ملف الشعار');
    res.status(201).json({
      file: req.file.filename,
      name: req.file.originalname,
      size: req.file.size,
      mime: req.file.mimetype,
    });
  })
);

/* Uploaded attachments require an authenticated internal user. */
filesRouter.get(
  '/files/:name',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!['admin', 'accountant', 'treasurer', 'board_member', 'member'].includes(req.user.role)) {
      throw new HttpError(403, 'غير مصرح');
    }
    const name = path.basename(req.params.name);
    if (!/^[a-f0-9-]{36}\.(png|jpg|jpeg|webp|pdf)$/i.test(name)) {
      throw new HttpError(400, 'اسم الملف غير صالح');
    }
    const fullPath = path.join(UPLOAD_DIR, name);
    if (!fs.existsSync(fullPath)) throw new HttpError(404, 'الملف غير موجود');
    const ext = path.extname(name).toLowerCase().replace('.jpeg', '.jpg');
    res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', `inline; filename="${name}"`);
    fs.createReadStream(fullPath).pipe(res);
  })
);

/* Public logo - deliberately only the fund logo is exposed before login. */
filesRouter.get(
  '/logo',
  asyncHandler(async (req, res) => {
    const settings = getSettings();
    if (!settings.logo_url) throw new HttpError(404, 'لا يوجد شعار');
    const name = path.basename(settings.logo_url);
    const ext = path.extname(name).toLowerCase().replace('.jpeg', '.jpg');
    if (!CONTENT_TYPES[ext] || ext === '.pdf') throw new HttpError(404, 'لا يوجد شعار');
    const fullPath = path.join(UPLOAD_DIR, name);
    if (!fs.existsSync(fullPath)) throw new HttpError(404, 'لا يوجد شعار');
    res.setHeader('Content-Type', CONTENT_TYPES[ext]);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(fullPath).pipe(res);
  })
);

export { ROLE_LABELS };
