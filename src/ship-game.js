import { randomInt } from 'node:crypto';
import { StaleGameViewError } from './game-display.js';
import { XoGame, XO_TURN } from './xo.js';

export const SHIP_SIZE = 10, SHIP_SETUP_MS = 5 * 60000;
// Six vessels from the supplied rules, including the two-cell-wide carrier.
export const SHIPS = Object.freeze([
  { name: 'حاملة طائرات', width: 2, length: 5 },
  { name: 'بارجة', width: 1, length: 5 },
  { name: 'مدمرة', width: 1, length: 4 },
  { name: 'غواصة', width: 1, length: 3 },
  { name: 'زورق ١', width: 1, length: 2 },
  { name: 'زورق ٢', width: 1, length: 2 }
].map(Object.freeze));
export const shipCoordinate = cell => `${'ABCDEFGHIJ'[Math.floor(cell / 10)]}${cell % 10 + 1}`;
export const shipOpponent = (g, id) => id === g.x ? g.o : g.x;
export const emptyFleet = () => ({ ships: Array(SHIPS.length).fill(null), ready: false, version: 0 });

export function shipCells(index, placement) {
  const ship = SHIPS[index];
  if (!Number.isInteger(index) || !ship || !placement) throw new Error('اختر سفينة صالحة.');
  const { row, column, direction } = placement;
  if (!Number.isInteger(row) || !Number.isInteger(column) || !['h', 'v'].includes(direction)
    || row < 0 || column < 0) throw new Error('اختر صفًا وعمودًا واتجاهًا صالحًا.');
  const width = direction === 'h' ? ship.length : ship.width;
  const height = direction === 'h' ? ship.width : ship.length;
  if (row + height > SHIP_SIZE || column + width > SHIP_SIZE) throw new Error('السفينة تتجاوز حدود البحر؛ غيّر موقعها أو اتجاهها.');
  return Array.from({ length: width * height }, (_, i) => (row + Math.floor(i / width)) * SHIP_SIZE + column + i % width);
}
export function placeShip(ships, index, placement) {
  const cells = shipCells(index, placement), occupied = new Set();
  ships.forEach((p, i) => { if (p && i !== index) for (const cell of shipCells(i, p)) occupied.add(cell); });
  if (cells.some(cell => occupied.has(cell))) throw new Error('السفينة تتداخل مع سفينة أخرى؛ اختر مكانًا متاحًا.');
  const next = [...ships];
  next[index] = { row: placement.row, column: placement.column, direction: placement.direction };
  return next;
}
export function validFleet(ships) {
  if (!Array.isArray(ships) || ships.length !== SHIPS.length || ships.some(p => !p)) return false;
  try {
    const cells = ships.flatMap((p, i) => shipCells(i, p));
    return new Set(cells).size === 26;
  } catch { return false; }
}
export function randomFleet() {
  let ships = Array(SHIPS.length).fill(null);
  for (let i = 0; i < SHIPS.length; i++) {
    const occupied = new Set(ships.flatMap((p, j) => p ? shipCells(j, p) : [])), choices = [];
    for (const direction of ['h', 'v']) for (let row = 0; row < SHIP_SIZE; row++) for (let column = 0; column < SHIP_SIZE; column++) {
      const p = { row, column, direction };
      try { if (shipCells(i, p).every(cell => !occupied.has(cell))) choices.push(p); } catch { /* Out of bounds. */ }
    }
    // With this 26-cell fleet, at least one legal placement remains for each size.
    if (!choices.length) throw new Error('تعذر ترتيب السفن؛ جرّب الترتيب العشوائي مجددًا.');
    ships = placeShip(ships, i, choices[randomInt(choices.length)]);
  }
  return ships;
}
export function sunkShips(ships, shots) {
  return ships.flatMap((p, i) => p && shipCells(i, p).every(cell => shots[cell] === 'hit') ? [i] : []);
}
export function fireShip(ships, previousShots, cell) {
  if (!Number.isInteger(cell) || cell < 0 || cell >= SHIP_SIZE * SHIP_SIZE) throw new Error('اختر خانة داخل البحر.');
  if (previousShots[cell]) throw new Error('هاجمت هذه الخانة من قبل؛ اختر خانة أخرى.');
  const index = ships.findIndex((p, i) => p && shipCells(i, p).includes(cell));
  const shots = [...previousShots], hit = index !== -1;
  shots[cell] = hit ? 'hit' : 'miss';
  const sunk = sunkShips(ships, shots);
  return { shots, hit, sunk: hit && sunk.includes(index) ? index : null, won: sunk.length === SHIPS.length };
}

export class ShipGame extends XoGame {
  get prefix() { return 'ship'; }
  get name() { return 'سفينة'; }
  initial() { return { phase: 'placement', fleets: {}, shots: {}, lastShot: null }; }
  accepted(g, holds, now) {
    return { ...super.accepted(g, holds, now), expiresAt: now + SHIP_SETUP_MS,
      fleets: { [g.x]: emptyFleet(), [g.o]: emptyFleet() },
      shots: { [g.x]: Array(100).fill(null), [g.o]: Array(100).fill(null) } };
  }
  // Called with the wallet gate held, including read-only panel refreshes.
  async current(input, eligible) {
    const g = await this.get(input.id);
    if (!g || g.channelId !== input.channelId) throw new Error('تحدّي سفينة غير صالح.');
    if (![g.x, g.o].includes(input.userId)) throw new Error('التحدّي مخصص للطرفين فقط.');
    if (!['pending', 'active'].includes(g.status)) return g;
    const bank = (await this.store.settings())?.bank;
    if (bank?.channelId !== g.channelId || bank.channelVersion !== g.bankVersion
      || [g.x, g.o].some(id => g.createdAt <= this.service.bankCutoff(id))) return this.finish(g, 'cancelled', null, 'settings');
    if (this.service.resumedAt > g.createdAt) return this.finish(g, 'cancelled', null, 'paused');
    if (!await eligible(g.x) || !await eligible(g.o)) return this.finish(g, 'cancelled', null, 'membership');
    if (g.expiresAt <= this.service.clock()) return this.timeout(g);
    return g;
  }
  async inspect(input, eligible) {
    eligible = await this.members(input, eligible);
    return this.run(() => this.current(input, eligible));
  }
  async act(input, eligible) {
    if (['accept', 'reject'].includes(input.move)) return super.act(input, eligible);
    eligible = await this.members(input, eligible);
    return this.run(async () => {
      const g = await this.current(input, eligible);
      if (!['pending', 'active'].includes(g.status)) return g;
      if (g.status !== 'active') throw new Error('انتظر قبول التحدّي.');
      const id = input.userId, fleet = g.fleets[id];
      if (input.move === 'fire') {
        if (g.phase !== 'battle') throw new Error('انتظر جاهزية الطرفين أولًا.');
        if (input.revision !== g.revision || (g.requireDelivery && g.dirty)) throw new StaleGameViewError(g);
        if (g.turn !== id) throw new Error('ليس دورك الآن.');
        const target = shipOpponent(g, id), result = fireShip(g.fleets[target].ships, g.shots[id], input.cell);
        const next = { ...g, shots: { ...g.shots, [id]: result.shots },
          lastShot: { by: id, cell: input.cell, hit: result.hit, sunk: result.sunk } };
        if (result.won) return this.finish(next, 'won', id);
        return this.commit({ ...next, turn: result.hit ? id : target, expiresAt: this.service.clock() + XO_TURN });
      }
      if (!['place', 'random', 'clear', 'ready'].includes(input.move)) throw new Error('حركة سفينة غير صالحة.');
      if (g.phase !== 'placement') throw new Error('بدأت المعركة؛ لا يمكن تغيير مواقع السفن.');
      // Separate versions allow both players to arrange their fleets concurrently.
      if (input.version !== fleet.version) throw new StaleGameViewError(g);
      if (fleet.ready) throw new Error('أكدت جاهزيتك؛ لا يمكن تعديل سفنك الآن.');
      const nextFleet = { ...fleet, version: fleet.version + 1 };
      if (input.move === 'place') nextFleet.ships = placeShip(fleet.ships, input.ship, input.placement);
      if (input.move === 'random') nextFleet.ships = randomFleet();
      if (input.move === 'clear') nextFleet.ships = Array(SHIPS.length).fill(null);
      if (input.move === 'ready') {
        if (!validFleet(fleet.ships)) throw new Error('ضع سفنك الست كاملة قبل الضغط على جاهز.');
        nextFleet.ready = true;
      }
      const next = { ...g, fleets: { ...g.fleets, [id]: nextFleet } };
      if ([g.x, g.o].every(who => next.fleets[who].ready)) {
        next.phase = 'battle'; next.turn = g.x; next.expiresAt = this.service.clock() + XO_TURN;
      }
      return this.commit(next);
    });
  }
  async timeout(g) {
    if (g.status === 'active' && g.phase === 'placement') {
      const ready = [g.x, g.o].filter(id => g.fleets[id]?.ready);
      if (ready.length === 1 && !(g.requireDelivery && g.dirty)) return this.finish(g, 'won', ready[0], 'setup-timeout');
      return this.finish(g, 'cancelled', null, 'setup-timeout');
    }
    return super.timeout(g);
  }
  expire() {
    return this.run(async () => {
      const bank = (await this.store.settings())?.bank;
      const games = await this.games.find({ clanId: this.clanId, status: { $in: ['pending', 'active'] } }).toArray();
      for (const g of games) {
        if (bank?.channelId !== g.channelId || bank.channelVersion !== g.bankVersion
          || [g.x, g.o].some(id => g.createdAt <= this.service.bankCutoff(id))) await this.finish(g, 'cancelled', null, 'settings');
        else if (this.service.resumedAt > g.createdAt) await this.finish(g, 'cancelled', null, 'paused');
        else if (g.expiresAt <= this.service.clock()) await this.timeout(g);
      }
    });
  }
}
