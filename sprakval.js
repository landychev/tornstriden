import { t, language, setLanguage, hasLanguageChoice, onLanguageChange } from './sprak.js';

let ready;
const switches = [];
const staticNodes = [];

function makeSwitch() {
  const group = document.createElement('div');
  group.className = 'language-switch';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', t('Välj språk'));
  for (const [code, name, flag] of [['sv', 'Svenska', 'assets/flaggor/sv.svg'], ['en', 'English', 'assets/flaggor/en.svg']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.language = code;
    button.setAttribute('aria-label', name);
    button.title = name;
    button.lang = code;
    const image = document.createElement('img');
    image.src = flag; image.alt = ''; image.width = 22; image.height = 15;
    const label = document.createElement('span'); label.textContent = name;
    button.append(image, label);
    button.addEventListener('click', () => setLanguage(code));
    group.append(button);
  }
  switches.push(group);
  return group;
}
function update() {
  document.documentElement.lang = language();
  for (const { node, attribute, key } of staticNodes) {
    if (attribute === 'text') node.textContent = t(key);
    else node.setAttribute(attribute, t(key));
  }
  for (const group of switches) {
    group.setAttribute('aria-label', t('Välj språk'));
    for (const button of group.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.language === language()));
  }
}

/* Anropas före session/matchstart. Första besöket väntar på ett uttryckligt val;
   senare besök fortsätter direkt med det sparade språket. */
export function initLanguage() {
  if (ready) return ready;
  for (const node of document.querySelectorAll('*')) {
    for (const { name, value } of node.attributes) {
      if (name === 'data-i18n') staticNodes.push({ node, attribute: 'text', key: value });
      else if (name.startsWith('data-i18n-')) staticNodes.push({ node, attribute: name.slice('data-i18n-'.length), key: value });
    }
  }
  document.querySelector('.masthead nav')?.append(makeSwitch());
  /* En modal dialog gör sidhuvudet inaktivt. Därför finns samma knappar i varje dialog. */
  for (const dialog of document.querySelectorAll('dialog')) dialog.prepend(makeSwitch());
  onLanguageChange(update);
  update();
  if (hasLanguageChoice()) { ready = Promise.resolve(); return ready; }
  ready = new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.id = 'language-dialog';
    dialog.className = 'language-dialog game-popup';
    dialog.setAttribute('aria-labelledby', 'language-title');
    const title = document.createElement('h1');
    title.id = 'language-title'; title.textContent = 'Välj språk / Choose language';
    const intro = document.createElement('p');
    intro.textContent = 'Svenska eller engelska? / Swedish or English?';
    const group = makeSwitch();
    // Inget språk är valt ännu, även om sidans grundspråk är svenska.
    for (const button of group.querySelectorAll('button')) button.setAttribute('aria-pressed', 'false');
    dialog.append(title, intro, group);
    dialog.addEventListener('cancel', event => event.preventDefault());
    const stop = onLanguageChange(() => { stop(); dialog.close(); dialog.remove(); switches.splice(switches.indexOf(group), 1); resolve(); });
    document.body.append(dialog);
    dialog.showModal();
  });
  return ready;
}
