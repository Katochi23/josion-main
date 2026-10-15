const express = require('express');
const store = require('../lib/store');
const { verify, hash, requireAuth, configured } = require('../lib/auth');
const { upload, resolveImage, pruneOrphans, processUploads } = require('../lib/uploads');
const { attemptLimiter, csrf, csrfVerify } = require('../lib/security');
const { DEFAULT_COPY } = require('../lib/copy');

const loginLimiter = attemptLimiter({ max: 8, windowMs: 15 * 60 * 1000 });

/** Every mutating route ends here: persist, then sweep files nothing points at. */
async function save(mutate) {
  const result = await store.update(mutate);
  pruneOrphans(store.referencedImages());
  return result;
}

const router = express.Router();

// Express 4 ignores a rejected promise from an async handler, and Node then
// kills the whole process on the unhandled rejection. Route every handler's
// failure to the error handler at the bottom of this file instead.
for (const verb of ['get', 'post']) {
  const register = router[verb].bind(router);
  router[verb] = (route, ...fns) => register(route, ...fns.map(fn =>
    fn.length === 4 ? fn : (req, res, next) => {
      try { const r = fn(req, res, next); if (r && typeof r.catch === 'function') r.catch(next); }
      catch (err) { next(err); }
    }));
}

/* Shared view locals so every admin template has the same furniture. */
router.use(csrf);
router.use((req, res, next) => {
  res.locals.notice = req.flash('notice');
  res.locals.problem = req.flash('problem');
  res.locals.section = '';
  const s = store.read().settings;
  res.locals.logo = s.logoDark || s.logo || '';   // sidebar mark
  next();
});

const trim = v => (typeof v === 'string' ? v.trim() : '');
/** Repeatable form rows arrive as parallel arrays; zip them and drop empty pairs. */
function pairs(body, aKey, bKey, aName, bName) {
  const a = [].concat(body[aKey] || []);
  const b = [].concat(body[bKey] || []);
  return a.map((v, i) => ({ [aName]: trim(v), [bName]: trim(b[i]) }))
          .filter(o => o[aName] || o[bName]);
}

// ---------------------------------------------------------------- login
router.get('/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin');
  res.render('admin/login', { configured: configured() });
});

router.post('/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!configured()) {
    req.flash('problem', 'No admin password is set. Add ADMIN_PASSWORD_HASH to your .env and restart.');
    return res.redirect('/admin/login');
  }
  if (loginLimiter.blocked(ip)) {
    req.flash('problem', `Too many failed attempts. Try again in ${loginLimiter.retryMinutes(ip)} minutes.`);
    return res.status(429).redirect('/admin/login');
  }
  if (!verify(req.body.password)) {
    loginLimiter.fail(ip);
    req.flash('problem', 'That password did not match. Try again.');
    return res.redirect('/admin/login');
  }
  loginLimiter.clear(ip);
  req.session.regenerate(err => {
    if (err) { req.flash('problem', 'Could not start a session. Try again.'); return res.redirect('/admin/login'); }
    req.session.admin = true;
    res.redirect('/admin');
  });
});

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/admin/login')));

router.use(requireAuth);

// ---------------------------------------------------------------- dashboard
router.get('/', (req, res) => {
  const c = store.read();
  const s = c.settings;
  const missing = [];
  if (!s.logo) missing.push({ what: 'Logo', where: '/admin/settings' });
  if (!s.calendlyUrl) missing.push({ what: 'Calendly link', where: '/admin/settings' });
  if (!s.youtubeId) missing.push({ what: 'YouTube video', where: '/admin/settings' });
  if (!s.whatsapp) missing.push({ what: 'WhatsApp number', where: '/admin/settings' });
  if (c.cases.every(x => x.source !== 'admin')) missing.push({ what: 'A real case study (the demo ones are not clickable)', where: '/admin/cases' });
  res.render('admin/dashboard', {
    section: 'dashboard',
    counts: { cases: c.cases.length, emails: c.emails.length, testimonials: c.testimonials.length },
    missing
  });
});

// ---------------------------------------------------------------- case studies
router.get('/cases', (req, res) =>
  res.render('admin/cases', { section: 'cases', cases: store.list('cases') }));

router.get('/cases/new', (req, res) =>
  res.render('admin/case-form', {
    section: 'cases', mode: 'new',
    item: { results: [{ v: '', l: '' }], art: 'wave' },
    emails: store.list('emails')
  }));

router.get('/cases/:id/edit', (req, res) => {
  const item = store.find('cases', req.params.id);
  if (!item) return res.redirect('/admin/cases');
  res.render('admin/case-form', { section: 'cases', mode: 'edit', item, emails: store.list('emails') });
});

const caseFiles = upload.fields([{ name: 'image', maxCount: 1 }, { name: 'beforeImage', maxCount: 1 }, { name: 'afterImage', maxCount: 1 }]);

function caseFromBody(req, existing = {}) {
  return {
    id: existing.id,
    client: trim(req.body.client),
    cat: trim(req.body.cat),
    title: trim(req.body.title),
    metric: trim(req.body.metric),
    metricLabel: trim(req.body.metricLabel),
    overview: trim(req.body.overview),
    challenge: trim(req.body.challenge),
    strategy: trim(req.body.strategy),
    art: trim(req.body.art) || 'wave',
    emailRef: trim(req.body.emailRef),
    results: pairs(req.body, 'result_v', 'result_l', 'v', 'l'),
    image: resolveImage(req, 'image', existing.image),
    beforeImage: resolveImage(req, 'beforeImage', existing.beforeImage),
    afterImage: resolveImage(req, 'afterImage', existing.afterImage)
  };
}

router.post('/cases', caseFiles, csrfVerify, processUploads, async (req, res) => {
  if (!trim(req.body.title)) { req.flash('problem', 'A case study needs a title.'); return res.redirect('/admin/cases/new'); }
  await save(c => {
    const item = caseFromBody(req);
    item.id = store.slugId('cases', item.title);
    item.source = 'admin';            // only these are clickable in the hero
    c.cases.push(item);
  });
  req.flash('notice', 'Case study added.');
  res.redirect('/admin/cases');
});

router.post('/cases/:id', caseFiles, csrfVerify, processUploads, async (req, res) => {
  const existing = store.find('cases', req.params.id);
  if (!existing) return res.redirect('/admin/cases');
  await save(c => {
    const i = c.cases.findIndex(x => x.id === req.params.id);
    // Editing a demo entry makes it yours, and therefore live in the hero.
    c.cases[i] = Object.assign({}, existing, caseFromBody(req, existing), { source: 'admin' });
  });
  req.flash('notice', 'Case study saved.');
  res.redirect('/admin/cases');
});

router.post('/cases/:id/delete', async (req, res) => {
  await save(c => { c.cases = c.cases.filter(x => x.id !== req.params.id); });
  req.flash('notice', 'Case study deleted.');
  res.redirect('/admin/cases');
});

router.post('/cases/:id/move', async (req, res) => {
  const dir = req.body.dir === 'up' ? -1 : 1;
  await store.update(c => {
    const i = c.cases.findIndex(x => x.id === req.params.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= c.cases.length) return;
    [c.cases[i], c.cases[j]] = [c.cases[j], c.cases[i]];
  });
  res.redirect('/admin/cases');
});

// ---------------------------------------------------------------- email designs
router.get('/emails', (req, res) =>
  res.render('admin/emails', { section: 'emails', emails: store.list('emails') }));

router.get('/emails/new', (req, res) =>
  res.render('admin/email-form', { section: 'emails', mode: 'new', item: {} }));

router.get('/emails/:id/edit', (req, res) => {
  const item = store.find('emails', req.params.id);
  if (!item) return res.redirect('/admin/emails');
  res.render('admin/email-form', { section: 'emails', mode: 'edit', item });
});

const emailFiles = upload.fields([{ name: 'image', maxCount: 1 }, { name: 'mobileImage', maxCount: 1 }]);
const emailUploads = processUploads.as({ image: 'email' });

function emailFromBody(req, existing = {}) {
  return {
    id: existing.id,
    cat: trim(req.body.cat),
    subject: trim(req.body.subject),
    desc: trim(req.body.desc),
    image: resolveImage(req, 'image', existing.image),
    mobileImage: resolveImage(req, 'mobileImage', existing.mobileImage)
  };
}

router.post('/emails', emailFiles, csrfVerify, emailUploads, async (req, res) => {
  if (!trim(req.body.subject)) { req.flash('problem', 'An email design needs a subject line.'); return res.redirect('/admin/emails/new'); }
  await save(c => {
    const item = emailFromBody(req);
    item.id = store.slugId('emails', req.body.cat || item.subject);
    c.emails.push(item);
  });
  req.flash('notice', 'Email design added.');
  res.redirect('/admin/emails');
});

router.post('/emails/:id', emailFiles, csrfVerify, emailUploads, async (req, res) => {
  const existing = store.find('emails', req.params.id);
  if (!existing) return res.redirect('/admin/emails');
  await save(c => {
    const i = c.emails.findIndex(x => x.id === req.params.id);
    // Merge so the coded mock-up fields on seeded designs survive an edit.
    c.emails[i] = Object.assign({}, existing, emailFromBody(req, existing));
  });
  req.flash('notice', 'Email design saved.');
  res.redirect('/admin/emails');
});

router.post('/emails/:id/delete', async (req, res) => {
  await save(c => {
    c.emails = c.emails.filter(x => x.id !== req.params.id);
    c.cases.forEach(cs => { if (cs.emailRef === req.params.id) cs.emailRef = ''; });
  });
  req.flash('notice', 'Email design deleted.');
  res.redirect('/admin/emails');
});

router.post('/emails/:id/move', async (req, res) => {
  const dir = req.body.dir === 'up' ? -1 : 1;
  await store.update(c => {
    const i = c.emails.findIndex(x => x.id === req.params.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= c.emails.length) return;
    [c.emails[i], c.emails[j]] = [c.emails[j], c.emails[i]];
  });
  res.redirect('/admin/emails');
});

// ---------------------------------------------------------------- testimonials
router.get('/testimonials', (req, res) =>
  res.render('admin/testimonials', { section: 'testimonials', items: store.list('testimonials') }));

router.get('/testimonials/new', (req, res) =>
  res.render('admin/testimonial-form', { section: 'testimonials', mode: 'new', item: {} }));

router.get('/testimonials/:id/edit', (req, res) => {
  const item = store.find('testimonials', req.params.id);
  if (!item) return res.redirect('/admin/testimonials');
  res.render('admin/testimonial-form', { section: 'testimonials', mode: 'edit', item });
});

const photoFile = upload.fields([{ name: 'photo', maxCount: 1 }]);

function testimonialFromBody(req, existing = {}) {
  return {
    id: existing.id,
    quote: trim(req.body.quote),
    name: trim(req.body.name),
    role: trim(req.body.role),
    photo: resolveImage(req, 'photo', existing.photo)
  };
}

router.post('/testimonials', photoFile, csrfVerify, processUploads, async (req, res) => {
  if (!trim(req.body.quote)) { req.flash('problem', 'A testimonial needs some words.'); return res.redirect('/admin/testimonials/new'); }
  await save(c => {
    const item = testimonialFromBody(req);
    item.id = store.slugId('testimonials', item.name || 'testimonial');
    c.testimonials.push(item);
  });
  req.flash('notice', 'Testimonial added.');
  res.redirect('/admin/testimonials');
});

router.post('/testimonials/:id', photoFile, csrfVerify, processUploads, async (req, res) => {
  const existing = store.find('testimonials', req.params.id);
  if (!existing) return res.redirect('/admin/testimonials');
  await save(c => {
    const i = c.testimonials.findIndex(x => x.id === req.params.id);
    c.testimonials[i] = Object.assign({}, existing, testimonialFromBody(req, existing));
  });
  req.flash('notice', 'Testimonial saved.');
  res.redirect('/admin/testimonials');
});

router.post('/testimonials/:id/delete', async (req, res) => {
  await save(c => { c.testimonials = c.testimonials.filter(x => x.id !== req.params.id); });
  req.flash('notice', 'Testimonial deleted.');
  res.redirect('/admin/testimonials');
});

router.post('/testimonials/:id/move', async (req, res) => {
  const dir = req.body.dir === 'up' ? -1 : 1;
  await store.update(c => {
    const i = c.testimonials.findIndex(x => x.id === req.params.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= c.testimonials.length) return;
    [c.testimonials[i], c.testimonials[j]] = [c.testimonials[j], c.testimonials[i]];
  });
  res.redirect('/admin/testimonials');
});

// ---------------------------------------------------------------- account
router.get('/account', (req, res) =>
  res.render('admin/account', { section: 'account', fromEnv: !(store.read().settings || {}).passwordHash }));

router.post('/account/password', async (req, res) => {
  const { current, next: fresh, confirm } = req.body;
  const fail = msg => { req.flash('problem', msg); res.redirect('/admin/account'); };

  if (!verify(current)) return fail('Your current password was not correct.');
  if (String(fresh || '').length < 10) return fail('Pick a password of at least 10 characters.');
  if (fresh !== confirm) return fail('The two new passwords did not match.');
  if (fresh === current) return fail('That is already your password.');

  await store.update(c => { c.settings.passwordHash = hash(fresh); });
  // Start a fresh session so an old cookie cannot keep using the old password's session.
  req.session.regenerate(err => {
    if (err) return fail('Password changed, but the session could not be renewed. Sign in again.');
    req.session.admin = true;
    req.flash('notice', 'Password changed. Use the new one next time you sign in.');
    res.redirect('/admin/account');
  });
});

// ---------------------------------------------------------------- faq
router.get('/faqs', (req, res) =>
  res.render('admin/faqs', { section: 'faqs', faqs: store.list('faqs') }));

router.get('/faqs/new', (req, res) =>
  res.render('admin/faq-form', { section: 'faqs', mode: 'new', item: {} }));

router.get('/faqs/:id/edit', (req, res) => {
  const item = store.find('faqs', req.params.id);
  if (!item) return res.redirect('/admin/faqs');
  res.render('admin/faq-form', { section: 'faqs', mode: 'edit', item });
});

router.post('/faqs', async (req, res) => {
  if (!trim(req.body.q)) { req.flash('problem', 'A question needs some text.'); return res.redirect('/admin/faqs/new'); }
  await save(c => {
    c.faqs.push({ id: store.slugId('faqs', req.body.q), q: trim(req.body.q), a: trim(req.body.a) });
  });
  req.flash('notice', 'Question added.');
  res.redirect('/admin/faqs');
});

router.post('/faqs/:id', async (req, res) => {
  const existing = store.find('faqs', req.params.id);
  if (!existing) return res.redirect('/admin/faqs');
  await save(c => {
    const i = c.faqs.findIndex(x => x.id === req.params.id);
    c.faqs[i] = { id: existing.id, q: trim(req.body.q), a: trim(req.body.a) };
  });
  req.flash('notice', 'Question saved.');
  res.redirect('/admin/faqs');
});

router.post('/faqs/:id/delete', async (req, res) => {
  await save(c => { c.faqs = c.faqs.filter(x => x.id !== req.params.id); });
  req.flash('notice', 'Question deleted.');
  res.redirect('/admin/faqs');
});

router.post('/faqs/:id/move', async (req, res) => {
  const dir = req.body.dir === 'up' ? -1 : 1;
  await save(c => {
    const i = c.faqs.findIndex(x => x.id === req.params.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= c.faqs.length) return;
    [c.faqs[i], c.faqs[j]] = [c.faqs[j], c.faqs[i]];
  });
  res.redirect('/admin/faqs');
});

// ---------------------------------------------------------------- page copy
router.get('/copy', (req, res) => {
  const content = store.read();
  res.render('admin/copy', {
    section: 'copy',
    c: store.copy(),
    defaults: DEFAULT_COPY,
    services: content.services,
    steps: content.process,
    clients: content.clients
  });
});

/** Form field names are "section.key"; repeatable rows arrive as parallel arrays. */
router.post('/copy', upload.none(), async (req, res) => {
  const b = req.body;
  const get = k => trim(b[k]);
  const lines = k => String(b[k] || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  await store.update(c => {
    c.copy = {
      hero: { headline: get('hero.headline'), phrases: lines('hero.phrases'), lede: get('hero.lede'),
              ctaPrimary: get('hero.ctaPrimary'), ctaSecondary: get('hero.ctaSecondary'), note: get('hero.note') },
      video: { heading: get('video.heading'), body: trim(b['video.body']) },
      about: {
        tag: get('about.tag'), heading: get('about.heading'),
        beliefs: pairs(b, 'belief_k', 'belief_text', 'k', 'text'),
        stats: [].concat(b.stat_value || []).map((v, i) => ({
          value: trim(v),
          suffix: trim([].concat(b.stat_suffix || [])[i]),
          label: trim([].concat(b.stat_label || [])[i])
        })).filter(x => x.value || x.label)
      },
      services: { tag: get('services.tag'), heading: get('services.heading'), lede: get('services.lede') },
      process:  { tag: get('process.tag'),  heading: get('process.heading'),  lede: get('process.lede') },
      work:     { tag: get('work.tag'),     heading: get('work.heading'),     lede: get('work.lede'), note: get('work.note') },
      emails:   { tag: get('emails.tag'),   heading: get('emails.heading'),   lede: get('emails.lede'), note: get('emails.note') },
      proof:    { tag: get('proof.tag'),    heading: get('proof.heading'),    lede: get('proof.lede'), note: get('proof.note') },
      faq:      { tag: get('faq.tag'),      heading: get('faq.heading'),      lede: get('faq.lede') },
      booking:  { tag: get('booking.tag'),  heading: get('booking.heading'),  lede: get('booking.lede'),
                  bullets: lines('booking.bullets'), whatsappLabel: get('booking.whatsappLabel') },
      final:    { heading: get('final.heading'), body: get('final.body'),
                  ctaPrimary: get('final.ctaPrimary'), ctaSecondary: get('final.ctaSecondary') },
      footer:   { description: get('footer.description') }
    };

    // The service list, the process steps and the client names are page copy
    // too, even though they live outside the `copy` object.
    const svc = pairs(b, 'service_t', 'service_d', 't', 'd');
    if (svc.length) c.services = svc;

    const stepN = [].concat(b.step_n || []);
    const steps = stepN.map((v, i) => ({
      n: trim(v) || String(i + 1).padStart(2, '0'),
      t: trim([].concat(b.step_t || [])[i]),
      d: trim([].concat(b.step_d || [])[i])
    })).filter(x => x.t || x.d);
    if (steps.length) c.process = steps;

    const names = lines('clients');
    if (names.length) c.clients = names;
  });
  req.flash('notice', 'Page copy saved.');
  res.redirect('/admin/copy');
});

// ---------------------------------------------------------------- links & settings
router.get('/settings', (req, res) =>
  res.render('admin/settings', { section: 'settings', s: store.read().settings }));

const brandFiles = upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'logoDark', maxCount: 1 }, { name: 'favicon', maxCount: 1 }]);

router.post('/settings', brandFiles, csrfVerify, processUploads, async (req, res) => {
  await save(c => {
    const s = c.settings;
    s.logo = resolveImage(req, 'logo', s.logo);
    s.logoDark = resolveImage(req, 'logoDark', s.logoDark);
    s.favicon = resolveImage(req, 'favicon', s.favicon);
    s.calendlyUrl = trim(req.body.calendlyUrl);
    s.youtubeId = extractYouTubeId(trim(req.body.youtubeId));
    s.youtubeTitle = trim(req.body.youtubeTitle);
    s.whatsapp = trim(req.body.whatsapp).replace(/[^0-9]/g, '');
    s.whatsappMsg = trim(req.body.whatsappMsg);
    s.email = trim(req.body.email);
    s.privacyUrl = trim(req.body.privacyUrl);
    s.termsUrl = trim(req.body.termsUrl);
    s.social = { li: trim(req.body.social_li), ig: trim(req.body.social_ig), x: trim(req.body.social_x) };
    // Analytics is deliberately not a free-text script box: an ID and a script
    // URL cover every common provider without an HTML injection point.
    const ga = trim(req.body.gaId).toUpperCase();
    s.gaId = /^(G-[A-Z0-9]{6,12}|UA-\d{4,10}-\d{1,4})$/.test(ga) ? ga : '';
    const src = trim(req.body.analyticsSrc);
    s.analyticsSrc = /^https:\/\/[\w.-]+\/[\w./-]+\.js$/.test(src) ? src : '';
    s.analyticsSiteId = trim(req.body.analyticsSiteId).slice(0, 80);
  });
  req.flash('notice', 'Settings saved.');
  res.redirect('/admin/settings');
});

/** Accepts a bare id or any normal YouTube URL and returns the id. */
function extractYouTubeId(input) {
  if (!input) return '';
  if (/^[\w-]{11}$/.test(input)) return input;
  const m = input.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([\w-]{11})/);
  // Anything we can't recognise is dropped rather than passed through — it would
  // otherwise be concatenated straight into the embed URL.
  return m ? m[1] : '';
}

// upload errors (wrong type, too large, unreadable) and any other failure in a
// handler come back here, so the server stays up and the admin sees a message
router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  let msg = err.message || 'That upload was rejected.';
  if (err.code === 'LIMIT_FILE_SIZE') msg = 'That image is larger than 8 MB. Make it smaller and upload it again.';
  else if (!err.code && !/image/i.test(msg)) { console.error(err); msg = 'That could not be saved: ' + msg; }
  req.flash('problem', msg);
  res.redirect(req.get('Referer') || '/admin');
});

module.exports = router;
