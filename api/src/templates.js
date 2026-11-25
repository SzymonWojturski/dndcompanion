// Starter catalog of 5e containers (PHB/DMG values). Size unit: cubic feet.
// The DM can edit or delete all of these after import.
export const CONTAINER_TEMPLATES = [
  { name: 'Plecak (Backpack)', weight: 5, capacityWeight: 30, capacitySize: 1, description: 'Do zewnętrznej strony można przypiąć np. śpiwór lub linę.' },
  { name: 'Sakiewka (Pouch)', weight: 1, capacityWeight: 6, capacitySize: 0.2 },
  { name: 'Worek (Sack)', weight: 0.5, capacityWeight: 30, capacitySize: 1 },
  { name: 'Kosz (Basket)', weight: 2, capacityWeight: 40, capacitySize: 2 },
  { name: 'Skrzynia (Chest)', weight: 25, capacityWeight: 300, capacitySize: 12 },
  { name: 'Beczka (Barrel)', weight: 70, capacitySize: 4, description: '40 galonów płynu albo 4 cu ft rzeczy sypkich.' },
  { name: 'Kołczan (Quiver)', weight: 1, allowedCategories: ['amunicja'], description: 'Mieści 20 strzał.' },
  { name: 'Futerał na bełty (Crossbow bolt case)', weight: 1, allowedCategories: ['amunicja'], description: 'Mieści 20 bełtów.' },
  { name: 'Sakwa na komponenty (Component pouch)', weight: 2 },
  {
    name: 'Torba Przechowywania (Bag of Holding)', weight: 15, capacityWeight: 500, capacitySize: 64,
    contentsMultiplier: 0, extradimensional: true, category: 'magiczny',
    description: 'Zawartość nic nie waży. Włożenie do innej przestrzeni pozawymiarowej niszczy oba przedmioty.',
  },
  {
    name: 'Poręczny Chlebak Hewarda (Handy Haversack)', weight: 5, capacityWeight: 160, capacitySize: 12,
    contentsMultiplier: 0, extradimensional: true, category: 'magiczny',
    description: 'Kieszeń główna 120 lb / 8 cu ft, dwie boczne po 20 lb / 2 cu ft. Wyjęcie przedmiotu to akcja bonusowa.',
  },
  {
    name: 'Przenośna Dziura (Portable Hole)', weight: 0, capacitySize: 282,
    contentsMultiplier: 0, extradimensional: true, category: 'magiczny',
    description: 'Otwór o średnicy 6 ft i głębokości 10 ft.',
  },
  {
    name: 'Kołczan Efektywności (Efficient Quiver)', weight: 2,
    contentsMultiplier: 0, category: 'magiczny',
    description: '3 przegrody: 60 strzał lub bełtów, 18 oszczepów lub włóczni, 6 łuków, kijów lub podobnych.',
  },
]
