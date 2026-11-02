// Общий моушн сайта: плавная прокрутка, появление строк и кадров, лента работ, курсор и меню.
(() => {
  const root = document.documentElement;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const wide = matchMedia('(min-width: 900px)').matches && fine && !calm;
  if (wide) root.classList.add('wide');

  // Меню на телефоне работает и без библиотек.
  const menuBtn = document.querySelector('.nav__menu');
  const menu = document.querySelector('.menu');
  if (menuBtn && menu) {
    menuBtn.addEventListener('click', () => {
      const open = menu.classList.toggle('is-open');
      menuBtn.textContent = open ? 'Закрыть' : 'Меню';
      menuBtn.setAttribute('aria-expanded', String(open));
    });
  }

  // Вопросы раскрываются плавно.
  document.querySelectorAll('.q').forEach((q) => {
    const sum = q.querySelector('summary');
    const body = q.querySelector('.q__a');
    sum.addEventListener('click', (e) => {
      if (calm || !window.gsap) return;
      e.preventDefault();
      if (q.open) {
        gsap.to(body, { height: 0, duration: 0.6, ease: 'expo.out', onComplete: () => { q.open = false; gsap.set(body, { clearProps: 'height' }); if (window.ScrollTrigger) ScrollTrigger.refresh(); } });
      } else {
        q.open = true;
        gsap.fromTo(body, { height: 0 }, { height: 'auto', duration: 0.8, ease: 'expo.out', onComplete: () => { gsap.set(body, { clearProps: 'height' }); if (window.ScrollTrigger) ScrollTrigger.refresh(); } });
      }
    });
  });

  // Режим работы: 10:00–21:00 каждый день, по Ростову (UTC+3).
  const hour = (new Date().getUTCHours() + 3) % 24;
  document.querySelectorAll('[data-open-now]').forEach((el) => {
    el.textContent = hour >= 10 && hour < 21 ? 'Сейчас открыто, до 21:00' : 'Сейчас закрыто, откроемся в 10:00';
  });

  if (calm || !window.gsap) {
    document.querySelectorAll('[data-rise],[data-clip]').forEach((el) => { el.removeAttribute('data-rise'); el.removeAttribute('data-clip'); });
    return;
  }
  gsap.registerPlugin(ScrollTrigger);
  if (window.SplitText) gsap.registerPlugin(SplitText);

  // Плавная прокрутка.
  const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9 });
  window.GTNLenis = lenis;
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);

  const start = () => {
    // Заголовки выезжают из-под маски построчно.
    document.querySelectorAll('[data-lines]').forEach((el) => {
      if (!window.SplitText) return;
      SplitText.create(el, {
        type: 'lines', mask: 'lines', autoSplit: true,
        onSplit: (self) => gsap.from(self.lines, { yPercent: 112, duration: 1.3, ease: 'expo.out', stagger: 0.09, scrollTrigger: { trigger: el, start: 'top 92%', once: true } }),
      });
    });

    gsap.utils.toArray('[data-rise]').forEach((el) => {
      gsap.to(el, { opacity: 1, y: 0, duration: 1.2, ease: 'expo.out', delay: (+el.dataset.rise || 0) * 0.08, scrollTrigger: { trigger: el, start: 'top 94%', once: true } });
    });

    // Фото открываются шторкой, а внутри чуть отъезжают.
    gsap.utils.toArray('[data-clip]').forEach((el) => {
      const img = el.querySelector('img');
      const st = { trigger: el, start: 'top 90%', once: true };
      gsap.to(el, { clipPath: 'inset(0 0 0% 0)', duration: 1.5, ease: 'expo.out', scrollTrigger: st });
      if (img) gsap.to(img, { scale: 1, duration: 1.9, ease: 'expo.out', scrollTrigger: st });
    });

    // Слова заявления проявляются по прокрутке.
    document.querySelectorAll('[data-fill]').forEach((el) => {
      const words = el.textContent.trim().split(/\s+/);
      el.setAttribute('aria-label', el.textContent.trim());
      el.innerHTML = words.map((w) => `<span class="w" aria-hidden="true">${w}</span>`).join(' ');
      gsap.fromTo(el.querySelectorAll('.w'), { opacity: 0.14 }, { opacity: 1, stagger: 0.1, ease: 'none', scrollTrigger: { trigger: el, start: 'top 78%', end: 'bottom 45%', scrub: true } });
    });

    // Цифры досчитываются один раз.
    document.querySelectorAll('[data-count-to]').forEach((el) => {
      const to = +el.dataset.countTo, dec = +(el.dataset.dec || 0);
      const v = { n: 0 };
      gsap.to(v, { n: to, duration: 2, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 92%', once: true }, onUpdate: () => { el.textContent = v.n.toFixed(dec).replace('.', ','); } });
    });

    // Настоящий бокс: кадр раскрывается из окна на весь экран.
    const real = document.querySelector('.real__pic');
    if (real) {
      gsap.fromTo(real, { clipPath: 'inset(16% 22% 16% 22%)' }, { clipPath: 'inset(0% 0% 0% 0%)', ease: 'none', scrollTrigger: { trigger: '.real', start: 'top 85%', end: 'top 5%', scrub: true } });
      gsap.fromTo(real.querySelector('img'), { scale: 1.22 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: '.real', start: 'top bottom', end: 'bottom bottom', scrub: true } });
    }

    // Над светлым разворотом навигация становится тёмной.
    const nav = document.querySelector('.nav');
    const bone = document.querySelector('.svc');
    if (nav && bone) ScrollTrigger.create({ trigger: bone, start: 'top 40px', end: 'bottom 40px', toggleClass: { targets: nav, className: 'is-dark' } });
    const stageEl = document.getElementById('bay');
    if (nav && stageEl && root.classList.contains('seq')) ScrollTrigger.create({ trigger: stageEl, start: 'top top', end: 'bottom 40px', toggleClass: { targets: nav, className: 'is-home' } });

    // Фото во всю ширину едет медленнее страницы.
    gsap.utils.toArray('.bleed img').forEach((img) => {
      gsap.fromTo(img, { yPercent: -8 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: img.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } });
    });

    // Лента работ.
    const works = document.querySelector('.works');
    const track = document.querySelector('.works__track');
    if (works && track && wide) {
      const shots = [...track.querySelectorAll('.shot img')];
      let dist = 0;
      const measure = () => {
        dist = Math.max(0, track.scrollWidth - innerWidth);
        works.style.height = `${dist + innerHeight}px`;
        ScrollTrigger.refresh();
      };
      const run = () => {
        const r = works.getBoundingClientRect();
        const pr = gsap.utils.clamp(0, 1, -r.top / Math.max(1, r.height - innerHeight));
        track.style.transform = `translate3d(${(-dist * pr).toFixed(1)}px,0,0)`;
        shots.forEach((im) => {
          const b = im.parentElement.getBoundingClientRect();
          const off = (b.left + b.width / 2 - innerWidth / 2) / innerWidth;
          im.style.setProperty('--px', `${(-off * 7).toFixed(2)}%`);
        });
      };
      shots.forEach((im) => im.addEventListener('load', measure, { once: true }));
      measure();
      addEventListener('resize', measure);
      gsap.ticker.add(run);
    }

    // Подвал: контур имени заполняется к концу страницы.
    const mark = document.querySelector('.foot__mark');
    if (mark) gsap.fromTo(mark, { yPercent: 28 }, { yPercent: 6, ease: 'none', scrollTrigger: { trigger: mark, start: 'top bottom', end: 'bottom bottom', scrub: true } });
  };

  // Подсказка с фото рядом с указателем.
  const peek = document.querySelector('.peek');
  const rows = document.querySelector('.rows');
  if (peek && rows && fine) {
    const imgs = [...peek.querySelectorAll('img')];
    const qx = gsap.quickTo(peek, 'x', { duration: 0.7, ease: 'expo.out' });
    const qy = gsap.quickTo(peek, 'y', { duration: 0.7, ease: 'expo.out' });
    rows.addEventListener('pointermove', (e) => {
      qx(Math.min(e.clientX + 28, innerWidth - peek.offsetWidth - 16));
      qy(gsap.utils.clamp(16, innerHeight - peek.offsetHeight - 16, e.clientY - peek.offsetHeight / 2));
    });
    rows.querySelectorAll('.row').forEach((row, i) => {
      row.addEventListener('pointerenter', () => { peek.classList.add('is-on'); imgs.forEach((im, k) => im.classList.toggle('is-on', k === i)); });
    });
    rows.addEventListener('pointerleave', () => peek.classList.remove('is-on'));
  }

  // Курсор и магнитные кнопки.
  if (fine) {
    const cur = document.createElement('div'); cur.className = 'cur'; document.body.append(cur);
    const cx = gsap.quickTo(cur, 'x', { duration: 0.35, ease: 'power3.out' });
    const cy = gsap.quickTo(cur, 'y', { duration: 0.35, ease: 'power3.out' });
    addEventListener('pointermove', (e) => { cur.classList.add('is-on'); cx(e.clientX); cy(e.clientY); }, { passive: true });
    document.addEventListener('pointerover', (e) => { cur.classList.toggle('is-big', !!e.target.closest('a,button,summary,label')); });
    document.documentElement.addEventListener('pointerleave', () => cur.classList.remove('is-on'));
    document.querySelectorAll('.btn').forEach((b) => {
      const mx = gsap.quickTo(b, 'x', { duration: 0.6, ease: 'expo.out' });
      const my = gsap.quickTo(b, 'y', { duration: 0.6, ease: 'expo.out' });
      b.addEventListener('pointermove', (e) => { const r = b.getBoundingClientRect(); mx((e.clientX - r.left - r.width / 2) * 0.18); my((e.clientY - r.top - r.height / 2) * 0.3); });
      b.addEventListener('pointerleave', () => { mx(0); my(0); });
    });
  }

  // Рельса глав сцены с роликами.
  const bay = document.getElementById('bay');
  document.querySelectorAll('[data-go]').forEach((b) => {
    b.addEventListener('click', () => {
      const y = bay.offsetTop + (+b.dataset.go + 0.012) * (bay.offsetHeight - innerHeight);
      lenis.scrollTo(y, { duration: 2.2, easing: (t) => 1 - Math.pow(1 - t, 4) });
    });
  });

  // На главной анимации ждут, пока откроется загрузчик: иначе заголовки отыграют под ним.
  if (root.classList.contains('seq') && !root.classList.contains('seq-ready')) {
    document.addEventListener('gtn:ready', start, { once: true });
  } else {
    start();
  }
})();
