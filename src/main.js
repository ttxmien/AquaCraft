import { AquariumStore } from './state/store.js';
import { AquariumWorld } from './world/AquariumWorld.js';

const $ = (selector) => document.querySelector(selector);
const store = new AquariumStore();
const shell = $('#appShell');
const sceneHost = $('#sceneHost');
let world;
let toastTimer;
let hudTimer;
let lastToast;
let scaleHistorySnapshot = null;

try {
  world = new AquariumWorld(sceneHost, store);
} catch (error) {
  console.error('Unable to initialize the aquarium renderer:', error);
  sceneHost.innerHTML = `
    <div class="webgl-error">
      <div class="webgl-error-card">
        <div class="webgl-error-icon">✦</div>
        <h2>We couldn't open the aquarium</h2>
        <p>This experience needs a browser with WebGL enabled. Try a recent version of Chrome, Edge, Firefox or Safari, and make sure hardware acceleration is turned on.</p>
        <small>${escapeHTML(error?.message || 'WebGL initialization failed')}</small>
      </div>
    </div>`;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function titleFor(type) {
  return store.labelFor(type);
}

function showToast(message) {
  if (!message) return;
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2300);
}

function updateUI(state) {
  const fishCount = String(state.fish.length).padStart(2, '0');
  $('#fishCount').textContent = fishCount;
  $('#foodCount').textContent = String(state.foodCount).padStart(2, '0');
  $('#fishLimit').textContent = `${fishCount} / 18`;
  $('#waterValue').textContent = `${Math.round(((state.waterLevel - 3.4) / (6.05 - 3.4)) * 100)}%`;
  if (document.activeElement !== $('#waterSlider')) $('#waterSlider').value = state.waterLevel;

  shell.dataset.theme = state.theme;
  $('#themeGlyph').textContent = state.theme === 'dark' ? '☼' : '☾';
  $('#editorPanel').classList.toggle('is-hidden', !state.editorOpen);
  $('#editorToggleLabel').textContent = state.editorOpen ? 'Hide studio' : 'Edit aquarium';
  $('#editorToggle').querySelector('.button-icon').textContent = state.editorOpen ? '−' : '＋';
  $('#feedButton').classList.toggle('active', state.feedingMode);
  $('#feedHint').textContent = state.feedingMode ? 'Click in the water to drop' : 'Drop a little snack';
  $('#feedInstruction').classList.toggle('hidden', !state.feedingMode);
  $('#undoButton').disabled = store.history.length === 0;
  $('#undoButton').style.opacity = store.history.length === 0 ? '.45' : '1';

  const selected = state.decorations.find(item => item.id === state.selectedDecoration);
  $('#selectedCard').classList.toggle('hidden', !selected);
  if (selected) {
    $('#selectedName').textContent = titleFor(selected.type);
    $('#scaleSlider').value = selected.scale || 1;
    $('#scaleValue').textContent = `${Math.round((selected.scale || 1) * 100)}%`;
  }

  const selectedFish = state.fish.find(item => item.id === state.selectedFish);
  $('#fishCard').classList.toggle('hidden', !selectedFish);
  if (selectedFish) {
    $('#fishName').textContent = titleFor(selectedFish.species);
    updateFishCard(selectedFish.id);
  }
  if (state.toast && state.toast !== lastToast) {
    lastToast = state.toast;
    showToast(state.toast);
  }
}

function updateFishCard(id) {
  const agent = world?.fishAgents.get(id);
  if (!agent) return;
  const stateName = agent.state === 'seeking food' ? 'Finding food' : agent.state === 'resting' ? 'Resting' : 'Exploring';
  const satiety = Math.round(agent.satiety);
  $('#fishState').textContent = stateName;
  $('#fishSatiety').textContent = `${satiety}% full`;
  $('#satietyFill').style.width = `${satiety}%`;
  const breedingSelection = store.getState().breedingSelection;
  const isParentSelected = breedingSelection?.fishId === id;
  $('#breedingHint').classList.toggle('hidden', !isParentSelected);
  if (isParentSelected) {
    const remaining = Math.max(0, 30 - (world.time - breedingSelection.selectedAt));
    $('#breedingHint').textContent = `First parent selected · choose a matching fish within ${Math.ceil(remaining)}s`;
  }
}

store.subscribe(updateUI);
updateUI(store.getState());

$('#editorToggle').addEventListener('click', () => {
  const state = store.getState();
  store.set({ editorOpen: !state.editorOpen, feedingMode: false });
});
$('#closeEditor').addEventListener('click', () => store.set({ editorOpen: false, feedingMode: false }));
$('#undoButton').addEventListener('click', () => store.undo());
$('#themeButton').addEventListener('click', () => store.set({ theme: store.getState().theme === 'dark' ? 'light' : 'dark' }));

for (const button of document.querySelectorAll('[data-tab]')) {
  button.addEventListener('click', () => {
    const target = button.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach(tab => {
      const active = tab.dataset.tab === target;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.panel !== target));
  });
}

for (const button of document.querySelectorAll('[data-decor]')) {
  button.addEventListener('click', () => store.addDecoration(button.dataset.decor));
}
for (const button of document.querySelectorAll('[data-fish]')) {
  button.addEventListener('click', () => store.addFish(button.dataset.fish));
}

$('#waterSlider').addEventListener('input', event => {
  store.set({ waterLevel: Number(event.currentTarget.value) });
});

$('#feedButton').addEventListener('click', () => {
  const active = store.getState().feedingMode;
  store.set({ feedingMode: !active, selectedDecoration: null, selectedFish: null });
});
$('#cancelFeed').addEventListener('click', () => store.set({ feedingMode: false }));

$('#scaleSlider').addEventListener('pointerdown', () => {
  scaleHistorySnapshot = JSON.parse(JSON.stringify(store.getState().decorations));
});
$('#scaleSlider').addEventListener('input', event => {
  if (!scaleHistorySnapshot) scaleHistorySnapshot = JSON.parse(JSON.stringify(store.getState().decorations));
  store.scaleSelected(Number(event.currentTarget.value));
  $('#scaleValue').textContent = `${Math.round(Number(event.currentTarget.value) * 100)}%`;
});
$('#scaleSlider').addEventListener('change', () => {
  if (scaleHistorySnapshot) {
    store.pushHistorySnapshot(scaleHistorySnapshot);
    scaleHistorySnapshot = null;
    store.set({ toast: 'Decoration scaled' });
  }
});
$('#rotateSelected').addEventListener('click', () => store.rotateSelected());
$('#removeSelected').addEventListener('click', () => store.removeSelected());
$('#clearSelection').addEventListener('click', () => store.set({ selectedDecoration: null }));
$('#closeFishCard').addEventListener('click', () => store.set({ selectedFish: null }));
$('#releaseFish').addEventListener('click', () => {
  const id = store.getState().selectedFish;
  if (id) store.removeFish(id);
});

window.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    store.undo();
  }
  if (event.key === 'Escape') {
    if (store.getState().feedingMode) store.set({ feedingMode: false });
    if (world?.drag) {
      world.drag.root.position.x = world.drag.startX;
      world.drag.root.position.z = world.drag.startZ;
      world.drag = null;
      world.pointerGesture = null;
      world.controls.enabled = true;
    }
  }
});

hudTimer = setInterval(() => {
  if (world) store.expireBreedingSelection(world.time);
  const id = store.getState().selectedFish;
  if (id) updateFishCard(id);
}, 260);

window.addEventListener('beforeunload', () => {
  clearTimeout(toastTimer);
  clearInterval(hudTimer);
  world?.dispose();
});
