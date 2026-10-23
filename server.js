import 'dotenv/config';
import express from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { list, head, put, del } from '@vercel/blob';
import { handleUpload } from '@vercel/blob/client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PASSWORD = process.env.APP_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || '';
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 150);
const PRODUCTION = Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';
const AUDIO_PREFIX = 'sonora-audio/';
const META_PREFIX = 'sonora-meta/';
const MAX_FILE_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const mimeTypes = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac',
  '.aac': 'audio/aac', '.webm': 'audio/webm',
};
if (PASSWORD.length < 12 || SECRET.length < 32) {
  throw new Error('Set APP_PASSWORD (>= 12 chars) and SESSION_SECRET (>= 32 chars) in Vercel Environment Variables.');
}
if (!(Number.isFinite(MAX_UPLOAD_MB) && MAX_UPLOAD_MB >= 1 && MAX_UPLOAD_MB <= 1000)) {
  throw new Error('MAX_UPLOAD_MB phải trong khoảng 1..1000.');
}
const app = express();
app.disable('x-powered-by');
if (PRODUCTION) app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: https://*.blob.vercel-storage.com; connect-src 'self' https://*.blob.vercel-storage.com https://blob.vercel-storage.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  });
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const site = req.get('sec-fetch-site');
  if (site && !['same-origin', 'none'].includes(site)) return res.status(403).json({ error: 'Yêu cầu không cùng nguồn bị từ chối.' });
  if (req.get('origin')) {
    try {
      const origin = new URL(req.get('origin'));
      if (origin.host !== req.get('host')) return res.status(403).json({ error: 'Nguồn yêu cầu không hợp lệ.' });
    } catch { return res.status(403).json({ error: 'Nguồn yêu cầu không hợp lệ.' }); }
  }
  next();
});

function hmac(value) { return createHmac('sha256', SECRET).update(value).digest('base64url'); }
function signSession() {
  const expire = String(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return `${expire}.${hmac(expire)}`;
}
function verifySession(req) {
  const cookie = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('music_session='));
  if (!cookie) return false;
  const token = cookie.slice('music_session='.length);
  const split = token.indexOf('.');
  if (split < 1) return false;
  const expiry = token.slice(0, split);
  if (!/^\d{13}$/.test(expiry) || Number(expiry) <= Date.now()) return false;
  const actual = Buffer.from(token.slice(split + 1));
  const expected = Buffer.from(hmac(expiry));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function auth(req, res, next) {
  if (!verifySession(req)) return res.status(401).json({ error: 'Bạn cần đăng nhập.' });
  next();
}
function equalPassword(submitted) {
  if (typeof submitted !== 'string' || submitted.length > 500) return false;
  const a = createHmac('sha256', SECRET).update(submitted).digest();
  const b = createHmac('sha256', SECRET).update(PASSWORD).digest();
  return timingSafeEqual(a, b);
}
function normalize(value, fallback, max=120) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;
}
const attempts = new Map(); // Best-effort per-instance limiter, not shared across serverless instances.
app.get('/api/session', (req, res) => res.json({ authenticated: verifySession(req) }));
app.post('/api/login', (req, res) => {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const state = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
  if (now > state.until) { state.count = 0; state.until = now + 15 * 60 * 1000; }
  if (state.count >= 10) return res.status(429).json({ error: 'Bạn đã thử quá nhiều lần. Thử lại sau 15 phút.' });
  if (!equalPassword(req.body?.password)) {
    state.count += 1;
    attempts.set(key, state);
    return res.status(401).json({ error: 'Mật khẩu không đúng.' });
  }
  attempts.delete(key);
  res.cookie('music_session', signSession(), {
    httpOnly: true, sameSite: 'lax', secure: PRODUCTION,
    maxAge: 30 * 24 * 60 * 60 * 1000, path: '/',
  });
  res.json({ authenticated: true });
});
app.post('/api/logout', (_req, res) => {
  res.clearCookie('music_session', { path: '/', sameSite: 'lax', secure: PRODUCTION });
  res.json({ ok: true });
});

async function listAll(prefix) {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix, limit: 500, ...(cursor ? { cursor } : {}) });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}
async function readRecords() {
  const metadataFiles = await listAll(META_PREFIX);
  // Files use unique URLs and are never overwritten (avoids edge-cache stale reads).
  const records = await Promise.all(metadataFiles.map(async (info) => {
    const response = await fetch(info.url, { cache: 'no-store' });
    if (!response.ok) throw new Error('Không tải được dữ liệu thư viện.');
    const record = await response.json();
    if (!record || typeof record.id !== 'string' || typeof record.fileUrl !== 'string') {
      throw new Error('Dữ liệu thư viện không hợp lệ.');
    }
    return { ...record, metaUrl: info.url };
  }));
  // In case of interrupted edits, use newest record per ID.
  const byId = new Map();
  for (const song of records) {
    const old = byId.get(song.id);
    if (!old || String(song.updatedAt || song.createdAt) > String(old.updatedAt || old.createdAt)) byId.set(song.id, song);
  }
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function publicSong(song) {
  const { metaUrl, fileUrl, updatedAt, ...publicFields } = song;
  return publicFields;
}
async function putRecord(record) {
  const id = record.id;
  const result = await put(`${META_PREFIX}${id}-${randomUUID()}.json`, JSON.stringify(record), {
    access: 'public', contentType: 'application/json', addRandomSuffix: false,
    cacheControlMaxAge: 60,
  });
  return result.url;
}
app.get('/api/songs', auth, async (_req, res, next) => {
  try { res.json((await readRecords()).map(publicSong)); } catch (error) { next(error); }
});

// Handle the token exchange and signed completion callback for direct client uploads.
// Never allow anonymous upload-token generation.
app.post('/api/blob/upload', async (req, res, next) => {
  try {
    const result = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!verifySession(req)) throw new Error('Bạn cần đăng nhập trước khi tải nhạc.');
        if (typeof pathname !== 'string' || !pathname.startsWith(AUDIO_PREFIX)) throw new Error('Tên file không hợp lệ.');
        const ext = path.extname(pathname).toLowerCase();
        if (!mimeTypes[ext] || !/^sonora-audio\/[a-f\d-]{36}\.[a-z0-9]+$/i.test(pathname)) {
          throw new Error('Định dạng file chưa hỗ trợ.');
        }
        return { addRandomSuffix: true, maximumSizeInBytes: MAX_FILE_BYTES, validUntil: Date.now() + 15 * 60 * 1000 };
      },
      onUploadCompleted: async () => {
        // Metadata is recorded by the signed-in client after it receives its Blob URL.
      },
    });
    res.json(result);
  } catch (error) { next(error); }
});
app.post('/api/songs', auth, async (req, res, next) => {
  try {
    const url = req.body?.url;
    if (typeof url !== 'string' || url.length > 2048) return res.status(400).json({ error: 'Đường dẫn file không hợp lệ.' });
    // Verify a user cannot register an arbitrary external URL as a music file.
    const blob = await head(url);
    const ext = path.extname(blob.pathname || '').toLowerCase();
    if (!blob.pathname?.startsWith(AUDIO_PREFIX) || !mimeTypes[ext] || !(blob.size > 0 && blob.size <= MAX_FILE_BYTES)) {
      return res.status(400).json({ error: 'File nhạc không hợp lệ hoặc vượt quá giới hạn.' });
    }
    if ((await readRecords()).some(s => s.fileUrl === blob.url)) {
      return res.status(409).json({ error: 'Bài hát này đã tồn tại trong thư viện.' });
    }
    const record = {
      id: randomUUID(),
      title: normalize(req.body?.title, 'Bài hát chưa đặt tên'),
      artist: 'Nghệ sĩ chưa rõ',
      originalName: normalize(req.body?.originalName, 'audio', 255),
      mimeType: mimeTypes[ext],
      size: blob.size,
      favorite: false,
      fileUrl: blob.url,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await putRecord(record);
    res.status(201).json(publicSong(record));
  } catch (error) { next(error); }
});
app.patch('/api/songs/:id', auth, async (req, res, next) => {
  try {
    const existing = (await readRecords()).find(s => s.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Không tìm thấy bài hát.' });
    const updates = req.body || {};
    const edited = {
      ...existing,
      title: Object.hasOwn(updates, 'title') ? normalize(updates.title, existing.title) : existing.title,
      artist: Object.hasOwn(updates, 'artist') ? normalize(updates.artist, existing.artist) : existing.artist,
      favorite: typeof updates.favorite === 'boolean' ? updates.favorite : existing.favorite,
      updatedAt: new Date().toISOString(),
    };
    delete edited.metaUrl;
    await putRecord(edited);
    await del(existing.metaUrl);
    res.json(publicSong(edited));
  } catch (error) { next(error); }
});
app.delete('/api/songs/:id', auth, async (req, res, next) => {
  try {
    const song = (await readRecords()).find(s => s.id === req.params.id);
    if (!song) return res.status(404).json({ error: 'Không tìm thấy bài hát.' });
    await del([song.metaUrl, song.fileUrl]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});
app.get('/api/stream/:id', auth, async (req, res, next) => {
  try {
    const song = (await readRecords()).find(s => s.id === req.params.id);
    if (!song) return res.status(404).json({ error: 'Không tìm thấy bài hát.' });
    // The public Blob CDN supports seeking / HTTP Range without consuming Function bandwidth.
    res.redirect(302, song.fileUrl);
  } catch (error) { next(error); }
});

// Express serves static files in local dev. Vercel serves public/ via its CDN.
if (!process.env.VERCEL) app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Không tìm thấy API.' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: 'Có lỗi trên server. Kiểm tra cấu hình Vercel Blob và nhật ký Functions.' });
});
if (!process.env.VERCEL) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => console.log(`SONORA chạy tại http://localhost:${port}`));
}
export default app;
