/* ================================================================
   VORNIX — app.js
   Modules: Config · Router · Background · Cursor · Nav · Tabs · FAQ · Reveal
   ================================================================ */

'use strict';

/* ── CONFIG ──────────────────────────────────────────────────────── */
const CONFIG = {
  pages:    ['home', 'challenges', 'tech', 'how', 'about', 'contact'],
  navLinks: ['home', 'challenges', 'tech', 'how', 'about', 'contact'],
  tabs:     ['one', 'two', 'three', 'partial'],
};

/* ── ROUTER ──────────────────────────────────────────────────────── */
const Router = (() => {
  let _current = 'home';

  function go(id) {
    if (!CONFIG.pages.includes(id)) return;
    _current = id;

    // Pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('is-active'));
    const pg = document.getElementById('page-' + id);
    if (pg) pg.classList.add('is-active');

    // Desktop nav links
    document.querySelectorAll('.nav__link').forEach(a => a.classList.remove('is-active'));
    const dl = document.getElementById('nl-' + id);
    if (dl) dl.classList.add('is-active');

    // Mobile drawer links
    document.querySelectorAll('.nav__drawer-link').forEach(a => a.classList.remove('is-active'));
    const ml = document.getElementById('ml-' + id);
    if (ml) ml.classList.add('is-active');

    window.scrollTo({ top: 0, behavior: 'instant' });
    window.history.pushState({ page: id }, '', '#' + id);
    setTimeout(() => Reveal.trigger(), 80);
  }

  function init() {
    const hash = window.location.hash.replace('#', '');
    go(CONFIG.pages.includes(hash) ? hash : 'home');
    window.addEventListener('popstate', e => go(e.state?.page || 'home'));
  }

  return { go, init, current: () => _current };
})();

/* ── TABS ────────────────────────────────────────────────────────── */
const Tabs = (() => {
  function set(id) {
    if (!CONFIG.tabs.includes(id)) return;

    document.querySelectorAll('.tab').forEach(t => t.classList.remove('is-active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('is-active'));

    const tab   = document.getElementById('tab-' + id);
    const panel = document.getElementById('panel-' + id);
    if (tab)   tab.classList.add('is-active');
    if (panel) panel.classList.add('is-active');

    setTimeout(() => Reveal.trigger(), 80);
  }

  function init() { set('one'); }
  return { set, init };
})();

/* ── NAV ─────────────────────────────────────────────────────────── */
const Nav = (() => {
  let _open = false;

  function toggle() {
    _open = !_open;
    const ham    = document.getElementById('nav-ham');
    const drawer = document.getElementById('nav-drawer');
    if (!ham || !drawer) return;
    ham.classList.toggle('is-open', _open);
    drawer.classList.toggle('is-open', _open);
    document.body.style.overflow = _open ? 'hidden' : '';
  }

  function close() {
    _open = false;
    const ham    = document.getElementById('nav-ham');
    const drawer = document.getElementById('nav-drawer');
    if (!ham || !drawer) return;
    ham.classList.remove('is-open');
    drawer.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  function init() {
    const ham = document.getElementById('nav-ham');
    if (ham) ham.addEventListener('click', toggle);

    // Navbar responsive visibility
    function responsive() {
      const isMobile = window.innerWidth < 1024;
      const linksEl  = document.getElementById('nav-links');
      const ctaEl    = document.getElementById('nav-cta');
      const tickerEl = document.getElementById('nav-ticker');
      const hamEl    = document.getElementById('nav-ham');
      if (linksEl)  linksEl.style.display  = isMobile ? 'none' : 'flex';
      if (ctaEl)    ctaEl.style.display    = isMobile ? 'none' : 'block';
      if (tickerEl) tickerEl.style.display = isMobile ? 'none' : 'flex';
      if (hamEl)    hamEl.style.display    = isMobile ? 'flex'  : 'none';
      if (!isMobile) close();
    }
    responsive();
    window.addEventListener('resize', responsive);

    // Nav scroll shadow
    window.addEventListener('scroll', () => {
      const nav = document.querySelector('.nav');
      if (nav) nav.style.boxShadow = window.scrollY > 20 ? '0 4px 32px rgba(0,0,0,.45)' : '';
    }, { passive: true });
  }

  return { toggle, close, init };
})();

/* ── FAQ ─────────────────────────────────────────────────────────── */
const FAQ = (() => {
  function init() {
    document.addEventListener('click', e => {
      const q = e.target.closest('.faq__q');
      if (!q) return;
      const item = q.parentElement;
      const wasOpen = item.classList.contains('is-open');
      document.querySelectorAll('.faq__item').forEach(i => i.classList.remove('is-open'));
      if (!wasOpen) item.classList.add('is-open');
    });
  }
  return { init };
})();

/* ── SCROLL REVEAL ───────────────────────────────────────────────── */
const Reveal = (() => {
  let _observer = null;

  function trigger() {
    // Immediately reveal elements above fold on active page
    const page = document.querySelector('.page.is-active');
    if (!page) return;
    page.querySelectorAll('.rv:not(.in)').forEach((el, i) => {
      setTimeout(() => el.classList.add('in'), i * 42);
    });
  }

  function init() {
    _observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          _observer.unobserve(e.target);
        }
      });
    }, { threshold: 0.08 });

    document.querySelectorAll('.rv').forEach(el => _observer.observe(el));
    trigger();
  }

  return { trigger, init };
})();

/* ── CUSTOM CURSOR ───────────────────────────────────────────────── */
const Cursor = (() => {
  const DOT_SELECTOR = 'a, button, .plan-card, .tab, .faq__q, .hstep, .vc, .ch, .tcard, .tc, .eco, .plan-preview';

  let mx = 0, my = 0, rx = 0, ry = 0;
  let cursor, ring, raf;

  function lerp(a, b, t) { return a + (b - a) * t; }

  function loop() {
    rx = lerp(rx, mx, 0.14);
    ry = lerp(ry, my, 0.14);
    if (cursor) { cursor.style.left = mx + 'px'; cursor.style.top = my + 'px'; }
    if (ring)   { ring.style.left   = rx + 'px'; ring.style.top   = ry + 'px'; }
    raf = requestAnimationFrame(loop);
  }

  function init() {
    cursor = document.querySelector('.cursor');
    ring   = document.querySelector('.cursor-ring');
    if (!cursor || !ring) return;

    document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; }, { passive: true });

    document.addEventListener('mouseover', e => {
      if (e.target.closest(DOT_SELECTOR)) document.body.classList.add('is-hovering');
    });
    document.addEventListener('mouseout', e => {
      if (e.target.closest(DOT_SELECTOR)) document.body.classList.remove('is-hovering');
    });

    loop();
  }

  return { init };
})();

/* ── FINANCIAL BACKGROUND ────────────────────────────────────────── */
const Background = (() => {
  const ACCENT   = 'rgba(184,0,15,';
  const GOLD     = 'rgba(196,152,42,';
  const GRID_CLR = 'rgba(255,255,255,.028)';
  const POS_CLR  = 'rgba(23,149,106,';
  const NEG_CLR  = 'rgba(184,0,15,';

  let canvas, ctx, W, H, raf;
  let lines    = [];
  let candles  = [];
  let gridDots = [];
  let tick     = 0;
  let mouse    = { x: 0, y: 0 };

  /* ── Line chart class ── */
  class PriceLine {
    constructor(opts) {
      this.color    = opts.color || ACCENT;
      this.opacity  = opts.opacity || .35;
      this.y        = opts.y || H * .5;
      this.speed    = opts.speed || .4;
      this.amp      = opts.amp   || 30;
      this.freq     = opts.freq  || .018;
      this.phase    = opts.phase || 0;
      this.pts      = [];
      this.maxPts   = Math.ceil(W / 3) + 2;
      this.offset   = 0;
      this.width    = opts.width || 1;

      // Pre-fill points
      for (let i = 0; i <= this.maxPts; i++) {
        this.pts.push(this._sample(i));
      }
    }

    _sample(i) {
      const x = i * 3;
      const base = this.y
        + Math.sin(x * this.freq + this.phase) * this.amp
        + Math.sin(x * this.freq * .34 + this.phase * 1.4) * this.amp * .4
        + Math.sin(x * this.freq * .12) * this.amp * .22;
      return base;
    }

    update() {
      this.phase += this.speed * .008;
      this.offset = (this.offset + this.speed) % 3;

      // Rebuild pts each frame from current phase
      for (let i = 0; i < this.pts.length; i++) {
        const x = i * 3;
        this.pts[i] = this.y
          + Math.sin(x * this.freq + this.phase) * this.amp
          + Math.sin(x * this.freq * .34 + this.phase * 1.4) * this.amp * .4;
      }
    }

    draw() {
      if (this.pts.length < 2) return;
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = this.color + this.opacity + ')';
      ctx.lineWidth   = this.width;

      ctx.moveTo(-this.offset, this.pts[0]);
      for (let i = 1; i < this.pts.length; i++) {
        const xPrev = (i - 1) * 3 - this.offset;
        const xCurr = i * 3 - this.offset;
        const xMid  = (xPrev + xCurr) / 2;
        ctx.quadraticCurveTo(xPrev, this.pts[i - 1], xMid, (this.pts[i - 1] + this.pts[i]) / 2);
      }
      ctx.stroke();

      // Area fill under line
      ctx.lineTo(W + 4, H + 4);
      ctx.lineTo(-4, H + 4);
      ctx.closePath();
      ctx.fillStyle = this.color + (this.opacity * .1) + ')';
      ctx.fill();

      ctx.restore();
    }
  }

  /* ── Candlestick ── */
  class Candle {
    constructor(x) {
      this.x     = x;
      this.up    = Math.random() > .45;
      this.h     = 22 + Math.random() * 56;
      this.wick  = 6 + Math.random() * 18;
      this.w     = 7 + Math.random() * 5;
      this.y     = H * .15 + Math.random() * H * .6;
      this.alpha = .07 + Math.random() * .1;
    }

    draw() {
      const c = this.up ? POS_CLR : NEG_CLR;
      ctx.save();
      ctx.fillStyle   = c + this.alpha + ')';
      ctx.strokeStyle = c + (this.alpha + .04) + ')';
      ctx.lineWidth   = 1;
      ctx.fillRect(this.x - this.w / 2, this.y - this.h / 2, this.w, this.h);
      ctx.beginPath();
      ctx.moveTo(this.x, this.y - this.h / 2);
      ctx.lineTo(this.x, this.y - this.h / 2 - this.wick);
      ctx.moveTo(this.x, this.y + this.h / 2);
      ctx.lineTo(this.x, this.y + this.h / 2 + this.wick);
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ── Horizontal grid lines ── */
  function drawGrid() {
    ctx.save();
    const LINES = 8;
    for (let i = 0; i <= LINES; i++) {
      const y = (H / LINES) * i;
      ctx.beginPath();
      ctx.strokeStyle = GRID_CLR;
      ctx.lineWidth   = 1;
      ctx.setLineDash([3, 18]);
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Vertical grid
    const VCOLS = Math.ceil(W / 80);
    for (let i = 0; i <= VCOLS; i++) {
      const x = i * 80;
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,.016)';
      ctx.setLineDash([2, 20]);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* ── Price label markers ── */
  function drawLabels() {
    ctx.save();
    ctx.font      = '500 10px JetBrains Mono, monospace';
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    const VALUES  = ['2847.50', '2836.20', '2824.85', '2813.40', '2802.15'];
    const STEP    = H / (VALUES.length + 1);
    VALUES.forEach((v, i) => {
      ctx.fillText(v, W - 66, STEP * (i + 1));
    });
    ctx.restore();
  }

  /* ── Corner data panel ── */
  function drawDataPanel() {
    const px = W - 220, py = 18, pw = 200, ph = 90;
    ctx.save();
    ctx.fillStyle   = 'rgba(12,15,30,.62)';
    ctx.strokeStyle = 'rgba(184,0,15,.12)';
    ctx.lineWidth   = 1;
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeRect(px, py, pw, ph);

    ctx.font      = '500 9px JetBrains Mono, monospace';
    ctx.fillStyle = 'rgba(184,0,15,.55)';
    ctx.fillText('VORNIX // MARKET DATA', px + 10, py + 16);

    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.fillText('XAUUSD   2847.50  +0.82%', px + 10, py + 32);
    ctx.fillText('EURUSD   1.0842  -0.24%', px + 10, py + 46);
    ctx.fillText('SP500    5934.40  +1.12%', px + 10, py + 60);
    ctx.fillText('BTC/USD  96,440  +2.38%', px + 10, py + 74);
    ctx.restore();
  }

  /* ── Resize ── */
  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    build();
  }

  /* ── Build scene objects ── */
  function build() {
    lines = [];
    // Main price lines
    lines.push(new PriceLine({ y: H*.38, speed:.38, amp:42, freq:.014, phase:0,   color:ACCENT, opacity:.38, width:1.4 }));
    lines.push(new PriceLine({ y: H*.55, speed:.22, amp:28, freq:.010, phase:2.1, color:GOLD,   opacity:.22, width:1 }));
    lines.push(new PriceLine({ y: H*.68, speed:.18, amp:20, freq:.008, phase:4.4, color:ACCENT, opacity:.14, width:.8 }));
    lines.push(new PriceLine({ y: H*.25, speed:.12, amp:15, freq:.022, phase:1.2, color:GOLD,   opacity:.1, width:.7 }));

    // Candles — scattered behind
    candles = [];
    const spacing = 28;
    for (let x = 40; x < W; x += spacing) {
      if (Math.random() > .5) candles.push(new Candle(x));
    }
  }

  /* ── Render loop ── */
  function frame() {
    ctx.clearRect(0, 0, W, H);

    // 1. Grid
    drawGrid();

    // 2. Candles
    candles.forEach(c => c.draw());

    // 3. Chart lines
    lines.forEach(l => { l.update(); l.draw(); });

    // 4. Labels
    drawLabels();

    // 5. Data panel (only on wide screens)
    if (W > 900) drawDataPanel();

    tick++;
    raf = requestAnimationFrame(frame);
  }

  function init() {
    canvas = document.getElementById('bg-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;

    build();
    frame();

    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('mousemove', e => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    }, { passive: true });
  }

  return { init };
})();

/* ── FORM SUBMIT ─────────────────────────────────────────────────── */
const Forms = (() => {
  function init() {
    document.addEventListener('click', e => {
      if (!e.target.classList.contains('f-submit')) return;
      const btn = e.target;
      const orig = btn.textContent;
      btn.textContent = '✓ Sent — We\'ll respond within 2 hours';
      btn.style.background = '#17956A';
      setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 4000);
    });
  }
  return { init };
})();

/* ── GLOBAL EXPOSE ───────────────────────────────────────────────── */
// Expose so inline onclick attrs work
window.nav     = (id)       => Router.go(id);
window.setTab  = (id)       => Tabs.set(id);
window.hamMenu = ()         => Nav.toggle();
window.closeDrawer = ()     => { Nav.close(); };

/* ── BOOT ────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  Background.init();
  Cursor.init();
  Nav.init();
  FAQ.init();
  Reveal.init();
  Tabs.init();
  Router.init();
});
