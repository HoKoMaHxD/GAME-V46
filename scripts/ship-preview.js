import { mkdirSync, writeFileSync } from 'node:fs';
import { shipPrivateBoard, shipPublicBoard } from '../src/ship-board.js';
import { shipCells } from '../src/ship-game.js';

// Reproducible demonstration only; this script never connects to Discord or MongoDB.
const x = '100000000000000010', o = '100000000000000011';
const ships = [0, 2, 3, 4, 5, 6].map(row => ({ row, column: 0, direction: 'h' }));
const g = { id: '155000000000000000', revision: 1, x, o, names: { [x]: 'أنور', [o]: 'SNOW' }, amount: 1000,
  status: 'active', phase: 'placement', turn: x,
  fleets: { [x]: { ships, ready: false }, [o]: { ships: ships.map(p => ({ ...p, column: 4 })), ready: false } },
  shots: { [x]: Array(100).fill(null), [o]: Array(100).fill(null) } };
const directory = new URL('../docs/review-logs/v2.5.49/', import.meta.url);
mkdirSync(directory, { recursive: true });
writeFileSync(new URL('ship-setup-preview.png', directory), shipPrivateBoard(g, x, { selection: { ship: 4, row: 8, column: 6, direction: 'h' } }));
g.phase = 'battle'; g.fleets[x].ready = g.fleets[o].ready = true;
for (const cell of [0, 4, 5, 14, 15, 99, 55, 77]) g.shots[x][cell] = [4, 5, 14, 15, 55].includes(cell) ? 'hit' : 'miss';
for (const cell of shipCells(2, g.fleets[o].ships[2])) g.shots[x][cell] = 'hit';
for (const cell of [0, 1, 3, 20, 21, 77]) g.shots[o][cell] = cell === 77 ? 'miss' : 'hit';
g.lastShot = { by: x, cell: 37, hit: true, sunk: 2 };
writeFileSync(new URL('ship-public-preview.png', directory), shipPublicBoard(g));
writeFileSync(new URL('ship-private-preview.png', directory), shipPrivateBoard(g, x, { row: 3 }));
console.log('Rendered the three ship previews.');
