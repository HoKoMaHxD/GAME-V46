import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import { SHIPS, emptyFleet, placeShip, shipCells, shipOpponent, sunkShips } from './ship-game.js';

GlobalFonts.registerFromPath(fileURLToPath(new URL('../assets/DejaVuSans.ttf', import.meta.url)), 'ShipArabic');
const BLUE = '#138bc0', RED = '#e1536b', INK = '#253e50';
const noShots = () => Array(100).fill(null);

// Project secrets away before any public rendering. Unsunk enemy hulls must
// never affect pixels, control labels, filenames or attachment metadata.
export function shipSeaView(g, target, viewer = null) {
  const fleet = g.fleets[target] || emptyFleet(), shots = g.shots[shipOpponent(g, target)] || noShots();
  const sunk = sunkShips(fleet.ships, shots);
  return { ships: fleet.ships.map((p, i) => viewer === target || sunk.includes(i) ? p : null),
    shots, sunk, remaining: SHIPS.length - sunk.length };
}
function text(ctx, value, x, y, size = 24, color = INK, maxWidth) {
  ctx.font = `bold ${size}px ShipArabic`; ctx.fillStyle = color; ctx.textAlign = 'center';
  ctx.fillText(String(value), x, y, maxWidth);
}
function card(width, height) {
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#eaf7fc'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(22, 22, width - 44, height - 44, 26); ctx.fill();
  text(ctx, 'سفينة', width / 2, 77, 38);
  return { canvas, ctx };
}
function hull(ctx, index, p, left, top, step, sunk) {
  const ship = SHIPS[index], w = ship.width * step, h = ship.length * step, pad = step * 0.14;
  ctx.save();
  ctx.translate(left + p.column * step, top + p.row * step);
  if (p.direction === 'h') { ctx.translate(0, w); ctx.rotate(-Math.PI / 2); }
  ctx.fillStyle = sunk ? '#693d51' : '#889fab'; ctx.strokeStyle = sunk ? '#ee8291' : '#d6e4e7'; ctx.lineWidth = Math.max(1.5, step * 0.035);
  ctx.beginPath(); ctx.moveTo(w / 2, pad); ctx.lineTo(w - pad, step * 0.65);
  ctx.lineTo(w - pad, h - pad * 2); ctx.quadraticCurveTo(w / 2, h + pad * 0.25, pad, h - pad * 2);
  ctx.lineTo(pad, step * 0.65); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = sunk ? '#a35264' : '#415d6c';
  ctx.beginPath(); ctx.roundRect(w * 0.3, h * 0.32, w * 0.4, h * 0.35, step * 0.1); ctx.fill();
  if (index === 0) {
    ctx.strokeStyle = '#e8f2f0'; ctx.lineWidth = step * 0.055; ctx.setLineDash([step * 0.2, step * 0.15]);
    ctx.beginPath(); ctx.moveTo(w * 0.5, step * 0.7); ctx.lineTo(w * 0.5, h - step * 0.5); ctx.stroke(); ctx.setLineDash([]);
    for (const y of [h * 0.32, h * 0.62]) for (const x of [w * 0.3, w * 0.73]) {
      ctx.fillStyle = '#d9e3e3'; ctx.beginPath(); ctx.moveTo(x, y - step * 0.23); ctx.lineTo(x + step * 0.2, y + step * 0.15);
      ctx.lineTo(x, y + step * 0.06); ctx.lineTo(x - step * 0.2, y + step * 0.15); ctx.closePath(); ctx.fill();
    }
  } else {
    for (const y of [h * 0.23, h * 0.77]) {
      ctx.fillStyle = '#bcccd0'; ctx.beginPath(); ctx.arc(w / 2, y, step * 0.18, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#dbe8e8'; ctx.lineWidth = step * 0.06;
      ctx.beginPath(); ctx.moveTo(w / 2, y); ctx.lineTo(w / 2, y - step * 0.3); ctx.stroke();
    }
  }
  ctx.restore();
}
function sea(ctx, view, left, top, step, { row = null, selection = null, last = null } = {}) {
  const length = step * 10, gradient = ctx.createLinearGradient(left, top, left + length, top + length);
  gradient.addColorStop(0, '#126e96'); gradient.addColorStop(1, '#073b5b');
  ctx.fillStyle = gradient; ctx.fillRect(left, top, length, length);
  if (Number.isInteger(row) && row >= 0 && row < 10) { ctx.fillStyle = '#55c6e42c'; ctx.fillRect(left, top + row * step, length, step); }
  for (let i = 0; i <= 10; i++) {
    ctx.strokeStyle = '#6bc5df66'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(left + i * step, top); ctx.lineTo(left + i * step, top + length); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(left, top + i * step); ctx.lineTo(left + length, top + i * step); ctx.stroke();
    if (i < 10) {
      text(ctx, i + 1, left + (i + 0.5) * step, top - 10, step * 0.4);
      text(ctx, 'ABCDEFGHIJ'[i], left - step * 0.52, top + (i + 0.64) * step, step * 0.4);
    }
  }
  view.ships.forEach((p, i) => { if (p) hull(ctx, i, p, left, top, step, view.sunk.includes(i)); });
  if (selection) {
    const { ship, row: sr, column, direction } = selection, p = { row: sr, column, direction };
    try {
      const cells = shipCells(ship, p); let valid = true;
      try { placeShip(view.ships, ship, p); } catch { valid = false; }
      for (const cell of cells) {
        const x = left + cell % 10 * step, y = top + Math.floor(cell / 10) * step;
        ctx.fillStyle = valid ? '#66efa337' : '#ff647b44'; ctx.fillRect(x + 2, y + 2, step - 4, step - 4);
        ctx.strokeStyle = valid ? '#88f3b0' : '#ff8094'; ctx.lineWidth = 2; ctx.strokeRect(x + 3, y + 3, step - 6, step - 6);
      }
    } catch { /* Out-of-bounds placement is explained in the private controls. */ }
  }
  view.shots.forEach((shot, cell) => {
    if (!shot) return;
    const x = left + (cell % 10 + 0.5) * step, y = top + (Math.floor(cell / 10) + 0.5) * step, r = step * 0.29;
    ctx.strokeStyle = shot === 'hit' ? '#ff6d68' : '#e5f8ff'; ctx.lineWidth = Math.max(1.5, step * 0.06);
    ctx.beginPath();
    if (shot === 'hit') {
      ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = '#ef4246aa'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - r * 1.25, y); ctx.lineTo(x + r * 1.25, y); ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x, y + r * 1.25);
    } else {
      ctx.moveTo(x - r * 0.75, y - r * 0.75); ctx.lineTo(x + r * 0.75, y + r * 0.75);
      ctx.moveTo(x + r * 0.75, y - r * 0.75); ctx.lineTo(x - r * 0.75, y + r * 0.75);
    }
    ctx.stroke();
    if (last === cell) { ctx.strokeStyle = '#ffd875'; ctx.lineWidth = 2; ctx.strokeRect(x - step / 2 + 2, y - step / 2 + 2, step - 4, step - 4); }
  });
}
export function shipPublicBoard(g) {
  const { canvas, ctx } = card(1040, 755);
  text(ctx, `المبلغ: ${g.amount.toLocaleString('en-US')} $ لكل لاعب`, 520, 117, 21, '#6b8090');
  for (const [id, left, color] of [[g.x, 80, BLUE], [g.o, 560, RED]]) {
    const view = shipSeaView(g, id), attacker = shipOpponent(g, id), cx = left + 210;
    text(ctx, g.names?.[id] || 'لاعب', cx, 166, 27, color, 400);
    const label = g.phase === 'placement' ? (g.fleets[id]?.ready ? 'جاهز للمعركة' : 'يرتّب سفنه في لوحته الخاصة') : `السفن المتبقية: ${view.remaining}`;
    text(ctx, label, cx, 198, 19, '#627786', 410);
    if (g.status === 'active' && g.phase === 'battle' && g.turn === attacker) {
      ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.strokeRect(left - 4, 237 - 4, 428, 428);
    }
    sea(ctx, view, left, 237, 42, { last: g.lastShot?.by === attacker ? g.lastShot.cell : null });
  }
  text(ctx, 'تظهر السفن بعد إغراقها', 266, 707, 22, '#526c7d');
  text(ctx, 'التصويب الأحمر: إصابة', 611, 707, 22, '#526c7d');
  text(ctx, 'خطأ', 905, 707, 22, '#526c7d'); text(ctx, '×', 850, 707, 25, '#526c7d');
  return canvas.toBuffer('image/png');
}
export function shipPrivateBoard(g, viewer, { selection = null, row = null } = {}) {
  if (![g.x, g.o].includes(viewer)) throw new Error('اللوحة الخاصة لصاحبها فقط.');
  const placement = g.phase === 'placement', { canvas, ctx } = card(760, placement ? 900 : 1130);
  const own = shipSeaView(g, viewer, viewer), enemy = shipSeaView(g, shipOpponent(g, viewer));
  text(ctx, g.names?.[viewer] || 'لاعب', 380, 118, 24, viewer === g.x ? BLUE : RED, 600);
  if (placement) {
    text(ctx, 'رتّب سفنك • هذه اللوحة تظهر لك وحدك', 380, 165, 25);
    sea(ctx, own, 120, 231, 52, { selection });
    text(ctx, `السفن في البحر: ${g.fleets[viewer]?.ships.filter(Boolean).length || 0} من 6`, 380, 798, 24);
    text(ctx, 'اختر السفينة والصف والعمود، ثم اضغط وضع السفينة', 380, 847, 20, '#627786', 680);
  } else {
    text(ctx, 'محيط الخصم', 380, 169, 28);
    text(ctx, 'السفن غير الغارقة مخفية', 380, 199, 18, '#627786');
    sea(ctx, enemy, 130, 240, 50, { row, last: g.lastShot?.by === viewer ? g.lastShot.cell : null });
    text(ctx, 'محيطك وسفنك', 210, 794, 24);
    sea(ctx, own, 100, 835, 22);
    text(ctx, `سفنك المتبقية: ${own.remaining}`, 520, 865, 23);
    text(ctx, `سفن الخصم: ${enemy.remaining}`, 520, 909, 23);
    text(ctx, 'الإصابة تمنحك دورًا إضافيًا', 520, 966, 19, RED, 340);
    text(ctx, 'الخطأ ينقل الدور للخصم', 520, 1001, 19, '#627786', 340);
    text(ctx, 'التصويب الأحمر: إصابة', 310, 1095, 20, '#627786');
    text(ctx, 'خطأ', 575, 1095, 20, '#627786'); text(ctx, '×', 532, 1095, 24, '#627786');
  }
  return canvas.toBuffer('image/png');
}
