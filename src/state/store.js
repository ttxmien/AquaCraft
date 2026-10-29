const clone = (value) => JSON.parse(JSON.stringify(value));

const seedDecorations = [
  { id: 'decor-seed-1', type: 'coral', x: -3.15, y: 0.24, z: -1.05, rotation: 0.25, scale: 1.05 },
  { id: 'decor-seed-2', type: 'rock', x: -2.15, y: 0.24, z: -0.85, rotation: -0.35, scale: 1.12 },
  { id: 'decor-seed-3', type: 'seaweed', x: 3.45, y: 0.24, z: 1.55, rotation: 0.1, scale: 1.0 },
  { id: 'decor-seed-4', type: 'rock', x: 2.55, y: 0.24, z: -1.85, rotation: 0.4, scale: 0.78 },
  { id: 'decor-seed-5', type: 'air', x: 4.45, y: 0.24, z: -2.25, rotation: 0, scale: 1.0 },
];

const seedFish = ['clown', 'tang', 'clown', 'gold'];

export class AquariumStore {
  constructor() {
    this.state = {
      decorations: clone(seedDecorations),
      fish: seedFish.map((species, index) => ({ id: `fish-${index + 1}`, species })),
      waterLevel: 5.55,
      editorOpen: true,
      theme: 'dark',
      feedingMode: false,
      selectedDecoration: null,
      selectedFish: null,
      breedingSelection: null,
      foodCount: 0,
      toast: null,
    };
    this.listeners = new Set();
    this.history = [];
    this.sequence = 10;
  }

  getState() { return this.state; }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of this.listeners) listener(this.state);
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  recordHistory() {
    this.history.push(clone(this.state.decorations));
    if (this.history.length > 40) this.history.shift();
  }

  pushHistorySnapshot(snapshot) {
    if (!snapshot) return;
    this.history.push(clone(snapshot));
    if (this.history.length > 40) this.history.shift();
  }

  scaleSelected(scale) {
    const id = this.state.selectedDecoration;
    if (!id) return;
    const value = Math.max(0.55, Math.min(1.8, Number(scale) || 1));
    this.set({
      decorations: this.state.decorations.map(item => item.id === id ? { ...item, scale: value } : item),
    });
  }

  addDecoration(type) {
    this.recordHistory();
    const id = `decor-${++this.sequence}`;
    const offset = (this.sequence % 5) * 0.18;
    const item = {
      id, type,
      x: (Math.random() - 0.5) * 3.8 + offset,
      y: 0.24,
      z: (Math.random() - 0.5) * 2.5,
      rotation: Math.random() * Math.PI * 2,
      scale: type === 'pebble' ? 0.72 + Math.random() * 0.45 : 0.85 + Math.random() * 0.32,
    };
    this.set({
      decorations: [...this.state.decorations, item],
      selectedDecoration: id,
      feedingMode: false,
      toast: `${this.labelFor(type)} added — drag to position`,
    });
    return id;
  }

  moveDecoration(id, x, z) {
    this.recordHistory();
    this.set({
      decorations: this.state.decorations.map(item => item.id === id ? { ...item, x, z } : item),
      selectedDecoration: id,
    });
  }

  rotateSelected() {
    const id = this.state.selectedDecoration;
    if (!id) return;
    this.recordHistory();
    this.set({
      decorations: this.state.decorations.map(item => item.id === id
        ? { ...item, rotation: item.rotation + Math.PI / 6 } : item),
    });
  }

  removeSelected() {
    const id = this.state.selectedDecoration;
    if (!id) return;
    this.recordHistory();
    this.set({
      decorations: this.state.decorations.filter(item => item.id !== id),
      selectedDecoration: null,
      toast: 'Decoration removed',
    });
  }

  selectDecoration(id) {
    if (this.state.selectedDecoration === id) return;
    this.set({ selectedDecoration: id, selectedFish: null, feedingMode: false });
  }

  undo() {
    if (!this.history.length) {
      this.set({ toast: 'Nothing to undo yet' });
      return;
    }
    const decorations = this.history.pop();
    this.set({ decorations, selectedDecoration: null, toast: 'Last decoration action undone' });
  }

  addFish(species, { bred = false } = {}) {
    if (this.state.fish.length >= 18) {
      this.set({ toast: 'Your aquarium is full — 18 fish maximum' });
      return null;
    }
    const id = `fish-${++this.sequence}`;
    this.set({
      fish: [...this.state.fish, { id, species }],
      selectedFish: id,
      selectedDecoration: null,
      feedingMode: false,
      breedingSelection: null,
      toast: bred ? `A baby ${this.labelFor(species)} was born` : `${this.labelFor(species)} joined your aquarium`,
    });
    return id;
  }

  selectBreedingParent(fish, selectedAt, hasFishBetween = false) {
    const pending = this.state.breedingSelection;
    if (!pending || selectedAt - pending.selectedAt > 30) {
      if (fish.satiety <= 60) {
        this.set({ toast: `${this.labelFor(fish.species)} needs more than 60% satiety to breed` });
        return;
      }
      this.set({
        breedingSelection: {
          fishId: fish.id,
          species: fish.species,
          satiety: fish.satiety,
          selectedAt,
        },
        selectedFish: fish.id,
        selectedDecoration: null,
        feedingMode: false,
        toast: `First ${this.labelFor(fish.species)} selected (${Math.round(fish.satiety)}%). Select a matching fish within 30 seconds`,
      });
      return;
    }

    if (pending.fishId === fish.id) {
      this.set({ toast: 'Select a different fish as the second parent' });
      return;
    }
    if (fish.satiety <= 60) {
      this.set({ toast: `${this.labelFor(fish.species)} needs more than 60% satiety to breed` });
      return;
    }
    if (pending.species !== fish.species) {
      this.set({ toast: 'The two parent fish must be the same color' });
      return;
    }
    if (hasFishBetween) {
      this.set({ toast: 'Another fish is between the selected parents' });
      return;
    }

    this.addFish(fish.species, { bred: true });
  }

  expireBreedingSelection(now) {
    const pending = this.state.breedingSelection;
    if (pending && now - pending.selectedAt > 30) {
      this.set({ breedingSelection: null, toast: 'Breeding selection expired' });
    }
  }

  selectFish(id) {
    this.set({ selectedFish: id, selectedDecoration: null, feedingMode: false });
  }

  removeFish(id) {
    this.set({
      fish: this.state.fish.filter(f => f.id !== id),
      selectedFish: null,
      breedingSelection: this.state.breedingSelection?.fishId === id ? null : this.state.breedingSelection,
      toast: 'Fish released from the aquarium',
    });
  }

  labelFor(type) {
    return ({ coral: 'Branch coral', fan: 'Fan coral', rock: 'Reef rock', pebble: 'Pebble', seaweed: 'Sea grass', air: 'Bubble stone', clown: 'Clownfish', tang: 'Blue tang', gold: 'Goldfish' })[type] || type;
  }
}
