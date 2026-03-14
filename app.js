'use strict';

const CONFIG = {
  pages: ['home','challenges','tech','how','about','contact'],
  tabs:  ['one','two','three','partial'],
};

/* ── ROUTER ──────────────────────────────────────────── */
const Router = (() => {
  function go(id) {
    if (!CONFIG.pages.includes(id)) id = 'home';

    document.querySelectorAll('.page').forEach(p => p.classList.remove('is-active'));
    const pg = document.getElementById('page-' + id);
    if (pg) pg.classList.add('is-active');

    document.querySelectorAll('.nav__link').forEach(a => a.classList.remove('is-active'));
    const dl = document.getElementById('nl-' + id);
    if (dl) dl.classList.add('is-active');

    document.querySelectorAll('.nav__drawer-link').forEach(a => a.classList.remove('is-active'));
    const ml = document.getElementById('ml-' + id);
    if (ml) ml.classList.add('is-active');

    window.scrollTo({ top: 0, behavior: 'instant' });
    try { window.history.pushState({ page: id }, '', '#' + id); } catch(e) {}

    /* Trigger reveals after a short delay so DOM is painted */
    setTimeout(() => Reveal.triggerPage(id), 80);
  }

  function init() {
    const hash = window.location.hash.replace('#', '');
    go(CONFIG.pages.includes(hash) ? hash : 'home');
    window.addEventListener('popstate', e => go(e.state?.page || 'home'));
  }

  return { go, init };
})();

/* ── TABS ────────────────────────────────────────────── */
const Tabs = (() => {
  function set(id) {
    if (!CONFIG.tabs.includes(id)) return;
    document.querySelectorAll('.tab').forEach(t  => t.classList.remove('is-active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('is-active'));
    const tab   = document.getElementById('tab-' + id);
    const panel = document.getElementById('panel-' + id);
    if (tab)   tab.classList.add('is-active');
    if (panel) panel.classList.add('is-active');
    setTimeout(() => Reveal.triggerAll(), 80);
  }
  return { set, init: () => set('one') };
})();

/* ── NAV HAMBURGER ───────────────────────────────────── */
const Nav = (() => {
  let _open = false;

  function open() {
    _open = true;
    const ham    = document.getElementById('nav-ham');
    const drawer = document.getElementById('nav-drawer');
    if (ham)    { ham.classList.add('is-open'); ham.setAttribute('aria-expanded','true'); }
    if (drawer) drawer.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    _open = false;
    const ham    = document.getElementById('nav-ham');
    const drawer = document.getElementById('nav-drawer');
    if (ham)    { ham.classList.remove('is-open'); ham.setAttribute('aria-expanded','false'); }
    if (drawer) drawer.classList.remove('is-open');
    document.body.style.overflow = '';
  }
  function toggle() { _open ? close() : open(); }

  function init() {
    /* Close on resize to desktop */
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 1100 && _open) close();
    }, { passive: true });

    /* Close on Escape */
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _open) close();
    });

    /* Close on outside click */
    document.addEventListener('click', e => {
      const drawer = document.getElementById('nav-drawer');
      const ham    = document.getElementById('nav-ham');
      if (_open && drawer && ham
          && !drawer.contains(e.target)
          && !ham.contains(e.target)) close();
    });

    /* Scroll shadow */
    window.addEventListener('scroll', () => {
      const nav = document.querySelector('.nav');
      if (nav) nav.style.boxShadow = window.scrollY > 20
        ? '0 4px 48px rgba(0,0,0,.6)' : '';
    }, { passive: true });
  }

  return { toggle, open, close, init };
})();

/* ── FAQ ─────────────────────────────────────────────── */
const FAQ = (() => {
  function init() {
    document.addEventListener('click', e => {
      const q = e.target.closest('.faq__q');
      if (!q) return;
      const item    = q.parentElement;
      const wasOpen = item.classList.contains('is-open');
      document.querySelectorAll('.faq__item').forEach(i => i.classList.remove('is-open'));
      if (!wasOpen) item.classList.add('is-open');
    });
  }
  return { init };
})();

/* ── REVEAL — reliable, no IntersectionObserver issues ── */
const Reveal = (() => {

  /* Immediately show all .rv in a specific page */
  function triggerPage(pageId) {
    const page = document.getElementById('page-' + pageId);
    if (!page) return;
    const items = page.querySelectorAll('.rv');
    items.forEach((el, i) => {
      /* Use the existing transition-delay from CSS classes (rv-d1 etc.)
         or fall back to a staggered manual delay */
      const hasDelay = Array.from(el.classList).some(c => c.startsWith('rv-d'));
      if (!hasDelay) {
        el.style.transitionDelay = (i * 40) + 'ms';
      }
      /* Force a reflow so the transition actually plays */
      void el.offsetWidth;
      el.classList.add('in');
    });
  }

  /* Show all visible .rv across the whole page (used after tab switch) */
  function triggerAll() {
    document.querySelectorAll('.page.is-active .rv').forEach((el, i) => {
      if (!el.classList.contains('in')) {
        const hasDelay = Array.from(el.classList).some(c => c.startsWith('rv-d'));
        if (!hasDelay) el.style.transitionDelay = (i * 35) + 'ms';
        void el.offsetWidth;
        el.classList.add('in');
      }
    });
  }

  /* Scroll-based reveal for content below the fold */
  function initScroll() {
    if (!('IntersectionObserver' in window)) {
      /* Fallback: just show everything */
      document.querySelectorAll('.rv').forEach(el => el.classList.add('in'));
      return;
    }
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.06, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.rv').forEach(el => obs.observe(el));
  }

  return { triggerPage, triggerAll, initScroll };
})();

/* ── FORMS ───────────────────────────────────────────── */
const Forms = (() => {
  function init() {
    document.addEventListener('click', e => {
      if (!e.target.classList.contains('f-submit')) return;
      const btn  = e.target;
      const orig = btn.textContent;
      btn.textContent = '✓ Sent — We\'ll reply within 2 hours';
      btn.style.background = 'var(--grn, #00D98A)';
      btn.style.clipPath = 'none';
      setTimeout(() => {
        btn.textContent = orig;
        btn.style.background = '';
        btn.style.clipPath = '';
      }, 4000);
    });
  }
  return { init };
})();

/* ── GLOBALS ─────────────────────────────────────────── */
window.nav         = id => Router.go(id);
window.setTab      = id => Tabs.set(id);
window.hamMenu     = ()  => Nav.toggle();
window.closeDrawer = ()  => Nav.close();

/* ── BOOT ────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  try { Nav.init();          } catch(e) { console.warn('[Nav]',    e); }
  try { FAQ.init();          } catch(e) { console.warn('[FAQ]',    e); }
  try { Reveal.initScroll(); } catch(e) { console.warn('[Reveal]', e); }
  try { Tabs.init();         } catch(e) { console.warn('[Tabs]',   e); }
  try { Router.init();       } catch(e) { console.warn('[Router]', e); }
  try { Forms.init();        } catch(e) { console.warn('[Forms]',  e); }
});
