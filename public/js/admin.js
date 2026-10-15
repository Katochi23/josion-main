/* Dashboard chrome: the off-canvas menu and the theme switch. */
(function () {
  'use strict';
  var root = document.documentElement;
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- off-canvas menu ---------- */
  var side = document.getElementById('admSide');
  var burger = document.getElementById('admBurger');
  var scrim = document.getElementById('admScrim');
  var mobile = window.matchMedia('(max-width: 900px)');
  var open = false;

  function focusables() {
    return Array.prototype.filter.call(side.querySelectorAll('a, button'), function (el) {
      return el.offsetParent !== null && !el.disabled;
    });
  }

  function setMenu(v) {
    open = v;
    side.classList.toggle('open', v);
    scrim.classList.toggle('open', v);
    burger.setAttribute('aria-expanded', String(v));
    burger.setAttribute('aria-label', v ? 'Close menu' : 'Open menu');
    scrim.setAttribute('aria-hidden', String(!v));
    root.classList.toggle('adm-locked', v);
    if (v) {
      // The sidebar's brand link is display:none at this width, so pick the first
      // element that is actually rendered — focusing a hidden one silently no-ops.
      var first = focusables()[0];
      if (first) setTimeout(function () { first.focus(); }, REDUCED ? 0 : 220);
    } else if (document.activeElement && side.contains(document.activeElement)) {
      burger.focus();
    }
  }

  if (side && burger && scrim) {
    burger.addEventListener('click', function () { setMenu(!open); });
    scrim.addEventListener('click', function () { setMenu(false); });
    var closeBtn = document.getElementById('admClose');
    if (closeBtn) closeBtn.addEventListener('click', function () { setMenu(false); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) { setMenu(false); return; }
      // Keep tabbing inside the drawer while it covers the page.
      if (e.key === 'Tab' && open) {
        var f = focusables();
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
      }
    });

    // Widening the window past the breakpoint must not leave the page locked.
    var onBreakpoint = function (e) { if (!e.matches && open) setMenu(false); };
    if (mobile.addEventListener) mobile.addEventListener('change', onBreakpoint);
    else if (mobile.addListener) mobile.addListener(onBreakpoint);
  }

  /* ---------- edit forms: never lose what was typed ---------- */
  // A refused save (bad image, missing title) redirects back to the form, which
  // used to come back empty. The typed values are kept in sessionStorage on
  // submit and put back only when the page returns with an error message.
  var form = document.querySelector('form.form');
  var problem = document.querySelector('.flash-bad');
  function store() { try { return window.sessionStorage; } catch (e) { return null; } }
  function addRow(list) {
    var rows = list.querySelectorAll('.pair');
    var row = rows[rows.length - 1].cloneNode(true);
    Array.prototype.forEach.call(row.querySelectorAll('input'), function (el) { el.value = ''; });
    list.appendChild(row);
    return row;
  }

  // A success message means the last save went through; its draft is spent.
  if (!form && document.querySelector('.flash-ok') && store()) {
    var s0 = store();
    for (var k = s0.length - 1; k >= 0; k--) if (/^josion-draft:/.test(s0.key(k))) s0.removeItem(s0.key(k));
  }

  if (form) {
    var key = 'josion-draft:' + form.getAttribute('action');
    var ss = store();

    if (ss) {
      var saved = null;
      try { saved = JSON.parse(ss.getItem(key) || 'null'); } catch (e) {}
      if (saved && problem) {
        // Rows added before the failed save need to exist again to hold their values.
        Array.prototype.forEach.call(form.querySelectorAll('[data-add-row]'), function (btn) {
          var list = document.getElementById(btn.getAttribute('data-add-row'));
          var first = list && list.querySelector('.pair input');
          if (!first || !saved[first.name]) return;
          while (list.querySelectorAll('.pair').length < saved[first.name].length) addRow(list);
        });
        var used = {};
        Array.prototype.forEach.call(form.elements, function (el) {
          if (!el.name || el.type === 'file' || el.name === '_csrf' || !(el.name in saved)) return;
          var i = used[el.name] = (used[el.name] || 0);
          used[el.name]++;
          var v = saved[el.name][i];
          if (el.type === 'checkbox' || el.type === 'radio') el.checked = v === true;
          else if (v !== undefined) el.value = v;
        });
        var note = document.createElement('div');
        note.className = 'flash flash-ok';
        note.textContent = 'What you typed has been kept. Pick your images again, then save.';
        problem.parentNode.insertBefore(note, problem.nextSibling);
      }
      ss.removeItem(key);
    }

    form.addEventListener('submit', function (e) {
      // Catch the two upload mistakes the server would refuse, before anything is sent.
      var files = form.querySelectorAll('input[type=file]');
      for (var i = 0; i < files.length; i++) {
        var f = files[i].files && files[i].files[0];
        if (!f) continue;
        var msg = '';
        if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) msg = '"' + f.name + '" is not a PNG, JPG, WebP or GIF image.';
        else if (f.size > 8 * 1024 * 1024) msg = '"' + f.name + '" is larger than 8 MB. Make it smaller and try again.';
        if (msg) {
          e.preventDefault();
          files[i].setCustomValidity(msg);
          files[i].reportValidity();
          files[i].addEventListener('change', function () { this.setCustomValidity(''); }, { once: true });
          return;
        }
      }
      var s = store();
      if (!s) return;
      var data = {};
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!el.name || el.type === 'file' || el.name === '_csrf') return;
        (data[el.name] = data[el.name] || []).push(el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value);
      });
      try { s.setItem(key, JSON.stringify(data)); } catch (err) {}
    });
  }

  /* ---------- repeatable rows (case study results) ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('[data-add-row]'), function (btn) {
    var list = document.getElementById(btn.getAttribute('data-add-row'));
    if (!list) return;
    btn.addEventListener('click', function () { addRow(list).querySelector('input').focus(); });
  });

  /* ---------- theme, sharing the site's stored preference ---------- */
  // Two toggles exist — one in the top bar, one in the sidebar — and only one is
  // visible at a time. Both are kept in sync.
  var toggles = Array.prototype.slice.call(document.querySelectorAll('[data-theme-toggle]'));
  function applyTheme(t, animate, persist) {
    if (animate && !REDUCED) {
      root.classList.add('theming');
      setTimeout(function () { root.classList.remove('theming'); }, 440);
    }
    root.setAttribute('data-theme', t);
    toggles.forEach(function (el) {
      el.setAttribute('aria-pressed', String(t === 'light'));
      el.setAttribute('aria-label', t === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    });
    if (persist) { try { localStorage.setItem('josion-theme', t); } catch (e) {} }
  }
  if (toggles.length) {
    applyTheme(root.getAttribute('data-theme') === 'light' ? 'light' : 'dark', false, false);
    toggles.forEach(function (el) {
      el.addEventListener('click', function () {
        applyTheme(root.getAttribute('data-theme') === 'light' ? 'dark' : 'light', true, true);
      });
    });
  }
})();
