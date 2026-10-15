/**
 * Content store.
 *
 * Everything the site renders lives in one JSON document on disk. Reads are
 * served from memory; writes go through a queue so two admins saving at the
 * same time can't interleave and corrupt the file.
 *
 * Swapping this for MongoDB means reimplementing read()/write() against a
 * single `content` document — nothing else in the app touches the filesystem.
 */
const fs = require('fs');
const path = require('path');
const { withDefaults } = require('./copy');

// CONTENT_FILE lets the test suite work on its own copy instead of the real content.
const FILE = process.env.CONTENT_FILE || path.join(__dirname, '..', 'data', 'content.json');
const TMP = FILE + '.tmp';

const DEFAULTS = {
  settings: {
    logo: '', logoDark: '', favicon: '',
    calendlyUrl: '', whatsapp: '', whatsappMsg: '', youtubeId: '', youtubeTitle: '',
    email: '', social: { li: '', ig: '', x: '' }, privacyUrl: '', termsUrl: '',
    gaId: '', analyticsSrc: '', analyticsSiteId: '', passwordHash: ''
  },
  copy: {},
  clients: [], services: [], process: [], testimonials: [], faqs: [], emails: [], cases: []
};

let cache = null;
let cacheStamp = null;
let queue = Promise.resolve();

/**
 * Bring content written by older versions of the app up to the current shape.
 * The first deployed version stored testimonials as {q, n, r} and never marked
 * case studies with `source`, so after an upgrade the client's real case
 * studies would have rendered as unclickable demos and testimonials as blanks.
 * Runs in memory on every load; the upgraded shape is written on the next save.
 */
function migrate(c) {
  c.testimonials = (c.testimonials || []).map((t, i) => {
    if (!t || t.quote !== undefined) return t;
    const { q, n, r, ...rest } = t;
    return { id: rest.id || 'testimonial-' + (i + 1), ...rest, quote: q || '', name: n || '', role: r || '', photo: rest.photo || '' };
  });
  // Only the shipped examples carry source: 'seed'. Anything else was entered
  // by a person, whichever version of the dashboard they used.
  c.cases = (c.cases || []).map(x => (x && !x.source ? { ...x, source: 'admin' } : x));
  return c;
}

/** Identifies the file version on disk; changes whenever anything rewrites it. */
function stamp() {
  try { const st = fs.statSync(FILE); return st.mtimeMs + ':' + st.size; } catch (err) { return null; }
}

/**
 * The cache is only trusted while the file on disk is unchanged. Anything else
 * that writes content.json — a second server process, a restored backup, a
 * hand edit — used to be silently overwritten by this process's stale copy on
 * its next save, which looked like saved changes vanishing after a restart.
 */
function read() {
  const now = stamp();
  if (cache && now === cacheStamp) return cache;
  try {
    const fresh = migrate(Object.assign({}, JSON.parse(JSON.stringify(DEFAULTS)), JSON.parse(fs.readFileSync(FILE, 'utf8'))));
    if (cache) console.warn('[store] content.json changed on disk; reloaded it');
    cache = fresh;
  } catch (err) {
    if (cache) return cache;          // mid-write by someone else: keep the last good copy
    if (err.code !== 'ENOENT') console.error('[store] content.json unreadable, starting empty:', err.message);
    cache = JSON.parse(JSON.stringify(DEFAULTS));
  }
  cacheStamp = now;
  return cache;
}

/**
 * Run `mutate(content)` and persist the result, serialised against other writes.
 *
 * The mutation runs against a copy: if it throws, the in-memory content and the
 * file on disk are both left exactly as they were. The queue survives a failed
 * write too — an earlier rejection must not stop every later save.
 */
function update(mutate) {
  const run = queue.then(async () => {
    const draft = JSON.parse(JSON.stringify(read()));
    const result = await mutate(draft);
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(TMP, JSON.stringify(draft, null, 2));
    fs.renameSync(TMP, FILE);           // atomic swap, so a crash never truncates the file
    cache = draft;                      // only commit once the write succeeded
    cacheStamp = stamp();
    return result;
  });
  queue = run.catch(() => {});          // keep the queue alive after a failure
  return run;
}

const list = key => read()[key] || [];
/** Saved copy merged over the shipped defaults. */
const copy = () => withDefaults(read().copy);
const find = (key, id) => list(key).find(x => x.id === id);

/** Every image path referenced anywhere in the content. Used to prune orphans. */
function referencedImages() {
  const c = read();
  const out = new Set();
  const add = v => { if (typeof v === 'string' && v.startsWith('/uploads/')) out.add(v); };
  ['logo', 'logoDark', 'favicon'].forEach(k => add(c.settings[k]));
  c.cases.forEach(x => ['image', 'beforeImage', 'afterImage'].forEach(k => add(x[k])));
  c.emails.forEach(x => ['image', 'mobileImage'].forEach(k => add(x[k])));
  (c.testimonials || []).forEach(x => add(x.photo));
  return out;
}

/** URL-safe id derived from a title, kept unique within its collection. */
function slugId(key, text, ignoreId) {
  const base = String(text || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'item';
  const taken = new Set(list(key).filter(x => x.id !== ignoreId).map(x => x.id));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

module.exports = { read, update, list, find, slugId, copy, referencedImages, FILE };
