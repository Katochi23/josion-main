const bcrypt = require('bcryptjs');
const store = require('./store');

/**
 * Single-admin auth.
 *
 * The password is a bcrypt hash — never plaintext. It starts in
 * ADMIN_PASSWORD_HASH so there is a way in on a fresh install, and once the
 * admin changes it from the dashboard the new hash is kept in the content file
 * and wins from then on. That means a password change does not need a redeploy.
 *
 * Generate the bootstrap hash with:
 *   node -e "console.log(require('bcryptjs').hashSync('your-password',12))"
 */
const ENV_HASH = process.env.ADMIN_PASSWORD_HASH || '';

const currentHash = () => (store.read().settings || {}).passwordHash || ENV_HASH;

function verify(password) {
  const hash = currentHash();
  if (!hash) return false;
  try { return bcrypt.compareSync(String(password || ''), hash); }
  catch { return false; }
}

const hash = password => bcrypt.hashSync(String(password), 12);

function requireAuth(req, res, next) {
  if (req.session && req.session.admin) return next();
  req.session.returnTo = req.originalUrl;
  return res.redirect('/admin/login');
}

module.exports = { verify, hash, requireAuth, configured: () => Boolean(currentHash()) };
