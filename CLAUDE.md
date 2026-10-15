# JOSION — project context

Marketing site for JOSION Marketing Agency (email, automation and ecommerce
growth for DTC brands) plus a dashboard the owner uses to run it. Node, Express,
EJS, a JSON content store, Multer + sharp for uploads.

Built in a long chat session before this one. Everything below is a decision
already made or a trap already hit — read it before changing things.

## Commands

```bash
npm start      # site on :3000, dashboard on /admin
npm test       # 31 integration tests, real server, real HTTP
```

A `.env` is required (`cp .env.example .env`). The bootstrap password hash goes
in `ADMIN_PASSWORD_HASH`; after the first change from the dashboard the hash
lives in `data/content.json` and wins.

## Shape of it

| Path | What it is |
| --- | --- |
| `server.js` | Routes, sessions, static files, the public page |
| `lib/store.js` | **The only file that touches disk.** Queued, atomic writes |
| `lib/copy.js` | Default page wording, deep-merged under saved edits |
| `lib/auth.js` | bcrypt check + route guard |
| `lib/uploads.js` | Multer config, sharp optimisation, orphan pruning |
| `lib/security.js` | Headers, CSRF, login throttle, script-safe JSON |
| `routes/admin.js` | Every dashboard route |
| `views/index.ejs` | The public page |
| `public/js/site.js` | Page behaviour, renders from `window.JOSION` |
| `data/content.json` | All content. Back this up. |

## Design language

Dark by default, light theme supported, toggle in the header. Tokens live at the
top of `public/css/site.css`. Palette is pinned by the client brief: blue, black,
white (`#1264FF` signal, `#04060B` void, `#EEF3FB` paper).

One typeface, Archivo, worked hard — the variable width axis carries the
hierarchy (condensed labels, expanded numerals). That replaces the usual
monospace-for-data move. Manrope for body.

The structural device is an **ascending trajectory**, taken from the arrow in the
logo: hero cards climb left to right, the process section is a drawn rising
curve, a hairline rail tracks scroll up the left edge.

**Dark islands.** Case-study artwork, the video container and the modal header
stay dark in *both* themes — they are imagery, not chrome. They carry scoped
token overrides so text inside them stays legible without per-element patching.
Preview *frames* (email tiles, the before/after slider) follow the theme instead,
because the content inside them is already white.

## Things that will bite you

- **Never regex a `<form>` tag in these templates.** The tags contain EJS
  (`<%= c.id %>`) and `%>` has a `>` in it, so `[^>]*` stops mid-expression. This
  already happened once and silently broke nine forms across three pages while
  every test stayed green. The markup-integrity tests in `test/app.test.js` exist
  because of it — keep them.
- **CSRF on upload forms is checked twice.** The router-level middleware cannot
  see `req.body` for multipart requests because multer has not run yet, so those
  routes call `csrfVerify` again *after* their upload middleware.
- **Uploads are decoded before saving.** Upload routes run `processUploads`
  after `csrfVerify`; a file sharp cannot read (a renamed text file passes the
  mime check) deletes every file in the request and refuses the save. Async
  route handlers are wrapped at the top of `routes/admin.js` so a rejection
  reaches the error handler instead of killing the process.
- **The store's cache is checked against the file on every read.** It used to
  load once and trust memory forever, so a second server process (or a
  restored file) got overwritten by the stale copy on the next save — saved
  changes then "vanished" after a restart. Keep the mtime/size check in `read()`.
- **`public/uploads/` is committed to git** alongside `data/content.json`,
  which points at those files. Upload roles are per route: the email form's
  `image` field is a long screenshot (`processUploads.as({ image: 'email' })`),
  not case-study artwork — the shared name once squashed emails to ~180px wide.
- **Tests never touch `data/content.json` or `public/uploads/`.** The suite
  copies the content to a temp dir (`CONTENT_FILE`) and uploads to another
  (`UPLOADS_DIR`). Saves prune unreferenced uploads, so a suite pointed at the
  real folder once deleted a real logo.
- **The live server once ran an older version** (first repo, Sep 2026) and its
  dashboard content was merged into this repo on 2026-10-15. `store.read()`
  upgrades that older shape on load (testimonials `{q,n,r}`, case studies
  without `source`). Content entered on a server exists only there until it is
  copied back into the repo — a deploy that replaces `data/content.json`
  overwrites it.
- **Settings sent to the browser are allow-listed** in `server.js`
  (`PUBLIC_SETTINGS`). `c.settings` holds the bcrypt password hash. Add a new
  public field there deliberately; anything else stays private by default.
- **Content goes into the page as escaped JSON** via `scriptJson()`. Plain
  `JSON.stringify` does not escape `</script>` and would let dashboard text break
  out of the tag.
- **The page script is one IIFE.** An exception anywhere kills everything after
  it. Independent blocks run inside `safe()`, and every render target goes
  through `fill()` because sections are conditionally rendered. A single process
  step once threw on `i/(steps-1)` and took out the email gallery and the
  WhatsApp link.
- **Sections hide themselves when empty** — video without a YouTube ID,
  testimonials with none, FAQ with none. An empty bordered grid under a heading
  looks broken.
- **No developer copy in the rendered page.** Instructions like "set
  CONFIG.calendlyUrl" leaked to visitors twice. There is a test asserting `<%`
  never reaches the browser; keep that habit for prose too.

## Content rules

- Case studies created in the dashboard are clickable in the hero; the five
  shipped examples are display-only there (`source` field). Editing an example
  adopts it. **The work grid still opens everything, including examples — that
  inconsistency is unresolved and was a deliberate client instruction.**
- Copy fields support `**white emphasis**`, `*blue emphasis*` and newline →
  `<br>`. Escaped first, so typing `<` is safe.
- Clearing a copy field restores the shipped default rather than blanking it.
- Images without uploads fall back to generated SVG artwork; email designs
  without screenshots fall back to coded mock-ups. Half-finished entries must
  never look broken.

## Open decisions (ask before assuming)

1. **Hosting.** Uploads are on local disk. On Render/Railway the filesystem is
   wiped each deploy and `content.json` keeps pointing at dead images. Needs
   Cloudinary or S3 unless this is a VPS. **Settle this before real content is
   loaded.**
2. **Academy (Phase 2 of the proposal).** Paystack subscriptions, student auth,
   course delivery, student and admin dashboards. Not started.
3. **Social links.** The design brief asks for them; the proposal explicitly
   excludes them for Site A. Currently built and hidden when empty.
4. **Session store.** In-memory. Fine for one admin, loses sessions on restart
   and leaks under load. Swap for connect-redis or connect-mongo before traffic.
5. **Real content.** Case studies, testimonials, client names and metrics are all
   placeholders. The logo has never been uploaded. Do not present placeholder
   numbers as real JOSION results.

## If you move to MongoDB

Reimplement `read()` and `update()` in `lib/store.js` against a single `content`
document. Nothing else in the app touches storage.
