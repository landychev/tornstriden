/* Kortet förstorat och kortflygningar – gemensamt för duellvyn (matchvy.js) och lagvyn (lagmatchvy.js).
   Ett långt tryck (finger, mus, penna eller mellanslag som hålls in) på ett kort med `data-card` öppnar
   kortrutan; kortet flyger från sin plats in i rutan. Ett kort tryck markerar kortet som förut, och klicket
   som följer på ett långtryck sväljs (`swallowed()`). Ingen matchdata rörs. Flyttad ur matchvy.js i L15. */
import { cards } from './kort.js';
import { cardFace } from './grafik.js';
import { canAttack, canDefend } from './matchregler.js';

export const FLY_MS = 850;              // ett kort flyger mellan hand, stridsplats och högar
export const HOLD_MS = 450;             // så länge ett kort hålls in innan det öppnas förstorat
export const HOLD_SLACK = 10;           // px som fingret får glida under ett långtryck
export const ZOOM_MS = 360;             // kortet flyger från sin plats in i kortrutan
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const html = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const cardType = id => cards.find(card => card.id === id);

/* ---- Kortflygningar: en kopia animeras i dokumentets koordinater, matchdata rörs inte ---- */
export const docRect = el => { const r = el.getBoundingClientRect(); return { left: r.left + scrollX, top: r.top + scrollY, width: r.width, height: r.height }; };

/* Bevara utseendet även när källkortet tas bort från handen vid ett byte. */
export function styledCardCopy(template) {
  const ghost = template.cloneNode(true);
  if (!template.isConnected) return ghost;
  const sourceParts = [template, ...template.querySelectorAll('*')];
  const ghostParts = [ghost, ...ghost.querySelectorAll('*')];
  const cardStyle = ['padding', 'margin', 'border', 'border-radius', 'background', 'color', 'font', 'text-align', 'min-height', 'min-width', 'max-width', 'display', 'flex', 'height', 'width', 'aspect-ratio', 'position', 'top', 'left', 'right', 'bottom', 'overflow'];
  sourceParts.forEach((source, index) => {
    const style = getComputedStyle(source);
    cardStyle.forEach(property => ghostParts[index].style.setProperty(property, style.getPropertyValue(property)));
  });
  return ghost;
}

/* Lägger en kopia av `template` i dokumentet och låter den glida från `from` till `to`.
   Kopian sätts i sin naturliga storlek (`layout`: 'to' för kort som landar i en ruta,
   'from' för kort som lämnar handen) och skalas till den andra änden.
   Med `inside` läggs kopian fast positionerad i det elementet (en öppen dialogruta ligger
   i det översta lagret, ovanför allt i body); `from` och `to` ges då i fönsterkoordinater. */
export function flyGhost(template, from, to, { delay = 0, fade = false, layout = 'to', duration = FLY_MS, inside = null } = {}) {
  if (reduceMotion.matches || !from?.width || !to?.width) return Promise.resolve();
  const base = layout === 'from' ? from : to;
  const at = r => `translate(${r.left - base.left}px, ${r.top - base.top}px) scale(${r.width / base.width}, ${r.height / base.height})`;
  const ghost = styledCardCopy(template);
  ghost.classList.add('fly-card');
  ghost.classList.remove('dealt', 'holding');
  ghost.removeAttribute('id');
  ghost.removeAttribute('aria-pressed');
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, { position: inside ? 'fixed' : 'absolute', margin: '0', left: `${base.left}px`, top: `${base.top}px`, width: `${base.width}px`, height: `${base.height}px`, visibility: 'visible' });
  (inside ?? document.body).append(ghost);
  const frames = [{ transform: at(from), opacity: 1 }, { transform: at(to), opacity: fade ? 0 : 1 }];
  // Kort som landar bromsar in; kort som lämnar handen lyfter mjukt och drar sedan iväg.
  const leaving = layout === 'from';
  const animation = ghost.animate(frames, { duration: leaving ? duration + 220 : duration, delay, easing: leaving ? 'cubic-bezier(.45, 0, .85, .45)' : 'cubic-bezier(.2, .7, .2, 1)', fill: 'forwards' });
  return animation.finished.catch(() => {}).then(() => ghost.remove());
}

const standardAnvandning = type => {
  const uses = [canAttack(type) && 'anfaller', canDefend(type) && 'försvarar'].filter(Boolean);
  return `Spelas när du ${uses.join(' eller ')}.`;
};

/* Kopplar långtryck på kort i `behallare` (element) till kortrutan `dialog` med innehållet i `detalj`.
   `anvandning(type)` ger raden om när kortet spelas; `tillagg(type)` kan lägga till HTML (t.ex. lagregler).
   Returnerar `swallowed()` som klickhanterare använder för att ignorera klicket efter ett långtryck. */
export function kopplaKortlupp({ behallare, dialog, detalj, anvandning = standardAnvandning, tillagg = () => '' }) {
  let hold = null;              // pågående tryck: { el, x, y, pointer, fired, timer }
  let swallowClicksUntil = 0;   // tidpunkt (performance.now) före vilken klick ignoreras
  const swallowed = () => performance.now() < swallowClicksUntil;
  const cardAt = target => target instanceof Element ? target.closest('[data-card]') : null;

  function openCardDetail(source) {
    const type = cardType(source.dataset.card);
    if (!type) return;
    const simple = source.dataset.simple === 'true';
    detalj.className = `card-detail ${type.type}`;
    detalj.innerHTML = `<div class="card-detail-art"><div class="mini-card ${type.type}">${cardFace(type, { simple })}</div></div>
    <div class="card-detail-text">
      <span class="eyebrow">${simple ? 'ENKEL ATTACK' : html(type.label).toUpperCase()}</span>
      <h3 id="card-title">${html(type.name)}</h3>
      <p class="card-detail-power"><strong>${simple ? '1' : html(type.value)}</strong><span>${simple ? 'Attackstyrka' : html(type.valueLabel)}</span></p>
      <p class="card-detail-use">${simple ? 'Spelas den här striden som enkel attack 1, utan specialeffekt.' : anvandning(type)}</p>
      <h4>${simple ? 'Kortets vanliga effekt' : 'Så fungerar kortet'}</h4>
      <p>${html(type.effect)}</p>${simple ? '' : tillagg(type)}
      <p class="help-note">Kortet slängs efter striden. Vilket kort som helst kan spelas som enkel attack 1, utan specialeffekt.</p>
    </div>`;
    const target = detalj.querySelector('.mini-card');
    target.style.visibility = 'hidden';
    const from = source.getBoundingClientRect();
    dialog.showModal();
    flyGhost(target, from, target.getBoundingClientRect(), { duration: ZOOM_MS, inside: dialog }).then(() => { target.style.visibility = ''; });
  }

  function startHold(el, { x = 0, y = 0, pointer = false } = {}) {
    if (hold) { clearTimeout(hold.timer); hold.el.classList.remove('holding'); }
    hold = { el, x, y, pointer, fired: false, timer: setTimeout(() => { hold.fired = true; openCardDetail(el); el.classList.remove('holding'); }, HOLD_MS) };
    el.classList.add('holding');
  }

  /* Kortet släpps: ett tryck som hann öppna rutan får inte också räknas som ett klick. */
  function cancelHold() {
    if (!hold) return;
    clearTimeout(hold.timer);
    hold.el.classList.remove('holding');
    if (hold.fired) swallowClicksUntil = performance.now() + 400;
    hold = null;
  }

  /* Långtryck med finger, mus eller penna, samt mellanslag som hålls in på ett fokuserat kort.
     Glider fingret (bläddring i handen) eller släpps kortet i tid avbryts trycket. */
  for (const el of behallare) {
    el.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const card = cardAt(event.target);
      if (card) startHold(card, { x: event.clientX, y: event.clientY, pointer: true });
    });
    el.addEventListener('keydown', event => { const card = cardAt(event.target); if (card && event.key === ' ' && !event.repeat) startHold(card); });
    el.addEventListener('focusout', () => { if (hold && !hold.pointer) cancelHold(); });
    el.addEventListener('dragstart', event => event.preventDefault());
  }
  document.addEventListener('pointermove', event => { if (hold?.pointer && !hold.fired && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > HOLD_SLACK) cancelHold(); });
  document.addEventListener('pointerup', () => { if (hold?.pointer) cancelHold(); });
  document.addEventListener('pointercancel', () => { if (hold?.pointer) cancelHold(); });
  document.addEventListener('keyup', event => { if (hold && !hold.pointer && event.key === ' ') cancelHold(); });
  document.addEventListener('contextmenu', event => { if (hold) event.preventDefault(); });   // pekskärmens egen meny under ett långtryck
  window.addEventListener('blur', cancelHold);
  /* Kortrutan stängs med knappen, Escape eller ett tryck utanför rutan. */
  dialog.addEventListener('click', event => { if (swallowed()) { event.stopPropagation(); event.preventDefault(); } else if (event.target === event.currentTarget) event.currentTarget.close(); }, true);

  return { swallowed, oppna: openCardDetail };
}
