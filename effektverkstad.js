import { effects, art } from './bildeffekter.js';

(() => {
  const $ = id => document.getElementById(id);
  let objectURL = null;
  let uploadRevision = 0;
  $('effect-options').innerHTML = effects.map(effect => `<button class="effect-option" type="button" data-effect="${effect.id}" aria-pressed="${effect.id === 'eld'}" aria-label="${effect.name}">${art(effect.id)}<span>${effect.name}</span></button>`).join('');
  function choose(id) {
    const effect = effects.find(item => item.id === id);
    if (!effect) return;
    $('art-preview').dataset.fx = id;
    $('overlay-image').src = `assets/effekter/${id}.svg`;
    $('preview-title').textContent = effect.name;
    $('effect-name').textContent = effect.name;
    $('effect-description').textContent = effect.description;
    $('download-layer').href = `assets/effekter/${id}.svg`;
    $('download-layer').download = `tornstriden-${id}.svg`;
    document.querySelectorAll('[data-effect]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.effect === id)));
  }
  $('effect-options').addEventListener('click', event => { const button = event.target.closest('[data-effect]'); if (button) choose(button.dataset.effect); });
  $('strength').addEventListener('input', () => {
    $('art-preview').style.setProperty('--fx-opacity', Number($('strength').value) / 100);
    $('strength-label').textContent = `${$('strength').value} %`;
  });
  $('show-layer').addEventListener('change', () => { $('overlay-image').hidden = !$('show-layer').checked; });
  $('animate-layer').addEventListener('change', () => { $('art-preview').classList.toggle('moving', $('animate-layer').checked); });
  $('base-upload').addEventListener('change', async () => {
    const revision = ++uploadRevision;
    const file = $('base-upload').files[0];
    if (!file) return;
    $('upload-error').textContent = '';
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) {
      $('upload-error').textContent = 'Välj PNG, JPG eller WebP, högst 20 MB.';
      return;
    }
    const url = URL.createObjectURL(file);
    const probe = new Image();
    probe.src = url;
    try { await probe.decode(); }
    catch { URL.revokeObjectURL(url); if (revision === uploadRevision) $('upload-error').textContent = 'Bilden kunde inte läsas. Prova en annan fil.'; return; }
    if (revision !== uploadRevision) { URL.revokeObjectURL(url); return; }
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = url;
    $('base-image').src = url;
    $('base-image').alt = 'Din valda bild';
    $('base-image').classList.add('custom-image');
  });
  $('reset-image').addEventListener('click', () => {
    uploadRevision++;
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = null;
    $('base-image').src = 'assets/torn.svg';
    $('base-image').alt = 'Exempelbild av tornet';
    $('base-image').classList.remove('custom-image');
    $('base-upload').value = '';
    $('upload-error').textContent = '';
  });
  window.addEventListener('pagehide', () => { if (objectURL) URL.revokeObjectURL(objectURL); });
})();
