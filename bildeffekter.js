/* Återanvändbara bildlager: motiv och genomskinligt SVG-lager hålls separata. */
export const effects = Object.freeze([
  { id: 'eld', name: 'Eldglöd', description: 'Varma lågor och gnistor längs kanterna.' },
  { id: 'frost', name: 'Frost', description: 'Iskristaller, sprickor och kallt sken.' },
  { id: 'runor', name: 'Runmagi', description: 'En lysande cirkel av magiska tecken.' },
  { id: 'blixt', name: 'Blixtar', description: 'Elektriska bågar runt bildens kanter.' },
  { id: 'ljus', name: 'Heligt ljus', description: 'Gyllene strålar och en mjuk ljusring.' },
  { id: 'skugga', name: 'Skugga', description: 'Violett dimma och mörka slöjor.' }
].map(Object.freeze));

export function art(id, moving = false) {
  if (!effects.some(effect => effect.id === id)) return '';
  return `<span class="fx-art${moving ? ' moving' : ''}" data-fx="${id}" aria-hidden="true"><img class="fx-subject" src="assets/torn/torn-bla.png" alt=""><img class="fx-layer" src="assets/effekter/${id}.svg" alt=""></span>`;
}
