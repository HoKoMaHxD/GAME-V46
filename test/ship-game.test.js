import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
import { fixture, at, user, other, actor, config, snowflake } from './helpers/shop-fixture.js';
import { SHIPS, SHIP_SETUP_MS, shipCells, placeShip, randomFleet, validFleet, sunkShips, fireShip } from '../src/ship-game.js';
import { shipPayload, shipPrivatePayload, createShipHandler, ShipManager, buildShipCommand, parseShipAction } from '../src/ship-game-commands.js';
import { shipPublicBoard, shipPrivateBoard, shipSeaView } from '../src/ship-board.js';
import { buildCommands, createHandler } from '../src/commands.js';
import { createTextCommands, commandsPanel } from '../src/experience-commands.js';
import { gamesMenuPayload } from '../src/bank-menu.js';
import { commandTimesPayload } from '../src/bank-commands.js';

const channelId = '100000000000000060', yes = async () => true;
const input = (patch = {}) => ({ id: snowflake(at, 2000), x: user, o: other, amount: 300, channelId,
  names: { [user]: 'أنور', [other]: 'الخصم' }, ...patch });
const controls = p => p.components.flatMap(r => r.toJSON().components);
const balances = f => Promise.all([user, other].map(id => f.store.totals(id, 'all', at).then(b => b.total)));
// A known board independent of the random placement implementation.
const knownFleet = () => [0, 2, 3, 4, 5, 6].map(row => ({ row, column: 0, direction: 'h' }));
const act = (f, g, move, who = g.status === 'pending' ? g.o : g.turn, patch = {}) => f.service.shipGame.act({
  id: g.id, userId: who, channelId, revision: g.revision, version: g.fleets[who]?.version, move, ...patch
}, yes);
async function setup() {
  const f = await fixture(); await f.seed(user, 1000); await f.seed(other, 1000); await f.service.shipGame.initialize(); return f;
}
async function accepted(f, patch) { return act(f, await f.service.shipGame.open(input(patch), yes), 'accept'); }
async function arrange(f, g, who) {
  for (let ship = 0; ship < 6; ship++) g = await act(f, g, 'place', who, { ship, placement: knownFleet()[ship] });
  return g;
}
async function battle(f, patch) {
  let g = await accepted(f, patch);
  for (const who of [user, other]) { g = await arrange(f, g, who); g = await act(f, g, 'ready', who); }
  return g;
}
function assertControls(p) {
  assert.ok(p.components.length <= 5);
  const ids = [];
  for (const row of p.components.map(r => r.toJSON())) {
    assert.ok(row.components.length >= 1 && row.components.length <= 5);
    if (row.components.some(c => c.type === 3)) assert.equal(row.components.length, 1);
    for (const c of row.components) {
      assert.ok(c.custom_id.length <= 100); ids.push(c.custom_id);
      if (c.type === 3) assert.ok(c.options.length <= 25);
      assert.ok(parseShipAction({ customId: c.custom_id, isButton: () => c.type === 2, isStringSelectMenu: () => c.type === 3 }));
    }
  }
  assert.equal(new Set(ids).size, ids.length);
  p.embeds.forEach(e => e.toJSON());
}

test('carrier occupies a rectangle in both orientations, placements cannot overlap or wrap', () => {
  assert.deepEqual(shipCells(0, { row: 0, column: 0, direction: 'h' }), [0, 1, 2, 3, 4, 10, 11, 12, 13, 14]);
  assert.deepEqual(shipCells(0, { row: 0, column: 0, direction: 'v' }), [0, 1, 10, 11, 20, 21, 30, 31, 40, 41]);
  assert.deepEqual(shipCells(5, { row: 9, column: 8, direction: 'h' }), [98, 99]);
  for (const p of [{ row: 9, column: 0, direction: 'h' }, { row: 0, column: 9, direction: 'v' }, { row: -1, column: 0, direction: 'h' }]) assert.throws(() => shipCells(0, p));
  const ships = knownFleet(), copy = structuredClone(ships);
  assert.throws(() => placeShip(ships, 2, { row: 1, column: 0, direction: 'h' }), /تتداخل/);
  assert.equal(placeShip(ships, 0, ships[0]).length, 6); assert.deepEqual(ships, copy);
  assert.equal(validFleet(ships), true); assert.equal(validFleet(ships.slice(1)), false);
  for (let i = 0; i < 40; i++) assert.equal(validFleet(randomFleet()), true);
});
test('six ships and 26 cells must sink; misses and duplicate shots are handled', () => {
  let shots = Array(100).fill(null), result;
  for (const cell of knownFleet().flatMap((p, i) => shipCells(i, p)).slice(0, -1)) {
    result = fireShip(knownFleet(), shots, cell); shots = result.shots; assert.equal(result.won, false);
  }
  assert.equal(sunkShips(knownFleet(), shots).length, 5);
  result = fireShip(knownFleet(), shots, 61); assert.equal(result.won, true); assert.equal(result.sunk, 5);
  assert.throws(() => fireShip(knownFleet(), result.shots, 61), /من قبل/);
  assert.equal(fireShip(knownFleet(), shots, 99).hit, false);
  for (const cell of [-1, 100, 0.5, '0']) assert.throws(() => fireShip(knownFleet(), shots, cell));
});
test('challenge validation, balance recheck, rejection and invitation timeout leave balances intact', async () => {
  const f = await setup();
  for (const patch of [{ o: user }, { bot: true }, { channelId: other }, { amount: 0 }, { amount: 1.5 }, { amount: 1000000001 }]) await assert.rejects(f.service.shipGame.open(input(patch), yes));
  let g = await f.service.shipGame.open(input(), yes);
  await assert.rejects(act(f, g, 'accept', user), /المتحدّى/); await assert.rejects(act(f, g, 'accept', actor), /للطرفين/);
  g = await act(f, g, 'reject'); assert.equal(g.status, 'rejected'); assert.deepEqual(await balances(f), [1000, 1000]);
  g = await f.service.shipGame.open(input({ id: snowflake(at, 2001) }), yes);
  f.service.clock = () => at + 30000; await f.service.shipGame.expire(); assert.deepEqual(await balances(f), [1000, 1000]);
  assert.equal((await f.service.shipGame.get(g.id)).status, 'cancelled');
  f.service.clock = () => at; g = await f.service.shipGame.open(input({ id: snowflake(at, 2002) }), yes);
  f.documents.days.find(d => d.userId === other).points.tasks = 299;
  assert.equal((await act(f, g, 'accept')).reason, 'balance'); assert.deepEqual(await balances(f), [1000, 299]);
});
test('independent fleet versions allow concurrent setup and freeze ships after ready', async () => {
  const f = await setup(); let g = await accepted(f);
  assert.equal(g.phase, 'placement'); assert.equal(g.expiresAt, at + SHIP_SETUP_MS); assert.deepEqual(await balances(f), [700, 700]);
  await assert.rejects(act(f, g, 'fire', user, { cell: 0 }), /جاهزية/);
  await assert.rejects(act(f, g, 'ready', user), /الست/);
  const results = await Promise.all([act(f, g, 'random', user), act(f, g, 'random', other)]);
  assert.equal(results.length, 2); g = await f.service.shipGame.get(g.id);
  assert.ok([user, other].every(id => validFleet(g.fleets[id].ships)));
  await assert.rejects(act(f, g, 'random', user, { version: 0 }), { code: 'GAME_STALE_VIEW' });
  g = await act(f, g, 'ready', user); await assert.rejects(act(f, g, 'clear', user), /جاهزيتك/);
  g = await act(f, g, 'ready', other); assert.equal(g.phase, 'battle'); assert.equal(g.turn, user); assert.equal(g.expiresAt, at + 30000);
  await assert.rejects(act(f, g, 'random', other), /بدأت/);
});
test('hits retain the turn, misses pass it, sixth sinking settles once without tax', async () => {
  const f = await setup(); let g = await battle(f);
  g = await act(f, g, 'fire', user, { cell: 99 }); assert.equal(g.turn, other); assert.equal(g.lastShot.hit, false);
  await assert.rejects(act(f, g, 'fire', user, { cell: 0 }), /دورك/);
  g = await act(f, g, 'fire', other, { cell: 98 }); assert.equal(g.turn, user);
  for (const cell of knownFleet().flatMap((p, i) => shipCells(i, p))) {
    const before = g; g = await act(f, g, 'fire', user, { cell });
    if (g.status === 'active') { assert.equal(g.turn, user); assert.deepEqual(await balances(f), [700, 700]); }
    if (cell === 0) { await assert.rejects(act(f, before, 'fire', user, { cell: 1 }), { code: 'GAME_STALE_VIEW' }); await assert.rejects(act(f, g, 'fire', user, { cell: 0 }), /من قبل/); }
  }
  assert.equal(g.winner, user); assert.equal(g.status, 'won'); assert.deepEqual(await balances(f), [1300, 700]);
  await act(f, g, 'fire', user, { cell: 61 }); await f.service.shipGame.expire(); assert.deepEqual(await balances(f), [1300, 700]);
});
test('setup timeout awards the sole ready player; neither ready or undelivered setup refunds', async () => {
  for (const scenario of ['none', 'one', 'undelivered']) {
    const f = await setup(); let g = await accepted(f, { requireDelivery: true });
    if (scenario !== 'none') { g = await act(f, g, 'random', other); g = await act(f, g, 'ready', other); }
    if (scenario !== 'undelivered') await f.service.shipGame.displayed(g);
    f.service.clock = () => at + SHIP_SETUP_MS; await f.service.shipGame.expire();
    g = await f.service.shipGame.get(g.id); assert.equal(g.status, scenario === 'one' ? 'won' : 'cancelled');
    assert.deepEqual(await balances(f), scenario === 'one' ? [700, 1300] : [1000, 1000]);
  }
});
test('delivered battle expires once; failed delivery refunds instead of penalizing a player', async () => {
  for (const delivered of [true, false]) {
    const f = await setup(); let g = await battle(f, { requireDelivery: true });
    if (delivered) await f.service.shipGame.displayed(g);
    else await assert.rejects(act(f, g, 'fire', user, { cell: 0 }), { code: 'GAME_STALE_VIEW' });
    f.service.clock = () => at + 30000;
    await Promise.all([f.service.shipGame.expire(), act(f, g, 'fire', user, { cell: 0 })]);
    g = await f.service.shipGame.get(g.id); assert.equal(g.status, delivered ? 'won' : 'cancelled');
    assert.deepEqual(await balances(f), delivered ? [700, 1300] : [1000, 1000]);
  }
});
test('restart preserves fleet, hits, turn and deadline; settings, membership and pause cancel safely', async () => {
  for (const reason of ['settings', 'membership', 'paused']) {
    const f = await setup(); let g = await battle(f); g = await act(f, g, 'fire', user, { cell: 0 });
    const restarted = f.open(at + 1000); await restarted.service.shipGame.initialize(); await restarted.service.shipGame.recover();
    assert.deepEqual(await restarted.service.shipGame.get(g.id), g);
    if (reason === 'settings') f.documents.settings[0].bank.channelVersion++;
    if (reason === 'paused') restarted.service.resumedAt = at + 500;
    g = await restarted.service.shipGame.inspect({ id: g.id, userId: user, channelId }, async id => reason !== 'membership' || id !== other);
    assert.equal(g.reason, reason); assert.deepEqual(await balances(f), [1000, 1000]);
  }
});
for (const phase of ['before', 'after']) for (const operation of ['hold', 'payout']) test(`recovery after ${phase} ${operation} failure cannot double-charge or double-pay`, async () => {
  const f = await setup(); let g = operation === 'hold' ? await f.service.shipGame.open(input(), yes) : await battle(f);
  if (operation === 'payout') for (const cell of knownFleet().flatMap((p, i) => shipCells(i, p)).slice(0, -1)) g = await act(f, g, 'fire', user, { cell });
  let hit = false;
  f.intercept(e => { if (!hit && e.name === 'days' && e.method === 'replaceOne' && e.phase === phase) { hit = true; throw new Error('lost connection'); } });
  await assert.rejects(operation === 'hold' ? act(f, g, 'accept') : act(f, g, 'fire', user, { cell: 61 })); assert.equal(hit, true);
  f.intercept(() => {}); const restarted = f.open(at); await restarted.service.shipGame.recover(); await restarted.service.shipGame.recover();
  assert.deepEqual(await balances(f), operation === 'hold' ? [700, 700] : [1300, 700]);
  assert.equal((await restarted.service.shipGame.get(g.id)).status, operation === 'hold' ? 'active' : 'won');
});
test('public pixels and opponent pixels do not depend on unsunk hidden positions', async () => {
  const f = await setup(), g = await battle(f), changed = structuredClone(g);
  changed.fleets[other].ships = randomFleet();
  assert.deepEqual(shipPublicBoard(g), shipPublicBoard(changed));
  assert.deepEqual(shipPrivateBoard(g, user), shipPrivateBoard(changed, user));
  assert.ok(shipSeaView(g, other).ships.every(p => p === null));
  assert.deepEqual(shipSeaView(g, user, user).ships, knownFleet());
  for (const cell of [60, 61]) g.shots[user][cell] = 'hit';
  assert.deepEqual(shipSeaView(g, other).ships.map((p, i) => p ? i : null).filter(i => i != null), [5]);
  assert.throws(() => shipPrivatePayload(g, actor), /لصاحبها/);
  assert.throws(() => shipPrivateBoard(g, actor), /لصاحبها/);
});
test('all states obey Discord component limits and slash, text, help and cooldown registration work', async () => {
  assert.ok(buildCommands().some(c => c.name === 'سفينة')); assert.equal(buildShipCommand().toJSON().options.length, 2);
  assert.ok(controls(gamesMenuPayload()).some(c => c.custom_id === 'ship:help'));
  assert.match(commandsPanel().embeds[0].data.description, /سفينة @عضو المبلغ/);
  for (const content of [`سفينة <@${other}> ١٠٠٠`, `!سفينة <@!${other}> 1000`, `-سفينة <@${other}> ۱۰۰۰`]) {
    let parsed; await createTextCommands(async i => { parsed = i; }, config)({ content, author: { id: user }, id: input().id, guildId: config.clanGuildId, channelId, mentions: { users: new Map([[other, { id: other }]]) } });
    assert.equal(parsed.commandName, 'سفينة'); assert.equal(parsed.options.getInteger('المبلغ'), 1000);
  }
  const f = await setup(); let g = await f.service.shipGame.open(input(), yes); assertControls(shipPayload(g));
  g = await act(f, g, 'accept'); assertControls(shipPayload(g)); assertControls(shipPrivatePayload(g, user));
  for (const id of [user, other]) { g = await act(f, g, 'random', id); g = await act(f, g, 'ready', id); }
  assertControls(shipPayload(g)); assertControls(shipPrivatePayload(g, user, { row: 9 })); assertControls(shipPrivatePayload(g, other));
  await assert.rejects(f.service.reset({ target: 'bank', userId: user, actorId: actor, operationId: 'reset-ship' }), /سفينة/);
  assert.equal((await f.service.shipGame.commandTime(user, at)).nextAt, at + 1200000);
  assert.equal((await f.service.shipGame.commandTime(other, at)).status, 'ready');
  assert.equal((await f.service.boxesGame.commandTime(user, at)).status, 'ready');
  assert.ok(commandTimesPayload(await f.service.commandTimes(user, channelId)).embeds[0].data.fields.some(f => f.name.includes('سفينة')));
  f.service.paused = true; let notice;
  await createHandler({ config, service: f.service })({ isStringSelectMenu: () => true, reply: async p => { notice = p; } });
  assert.match(notice.content, /متوقف/);
});

function ui(f) {
  const outputs = [], errors = [], publicMessage = { id: snowflake(at, 2900), author: { id: actor },
    edit: async p => { outputs.push({ type: 'public', payload: p }); return publicMessage; } };
  const channel = { guildId: config.clanGuildId, messages: { fetch: async () => publicMessage } };
  const bot = { user: { id: actor }, channels: { fetch: async () => channel } };
  const handler = createShipHandler({ config, service: f.service, bot, isBankMember: yes, onError: e => errors.push(e) });
  async function press(control, who, { privateMessage = false, value } = {}) {
    const start = outputs.length;
    const i = { customId: control.custom_id, values: value == null ? undefined : [String(value)], user: { id: who }, guildId: config.clanGuildId, channelId, channel,
      message: privateMessage ? { id: snowflake(at, 2901), flags: { has: flag => flag === MessageFlags.Ephemeral } } : publicMessage,
      isButton: () => control.type === 2, isStringSelectMenu: () => control.type === 3,
      reply: async p => outputs.push({ type: 'denied', payload: p }),
      deferUpdate: async () => outputs.push({ type: 'ackUpdate' }), deferReply: async p => outputs.push({ type: 'ackReply', payload: p }),
      editReply: async p => { outputs.push({ type: 'reply', payload: p }); return privateMessage ? { id: snowflake(at, 2901) } : publicMessage; },
      followUp: async p => outputs.push({ type: 'notice', payload: p }) };
    await handler(i); return outputs.slice(start);
  }
  return { outputs, errors, handler, press, publicMessage, bot };
}
const find = (p, suffix) => controls(p).find(c => c.custom_id.endsWith(suffix));
test('real text and private interactions arrange, rotate, select and fire without exposing private attachments', async () => {
  const f = await setup(), u = ui(f); let publicPayload;
  await createTextCommands(u.handler, config)({ content: `سفينة <@${other}> 300`, id: input().id, author: { id: user, username: 'أنور' },
    guildId: config.clanGuildId, channelId, mentions: { users: new Map([[other, { id: other, username: 'الخصم' }]]) },
    reply: async p => { publicPayload = p; return u.publicMessage; } });
  assert.equal(f.documents.ship_games[0].messageId, u.publicMessage.id);
  let out = await u.press(find(publicPayload, ':accept'), other); publicPayload = out.find(o => o.type === 'reply').payload;
  assert.equal(out[0].type, 'ackUpdate');
  const open = find(publicPayload, input().id);
  for (const who of [user, other]) {
    out = await u.press(open, who); assert.equal(out[0].payload.flags, MessageFlags.Ephemeral);
    let p = out.find(o => o.type === 'reply').payload;
    if (who === user) {
      out = await u.press(find(p, ':rotate'), who, { privateMessage: true }); p = out.find(o => o.type === 'reply').payload;
      assert.match(p.embeds[0].data.description, /عمودي/);
      out = await u.press(find(p, ':row'), who, { privateMessage: true, value: 1 }); p = out.find(o => o.type === 'reply').payload;
      out = await u.press(find(p, ':place'), who, { privateMessage: true }); p = out.find(o => o.type === 'reply').payload;
      assert.deepEqual(f.documents.ship_games[0].fleets[user].ships[0], { row: 1, column: 0, direction: 'v' });
    }
    out = await u.press(find(p, ':random'), who, { privateMessage: true }); p = out.find(o => o.type === 'reply').payload;
    await u.press(find(p, ':ready'), who, { privateMessage: true });
  }
  let g = await f.service.shipGame.get(input().id); assert.equal(g.phase, 'battle'); assert.equal(g.dirty, false);
  publicPayload = u.outputs.filter(o => o.type === 'public').at(-1).payload;
  out = await u.press(controls(publicPayload)[0], user, { value: 0 }); let p = out.find(o => o.type === 'reply').payload;
  assert.equal(out[0].payload.flags, MessageFlags.Ephemeral);
  const fire = controls(p).find(c => c.custom_id.startsWith('ship:fire:'));
  await u.press(fire, user, { privateMessage: true }); g = await f.service.shipGame.get(g.id);
  assert.equal(g.shots[user].filter(Boolean).length, 1); assert.equal(g.dirty, false);
  out = await u.press(fire, user, { privateMessage: true }); assert.match(out.find(o => o.type === 'reply').payload.embeds[0].data.description, /لم تُحسب/);
  for (const output of u.outputs.filter(o => o.type === 'public')) assert.ok(output.payload.files.every(f => !f.name.includes('private')));
  assert.equal(u.errors.length, 0);
});
test('spectators, copied public controls and another owner cannot open or mutate secret panels', async () => {
  const f = await setup(); let g = await accepted(f); await f.service.shipGame.bind(g.id, snowflake(at, 2900)); const u = ui(f);
  const p = shipPrivatePayload(g, user), random = find(p, ':random');
  for (const [who, privateMessage] of [[other, true], [user, false]]) {
    const out = await u.press(random, who, { privateMessage }); assert.equal(out[0].type, 'denied'); assert.equal(out[0].payload.flags, 64);
  }
  const out = await u.press(controls(shipPayload(g))[0], actor);
  assert.equal(out[0].payload.flags, 64); assert.match(out.at(-1).payload.content, /للطرفين/);
  assert.ok(out.every(o => !o.payload?.files?.length));
  assert.equal((await f.service.shipGame.get(g.id)).fleets[user].ships.filter(Boolean).length, 0);
});
test('manager recovers a public edit failure and refunds when the original message was deleted', async () => {
  for (const deleted of [false, true]) {
    const f = await setup(), g = await accepted(f, { requireDelivery: true }); await f.service.shipGame.bind(g.id, snowflake(at, 2900));
    let edited, fail = true;
    const bot = { user: { id: actor }, channels: { fetch: async () => ({ guildId: config.clanGuildId, messages: { fetch: async () => {
      if (deleted) throw Object.assign(new Error('deleted'), { code: 10008 });
      return { author: { id: actor }, edit: async p => { if (fail) { fail = false; throw new Error('temporary'); } edited = p; } };
    } } }) } };
    const manager = new ShipManager({ bot, service: f.service, canRun: () => true, onError: () => {} });
    await manager.tick(); await manager.drain(); await manager.tick(); await manager.drain();
    const saved = await f.service.shipGame.get(g.id); assert.equal(saved.dirty, false);
    if (deleted) { assert.equal(saved.reason, 'delivery'); assert.deepEqual(await balances(f), [1000, 1000]); }
    else assert.ok(edited.files.every(f => !f.name.includes('private')));
  }
});
