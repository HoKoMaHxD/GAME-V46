import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeControl, buildRuntimeCommand, createRuntimeHandler } from '../src/runtime-control.js';
import { createHandler, buildCommands } from '../src/commands.js';
import { fixture, at, user, actor, config, snowflake } from './helpers/shop-fixture.js';

const input = (enabled, seq) => ({ enabled, actorId: actor, operationId: snowflake(at, seq) });
test('runtime command exposes stop/start and persists stop through process restart', async () => {
  const command = buildRuntimeCommand().toJSON();
  assert.equal(command.name, 'البنك'); assert.deepEqual(command.options.map(x => x.name), ['تشغيل', 'ايقاف']);
  assert.equal(buildCommands().filter(x => x.name === 'البنك').length, 1);
  const f = await fixture();
  const control = new RuntimeControl({ store: f.store, service: f.service, clock: () => at });
  await control.change(input(false, 1));
  const restarted = f.open(); const restored = new RuntimeControl({ store: restarted.store, service: restarted.service });
  restored.load(await restarted.store.settings());
  assert.equal(restarted.service.paused, true);
  for (const task of [() => restarted.service.day(user), () => restarted.service.message({ userId: user }),
    () => restarted.service.voice({ userId: user }), () => restarted.service.game({ userId: user }),
    () => restarted.service.claimSalary({}), () => restarted.service.claimPrize({}),
    () => restarted.service.penalizeSpam({})]) await assert.rejects(task(), /متوقف بالكامل/);
  assert.equal(f.documents.days.length, 0);
});

test('resume fences stopped activity, keeps balances, clears pause only after boundaries reset', async () => {
  const f = await fixture(); await f.seed(user, 1000);
  let now = at, fenced = false, resumed = false;
  const control = new RuntimeControl({ store: f.store, service: f.service, clock: () => now,
    onChanged: async () => { assert.equal(f.service.paused, true); fenced = true; },
    onResumed: async () => { assert.equal(f.service.paused, false); resumed = true; } });
  await control.change(input(false, 2)); now += 10000; f.service.clock = () => now;
  await control.change(input(true, 3));
  assert.ok(fenced && resumed); assert.equal(f.service.resumedAt, now);
  assert.equal((await f.store.totals(user, 'all', now)).total, 1000);
  const old = { guildId: config.arenaGuildId, userId: user, id: snowflake(at + 5000), at: at + 5000,
    channelId: config.clanChatChannelId, eligible: true };
  assert.equal(await f.service.message(old), null);
  assert.equal(await f.service.game({ ...old, botId: config.gamesBotId, channelId: config.gamesChannelId }), null);
  const restarted = f.open(now); const restored = new RuntimeControl({ store: restarted.store, service: restarted.service });
  restored.load(await restarted.store.settings());
  assert.equal(restarted.service.paused, false); assert.equal(restarted.service.resumedAt, now);
});

test('lost switch acknowledgement is recovered; stale requests cannot reverse a newer switch', async () => {
  const f = await fixture(); const control = new RuntimeControl({ store: f.store, service: f.service, clock: () => at });
  let lost = false;
  f.intercept(({ name, method, phase }) => { if (!lost && name === 'settings' && method === 'updateOne' && phase === 'after') {
    lost = true; throw new Error('lost acknowledgement');
  } });
  assert.equal((await control.change(input(false, 20))).enabled, false);
  f.intercept(() => {});
  assert.equal((await control.change(input(false, 20))).enabled, false);
  await assert.rejects(control.change(input(true, 19)), /طلب قديم/);
  assert.equal(f.service.paused, true);
  await control.change(input(true, 21)); assert.equal(f.service.paused, false);
});

test('unauthorized member cannot toggle; recovery command remains accessible while paused', async () => {
  const f = await fixture();
  const control = new RuntimeControl({ store: f.store, service: f.service, clock: () => at });
  f.service.paused = true;
  const handler = createHandler({ config, service: f.service, store: f.store, runtimeControl: control });
  const replies = [];
  const interaction = { commandName: 'البنك', guildId: config.clanGuildId, user: { id: user }, id: snowflake(at, 30),
    guild: { ownerId: actor }, isChatInputCommand: () => true, options: { getSubcommand: () => 'تشغيل' },
    reply: async p => replies.push(p), deferReply: async () => {}, editReply: async p => replies.push(p) };
  await handler(interaction); assert.match(replies.pop().content, /تحتاج رتبة/); assert.equal(f.service.paused, true);
  await handler({ ...interaction, user: { id: actor } }); assert.equal(f.service.paused, false);
  f.service.paused = true;
  await handler({ ...interaction, commandName: 'راتب' }); assert.match(replies.pop().content, /متوقف بالكامل/);
});
