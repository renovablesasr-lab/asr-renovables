import '@fontsource-variable/sora';
import '@fontsource-variable/inter';
import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/600.css';
import './styles/main.css';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger, SplitText);
// las animaciones siguen el reloj real aunque un equipo lento renderice pocos cuadros:
// nada se queda a medias ni escondido
gsap.ticker.lagSmoothing(0);

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// ?snap desactiva la inercia de la cámara (útil para capturas de pantalla)
const SNAP = new URLSearchParams(location.search).has('snap');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// móvil / táctil: scroll nativo del teléfono (más fluido) y video ligero
const mobile = window.matchMedia('(max-width: 900px), (pointer: coarse)').matches;
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const root = document.documentElement;
if (reduced) root.classList.add('rm');

document.body.classList.add('is-loading');
$('[data-year]').textContent = new Date().getFullYear();

/* =========================================================
   Scroll suave
   ========================================================= */
let lenis = null;
if (!reduced && !mobile) {
  lenis = new Lenis({ lerp: 0.09, smoothWheel: true, wheelMultiplier: 0.95 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  lenis.stop();
}

function scrollToTarget(target) {
  const offset = target === 0 ? 0 : -70;
  if (lenis) lenis.scrollTo(target, { offset, duration: 1.6, easing: (t) => 1 - Math.pow(1 - t, 4) });
  else if (typeof target === 'number') window.scrollTo({ top: target, behavior: reduced ? 'auto' : 'smooth' });
  else window.scrollTo({ top: target.getBoundingClientRect().top + scrollY + offset, behavior: reduced ? 'auto' : 'smooth' });
}

/* =========================================================
   Loader + escena 3D
   ========================================================= */
const loaderNum = $('.loader__num');
const loaderBar = $('.loader__bar span');
const loadState = { v: 0 };
const paintLoader = () => {
  loaderNum.textContent = Math.round(loadState.v);
  loaderBar.style.transform = `scaleX(${loadState.v / 100})`;
};
const fakeLoad = gsap.to(loadState, { v: 88, duration: 2.4, ease: 'power2.out', onUpdate: paintLoader });

let scene = null;

async function boot() {
  const minTime = new Promise((r) => setTimeout(r, 1200));
  try {
    const { createScene } = await import('./scene.js');
    scene = createScene($('.webgl'));
  } catch (err) {
    console.warn('WebGL no disponible, se usa el fondo estático.', err);
    root.classList.add('no-webgl');
    document.body.classList.add('no-webgl');
  }
  await Promise.all([document.fonts.ready, minTime]);

  fakeLoad.kill();
  await gsap.to(loadState, { v: 100, duration: 0.4, ease: 'power1.out', onUpdate: paintLoader }).then();

  initAnimations();
  initScrollWorld();
  initNavTriggers();
  ScrollTrigger.refresh();
  introTimeline();
}

function introTimeline() {
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
  tl.to('.loader__inner', { opacity: 0, y: -20, duration: 0.5, ease: 'power2.in' })
    .to('.loader', { clipPath: 'inset(0 0 100% 0)', duration: 1.1, ease: 'expo.inOut' }, '-=0.1')
    .set('.loader', { display: 'none' })
    .call(() => {
      // la página se puede usar en cuanto se va el loader
      document.body.classList.remove('is-loading');
      lenis?.start();
    });
  if (reduced) return;
  tl.from('.hero__asr', { yPercent: 110, duration: 1.4 }, '-=0.6')
    .from('.hero__ren', { yPercent: 110, duration: 1.4 }, '-=1.25')
    .from('.hero__eyebrow', { opacity: 0, y: 20, duration: 1 }, '-=1.2')
    .from('.hero__lead', { opacity: 0, y: 26, duration: 1.1 }, '-=1')
    .fromTo('.hero__actions > *', { opacity: 0, y: 26 }, { opacity: 1, y: 0, stagger: 0.08, duration: 1 }, '-=0.9')
    .from('.hero__trust li', { opacity: 0, y: 12, stagger: 0.06, duration: 0.8 }, '-=0.8')
    .from('.scroll-cue', { opacity: 0, duration: 1 }, '-=0.5');
}

/* =========================================================
   Batería solar: el scroll recorre un día (amanecer → atardecer)
   y la batería de un sistema de 5 kWp se carga con el sol
   ========================================================= */
const hud = $('.hud');
const H = {
  time: $('.hud__time'),
  label: $('.hud__label'),
  state: $('.hud__state'),
  pct: $('.hud__pct'),
  kwh: $('.hud__kwh'),
  eqN: $('.hud__eqn'),
  eqU: $('.hud__equ'),
  eq: $('.hud__eq'),
  sun: $('.hud__sun-g'),
  done: $('.hud__arc-done'),
};
const DAY_KWH = 30; // sistema residencial de 5 kWp en Ciudad Juárez, día despejado
const ARC = Math.PI * 42; // largo del arco del sol en el SVG
const EQUIV = [
  { per: 0.015, unit: 'cargas de celular' }, // ~15 Wh por carga
  { per: 0.9, unit: 'horas de minisplit' }, // minisplit inverter de 1 ton
  { per: 1.4, unit: 'días de refrigerador' }, // refrigerador doméstico
];
let eqIdx = 0;
let energy = 0;
let lastT = 0;
let lastDecade = -1;
let chargeTimer;

function renderEquiv() {
  const e = EQUIV[eqIdx];
  const v = energy / e.per;
  H.eqN.textContent = v >= 100 ? Math.round(v).toLocaleString('es-MX') : v.toFixed(v < 10 ? 1 : 0);
  H.eqU.textContent = e.unit;
}

function updateHud(t) {
  // 06:15 → 20:10 (verano en Ciudad Juárez)
  const mins = 6 * 60 + 15 + t * (13 * 60 + 55);
  H.time.textContent = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(Math.floor(mins % 60)).padStart(2, '0')}`;
  H.label.textContent =
    t < 0.1 ? 'Amanecer' : t < 0.36 ? 'Mañana' : t < 0.62 ? 'Mediodía' : t < 0.9 ? 'Tarde' : 'Atardecer';

  // el sol recorre el arco de oriente a poniente
  const a = Math.PI * t;
  const x = (50 - 42 * Math.cos(a)).toFixed(2);
  const y = (50 - 42 * Math.sin(a)).toFixed(2);
  H.sun.setAttribute('transform', `translate(${x} ${y})`);
  H.done.style.strokeDashoffset = (ARC * (1 - t)).toFixed(1);

  // la producción sigue la curva del sol: energía acumulada = (1 − cos πt) / 2
  const charge = t >= 0.999 ? 1 : (1 - Math.cos(a)) / 2;
  energy = DAY_KWH * charge;
  hud.style.setProperty('--charge', charge.toFixed(4));
  hud.style.setProperty('--sun', Math.sin(a).toFixed(3));
  const pct = Math.round(charge * 100);
  H.pct.textContent = `${pct}%`;
  // cada 10 % que sube, el número da un salto
  const decade = Math.floor(pct / 10);
  if (decade > lastDecade && lastDecade >= 0) {
    H.pct.classList.remove('is-bump');
    void H.pct.offsetWidth;
    H.pct.classList.add('is-bump');
  }
  lastDecade = decade;
  H.kwh.textContent = energy.toFixed(1);

  const full = charge >= 0.995;
  hud.classList.toggle('is-full', full);
  H.state.textContent = full ? 'Batería llena ✓' : t < 0.02 ? 'Esperando el sol' : 'Cargando con el sol';

  // mientras bajas, el rayo indica que se está cargando
  if (t > lastT + 0.0005 && !full) {
    hud.classList.add('is-charging');
    clearTimeout(chargeTimer);
    chargeTimer = setTimeout(() => hud.classList.remove('is-charging'), 650);
  }
  lastT = t;
  renderEquiv();
}

// las equivalencias rotan solas
if (!reduced) {
  setInterval(() => {
    if (!document.body.classList.contains('dock-on') || energy < 0.05) return;
    H.eq.classList.add('is-swap');
    setTimeout(() => {
      eqIdx = (eqIdx + 1) % EQUIV.length;
      renderEquiv();
      H.eq.classList.remove('is-swap');
    }, 250);
  }, 3400);
}

function initScrollWorld() {
  // la escena 3D recorre toda la página
  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (self) => scene?.setProgress(self.progress, SNAP),
  });
  // la batería se llena justo al llegar al atardecer (contacto)
  ScrollTrigger.create({
    start: 0,
    endTrigger: '#contacto',
    end: 'top 45%',
    onUpdate: (self) => updateHud(self.progress),
    onLeave: () => updateHud(1),
  });
  updateHud(0);

  // velo oscuro según la sección que ocupa el centro de la pantalla
  const veil = $('.veil');
  let currentVeil = -1;
  let veilTriggers = [];
  veilTriggers = $$('[data-veil]').map((sec) =>
    ScrollTrigger.create({ trigger: sec, start: 'top 50%', end: 'bottom 50%', onToggle: () => syncVeil() })
  );
  function syncVeil() {
    const active = veilTriggers.find((t) => t.isActive);
    if (!active) return;
    const v = parseFloat(active.trigger.dataset.veil);
    if (v === currentVeil) return;
    currentVeil = v;
    gsap.to(veil, { opacity: v, duration: 1, ease: 'power2.out', overwrite: true });
  }
  syncVeil();

  // batería + Llamar/WhatsApp: aparecen al salir de la portada
  ScrollTrigger.create({
    start: () => innerHeight * 0.4,
    end: 'max',
    onEnter: () => document.body.classList.add('dock-on'),
    onLeaveBack: () => document.body.classList.remove('dock-on'),
  });
  ScrollTrigger.create({
    trigger: '#contacto',
    start: 'top 60%',
    end: 'max',
    onEnter: () => document.body.classList.add('at-contact'),
    onLeaveBack: () => document.body.classList.remove('at-contact'),
  });

  if (!mobile && !reduced) {
    window.addEventListener(
      'pointermove',
      (e) => scene?.setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1),
      { passive: true }
    );
  }
}

/* =========================================================
   Navegación
   ========================================================= */
const nav = $('.nav');
const burger = $('.nav__burger');
const menu = $('#menu');

function setMenu(open) {
  document.body.classList.toggle('menu-open', open);
  burger.setAttribute('aria-expanded', String(open));
  burger.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  menu.setAttribute('aria-hidden', String(!open));
  if (open) lenis?.stop();
  else lenis?.start();
}
burger.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
document.addEventListener('keydown', (e) => e.key === 'Escape' && setMenu(false));

$$('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    const target = id === '#' ? null : $(id);
    if (!target) return;
    e.preventDefault();
    setMenu(false);
    if (a.dataset.tipo) {
      const radio = $(`input[name="tipo"][value="${a.dataset.tipo}"]`);
      if (radio) radio.checked = true;
    }
    scrollToTarget(id === '#inicio' ? 0 : target);
  });
});

let lastY = 0;
function onScrollNav(y) {
  nav.classList.toggle('is-scrolled', y > 40);
  const goingDown = y > lastY && y > innerHeight * 0.6;
  if (!document.body.classList.contains('menu-open')) nav.classList.toggle('is-hidden', goingDown);
  lastY = y;
}
if (lenis) lenis.on('scroll', ({ scroll }) => onScrollNav(scroll));
else window.addEventListener('scroll', () => onScrollNav(scrollY), { passive: true });

function initNavTriggers() {
  $$('.nav__links a').forEach((link) => {
    const sec = $(link.getAttribute('href'));
    if (!sec) return;
    ScrollTrigger.create({
      trigger: sec,
      start: 'top 50%',
      end: 'bottom 50%',
      onToggle: (self) => link.classList.toggle('is-active', self.isActive),
    });
  });
}

/* =========================================================
   Animaciones (sobrias: entran una vez y se quedan)
   ========================================================= */
function initAnimations() {
  /* marquee de marcas: duplicamos para bucle continuo */
  const track = $('.marquee__track');
  if (track && !reduced) {
    [...track.children].forEach((img) => {
      const c = img.cloneNode(true);
      c.alt = '';
      c.setAttribute('aria-hidden', 'true');
      track.appendChild(c);
    });
  }

  /* contadores */
  $$('[data-count]').forEach((el) => {
    const to = Number(el.dataset.count);
    if (reduced) return void (el.textContent = to);
    const o = { v: 0 };
    el.textContent = '0';
    gsap.to(o, {
      v: to,
      duration: 2,
      ease: 'power3.out',
      onUpdate: () => (el.textContent = Math.round(o.v)),
      scrollTrigger: { trigger: el, start: 'top 90%', once: true },
    });
  });

  if (reduced) return;

  /* títulos línea por línea */
  $$('[data-split]').forEach((el) => {
    const split = SplitText.create(el, { type: 'lines', linesClass: 'split-line-inner', mask: 'lines' });
    gsap.from(split.lines, {
      yPercent: 110,
      filter: 'blur(10px)',
      duration: 1.2,
      ease: 'expo.out',
      stagger: 0.08,
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    });
  });

  /* textos y bloques */
  $$('[data-reveal]').forEach((el) => {
    gsap.from(el, {
      y: 30,
      opacity: 0,
      duration: 1.1,
      ease: 'expo.out',
      scrollTrigger: { trigger: el, start: 'top 92%', once: true },
    });
  });

  /* tarjetas en grupo */
  ScrollTrigger.batch('[data-card], .project, .sun__stat', {
    start: 'top 92%',
    once: true,
    onEnter: (els) =>
      gsap.fromTo(
        els,
        { y: 50, opacity: 0 },
        { y: 0, opacity: 1, stagger: 0.09, duration: 1.1, ease: 'expo.out', overwrite: true, clearProps: 'transform' }
      ),
  });
  gsap.set('[data-card], .project, .sun__stat', { opacity: 0 });

  /* portada: el texto se aleja al bajar */
  gsap.to('.hero__inner', {
    yPercent: -12,
    opacity: 0,
    ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom 25%', scrub: true },
  });
  gsap.to('.scroll-cue', {
    opacity: 0,
    ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: '25% top', scrub: true },
  });

  /* el disco del sol sube mientras pasas */
  gsap.fromTo(
    '.sun__disc',
    { scale: 0.45, yPercent: 40 },
    { scale: 1.1, yPercent: -20, ease: 'none', scrollTrigger: { trigger: '.sun', start: 'top bottom', end: 'bottom top', scrub: 1 } }
  );

  /* video de dron: se carga al acercarse y se pausa fuera de pantalla */
  const video = $('.biz__video');
  if (video && !navigator.connection?.saveData) {
    const load = () => {
      if (video.src) return;
      video.src = mobile ? video.dataset.srcMobile : video.dataset.src;
      video.addEventListener('playing', () => video.classList.add('is-playing'), { once: true });
    };
    ScrollTrigger.create({
      trigger: '.biz',
      start: 'top 160%',
      end: 'bottom top',
      onEnter: load,
      onEnterBack: load,
      onToggle: (self) => {
        if (!video.src) return;
        if (self.isActive) video.play().catch(() => {});
        else video.pause();
      },
    });
  }
}

/* =========================================================
   Proyectos: filtro por tipo y visor de fotos
   ========================================================= */
const projects = $$('.project');
$$('.filters button').forEach((btn) =>
  btn.addEventListener('click', () => {
    const f = btn.dataset.filter;
    $$('.filters button').forEach((b) => {
      b.classList.toggle('is-active', b === btn);
      b.setAttribute('aria-pressed', String(b === btn));
    });
    const shown = [];
    projects.forEach((p) => {
      const on = f === 'todos' || p.dataset.cat.split(' ').includes(f);
      p.hidden = !on;
      if (on) shown.push(p);
    });
    $('.project-grid').scrollLeft = 0;
    if (!reduced) gsap.fromTo(shown, { opacity: 0, y: 20 }, { opacity: 1, y: 0, stagger: 0.06, duration: 0.6, ease: 'power3.out', overwrite: true });
    else gsap.set(shown, { opacity: 1 });
    ScrollTrigger.refresh();
  })
);

const lightbox = $('.lightbox');
const lbImg = $('img', lightbox);
const lbCap = $('.lightbox__cap', lightbox);
$$('[data-zoom]').forEach((btn) =>
  btn.addEventListener('click', () => {
    const img = $('img', btn);
    const card = btn.closest('.project');
    lbImg.src = img.currentSrc || img.src;
    lbImg.alt = img.alt;
    lbCap.textContent = `${$('h3', card).textContent} · ${$('p', card).textContent}`;
    lightbox.showModal();
    lenis?.stop();
  })
);
lightbox.addEventListener('close', () => lenis?.start());
$('.lightbox__close').addEventListener('click', () => lightbox.close());
lightbox.addEventListener('click', (e) => e.target === lightbox && lightbox.close());

/* =========================================================
   Formulario de cotización (WhatsApp o correo)
   ========================================================= */
// FormSubmit responde 200 aunque falle (p. ej. sin activar), así que se revisa "success"
async function sendMail(endpoint, payload) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || String(json.success) !== 'true') throw new Error(json.message || res.status);
  return json;
}

const form = $('.quote');
const note = $('.quote__note');

function readForm() {
  const data = new FormData(form);
  const name = String(data.get('nombre') || '').trim();
  const phone = String(data.get('telefono') || '').trim();
  const nameEl = $('#q-name');
  const phoneEl = $('#q-phone');
  const phoneOk = phone.replace(/\D/g, '').length >= 10;
  nameEl.classList.toggle('is-invalid', !name);
  phoneEl.classList.toggle('is-invalid', !phoneOk);
  if (!name || !phoneOk) {
    note.textContent = 'Escribe tu nombre y un teléfono de 10 dígitos.';
    (!name ? nameEl : phoneEl).focus();
    return null;
  }
  return {
    nombre: name,
    telefono: phone,
    tipo: String(data.get('tipo')),
    servicio: data.getAll('servicio').join(', ') || 'Por definir',
    mensaje: String(data.get('mensaje') || '').trim(),
  };
}

const toText = (d) =>
  [`Nombre: ${d.nombre}`, `Teléfono: ${d.telefono}`, `Tipo de proyecto: ${d.tipo}`, `Servicio: ${d.servicio}`, d.mensaje && `Mensaje: ${d.mensaje}`]
    .filter(Boolean)
    .join('\n');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = readForm();
  if (!d) return;
  const endpoint = form.dataset.endpoint?.trim();
  const btn = $('button[type="submit"]', form);

  if (endpoint) {
    // envío directo al correo (FormSubmit)
    if ($('.hp', form)?.value) return; // bot
    btn.disabled = true;
    note.textContent = 'Enviando…';
    try {
      await sendMail(endpoint, { ...d, _subject: `Cotización · ${d.tipo} · ${d.nombre}`, _template: 'table' });
      form.reset();
      note.textContent = '¡Gracias! Recibimos tu solicitud y te contactaremos pronto.';
    } catch {
      note.textContent = 'No se pudo enviar. Escríbenos por WhatsApp o llama al 656 103 1243.';
    } finally {
      btn.disabled = false;
    }
    return;
  }

  // sin endpoint: abre el correo del visitante con la solicitud lista
  const subject = `Solicitud de cotización · ${d.tipo} · ${d.nombre}`;
  window.location.href = `mailto:aerorenovables@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(toText(d))}`;
  note.textContent = 'Se abrió tu correo con la solicitud. Si no se abrió, llámanos al 656 103 1243.';
});

$('[data-wa-send]').addEventListener('click', () => {
  const d = readForm();
  if (!d) return;
  const msg = `Hola ASR Renovables, vengo desde tu página web, me interesa hacer una cotización.\n${toText(d)}`;
  window.open(`https://wa.me/${form.dataset.wa}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  note.textContent = 'Se abrió WhatsApp con tu solicitud. Solo presiona enviar.';
});

/* =========================================================
   Reseñas: se pintan desde resenas.json y se reciben por correo
   ========================================================= */
const reviewsBox = $('[data-reviews]');
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function reviewCard(r) {
  const n = Math.max(1, Math.min(5, Math.round(Number(r.estrellas) || 5)));
  const stars = '<svg><use href="#i-star" /></svg>'.repeat(n);
  const nombre = esc(r.nombre || 'Cliente de ASR');
  return `<figure class="review">
    <div class="review__stars" aria-label="${n} de 5 estrellas">${stars}</div>
    <blockquote>“${esc(r.texto)}”</blockquote>
    <figcaption><span class="review__avatar" aria-hidden="true">${esc(nombre.charAt(0).toUpperCase())}</span><span><b>${nombre}</b>${esc(r.detalle || '')}</span></figcaption>
  </figure>`;
}

fetch('resenas.json', { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : []))
  .catch(() => [])
  .then((list) => {
    const ok = Array.isArray(list) ? list.filter((r) => r && r.texto) : [];
    if (!ok.length) return; // sin reseñas: queda el mensaje de "primeras reseñas"
    reviewsBox.innerHTML = ok.map(reviewCard).join('');
    reviewsBox.hidden = false;
    $('[data-reviews-empty]')?.remove();
    $('[data-reviews-title]')?.removeAttribute('hidden');
    ScrollTrigger.refresh();
  });

const google = $('[data-google]');
if (google?.dataset.google) {
  google.href = google.dataset.google;
  google.hidden = false;
}

const rateDialog = $('.rate-dialog');
const rateForm = $('.rate-form');
const rateNote = $('.rate-form__note');
$('[data-rate-open]')?.addEventListener('click', () => {
  rateNote.textContent = '';
  rateDialog.showModal();
  lenis?.stop();
});
rateDialog.addEventListener('close', () => lenis?.start());
$('.rate-dialog__close').addEventListener('click', () => rateDialog.close());
rateDialog.addEventListener('click', (e) => e.target === rateDialog && rateDialog.close());
rateForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('.hp', rateForm).value) return; // bot
  const data = new FormData(rateForm);
  const nombre = String(data.get('nombre') || '').trim();
  const resena = String(data.get('resena') || '').trim();
  const autorizo = data.get('autorizo');
  $('#r-name').classList.toggle('is-invalid', !nombre);
  $('#r-msg').classList.toggle('is-invalid', resena.length < 10);
  if (!nombre || resena.length < 10) {
    rateNote.textContent = 'Escribe tu nombre y tu reseña (mínimo 10 letras).';
    return;
  }
  if (!autorizo) {
    rateNote.textContent = 'Marca la casilla para autorizar que publiquemos tu reseña.';
    return;
  }
  const estrellas = Number(data.get('estrellas') || 5);
  const btn = $('button[type="submit"]', rateForm);
  btn.disabled = true;
  rateNote.textContent = 'Enviando…';
  try {
    await sendMail(rateForm.dataset.endpoint, {
      _subject: `Nueva reseña ${'★'.repeat(estrellas)} · ${nombre}`,
      _template: 'table',
      nombre,
      estrellas,
      sistema: String(data.get('sistema') || ''),
      resena,
      autoriza_publicar: 'Sí',
    });
    rateForm.reset();
    rateNote.textContent = '¡Gracias! Recibimos tu reseña y la publicaremos después de revisarla.';
    setTimeout(() => rateDialog.open && rateDialog.close(), 2600);
  } catch {
    rateNote.textContent = 'No se pudo enviar. Mándanos tu reseña por WhatsApp, por favor.';
  } finally {
    btn.disabled = false;
  }
});

/* =========================================================
   Calculadora de ahorro (estimación orientativa)
   ========================================================= */
const calc = $('.calc');
let calcApi = null;
if (calc) {
  const HSP = 5.8; // horas solares pico promedio en Ciudad Juárez
  const PR = 0.78; // rendimiento real del sistema (calor, cableado, inversor)
  const PANEL_KW = 0.55; // panel de 550 W
  const PANEL_M2 = 2.6; // área por panel incluyendo separaciones
  const CO2 = 0.438; // t CO2 por MWh (factor de emisión del sistema eléctrico nacional)
  const PESOS_KWH = 3.3; // pago promedio por kWh para estimar el consumo cuando solo dan el pago
  const fmt = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
  const fmt1 = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });

  const inBill = $('#c-bill', calc);
  const inKwh = $('#c-kwh', calc);
  const out = (k) => $(`[data-out="${k}"]`, calc);
  const shown = {};

  function animateTo(key, value, format) {
    const el = out(key);
    const o = { v: shown[key] ?? 0 };
    shown[key] = value;
    gsap.to(o, { v: value, duration: reduced ? 0 : 0.5, ease: 'power2.out', overwrite: true, onUpdate: () => (el.textContent = format(o.v)) });
  }

  function update() {
    const bill = Number(inBill.value);
    const kwh = Number(inKwh.value);
    $('[data-val="bill"]', calc).textContent = money.format(bill);
    $('[data-val="kwh"]', calc).textContent = `${fmt.format(kwh)} kWh`;
    [inBill, inKwh].forEach((r) => r.style.setProperty('--p', `${((r.value - r.min) / (r.max - r.min)) * 100}%`));

    const kwDay = kwh / 60;
    const panels = Math.max(2, Math.ceil(kwDay / (HSP * PR) / PANEL_KW));
    animateTo('panels', panels, (v) => fmt.format(v));
    animateTo('kwp', panels * PANEL_KW, (v) => fmt1.format(v));
    animateTo('area', panels * PANEL_M2, (v) => fmt.format(v));
    animateTo('save', bill * 6 * 0.95, (v) => money.format(v));
    animateTo('co2', ((kwh * 6) / 1000) * CO2, (v) => fmt1.format(v));

    // recibo: hoy vs. con solar (el sistema cubre ~95 %)
    const after = bill * 0.05;
    animateTo('now', bill, (v) => money.format(v));
    animateTo('after', after, (v) => money.format(v));
    animateTo('save25', bill * 6 * 0.95 * 25, (v) => money.format(v));
    if (billShown) {
      gsap.to(barNow, { scaleX: 1, duration: 0.5, ease: 'power2.out', overwrite: true });
      gsap.to(barSun, { scaleX: Math.max(0.02, after / bill), duration: 0.5, ease: 'power2.out', overwrite: true });
    }
  }

  // la barra "con solar" se desploma la primera vez que ves la calculadora
  const barNow = $('.bill__bar--now b', calc);
  const barSun = $('.bill__bar--sun b', calc);
  let billShown = reduced;
  gsap.set([barNow, barSun], { scaleX: reduced ? 1 : 0 });
  if (reduced) gsap.set(barSun, { scaleX: 0.05 });
  else
    ScrollTrigger.create({
      trigger: '.bill',
      start: 'top 85%',
      once: true,
      onEnter: () => {
        gsap
          .timeline({ onComplete: () => (billShown = true) })
          .to([barNow, barSun], { scaleX: 1, duration: 0.9, ease: 'power3.out' })
          .to(barSun, { scaleX: 0.05, duration: 1.3, ease: 'expo.inOut' }, '+=0.35');
      },
    });

  function kwhFromBill(bill) {
    return Math.min(8000, Math.max(200, Math.round(bill / PESOS_KWH / 50) * 50));
  }

  calcApi = {
    // desde la portada: con el pago estimamos el consumo (≈ $3.30 por kWh promedio) y llenamos la calculadora
    fromBill(bill) {
      const b = Math.min(30000, Math.max(500, Math.round(bill / 100) * 100));
      const k = kwhFromBill(b);
      inBill.value = b;
      inKwh.value = k;
      update();
    },
  };
  // mientras no toquen el consumo, el pago lo arrastra (si no, los paneles no cambian al mover el pago)
  let kwhTouched = false;
  inKwh.addEventListener('input', () => {
    kwhTouched = true;
    update();
  });
  inBill.addEventListener('input', () => {
    if (!kwhTouched) inKwh.value = kwhFromBill(Number(inBill.value));
    update();
  });
  update();

  $('[data-calc-quote]', calc).addEventListener('click', () => {
    const msg = $('#q-msg');
    if (msg && !msg.value.trim()) {
      msg.value = `Pago bimestral aprox. ${money.format(Number(inBill.value))}, consumo ${fmt.format(Number(inKwh.value))} kWh por bimestre. La calculadora me sugiere ${out('panels').textContent} paneles (${out('kwp').textContent} kWp).`;
    }
  });
}

/* =========================================================
   Preguntas frecuentes: solo una abierta a la vez
   ========================================================= */
$$('.faq details').forEach((d) =>
  d.addEventListener('toggle', () => {
    if (d.open) $$('.faq details').forEach((o) => o !== d && (o.open = false));
  })
);

// abrir un "Ver más" cambia la altura: recalcular posiciones
let refreshTimer;
$$('details').forEach((d) =>
  d.addEventListener('toggle', () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => ScrollTrigger.refresh(), 80);
  })
);

boot();

/* =========================================================
   Cotizador rápido de la portada → calculadora
   ========================================================= */
const quick = $('[data-quick]');
if (quick) {
  const qIn = $('input', quick);
  const money0 = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
  qIn.addEventListener('input', () => {
    const digits = qIn.value.replace(/\D/g, '').slice(0, 6);
    qIn.value = digits ? money0.format(Number(digits)) : '';
  });
  quick.addEventListener('submit', (e) => {
    e.preventDefault();
    const bill = Number(qIn.value.replace(/\D/g, '')) || 3000;
    calcApi?.fromBill(bill);
    scrollToTarget($('#ahorro'));
    const res = $('.calc__results');
    res?.classList.remove('is-flash');
    setTimeout(() => res?.classList.add('is-flash'), reduced ? 0 : 1200);
    $('.calc__field:nth-child(2)')?.classList.add('is-hint');
  });
}

/* =========================================================
   Detalles modernos: progreso del día, luz que sigue al puntero,
   tarjetas con brillo, palabras clave y línea del proceso
   ========================================================= */
// barra de progreso del "día" bajo el menú
const progress = document.createElement('div');
progress.className = 'progress';
progress.setAttribute('aria-hidden', 'true');
document.body.appendChild(progress);
ScrollTrigger.create({
  start: 0,
  end: 'max',
  onUpdate: (self) => progress.style.setProperty('--p', self.progress.toFixed(4)),
});

// palabras clave: brillo dorado al aparecer
$$('.hl').forEach((el) => {
  if (reduced) return el.classList.add('is-lit');
  ScrollTrigger.create({ trigger: el, start: 'top 85%', once: true, onEnter: () => setTimeout(() => el.classList.add('is-lit'), 450) });
});

// proceso: la línea se llena con el scroll y cada paso se enciende
const stepsWrap = $('.steps-wrap');
if (stepsWrap) {
  const steps = $$('.step', stepsWrap);
  const paint = (p) => {
    stepsWrap.style.setProperty('--p', p.toFixed(3));
    steps.forEach((st, i) => st.classList.toggle('is-on', p >= i / (steps.length - 1) - 0.02));
  };
  if (reduced) paint(1);
  else
    ScrollTrigger.create({
      trigger: stepsWrap,
      start: 'top 75%',
      end: 'bottom 55%',
      scrub: 0.6,
      onUpdate: (self) => paint(self.progress),
    });
}

if (finePointer && !reduced) {
  // un sol suave sigue al puntero sobre el fondo
  const sunCursor = document.createElement('div');
  sunCursor.className = 'cursor-sun';
  sunCursor.setAttribute('aria-hidden', 'true');
  $('.veil').after(sunCursor);
  const sx = gsap.quickTo(sunCursor, 'x', { duration: 0.9, ease: 'power3.out' });
  const sy = gsap.quickTo(sunCursor, 'y', { duration: 0.9, ease: 'power3.out' });

  // tarjetas: brillo y borde dorado que siguen al puntero
  const glowCards = $$('.sol, .project, .card, .step, .review, .sun__stat, .calc');
  glowCards.forEach((c) => {
    c.classList.add('has-glow');
    const g = document.createElement('span');
    g.className = 'glow';
    g.setAttribute('aria-hidden', 'true');
    c.appendChild(g);
  });
  window.addEventListener(
    'pointermove',
    (e) => {
      sx(e.clientX);
      sy(e.clientY);
      const card = e.target.closest?.('.has-glow');
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    },
    { passive: true }
  );

  // botones dorados magnéticos
  $$('.btn--gold').forEach((btn) => {
    const mx = gsap.quickTo(btn, 'x', { duration: 0.5, ease: 'power3.out' });
    const my = gsap.quickTo(btn, 'y', { duration: 0.5, ease: 'power3.out' });
    btn.addEventListener('pointermove', (e) => {
      const r = btn.getBoundingClientRect();
      mx((e.clientX - r.left - r.width / 2) * 0.18);
      my((e.clientY - r.top - r.height / 2) * 0.3);
    });
    btn.addEventListener('pointerleave', () => {
      mx(0);
      my(0);
    });
  });
}
