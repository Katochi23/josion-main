/**
 * Integration tests. No framework — node's built-in runner, a real server and
 * real HTTP, against a throwaway copy of the content file.
 *
 *   npm test
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.SESSION_SECRET = 'test-secret-not-used-anywhere-real';
process.env.ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync('test-password', 4);
process.env.PORT = '0';

// The suite works on its own copy of the content, never the real file: an
// interrupted run used to leave test data behind in data/content.json, and a
// dev server running alongside would have its saves overwritten on restore.
const REAL = path.join(__dirname, '..', 'data', 'content.json');
const FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'josion-test-')), 'content.json');
fs.copyFileSync(REAL, FILE);
process.env.CONTENT_FILE = FILE;
const UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), 'josion-test-uploads-'));
process.env.UPLOADS_DIR = UPLOADS;

let base, server, cookie = '', token = '';

const url = p => base + p;

async function get(p) {
  const res = await fetch(url(p), { headers: { cookie }, redirect: 'manual' });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const body = await res.text();
  const m = body.match(/name="_csrf" value="([^"]+)"/);
  if (m) token = m[1];
  return { status: res.status, body, location: res.headers.get('location') };
}

async function post(p, fields) {
  const form = new URLSearchParams({ _csrf: token, ...fields });
  const res = await fetch(url(p), {
    method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: form, redirect: 'manual'
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return { status: res.status, location: res.headers.get('location'), body: await res.text() };
}

before(async () => {
  const app = require('../server');
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
});

after(() => {
  if (server) server.close();
  fs.rmSync(path.dirname(FILE), { recursive: true, force: true });
  fs.rmSync(UPLOADS, { recursive: true, force: true });
});

describe('public page', () => {
  test('renders', async () => {
    const r = await get('/');
    assert.equal(r.status, 200);
    assert.match(r.body, /JOSION/);
  });

  test('case studies are in the HTML for crawlers without JS', async () => {
    const r = await get('/');
    assert.match(r.body, /class="wcard-title"/);
  });

  test('never leaks the admin password hash', async () => {
    const r = await get('/');
    assert.ok(!/passwordHash/.test(r.body), 'passwordHash appeared in the page');
    assert.ok(!/\$2[aby]\$/.test(r.body), 'a bcrypt hash appeared in the page');
  });

  test('injected content cannot break out of the data script tag', async () => {
    const content = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const original = content.cases[0].title;
    content.cases[0].title = 'x</script><script>window.pwned=1</script>';
    fs.writeFileSync(FILE, JSON.stringify(content));
    delete require.cache[require.resolve('../lib/store')];
    const r = await fetch(url('/')).then(x => x.text());
    assert.ok(!r.includes('<script>window.pwned=1</script>'), 'script tag escaped the payload');
    content.cases[0].title = original;
    fs.writeFileSync(FILE, JSON.stringify(content, null, 2));
  });

  test('robots.txt keeps crawlers out of the dashboard', async () => {
    const r = await get('/robots.txt');
    assert.match(r.body, /Disallow: \/admin/);
  });

  test('unknown pages render the styled 404', async () => {
    const r = await get('/no-such-page');
    assert.equal(r.status, 404);
  });
});

describe('admin access', () => {
  test('the dashboard requires a session', async () => {
    const r = await get('/admin');
    assert.equal(r.status, 302);
    assert.match(r.location, /\/admin\/login/);
  });

  test('a wrong password is rejected', async () => {
    await get('/admin/login');
    const r = await post('/admin/login', { password: 'wrong' });
    assert.equal(r.status, 302);
    const after = await get('/admin');
    assert.equal(after.status, 302, 'a bad password should not create a session');
  });

  test('a correct password signs in', async () => {
    await get('/admin/login');
    await post('/admin/login', { password: 'test-password' });
    const r = await get('/admin');
    assert.equal(r.status, 200);
    assert.match(r.body, /Overview/);
  });

  test('a POST without a CSRF token is refused', async () => {
    await get('/admin/faqs/new');
    const res = await fetch(url('/admin/faqs'), {
      method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ q: 'No token', a: 'Should not save' }), redirect: 'manual'
    });
    assert.equal(res.status, 403);
  });
});

describe('every admin page renders clean markup', () => {
  // A CSRF token was once injected into the middle of a <form> tag, because the
  // tag contained an EJS expression whose "%>" has a ">" in it. The page still
  // returned 200 and the test suite stayed green while half the markup leaked
  // onto the screen as text. These assertions look at the rendered HTML itself.
  const pages = ['/admin', '/admin/cases', '/admin/emails', '/admin/testimonials',
                 '/admin/faqs', '/admin/copy', '/admin/settings', '/admin/account',
                 '/admin/cases/new', '/admin/emails/new', '/admin/testimonials/new', '/admin/faqs/new'];

  for (const page of pages) {
    test(page + ' has no unrendered template or broken tags', async () => {
      const r = await get(page);
      assert.equal(r.status, 200, page + ' did not render');
      assert.ok(!r.body.includes('<%'), 'unrendered EJS left in the output');

      // An attribute split by a stray newline leaves fragments like  /move">  as
      // visible text between tags.
      assert.ok(!/>\s*\/(move|delete)"/.test(r.body), 'a form action leaked into the page as text');
      assert.ok(!/onsubmit="return confirm\([^)]*$/m.test(r.body), 'an onsubmit handler was cut in half');

      // Each form must carry exactly one token, and it must sit inside the form.
      const forms = (r.body.match(/<form\b/g) || []).length;
      const tokens = (r.body.match(/name="_csrf"/g) || []).length;
      assert.equal(tokens, forms, `${page}: ${forms} forms but ${tokens} CSRF tokens`);

      // Counting tokens is not enough: an unclosed action="..." swallows the
      // token input as text and the count still matches. Every action must be a
      // plain path.
      const actions = [...r.body.matchAll(/<form\b[^]*?\baction="([^"]*)"/g)].map(m => m[1]);
      assert.equal(actions.length, forms, `${page}: a form has no readable action`);
      for (const a of actions) assert.match(a, /^\/admin\/[a-z0-9/-]*$/, `${page}: broken form action ${JSON.stringify(a)}`);
    });
  }

  test('list pages build working action URLs', async () => {
    const r = await get('/admin/cases');
    assert.match(r.body, /action="\/admin\/cases\/[a-z0-9-]+\/move"/, 'no valid move action found');
    assert.match(r.body, /action="\/admin\/cases\/[a-z0-9-]+\/delete"/, 'no valid delete action found');
  });

  test('reordering from the list page actually works', async () => {
    const before = JSON.parse(fs.readFileSync(FILE, 'utf8')).cases.map(c => c.id);
    await get('/admin/cases');
    const r = await post('/admin/cases/' + before[0] + '/move', { dir: 'down' });
    assert.equal(r.status, 302);
    const after = JSON.parse(fs.readFileSync(FILE, 'utf8')).cases.map(c => c.id);
    assert.equal(after[1], before[0], 'the case study did not move');
    await post('/admin/cases/' + before[0] + '/move', { dir: 'up' });
  });
});

describe('editing content', () => {
  test('page copy saves and shows on the site', async () => {
    await get('/admin/copy');
    const r = await post('/admin/copy', { 'hero.headline': 'Tested headline is' });
    assert.equal(r.status, 302);
    const page = await get('/');
    assert.match(page.body, /Tested headline is/);
  });

  test('clearing a copy field restores the shipped wording', async () => {
    await get('/admin/copy');
    await post('/admin/copy', { 'hero.headline': '' });
    const page = await get('/');
    assert.match(page.body, /Your list is the/);
  });

  test('an FAQ can be added, edited and deleted', async () => {
    await get('/admin/faqs/new');
    await post('/admin/faqs', { q: 'Does this test work?', a: 'Apparently so.' });
    let page = await get('/');
    assert.match(page.body, /Does this test work\?/);

    await get('/admin/faqs');
    await post('/admin/faqs/does-this-test-work/delete', {});
    page = await get('/');
    assert.ok(!page.body.includes('Does this test work?'), 'deleted FAQ still on the page');
  });

  test('a testimonial can be added and appears on the site', async () => {
    await get('/admin/testimonials/new');
    await post('/admin/testimonials', { quote: 'A tested quote.', name: 'Test Person', role: 'Tester' });
    const page = await get('/');
    assert.match(page.body, /testimonial|tcard|tGrid/);
    const content = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    assert.ok(content.testimonials.some(t => t.name === 'Test Person'));
  });
});

describe('the password can be changed from the dashboard', () => {
  test('the wrong current password is refused', async () => {
    await get('/admin/account');
    await post('/admin/account/password', { current: 'nope', next: 'a-long-new-password', confirm: 'a-long-new-password' });
    const content = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    assert.ok(!content.settings.passwordHash, 'password changed without the current one');
  });

  test('a matching pair is accepted and takes effect', async () => {
    await get('/admin/account');
    await post('/admin/account/password', {
      current: 'test-password', next: 'a-long-new-password', confirm: 'a-long-new-password'
    });
    const content = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    assert.ok(content.settings.passwordHash, 'no new hash was stored');

    delete require.cache[require.resolve('../lib/auth')];
    delete require.cache[require.resolve('../lib/store')];
    const auth = require('../lib/auth');
    assert.ok(auth.verify('a-long-new-password'), 'new password does not verify');
    assert.ok(!auth.verify('test-password'), 'old password still works');
  });
});

describe('the store survives bad input', () => {
  test('a failed write rolls back and does not jam the queue', async () => {
    const store = require('../lib/store');
    const before = JSON.stringify(store.read());
    await assert.rejects(store.update(() => { throw new Error('deliberate'); }));
    assert.equal(JSON.stringify(store.read()), before, 'content changed despite a failed write');
    await store.update(c => { c.settings.youtubeTitle = c.settings.youtubeTitle || ''; });
  });
});

describe('uploads', () => {
  test('a file that is not really an image is refused, not saved as a broken image', async () => {
    await get('/admin/cases/new');
    const uploadsBefore = fs.readdirSync(UPLOADS);
    const form = new FormData();
    form.append('_csrf', token);
    form.append('title', 'Renamed text file upload');
    form.append('image', new Blob(['this is text, not a jpeg'], { type: 'image/jpeg' }), 'photo.jpg');
    const res = await fetch(url('/admin/cases'), {
      method: 'POST', headers: { cookie, referer: url('/admin/cases/new') }, body: form, redirect: 'manual'
    });
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /\/admin\/cases\/new$/, 'should go back to the form');
    const content = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    assert.ok(!content.cases.some(c => c.title === 'Renamed text file upload'), 'the case study was saved anyway');
    assert.deepEqual(fs.readdirSync(UPLOADS), uploadsBefore, 'the bad file was left on disk');
    const page = await get('/admin/cases/new');
    assert.match(page.body, /not a readable image/, 'no message explained the refusal');
  });

  test('the server is still up afterwards', async () => {
    assert.equal((await get('/healthz')).status, 200);
  });
});

describe('isolation', () => {
  test('the suite never writes to the real content file', () => {
    assert.notEqual(path.resolve(require('../lib/store').FILE), path.resolve(REAL));
  });
});

describe('saves never undo changes made elsewhere', () => {
  // Two server processes on one content file, or a file restored while the
  // server runs: the next save used to write this process's stale copy back,
  // and the other change vanished after a restart.
  test('a change written to the file by someone else survives our next save', async () => {
    const content = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    content.faqs.push({ id: 'written-elsewhere', q: 'Written by another process?', a: 'Yes.' });
    fs.writeFileSync(FILE, JSON.stringify(content, null, 2));

    await get('/admin/faqs/new');
    await post('/admin/faqs', { q: 'Saved through the dashboard?', a: 'Yes.' });

    const after = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    assert.ok(after.faqs.some(f => f.id === 'written-elsewhere'), 'the outside change was overwritten');
    assert.ok(after.faqs.some(f => f.q === 'Saved through the dashboard?'), 'the dashboard save was lost');
  });
});

describe('email screenshots keep their width', () => {
  test('a long email is not squashed into a thin strip', async () => {
    const sharp = require('sharp');
    const png = await sharp({ create: { width: 600, height: 6000, channels: 3, background: '#2255aa' } }).png().toBuffer();
    await get('/admin/emails/new');
    const form = new FormData();
    form.append('_csrf', token);
    form.append('subject', 'Tall email width check');
    form.append('image', new Blob([png], { type: 'image/png' }), 'tall.png');
    const res = await fetch(url('/admin/emails'), { method: 'POST', headers: { cookie }, body: form, redirect: 'manual' });
    assert.equal(res.status, 302);
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8')).emails.find(e => e.subject === 'Tall email width check');
    assert.ok(saved && saved.image, 'email was not saved with an image');
    const file = path.join(UPLOADS, path.basename(saved.image));
    const meta = await sharp(file).metadata();
    fs.unlinkSync(file);
    assert.equal(meta.width, 600, `stored at ${meta.width}x${meta.height}`);
  });
});

describe('logo uploads', () => {
  test('the empty border around a logo is trimmed away', async () => {
    const sharp = require('sharp');
    const mark = await sharp({ create: { width: 120, height: 60, channels: 3, background: '#1264FF' } }).png().toBuffer();
    const padded = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#ffffff' } })
      .composite([{ input: mark, top: 270, left: 240 }]).jpeg().toBuffer();
    const before = JSON.parse(fs.readFileSync(FILE, 'utf8')).settings;
    await get('/admin/settings');
    const form = new FormData();
    form.append('_csrf', token);
    form.append('logo', new Blob([padded], { type: 'image/jpeg' }), 'padded-logo.jpg');
    for (const k of ['calendlyUrl', 'youtubeId', 'whatsapp', 'email']) form.append(k, before[k] || '');
    const res = await fetch(url('/admin/settings'), { method: 'POST', headers: { cookie }, body: form, redirect: 'manual' });
    assert.equal(res.status, 302);
    const logo = JSON.parse(fs.readFileSync(FILE, 'utf8')).settings.logo;
    const file = path.join(UPLOADS, path.basename(logo));
    const meta = await sharp(file).metadata();
    fs.unlinkSync(file);
    assert.ok(meta.width <= 130 && meta.height <= 70, `logo stored at ${meta.width}x${meta.height}, border not trimmed`);
  });
});

describe('content from the first deployed version still works', () => {
  // The live server's content.json was written by an older dashboard:
  // testimonials as {q, n, r} and case studies without a `source` field.
  test('old testimonials and case studies are upgraded on load', async () => {
    const current = fs.readFileSync(FILE, 'utf8');
    const old = JSON.parse(current);
    old.testimonials = [{ q: 'They rebuilt our flows in a month.', n: 'Legacy Person', r: 'Founder, test brand' }];
    old.cases = [{ id: 'legacy-case', client: 'Legacy Client', title: 'Old-format case', cat: 'Test', metric: '+1%', metricLabel: 'x',
      overview: '', challenge: '', strategy: '', results: [], art: 'wave', image: '', beforeImage: '', afterImage: '', emailRef: '' }];
    delete old.copy; delete old.faqs;
    fs.writeFileSync(FILE, JSON.stringify(old, null, 2));
    try {
      const page = await get('/');
      assert.equal(page.status, 200);
      const data = JSON.parse(page.body.match(/window\.JOSION\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/)[1]);
      assert.equal(data.testimonials[0].quote, 'They rebuilt our flows in a month.');
      assert.equal(data.testimonials[0].name, 'Legacy Person');
      assert.equal(data.cases[0].source, 'admin', 'a real case study would show as an unclickable demo');
      assert.equal((await get('/admin/testimonials')).status, 200);
      assert.equal((await get('/admin/faqs')).status, 200);
    } finally {
      fs.writeFileSync(FILE, current);
    }
  });
});

describe('isolation from real uploads', () => {
  // Saves prune files nothing in the content points at. Pointed at the real
  // folder, the suite's own saves once deleted a real logo.
  test('the suite never prunes or writes the real uploads folder', () => {
    const real = path.resolve(__dirname, '..', 'public', 'uploads');
    assert.notEqual(path.resolve(require('../lib/uploads').DIR), real);
  });
});
