const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');

// UPLOADS_DIR lets the test suite use a throwaway folder: its saves prune files
// nothing in *its* content points at, which in the real folder meant real images.
const DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(DIR, { recursive: true });

/**
 * SVG is deliberately absent. An SVG can contain <script>, and anything served
 * from /uploads/ runs on our own origin — one uploaded file would be stored XSS
 * against every visitor. Raster only.
 */
const ALLOWED = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif']
]);
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

let counter = 0;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DIR),
  filename: (req, file, cb) => {
    // Extension comes from the sniffed mime type, not from the client's filename.
    const ext = ALLOWED.get(file.mimetype) || '.png';
    const stem = path.basename(file.originalname, path.extname(file.originalname))
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
    counter = (counter + 1) % 1e4;   // two files in the same millisecond must not collide
    cb(null, `${stem}-${Date.now().toString(36)}${counter.toString(36)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ALLOWED.has(file.mimetype) && (!ext || ALLOWED_EXT.has(ext))) return cb(null, true);
    cb(new Error('Only PNG, JPG, WebP or GIF images can be uploaded.'));
  }
});

/**
 * Returns the public path for a field: the newly uploaded file if there is one,
 * the existing value if the field was left alone, or '' if the admin ticked "remove".
 */
function resolveImage(req, field, existing) {
  const uploaded = req.files && req.files[field] && req.files[field][0];
  if (req.body[`${field}__remove`]) {
    // "Remove" wins over a file picked in the same submit; don't leave that file behind.
    if (uploaded) safeUnlink(path.join(DIR, uploaded.filename));
    return '';
  }
  return uploaded ? `/uploads/${uploaded.filename}` : (existing || '');
}

function safeUnlink(abs) {
  const resolved = path.resolve(abs);
  if (!resolved.startsWith(DIR + path.sep)) return;   // never delete outside the uploads dir
  fs.unlink(resolved, () => {});
}

/**
 * Delete uploaded files nothing points at any more — replaced images, images on
 * deleted records. Files younger than a minute are spared so an upload that is
 * mid-request never gets swept away.
 */
function pruneOrphans(referenced) {
  fs.readdir(DIR, (err, files) => {
    if (err) return;
    const cutoff = Date.now() - 60 * 1000;
    files.forEach(name => {
      if (name === '.gitkeep') return;
      if (referenced.has('/uploads/' + name)) return;
      const abs = path.join(DIR, name);
      fs.stat(abs, (e, st) => {
        if (e || st.mtimeMs > cutoff) return;
        safeUnlink(abs);
      });
    });
  });
}

/**
 * Shrink an upload to something sensible for the web and strip EXIF.
 *
 * Photographs arrive straight off a phone at several megabytes; serving those
 * untouched is the single biggest weight on the page. Images are resized to fit
 * their role, re-encoded, and only replaced if the result is actually smaller.
 * A failure here is never fatal — the original file simply stays as it is.
 */
const BOUNDS = {
  photo:  { width: 480,  height: 480,  fit: 'cover'  },   // testimonial headshots
  logo:   { width: 900,  height: 400,  fit: 'inside' },
  // Emails are long: cap the width only. A height cap squashed a 15,000px
  // email down to a strip under 200px wide.
  email:  { width: 1200, height: 20000, fit: 'inside' },
  wide:   { width: 1800, height: 1400, fit: 'inside' }    // case study artwork
};
const ROLE = {
  photo: 'photo', logo: 'logo', logoDark: 'logo', favicon: 'logo',
  image: 'wide', beforeImage: 'email', afterImage: 'email', mobileImage: 'email'
};

/** Returns false when the file is not a decodable image at all. */
async function optimise(absPath, role) {
  const bound = BOUNDS[role] || BOUNDS.wide;
  const tmp = absPath + '.opt';
  let meta;
  try {
    // The mime type multer checked is whatever the browser claimed. A renamed
    // text file passes that check, so decode the file to be sure it is an image.
    meta = await sharp(absPath).metadata();
    if (!meta.width || !meta.height) return false;
  } catch (err) {
    return false;
  }
  try {
    if (meta.format === 'gif') return true;            // leave animations alone
    const before = fs.statSync(absPath).size;
    let img = sharp(absPath).rotate();                 // honour EXIF orientation, then drop it
    // Logo files usually arrive as a square canvas with the mark floating in the
    // middle; at header height that border shrank the mark to a smudge. Cut away
    // the plain border so the mark itself fills the space it is given.
    const trim = role === 'logo';
    if (trim) img = img.trim({ threshold: 24 });
    await img
      .resize({ ...bound, withoutEnlargement: true })
      .toFormat(meta.hasAlpha ? 'png' : 'jpeg', { quality: 82, compressionLevel: 9 })
      .toFile(tmp);
    if (trim || fs.statSync(tmp).size < before) fs.renameSync(tmp, absPath);
    else fs.unlinkSync(tmp);
  } catch (err) {
    console.error('[uploads] could not optimise ' + path.basename(absPath) + ':', err.message);
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
  return true;
}

/**
 * Run over every file in this request. If any file is not a readable image,
 * every file from the request is deleted and the whole save is refused — a
 * half-saved record pointing at a broken image is worse than no save.
 */
async function optimiseAll(req, roles = {}) {
  if (!req.files) return;
  const files = [];
  Object.keys(req.files).forEach(field => req.files[field].forEach(f => files.push({ f, field })));
  const ok = await Promise.all(files.map(({ f, field }) => optimise(path.join(DIR, f.filename), roles[field] || ROLE[field])));
  const bad = files.filter((_, i) => !ok[i]);
  if (bad.length) {
    files.forEach(({ f }) => safeUnlink(path.join(DIR, f.filename)));
    throw new Error(`"${bad[0].f.originalname}" is not a readable image. Save it again as PNG or JPG and re-upload it.`);
  }
}

/**
 * Route middleware: run after multer and csrfVerify. Bad images go to the error
 * handler. Field names repeat across forms ("image" is case artwork on one form
 * and an email screenshot on another), so a route can name the role per field.
 */
function processUploads(req, res, next) {
  optimiseAll(req).then(() => next(), next);
}
processUploads.as = roles => (req, res, next) => { optimiseAll(req, roles).then(() => next(), next); };

module.exports = { upload, resolveImage, pruneOrphans, optimiseAll, processUploads, DIR };
