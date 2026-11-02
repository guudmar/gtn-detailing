// Главная сцена: ролики идут вслед за прокруткой. Кадры лежат в assets/frames и грузятся вокруг текущего места.
(() => {
  const html = document.documentElement;
  if (!html.classList.contains('seq')) return;

  const root = document.getElementById('bay');
  const stage = root.querySelector('.bay__stage');
  const canvas = root.querySelector('.bay__canvas');
  const ctx = canvas.getContext('2d', { alpha: false });

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const seg = (v, a, b) => clamp((v - a) / (b - a));
  const ease = (t) => t * t * (3 - 2 * t);

  const tall = innerWidth / innerHeight < 0.8;
  const set = tall ? 'tall' : 'wide';
  const COUNT = { door: 151, wash: 91, polish: 91, ceramic: 91, film: 60 };
  const AHEAD = tall ? 90 : 160; // сколько кадров держать загруженными вокруг текущего
  const KEEP = AHEAD * 1.6;
  const PARALLEL = tall ? 4 : 6;

  // Отрезки прокрутки. В промежутках между ними следующий кадр открывается шестигранником.
  const SHOTS = [
    { clip: 'door', a: 0, b: 0.3 },
    { clip: 'wash', a: 0.325, b: 0.46 },
    { clip: 'polish', a: 0.475, b: 0.615 },
    { clip: 'ceramic', a: 0.63, b: 0.74 },
    { clip: 'film', a: 0.755, b: 0.88 },
    { clip: 'door', a: 0.905, b: 1, still: true }, // финал: последний кадр ворот, камера чуть наезжает
  ];

  const frames = [];
  SHOTS.forEach((s) => {
    const total = COUNT[s.clip];
    s.start = frames.length;
    s.n = s.still ? 1 : total;
    for (let i = s.still ? total : 1; i <= total; i++) {
      frames.push({ src: `assets/frames/${set}/${s.clip}/${String(i).padStart(4, '0')}.webp`, img: null, busy: false, bad: false });
    }
  });

  // Загрузка: ближайшие кадры первыми, вперёд важнее, чем назад; дальние отпускаем из памяти.
  let cursor = 0;
  let active = 0;
  let dirty = true;
  let firstLoaded = 0;

  const score = (i) => (i >= cursor ? i - cursor : (cursor - i) * 2);
  const pump = () => {
    while (active < PARALLEL) {
      let best = -1;
      let bestScore = AHEAD;
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        if (f.img || f.busy || f.bad) continue;
        const sc = score(i);
        if (sc < bestScore) { bestScore = sc; best = i; }
      }
      if (best < 0) return;
      const f = frames[best];
      const img = new Image();
      f.busy = true;
      active++;
      img.onload = () => {
        f.busy = false; f.img = img; active--; firstLoaded++; dirty = true;
        if (firstLoaded >= 8) ready();
        pump();
      };
      img.onerror = () => { f.busy = false; f.bad = true; active--; if (best === 0) fail(); pump(); };
      img.src = f.src;
    }
  };
  const evict = () => {
    frames.forEach((f, i) => { if (f.img && Math.abs(i - cursor) > KEEP) f.img = null; });
  };

  let w = 0;
  let h = 0;
  let dpr = 1;
  const size = () => {
    const r = stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    dpr = Math.min(dpr, 2200 / Math.max(r.width, 1));
    w = Math.round(r.width * dpr);
    h = Math.round(r.height * dpr);
    canvas.width = w;
    canvas.height = h;
    ctx.imageSmoothingQuality = 'high';
    dirty = true;
  };

  const cover = (img, zoom = 1) => {
    const k = Math.max(w / img.naturalWidth, h / img.naturalHeight) * zoom;
    const dw = img.naturalWidth * k;
    const dh = img.naturalHeight * k;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  };

  // Кадр отрезка: два соседних смешиваются, поэтому при медленной прокрутке движение не дёргается.
  const nearest = (shot, i) => {
    for (let d = 0; d < shot.n; d++) {
      const lo = frames[shot.start + i - d];
      if (i - d >= 0 && lo && lo.img) return lo.img;
      const hi = frames[shot.start + i + d];
      if (i + d < shot.n && hi && hi.img) return hi.img;
    }
    return null;
  };
  const drawShot = (shot, t) => {
    const zoom = shot.still ? 1 + 0.05 * t : 1;
    const pos = t * (shot.n - 1);
    const i = Math.floor(pos);
    const base = nearest(shot, i);
    if (!base) return false;
    ctx.globalAlpha = 1;
    cover(base, zoom);
    const next = frames[shot.start + i + 1];
    const frac = pos - i;
    if (frac > 0.02 && i + 1 < shot.n && next.img) {
      ctx.globalAlpha = frac;
      cover(next.img, zoom);
      ctx.globalAlpha = 1;
    }
    return true;
  };

  const hexPath = (r) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = Math.PI / 2 + (i * Math.PI) / 3;
      const x = w / 2 + r * Math.cos(ang);
      const y = h / 2 + r * Math.sin(ang);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  };

  const drawAt = (pr) => {
    const k = SHOTS.findIndex((s) => pr <= s.b);
    const shot = SHOTS[k < 0 ? SHOTS.length - 1 : k];
    if (pr >= shot.a || k <= 0) {
      const t = seg(pr, shot.a, shot.b);
      cursor = shot.start + Math.round(t * (shot.n - 1));
      drawShot(shot, t);
      return;
    }
    // Промежуток: шестигранник, как ячейка потолка, раскрывается из центра.
    const prev = SHOTS[k - 1];
    const q = ease(seg(pr, prev.b, shot.a));
    cursor = shot.start;
    if (!drawShot(prev, 1)) return;
    const full = (Math.hypot(w, h) / 2) / Math.cos(Math.PI / 6);
    const r = full * q * 1.04;
    ctx.save();
    hexPath(r);
    ctx.clip();
    drawShot(shot, 0);
    ctx.restore();
    ctx.save();
    hexPath(r);
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = `rgba(255,255,255,${(1 - q * q).toFixed(3)})`;
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 26 * dpr;
    ctx.stroke();
    ctx.restore();
  };

  // Прокрутка и подписи.
  const chapters = [...root.querySelectorAll('[data-in]')].map((el) => ({
    el, a: +el.dataset.in, b: +el.dataset.out, fade: +(el.dataset.fade || 0.018), last: el.dataset.out === '1.1',
  }));
  const rail = [...root.querySelectorAll('[data-go]')];
  const readP = () => clamp(-root.getBoundingClientRect().top / Math.max(1, root.offsetHeight - innerHeight));

  const applyOverlay = (pr) => {
    chapters.forEach((c) => {
      const inn = seg(pr, c.a - c.fade, c.a + c.fade);
      const out = c.last ? 0 : seg(pr, c.b - c.fade, c.b + c.fade);
      const a = inn * (1 - out);
      c.el.style.setProperty('--a', a.toFixed(3));
      c.el.style.setProperty('--y', ((1 - inn) * 100 - out * 100).toFixed(1));
      c.el.style.visibility = a < 0.002 ? 'hidden' : 'visible';
    });
    rail.forEach((r) => r.classList.toggle('is-on', pr >= +r.dataset.go - 0.005 && pr < +r.dataset.end - 0.005));
    const railA = seg(pr, 0.3, 0.325) * (1 - seg(pr, 0.875, 0.895));
    stage.style.setProperty('--rail', railA.toFixed(3));
    stage.style.setProperty('--rail-v', railA > 0.01 ? 'visible' : 'hidden');
    stage.style.setProperty('--scrim', Math.max(1 - seg(pr, 0.035, 0.06), seg(pr, 0.3, 0.33)).toFixed(3));
  };

  let p = readP();
  let shownP = -1;
  let tick = 0;
  const loop = () => {
    requestAnimationFrame(loop);
    const target = readP();
    p += (target - p) * 0.2;
    if (Math.abs(target - p) < 0.00004) p = target;
    if (p === shownP && !dirty) return;
    const inView = root.getBoundingClientRect().bottom > 0;
    if (inView) {
      drawAt(p);
      applyOverlay(p);
    }
    shownP = p;
    dirty = false;
    if (++tick % 20 === 0) { evict(); }
    pump();
  };

  let done = false;
  function ready() {
    if (done) return;
    done = true;
    html.classList.add('seq-ready');
    document.dispatchEvent(new CustomEvent('gtn:ready'));
  }
  function fail() {
    if (done) return;
    done = true;
    html.classList.remove('seq');
    html.classList.add('seq-failed');
    document.dispatchEvent(new CustomEvent('gtn:ready'));
  }

  size();
  addEventListener('resize', size);
  applyOverlay(p);
  drawAt(p);
  pump();
  requestAnimationFrame(loop);
  // На медленной связи не держим загрузчик ради восьми кадров: хватает первого.
  setTimeout(() => { if (firstLoaded > 0) ready(); }, 5000);
})();
