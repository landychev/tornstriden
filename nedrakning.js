/* Nedräkning för serverns spelarklockor (arbetsordning L16) – delas av duellvyn (matchvy.js) och lagvyn
   (lagmatchvy.js). Servern äger tiden: vyn har `clocks` { [spelare]: deadline } i serverns tid och klienten
   räknar bara ned. Ingen klocka ändras här, och ingen tidsgräns avgörs i webbläsaren – vid 0:00 väntar sidan
   på serverns besked.

   Element med `data-klocka="<spelare>"` visar den spelarens återstående tid; utan klocka döljs elementet.
   `data-etikett` står efter tiden och `data-varning` ersätter den när mindre än VARNING_MS återstår (klassen
   `warn`). `varna(text)` anropas en gång per deadline när den egna tiden passerar varningsgränsen, för
   skärmläsare. Element med `data-avbrott="<spelare>"` visar på samma sätt den spelarens återstående
   återanslutningsfrist (L17) ur `avbrott()`. */
export const VARNING_MS = 20_000;   // samma gräns som servern (online/klockor.js)

export const mmss = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const attr = text => String(text).replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
/* En nedräkningsrad för en spelare; fylls och visas av tick(). */
export const klockrad = (playerId, { etikett = 'kvar att välja', varning = null } = {}) =>
  `<p class="turn-clock" data-klocka="${attr(playerId)}" data-etikett="${attr(etikett)}"${varning ? ` data-varning="${attr(varning)}"` : ''} hidden></p>`;

export function kopplaNedrakning({ klockor, avbrott = () => null, nu, egen, varna = () => {}, rot = document, intervall = 250 }) {
  const varnade = new Set();
  const fyll = (selector, attribut, tider, now) => {
    for (const el of rot.querySelectorAll(selector)) {
      const at = tider[el.dataset[attribut]];
      if (!Number.isFinite(at)) { el.hidden = true; el.textContent = ''; el.classList.remove('warn'); continue; }
      const kvar = at - now;
      const varning = kvar < VARNING_MS;
      el.hidden = false;
      el.classList.toggle('warn', varning);
      el.textContent = `${mmss(kvar)} ${(varning ? el.dataset.varning : null) ?? el.dataset.etikett ?? ''}`.trim();
    }
  };
  function tick() {
    const clocks = klockor() ?? {};
    const now = nu();
    fyll('[data-klocka]', 'klocka', clocks, now);
    fyll('[data-avbrott]', 'avbrott', avbrott() ?? {}, now);
    const mig = egen();
    const minAt = clocks[mig];
    if (Number.isFinite(minAt) && minAt - now < VARNING_MS && minAt - now > 0 && !varnade.has(`${mig}|${minAt}`)) {
      varnade.add(`${mig}|${minAt}`);
      varna(`Mindre än ${VARNING_MS / 1000} sekunder kvar att välja.`);
    }
  }
  setInterval(tick, intervall);
  return tick;
}
