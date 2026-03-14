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
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('is-active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('is-active'));
    const tab = document.getElementById('tab-' + id);
    const panel = document.getElementById('panel-' + id);
    if (tab) tab.classList.add('is-active');
    if (panel) panel.classList.add('is-active');
    setTimeout(() => Reveal.triggerAll(), 80);
  }
  return { set, init: () => set('one') };
})();

/* ── NAV ─────────────────────────────────────────────── */
const Nav = (() => {
  let _open = false;
  function open() {
    _open = true;
    const ham = document.getElementById('nav-ham');
    const drawer = document.getElementById('nav-drawer');
    if (ham) { ham.classList.add('is-open'); ham.setAttribute('aria-expanded','true'); }
    if (drawer) drawer.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    _open = false;
    const ham = document.getElementById('nav-ham');
    const drawer = document.getElementById('nav-drawer');
    if (ham) { ham.classList.remove('is-open'); ham.setAttribute('aria-expanded','false'); }
    if (drawer) drawer.classList.remove('is-open');
    document.body.style.overflow = '';
  }
  function toggle() { _open ? close() : open(); }
  function init() {
    window.addEventListener('resize', () => { if (window.innerWidth >= 1100 && _open) close(); }, { passive: true });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && _open) close(); });
    document.addEventListener('click', e => {
      const drawer = document.getElementById('nav-drawer');
      const ham = document.getElementById('nav-ham');
      if (_open && drawer && ham && !drawer.contains(e.target) && !ham.contains(e.target)) close();
    });
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
      const item = q.parentElement;
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
    page.querySelectorAll('.rv').forEach((el, i) => {
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
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); } });
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
      const btn = e.target;
      const orig = btn.textContent;
      btn.textContent = '✓ Sent — We\'ll reply within 2 hours';
      btn.style.background = '#10B981';
      btn.style.color = '#fff';
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

/* ══════════════════════════════════════════════════════
   PREMIUM 3D BACKGROUND
   Layers: 1) subtle grid  2) candlestick chart  3) rising particles
           4) node network  5) VORNIX watermark pulse
   ══════════════════════════════════════════════════════ */
const Background = (() => {

  // Color palette
  const GOLD    = [212, 160, 23];
  const EMERALD = [16, 185, 129];
  const WHITE   = [238, 242, 255];
  const RED     = [239, 68, 68];

  function rgba(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }

  /* ── Candlestick generator ── */
  function makeCandleData(count) {
    const candles = [];
    let price = 100 + Math.random() * 50;
    for (let i = 0; i < count; i++) {
      const open = price;
      const move = (Math.random() - 0.44) * 4;   // slight upward bias
      const close = open + move;
      const high  = Math.max(open, close) + Math.random() * 2;
      const low   = Math.min(open, close) - Math.random() * 2;
      candles.push({ open, close, high, low, bull: close >= open });
      price = close;
    }
    return candles;
  }

  /* ── Particle factory ── */
  function makeParticle(W, H) {
    return {
      x:  Math.random() * W,
      y:  H + Math.random() * H * 0.3,          // start below screen
      vx: (Math.random() - 0.5) * 0.4,
      vy: -(0.3 + Math.random() * 0.7),          // rising
      r:  0.5 + Math.random() * 1.5,
      a:  0.15 + Math.random() * 0.45,
      color: Math.random() < 0.55 ? GOLD : Math.random() < 0.6 ? EMERALD : WHITE,
      pulse: Math.random() * Math.PI * 2,
      pspeed: 0.02 + Math.random() * 0.02,
    };
  }

  /* ── Node factory ── */
  function makeNode(W, H) {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.25,
      vy: -(0.08 + Math.random() * 0.2),
      r: 1.5 + Math.random() * 2.5,
      a: 0.3 + Math.random() * 0.4,
      color: Math.random() < 0.6 ? GOLD : EMERALD,
      pulse: Math.random() * Math.PI * 2,
      ps: 0.01 + Math.random() * 0.015,
    };
  }

  function init() {
    const canvas = document.getElementById('bg-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let W, H, candleData, particles, nodes;
    const PARTICLE_COUNT = 80;
    const NODE_COUNT = 20;

    function reset() {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
      candleData = makeCandleData(60);
      particles  = Array.from({ length: PARTICLE_COUNT }, () => makeParticle(W, H));
      // Spread initial y positions so they start visible, not all below
      particles.forEach(p => { p.y = Math.random() * H; });
      nodes = Array.from({ length: NODE_COUNT }, () => makeNode(W, H));
    }

    reset();
    window.addEventListener('resize', reset, { passive: true });

    /* ── Draw chart grid ── */
    function drawGrid() {
      // Horizontal lines
      for (let i = 0; i <= 6; i++) {
        const y = (H / 6) * i;
        const g = ctx.createLinearGradient(0, y, W, y);
        g.addColorStop(0,   'rgba(255,255,255,0)');
        g.addColorStop(0.2, 'rgba(255,255,255,0.028)');
        g.addColorStop(0.8, 'rgba(255,255,255,0.028)');
        g.addColorStop(1,   'rgba(255,255,255,0)');
        ctx.beginPath();
        ctx.moveTo(0, y); ctx.lineTo(W, y);
        ctx.strokeStyle = g; ctx.lineWidth = 0.5; ctx.stroke();
      }
      // Vertical lines — fewer, subtle
      const vStep = Math.round(W / 10);
      for (let x = vStep; x < W; x += vStep) {
        ctx.beginPath();
        ctx.moveTo(x, 0); ctx.lineTo(x, H);
        ctx.strokeStyle = 'rgba(255,255,255,0.018)'; ctx.lineWidth = 0.5; ctx.stroke();
      }
    }

    /* ── Draw animated candlesticks ── */
    let chartOffset = 0;
    function drawCandles(t) {
      chartOffset = (chartOffset + 0.2) % 30; // slow scroll
      const candles = candleData;
      const cW = 22;       // candle width
      const gap = 6;
      const step = cW + gap;
      const chartH = H * 0.45;
      const chartY = H * 0.35;  // vertical center of chart area
      const chartX = W * 0.55;  // right side of screen

      // Price range
      let minP = Infinity, maxP = -Infinity;
      candles.forEach(c => { minP = Math.min(minP, c.low); maxP = Math.max(maxP, c.high); });
      const range = maxP - minP || 1;

      const totalW = candles.length * step;
      const startX = chartX - chartOffset;

      // Subtle shadow/glow behind candle area
      const areaGlow = ctx.createRadialGradient(chartX + W * 0.15, chartY + chartH * 0.5, 0, chartX + W * 0.15, chartY + chartH * 0.5, W * 0.3);
      areaGlow.addColorStop(0, rgba(GOLD, 0.04));
      areaGlow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = areaGlow;
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      // Clip to right portion so candles don't overlap hero text
      ctx.rect(W * 0.48, 0, W * 0.52, H);
      ctx.clip();

      candles.forEach((c, i) => {
        const x = startX + i * step;
        if (x + cW < W * 0.48 || x > W) return;

        const openY  = chartY + chartH - ((c.open  - minP) / range) * chartH;
        const closeY = chartY + chartH - ((c.close - minP) / range) * chartH;
        const highY  = chartY + chartH - ((c.high  - minP) / range) * chartH;
        const lowY   = chartY + chartH - ((c.low   - minP) / range) * chartH;
        const bodyH  = Math.max(Math.abs(closeY - openY), 1.5);
        const bodyY  = Math.min(openY, closeY);
        const color  = c.bull ? EMERALD : RED;
        const alpha  = 0.22 + 0.12 * Math.sin(t * 0.005 + i * 0.3);

        // Wick
        ctx.beginPath();
        ctx.moveTo(x + cW * 0.5, highY);
        ctx.lineTo(x + cW * 0.5, lowY);
        ctx.strokeStyle = rgba(color, alpha * 0.8);
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Body
        ctx.fillStyle = rgba(color, alpha);
        ctx.fillRect(x, bodyY, cW, bodyH);

        // Body border
        ctx.strokeStyle = rgba(color, alpha * 1.5);
        ctx.lineWidth = 0.8;
        ctx.strokeRect(x, bodyY, cW, bodyH);
      });

      // Trend line — moving average glow
      ctx.beginPath();
      let started = false;
      candles.forEach((c, i) => {
        const x = startX + i * step + cW * 0.5;
        if (x < W * 0.48 || x > W) return;
        const y = chartY + chartH - ((c.close - minP) / range) * chartH;
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      });
      const tg = ctx.createLinearGradient(W * 0.48, 0, W, 0);
      tg.addColorStop(0,   rgba(EMERALD, 0));
      tg.addColorStop(0.3, rgba(EMERALD, 0.35));
      tg.addColorStop(1,   rgba(EMERALD, 0.1));
      ctx.strokeStyle = tg;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.restore();
    }

    /* ── Draw node connections ── */
    function drawConnections() {
      const maxD = Math.min(W, H) * 0.2;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d = Math.sqrt(dx*dx + dy*dy);
          if (d < maxD) {
            const alpha = (1 - d / maxD) * 0.09 * Math.min(a.a, b.a);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = rgba(GOLD, alpha);
            ctx.lineWidth = 0.6; ctx.stroke();
          }
        }
      }
    }

    /* ── VORNIX watermark ── */
    function drawWatermark(t) {
      ctx.save();
      const size = Math.min(W * 0.22, 220);
      ctx.font = `bold ${size}px 'Bebas Neue', sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.0007);
      ctx.strokeStyle = rgba(GOLD, 0.016 + 0.008 * pulse);
      ctx.lineWidth = 1;
      ctx.strokeText('VORNIX', W * 0.38, H * 0.52);
      ctx.restore();
    }

    let t = 0;
    function draw() {
      ctx.clearRect(0, 0, W, H);

      drawGrid();
      drawWatermark(t);
      drawCandles(t);
      drawConnections();

      // Particles — rising
      particles.forEach(p => {
        p.pulse += p.pspeed;
        const pa = p.a * (0.6 + 0.4 * Math.sin(p.pulse));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = rgba(p.color, pa);
        ctx.fill();
        p.x += p.vx; p.y += p.vy;
        if (p.y < -20) { Object.assign(p, makeParticle(W, H)); }
        if (p.x < -10) p.x = W + 10;
        if (p.x > W + 10) p.x = -10;
      });

      // Nodes — glowing
      nodes.forEach(n => {
        n.pulse += n.ps;
        const np = 0.5 + 0.5 * Math.sin(n.pulse);
        // Glow
        const gr = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 10);
        gr.addColorStop(0, rgba(n.color, 0.18 * np * n.a));
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(n.x - n.r * 10, n.y - n.r * 10, n.r * 20, n.r * 20);
        // Core
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * (0.8 + 0.2 * np), 0, Math.PI * 2);
        ctx.fillStyle = rgba(n.color, n.a * np);
        ctx.fill();
        n.x += n.vx; n.y += n.vy;
        if (n.y < -20) { Object.assign(n, makeNode(W, H)); n.y = H + 20; }
        if (n.x < -20) n.x = W + 20;
        if (n.x > W + 20) n.x = -20;
      });

      t++;
      requestAnimationFrame(draw);
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
