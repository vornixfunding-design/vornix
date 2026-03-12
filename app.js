/* ================================================================
   VORNIX — app.js  v2  (Hamburger Bug Fixed)
   ─────────────────────────────────────────────────────────────
   BUG FIX:  Old code crashed silently inside DOMContentLoaded.
             If Background.init() threw any error, Nav.init()
             never ran → hamburger permanently hidden.
   FIX:      Every init() is now inside its own try/catch block.
             One failure can never break anything else.
   FIX:      Hamburger visibility is now 100% CSS-driven.
             JS only toggles the is-open class on click.
================================================================ */

'use strict';

/* ── CONFIG ─────────────────────────────────────────── */
const CONFIG = {
  pages: ['home','challenges','tech','how','about','contact'],
  tabs:  ['one','two','three','partial'],
};

/* ── ROUTER ─────────────────────────────────────────── */
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
    setTimeout(() => Reveal.trigger(), 80);
  }
  function init() {
    const hash = window.location.hash.replace('#','');
    go(CONFIG.pages.includes(hash) ? hash : 'home');
    window.addEventListener('popstate', e => go(e.state?.page || 'home'));
  }
  return { go, init };
})();

/* ── TABS ───────────────────────────────────────────── */
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
  return { set, init: () => set('one') };
})();

/* ── NAV  ── HAMBURGER BUG IS FIXED HERE ───────────── */
const Nav = (() => {
  let _open = false;

  function open() {
    _open = true;
    document.getElementById('nav-ham')?.classList.add('is-open');
    document.getElementById('nav-ham')?.setAttribute('aria-expanded','true');
    document.getElementById('nav-drawer')?.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    _open = false;
    document.getElementById('nav-ham')?.classList.remove('is-open');
    document.getElementById('nav-ham')?.setAttribute('aria-expanded','false');
    document.getElementById('nav-drawer')?.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  function toggle() { _open ? close() : open(); }

  function init() {
    // Close on resize past desktop breakpoint
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 1024 && _open) close();
    }, { passive: true });

    // Close on ESC
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _open) close();
    });

    // Nav shadow on scroll
    window.addEventListener('scroll', () => {
      const nav = document.querySelector('.nav');
      if (nav) nav.style.boxShadow = window.scrollY > 20 ? '0 4px 32px rgba(0,0,0,.45)' : '';
    }, { passive: true });
  }

  return { toggle, close, init };
})();

/* ── FAQ ────────────────────────────────────────────── */
const FAQ = (() => {
  function init() {
    document.addEventListener('click', e => {
      const q = e.target.closest('.faq__q');
      if (!q) return;
      const item = q.parentElement;
      const was  = item.classList.contains('is-open');
      document.querySelectorAll('.faq__item').forEach(i => i.classList.remove('is-open'));
      if (!was) item.classList.add('is-open');
    });
  }
  return { init };
})();

/* ── REVEAL ─────────────────────────────────────────── */
const Reveal = (() => {
  let obs;
  function trigger() {
    document.querySelectorAll('.page.is-active .rv:not(.in)').forEach((el,i) => {
      setTimeout(() => el.classList.add('in'), i * 40);
    });
  }
  function init() {
    if (!('IntersectionObserver' in window)) {
      document.querySelectorAll('.rv').forEach(el => el.classList.add('in'));
      return;
    }
    obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); } });
    }, { threshold: 0.08 });
    document.querySelectorAll('.rv').forEach(el => obs.observe(el));
    trigger();
  }
  return { trigger, init };
})();

/* ── CURSOR ─────────────────────────────────────────── */
const Cursor = (() => {
  const SEL = 'a,button,.plan-card,.tab,.faq__q,.hstep,.vc,.ch,.tcard,.tc,.eco,.plan-preview';
  let mx=0, my=0, rx=0, ry=0, dot, ring;
  const lerp = (a,b,t) => a+(b-a)*t;

  function loop() {
    rx = lerp(rx,mx,.14); ry = lerp(ry,my,.14);
    if (dot)  { dot.style.left  = mx+'px'; dot.style.top  = my+'px'; }
    if (ring) { ring.style.left = rx+'px'; ring.style.top = ry+'px'; }
    requestAnimationFrame(loop);
  }

  function init() {
    dot  = document.querySelector('.cursor');
    ring = document.querySelector('.cursor-ring');
    if (!dot || !ring) return;
    if (window.matchMedia('(hover:none)').matches) {
      dot.style.display = ring.style.display = 'none';
      document.body.style.cursor = 'auto';
      return;
    }
    document.addEventListener('mousemove', e => { mx=e.clientX; my=e.clientY; }, { passive:true });
    document.addEventListener('mouseover', e => { if(e.target.closest(SEL)) document.body.classList.add('is-hovering'); });
    document.addEventListener('mouseout',  e => { if(e.target.closest(SEL)) document.body.classList.remove('is-hovering'); });
    loop();
  }
  return { init };
})();

/* ── BACKGROUND (financial chart) ───────────────────── */
const Background = (() => {
  let canvas, ctx, W, H, lines=[], candles=[];

  class Line {
    constructor(o) { Object.assign(this,{color:'rgba(184,0,15,',opacity:.35,speed:.4,amp:30,freq:.018,phase:0,width:1,...o}); this.pts=[]; }
    update() {
      this.phase += this.speed*.008; this.pts=[];
      for(let i=0;i<=Math.ceil(W/3)+2;i++) {
        const x=i*3;
        this.pts.push(this.y+Math.sin(x*this.freq+this.phase)*this.amp+Math.sin(x*this.freq*.34+this.phase*1.4)*this.amp*.4);
      }
    }
    draw() {
      if(this.pts.length<2) return;
      ctx.save(); ctx.beginPath();
      ctx.strokeStyle=this.color+this.opacity+')'; ctx.lineWidth=this.width;
      ctx.moveTo(0,this.pts[0]);
      for(let i=1;i<this.pts.length;i++) {
        const xp=(i-1)*3,xc=i*3,xm=(xp+xc)/2;
        ctx.quadraticCurveTo(xp,this.pts[i-1],xm,(this.pts[i-1]+this.pts[i])/2);
      }
      ctx.stroke();
      ctx.lineTo(W+4,H+4); ctx.lineTo(-4,H+4); ctx.closePath();
      ctx.fillStyle=this.color+(this.opacity*.08)+')'; ctx.fill();
      ctx.restore();
    }
  }

  class Candle {
    constructor(x) {
      this.x=x; this.up=Math.random()>.45;
      this.h=20+Math.random()*55; this.wick=5+Math.random()*18;
      this.w=7+Math.random()*5; this.y=H*.15+Math.random()*H*.6;
      this.a=.06+Math.random()*.09;
    }
    draw() {
      const c=this.up?'rgba(23,149,106,':'rgba(184,0,15,';
      ctx.save(); ctx.fillStyle=c+this.a+')'; ctx.strokeStyle=c+(this.a+.04)+')';
      ctx.lineWidth=1; ctx.fillRect(this.x-this.w/2,this.y-this.h/2,this.w,this.h);
      ctx.beginPath();
      ctx.moveTo(this.x,this.y-this.h/2); ctx.lineTo(this.x,this.y-this.h/2-this.wick);
      ctx.moveTo(this.x,this.y+this.h/2); ctx.lineTo(this.x,this.y+this.h/2+this.wick);
      ctx.stroke(); ctx.restore();
    }
  }

  function drawGrid() {
    ctx.save();
    for(let i=0;i<=8;i++) {
      ctx.beginPath(); ctx.strokeStyle='rgba(255,255,255,.02)';
      ctx.setLineDash([3,18]); ctx.moveTo(0,(H/8)*i); ctx.lineTo(W,(H/8)*i); ctx.stroke();
    }
    for(let i=0;i<=Math.ceil(W/80);i++) {
      ctx.beginPath(); ctx.strokeStyle='rgba(255,255,255,.012)';
      ctx.setLineDash([2,20]); ctx.moveTo(i*80,0); ctx.lineTo(i*80,H); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.restore();
  }

  function drawLabels() {
    ctx.save(); ctx.font='10px JetBrains Mono,monospace';
    ctx.fillStyle='rgba(255,255,255,.05)';
    ['2847.50','2836.20','2824.85','2813.40','2802.15'].forEach((v,i)=>ctx.fillText(v,W-66,(H/6)*(i+1)));
    ctx.restore();
  }

  function drawPanel() {
    if(W<900) return;
    const px=W-218,py=18,pw=198,ph=88;
    ctx.save();
    ctx.fillStyle='rgba(10,13,28,.6)'; ctx.strokeStyle='rgba(184,0,15,.1)'; ctx.lineWidth=1;
    ctx.fillRect(px,py,pw,ph); ctx.strokeRect(px,py,pw,ph);
    ctx.font='9px JetBrains Mono,monospace';
    ctx.fillStyle='rgba(184,0,15,.48)'; ctx.fillText('VORNIX // MARKET DATA',px+10,py+14);
    ctx.fillStyle='rgba(255,255,255,.22)';
    ['XAUUSD   2847.50  +0.82%','EURUSD   1.0842  -0.24%','SP500    5934.40  +1.12%','BTC/USD  96,440  +2.38%']
      .forEach((t,i)=>ctx.fillText(t,px+10,py+28+i*14));
    ctx.restore();
  }

  function build() {
    lines=[
      new Line({y:H*.38,speed:.38,amp:42,freq:.014,phase:0,color:'rgba(184,0,15,',opacity:.36,width:1.4}),
      new Line({y:H*.55,speed:.22,amp:28,freq:.010,phase:2.1,color:'rgba(196,152,42,',opacity:.2,width:1}),
      new Line({y:H*.68,speed:.18,amp:20,freq:.008,phase:4.4,color:'rgba(184,0,15,',opacity:.13,width:.8}),
      new Line({y:H*.25,speed:.12,amp:15,freq:.022,phase:1.2,color:'rgba(196,152,42,',opacity:.1,width:.7}),
    ];
    candles=[];
    for(let x=40;x<W;x+=28) if(Math.random()>.5) candles.push(new Candle(x));
  }

  function frame() {
    ctx.clearRect(0,0,W,H);
    drawGrid(); candles.forEach(c=>c.draw()); lines.forEach(l=>{l.update();l.draw();});
    drawLabels(); drawPanel();
    requestAnimationFrame(frame);
  }

  function init() {
    canvas=document.getElementById('bg-canvas');
    if(!canvas||!canvas.getContext) return;
    ctx=canvas.getContext('2d');
    W=canvas.width=window.innerWidth; H=canvas.height=window.innerHeight;
    build(); frame();
    window.addEventListener('resize',()=>{
      W=canvas.width=window.innerWidth; H=canvas.height=window.innerHeight; build();
    },{passive:true});
  }

  return { init };
})();

/* ── FORMS ──────────────────────────────────────────── */
const Forms = (() => {
  function init() {
    document.addEventListener('click', e => {
      if (!e.target.classList.contains('f-submit')) return;
      const btn=e.target, orig=btn.textContent;
      btn.textContent='✓ Sent — We\'ll reply within 2 hours';
      btn.style.background='#17956A';
      setTimeout(()=>{btn.textContent=orig;btn.style.background='';},4000);
    });
  }
  return { init };
})();

/* ── GLOBAL FUNCTIONS (used by HTML onclick attrs) ─── */
window.nav         = id => Router.go(id);
window.setTab      = id => Tabs.set(id);
window.hamMenu     = () => Nav.toggle();
window.closeDrawer = () => Nav.close();

/* ── BOOT ── Each init is isolated in try/catch ─────── */
document.addEventListener('DOMContentLoaded', () => {
  try { Background.init(); } catch(e) { console.warn('[VORNIX] Background failed:',e); }
  try { Cursor.init();     } catch(e) { console.warn('[VORNIX] Cursor failed:',e);     }
  try { Nav.init();        } catch(e) { console.warn('[VORNIX] Nav failed:',e);        }
  try { FAQ.init();        } catch(e) { console.warn('[VORNIX] FAQ failed:',e);        }
  try { Reveal.init();     } catch(e) { console.warn('[VORNIX] Reveal failed:',e);     }
  try { Tabs.init();       } catch(e) { console.warn('[VORNIX] Tabs failed:',e);       }
  try { Router.init();     } catch(e) { console.warn('[VORNIX] Router failed:',e);     }
  try { Forms.init();      } catch(e) { console.warn('[VORNIX] Forms failed:',e);      }
});
