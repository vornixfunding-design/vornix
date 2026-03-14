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
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 1100 && _open) close();
    }, { passive: true });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _open) close();
    });

    document.addEventListener('click', e => {
      const drawer = document.getElementById('nav-drawer');
      const ham    = document.getElementById('nav-ham');
      if (_open && drawer && ham
          && !drawer.contains(e.target)
          && !ham.contains(e.target)) close();
    });

    /* Nav scroll class */
    window.addEventListener('scroll', () => {
      const nav = document.querySelector('.nav');
      if (nav) nav.classList.toggle('scrolled', window.scrollY > 20);
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

/* ── REVEAL ──────────────────────────────────────────── */
const Reveal = (() => {
  function triggerPage(pageId) {
    const page = document.getElementById('page-' + pageId);
    if (!page) return;
    const items = page.querySelectorAll('.rv');
    items.forEach((el, i) => {
      const hasDelay = Array.from(el.classList).some(c => c.startsWith('rv-d'));
      if (!hasDelay) el.style.transitionDelay = (i * 40) + 'ms';
      void el.offsetWidth;
      el.classList.add('in');
    });
  }

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

  function initScroll() {
    if (!('IntersectionObserver' in window)) {
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
      btn.style.background = 'var(--grn, #2ECC8F)';
      btn.style.color = '#050709';
      btn.style.clipPath = 'none';
      setTimeout(() => {
        btn.textContent = orig;
        btn.style.background = '';
        btn.style.color = '';
        btn.style.clipPath = '';
      }, 4000);
    });
  }
  return { init };
})();

/* ── 3D BACKGROUND CANVAS ────────────────────────────── */
const Background = (() => {

  function init() {
    const canvas = document.getElementById('bg-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let W, H, animFrame;

    // ── Resize ──
    function resize() {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    // ── Particle system — rising nodes (growth motif) ──
    const GOLD   = [201, 168, 76];
    const EMERALD= [46, 204, 143];
    const WHITE  = [240, 244, 255];

    const PARTICLE_COUNT = 90;
    const NODES          = 18;  // bigger connected nodes

    // Particles
    const particles = Array.from({ length: PARTICLE_COUNT }, () => makeParticle());
    const nodes     = Array.from({ length: NODES },          () => makeNode());

    function makeParticle() {
      return {
        x:     Math.random() * 1.2 - 0.1,  // 0-1 normalized
        y:     Math.random(),
        vy:    -(0.00012 + Math.random() * 0.00018), // rising
        vx:    (Math.random() - 0.5) * 0.00008,
        size:  0.5 + Math.random() * 1.4,
        alpha: 0.2 + Math.random() * 0.5,
        color: Math.random() < 0.5 ? GOLD : Math.random() < 0.6 ? EMERALD : WHITE,
        pulse: Math.random() * Math.PI * 2,
      };
    }

    function makeNode() {
      return {
        x:      Math.random(),
        y:      Math.random(),
        vx:     (Math.random() - 0.5) * 0.00015,
        vy:     -(0.00006 + Math.random() * 0.0001),
        size:   2 + Math.random() * 3,
        alpha:  0.35 + Math.random() * 0.4,
        color:  Math.random() < 0.6 ? GOLD : EMERALD,
        pulse:  Math.random() * Math.PI * 2,
        pSpeed: 0.012 + Math.random() * 0.018,
      };
    }

    // V-shape lines — like Vornix chart growth lines
    function drawVLines(t) {
      const cx = W * 0.5;
      const cy = H * 0.72;
      const spread = W * 0.38;

      // Left arm of V (descend)
      const grad1 = ctx.createLinearGradient(cx - spread, cy - H * 0.22, cx, cy);
      grad1.addColorStop(0, `rgba(${GOLD.join(',')},0)`);
      grad1.addColorStop(0.5, `rgba(${GOLD.join(',')},0.035)`);
      grad1.addColorStop(1, `rgba(${GOLD.join(',')},0.005)`);

      ctx.beginPath();
      ctx.moveTo(cx - spread, cy - H * 0.22);
      ctx.lineTo(cx, cy);
      ctx.strokeStyle = grad1;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Right arm of V (ascend — stronger, represents growth)
      const rightEndY = cy - H * 0.38;
      const grad2 = ctx.createLinearGradient(cx, cy, cx + spread * 1.1, rightEndY);
      grad2.addColorStop(0, `rgba(${EMERALD.join(',')},0.005)`);
      grad2.addColorStop(0.4, `rgba(${EMERALD.join(',')},0.05)`);
      grad2.addColorStop(1, `rgba(${EMERALD.join(',')},0)`);

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + spread * 1.1, rightEndY);
      ctx.strokeStyle = grad2;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Upward arrow tip glow at top right of V
      const tipX = cx + spread * 1.1;
      const tipY = rightEndY;
      const tipGlow = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, 60);
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.002);
      tipGlow.addColorStop(0, `rgba(${EMERALD.join(',')},${0.12 * pulse})`);
      tipGlow.addColorStop(1, `rgba(${EMERALD.join(',')},0)`);
      ctx.fillStyle = tipGlow;
      ctx.fillRect(tipX - 60, tipY - 60, 120, 120);
    }

    // Horizontal grid lines — like a chart background
    function drawGrid() {
      const lines = 7;
      for (let i = 0; i < lines; i++) {
        const y = (H / (lines - 1)) * i;
        const grad = ctx.createLinearGradient(0, y, W, y);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.3, 'rgba(255,255,255,0.022)');
        grad.addColorStop(0.7, 'rgba(255,255,255,0.022)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    // Connecting lines between nearby nodes
    function drawConnections() {
      const maxDist = Math.min(W, H) * 0.22;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = (a.x - b.x) * W;
          const dy = (a.y - b.y) * H;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < maxDist) {
            const alpha = (1 - dist / maxDist) * 0.1 * Math.min(a.alpha, b.alpha);
            ctx.beginPath();
            ctx.moveTo(a.x * W, a.y * H);
            ctx.lineTo(b.x * W, b.y * H);
            ctx.strokeStyle = `rgba(${GOLD.join(',')},${alpha})`;
            ctx.lineWidth = 0.7;
            ctx.stroke();
          }
        }
      }
    }

    // Main VORNIX letter trace in background (very subtle)
    function drawWatermark(t) {
      ctx.save();
      ctx.font = `bold ${Math.min(W * 0.18, 200)}px 'Bebas Neue', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.0008);
      ctx.strokeStyle = `rgba(${GOLD.join(',')},${0.018 + 0.008 * pulse})`;
      ctx.lineWidth = 1;
      ctx.strokeText('VORNIX', W * 0.5, H * 0.52);
      ctx.restore();
    }

    let t = 0;
    function draw() {
      ctx.clearRect(0, 0, W, H);

      drawGrid();
      drawVLines(t);
      drawWatermark(t);

      // Draw connections between nodes
      drawConnections();

      // Draw particles
      particles.forEach(p => {
        p.pulse += 0.025;
        const pulsed = p.alpha * (0.7 + 0.3 * Math.sin(p.pulse));
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color.join(',')},${pulsed})`;
        ctx.fill();

        p.x += p.vx;
        p.y += p.vy;

        // Wrap
        if (p.y < -0.05) { p.y = 1.05; p.x = Math.random() * 1.2 - 0.1; }
        if (p.x < -0.1)  { p.x = 1.1; }
        if (p.x > 1.1)   { p.x = -0.1; }
      });

      // Draw nodes
      nodes.forEach(n => {
        n.pulse += n.pSpeed;
        const pulse = 0.6 + 0.4 * Math.sin(n.pulse);

        // Outer glow
        const grd = ctx.createRadialGradient(n.x*W, n.y*H, 0, n.x*W, n.y*H, n.size * 8);
        grd.addColorStop(0, `rgba(${n.color.join(',')},${0.15 * pulse * n.alpha})`);
        grd.addColorStop(1, `rgba(${n.color.join(',')},0)`);
        ctx.fillStyle = grd;
        ctx.fillRect(n.x*W - n.size*8, n.y*H - n.size*8, n.size*16, n.size*16);

        // Core dot
        ctx.beginPath();
        ctx.arc(n.x * W, n.y * H, n.size * pulse, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${n.color.join(',')},${n.alpha * pulse})`;
        ctx.fill();

        n.x += n.vx;
        n.y += n.vy;
        if (n.y < -0.05) { Object.assign(n, makeNode()); n.y = 1.05; }
        if (n.x < -0.05) n.x = 1.05;
        if (n.x > 1.05)  n.x = -0.05;
      });

      t++;
      animFrame = requestAnimationFrame(draw);
    }

    draw();
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
  try { Background.init();   } catch(e) { console.warn('[BG]',     e); }
  try { Nav.init();          } catch(e) { console.warn('[Nav]',    e); }
  try { FAQ.init();          } catch(e) { console.warn('[FAQ]',    e); }
  try { Reveal.initScroll(); } catch(e) { console.warn('[Reveal]', e); }
  try { Tabs.init();         } catch(e) { console.warn('[Tabs]',   e); }
  try { Router.init();       } catch(e) { console.warn('[Router]', e); }
  try { Forms.init();        } catch(e) { console.warn('[Forms]',  e); }
});
