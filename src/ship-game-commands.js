import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder, StringSelectMenuBuilder, escapeMarkdown } from 'discord.js';
import { bankMember } from './bank.js';
import { gameDisplays, playGameAction, STALE_GAME_NOTICE } from './game-display.js';
import { shipPrivateBoard, shipPublicBoard } from './ship-board.js';
import { SHIPS, shipCells, shipCoordinate, shipOpponent, sunkShips, validFleet } from './ship-game.js';
import { XO_MAX } from './xo.js';
import { XoManager } from './xo-commands.js';

const safeName = (g, id) => escapeMarkdown((g.names?.[id] || 'لاعب').slice(0, 60));
const button = (id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder()
  .setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
const rowOf = (...items) => new ActionRowBuilder().addComponents(...items);
const select = (id, placeholder, options, disabled = false) => rowOf(new StringSelectMenuBuilder()
  .setCustomId(id).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1).setOptions(options).setDisabled(disabled));
const frame = (embed, components = [], files = []) => ({ content: '', embeds: [embed], components, files, attachments: [], allowedMentions: { parse: [] } });
const money = g => g.amount.toLocaleString('en-US');
function conclusion(g) {
  if (g.status === 'won') return `${g.reason === 'timeout' ? '⏰ انتهت مهلة صاحب الدور.\n' : g.reason === 'setup-timeout' ? '⏰ الخصم لم يؤكد جاهزيته خلال مهلة الترتيب.\n' : ''}🏆 فاز <@${g.winner}>! ربح **${money(g)} $** من خصمه واسترجع مبلغه المحجوز، بدون ضريبة.`;
  if (g.status === 'rejected') return 'رُفض التحدّي؛ لم يُخصم أي مبلغ.';
  if (g.reason === 'balance') return 'أُلغي التحدّي؛ رصيد أحد الطرفين لا يكفي. لم يُحجز أي مبلغ.';
  return `${g.reason === 'setup-timeout' ? 'تعذر بدء المعركة خلال مهلة الترتيب. ' : g.reason === 'paused' ? 'توقف البوت أثناء اللعبة. ' : ''}أُلغي التحدّي؛ أُعيدت أي مبالغ محجوزة للطرفين.`;
}
function lastShot(g) {
  if (!g.lastShot) return '';
  const shot = g.lastShot;
  return `<@${shot.by}> هاجم **${shipCoordinate(shot.cell)}**: ${shot.sunk != null ? `💥 أغرق **${SHIPS[shot.sunk].name}**!` : shot.hit ? '🎯 إصابة!' : '✖️ خطأ.'}${shot.hit && g.status === 'active' ? ' له دور إضافي.' : ''}`;
}
export function buildShipCommand() {
  return new SlashCommandBuilder().setName('سفينة').setDescription('رتّب سفنك سرًا ثم أغرق أسطول خصمك في معركة بحرية')
    .addUserOption(o => o.setName('العضو').setDescription('العضو المتحدّى').setRequired(true))
    .addIntegerOption(o => o.setName('المبلغ').setDescription('المبلغ المحجوز من كل طرف').setMinValue(1).setMaxValue(XO_MAX).setRequired(true));
}
export function shipPayload(g) {
  const active = g.status === 'active';
  let description, components = [];
  if (g.status === 'pending') {
    description = `<@${g.o}>، تحدّاك <@${g.x}> في **سفينة**!\nشبكة **10×10** و**6 سفن** لكل لاعب. رتّب سفنك في لوحتك الخاصة، ثم اضغط جاهز. الإصابة تمنحك دورًا إضافيًا، والفائز أول من يغرق سفن خصمه الست.\n\nعند القبول يُحجز **${money(g)} $** من كل طرف. الفائز يأخذ مبلغ خصمه كاملًا بدون ضريبة.\nالقبول خلال **30 ثانية**، والترتيب خلال **5 دقائق**، ولكل هجوم **30 ثانية**. عدم الهجوم خسارة. عند انتهاء الترتيب يفوز اللاعب الجاهز إذا كان وحده جاهزًا، وإلا يُعاد المبلغان.\nانتظار إرسال تحدٍّ جديد: **20 دقيقة**؛ استقبال التحديات متاح أثناء الانتظار.\nتنتهي الدعوة <t:${Math.ceil(g.expiresAt / 1000)}:R>.`;
    components = [rowOf(button(`ship:v1:${g.id}:${g.revision}:accept`, 'قبول', ButtonStyle.Success), button(`ship:v1:${g.id}:${g.revision}:reject`, 'رفض', ButtonStyle.Danger))];
  } else if (active && g.phase === 'placement') {
    description = `**مرحلة ترتيب السفن**\n${[g.x, g.o].map(id => `${g.fleets[id].ready ? '✅ جاهز' : '⏳ يرتّب سفنه'} — <@${id}>`).join('\n')}\n\nاضغط **ترتيب سفني**؛ تظهر اللوحة لك وحدك. اختر السفينة والصف والعمود والاتجاه ثم ضعها، أو استخدم **عشوائي**، وبعدها **جاهز**.\nالمبلغ المحجوز: **${money(g)} $** من كل طرف. تنتهي المهلة <t:${Math.ceil(g.expiresAt / 1000)}:R>.`;
  } else if (active) {
    description = `الدور على <@${g.turn}> ${g.turn === g.x ? '🔵' : '🔴'}\n${lastShot(g)}\nاختر **صف الهجوم** من القائمة، ثم اضغط الخانة في لوحتك الخاصة. **لوحتي** تعرض محيط الخصم كبيرًا وسفنك في الأسفل.\nلديك **30 ثانية**؛ تنتهي <t:${Math.ceil(g.expiresAt / 1000)}:R>.\nمبلغ التحدّي: **${money(g)} $** لكل طرف.`;
    components.push(select(`ship:row:${g.id}:${g.revision}`, 'اختر صف الهجوم (A–J)', Array.from({ length: 10 }, (_, r) => ({ label: `الصف ${'ABCDEFGHIJ'[r]}`, value: String(r) }))));
  } else description = conclusion(g);
  const color = g.status === 'won' ? (g.winner === g.x ? 0x138bc0 : 0xe1536b) : active && g.phase === 'battle' ? (g.turn === g.x ? 0x138bc0 : 0xe1536b) : 0x138bc0;
  const embed = new EmbedBuilder().setColor(color).setTitle(`سفينة • ${safeName(g, g.x)} ضد ${safeName(g, g.o)}`)
    .setDescription(description).setFooter({ text: `سفينة • 10×10 • 6 سفن • رقم اللعبة: ${g.id}` });
  const files = [];
  if (g.acceptedAt != null) {
    components.push(rowOf(button(`ship:open:${g.id}`, active && g.phase === 'placement' ? 'ترتيب سفني' : 'لوحتي', ButtonStyle.Primary)));
    const name = `ship-${g.id}-${g.revision}.png`;
    embed.setImage(`attachment://${name}`); files.push({ attachment: shipPublicBoard(g), name });
  }
  return frame(embed, components, files);
}
export function defaultShipSelection(fleet) {
  const first = fleet.ships.findIndex(p => !p), ship = first < 0 ? 0 : first;
  return { ship, ...(fleet.ships[ship] || { row: 0, column: 0, direction: 'h' }) };
}
export function shipPrivatePayload(g, viewer, { selection = null, row = null, notice = '' } = {}) {
  if (![g.x, g.o].includes(viewer)) throw new Error('هذه اللوحة لصاحبها فقط.');
  const embed = new EmbedBuilder().setColor(viewer === g.x ? 0x138bc0 : 0xe1536b).setTitle(`سفينة • لوحة ${safeName(g, viewer)}`);
  if (g.acceptedAt == null) return frame(embed.setDescription(g.status === 'pending' ? 'انتظر قبول التحدّي أولًا.' : conclusion(g)));
  const fleet = g.fleets[viewer], active = g.status === 'active', components = [];
  let description;
  if (g.phase === 'placement') {
    selection ||= defaultShipSelection(fleet);
    const { ship, row: r, column, direction } = selection, locked = !active || fleet.ready;
    const id = action => `ship:setup:${g.id}:${viewer}:${fleet.version}:${ship}:${r}:${column}:${direction}:${action}`;
    description = `${active ? fleet.ready ? '✅ أكدت جاهزيتك. انتظر خصمك؛ يبدأ اللعب تلقائيًا عند جاهزيته.' : '**ترتيب خاص بك** — اختر موقع أعلى يسار السفينة ثم اضغط **وضع السفينة**. زر التدوير يغيّر المعاينة؛ ثبّت التغيير بزر وضع السفينة.' : conclusion(g)}\n\nالسفن: **2×5، 1×5، 1×4، 1×3، 1×2، 1×2**.\nالمحدد: **${SHIPS[ship].name}**، البداية **${shipCoordinate(r * 10 + column)}**، الاتجاه **${direction === 'h' ? 'أفقي' : 'عمودي'}**.\n${active ? `تنتهي مهلة الترتيب <t:${Math.ceil(g.expiresAt / 1000)}:R>.` : ''}`;
    if (active && !fleet.ready) {
      try { shipCells(ship, selection); } catch { description += '\n⚠️ المعاينة خارج حدود البحر؛ غيّر الموقع أو الاتجاه.'; }
      components.push(select(id('ship'), 'اختر السفينة', SHIPS.map((s, index) => ({ label: `${fleet.ships[index] ? '✓ ' : ''}${s.name} (${s.width}×${s.length})`, value: String(index), default: index === ship })), locked));
      components.push(select(id('row'), 'صف البداية', Array.from({ length: 10 }, (_, index) => ({ label: `الصف ${'ABCDEFGHIJ'[index]}`, value: String(index), default: index === r })), locked));
      components.push(select(id('column'), 'عمود البداية', Array.from({ length: 10 }, (_, index) => ({ label: `العمود ${index + 1}`, value: String(index), default: index === column })), locked));
      components.push(rowOf(button(id('rotate'), 'تدوير'), button(id('place'), 'وضع السفينة', ButtonStyle.Primary),
        button(id('random'), 'عشوائي'), button(id('clear'), 'مسح الترتيب', ButtonStyle.Danger),
        button(id('ready'), 'جاهز', ButtonStyle.Success, !validFleet(fleet.ships))));
    }
  } else {
    const mine = g.turn === viewer, enemy = shipOpponent(g, viewer), shots = g.shots[viewer];
    description = `${active ? mine ? '**دورك الآن** — اختر الصف ثم اضغط الخانة للهجوم.' : `انتظر دورك؛ يلعب <@${g.turn}> الآن. استخدم تحديث لوحتي بعد حركة خصمك.` : conclusion(g)}\n${lastShot(g)}\n\nأغرقت **${sunkShips(g.fleets[enemy].ships, shots).length}** من **6** سفن.\n${active ? `مهلة الدور <t:${Math.ceil(g.expiresAt / 1000)}:R>.` : ''}`;
    if (active) {
      components.push(select(`ship:aim:${g.id}:${viewer}:${g.revision}`, 'اختر صف الهجوم (A–J)', Array.from({ length: 10 }, (_, r) => ({ label: `الصف ${'ABCDEFGHIJ'[r]}`, value: String(r), default: r === row })), !mine));
      if (Number.isInteger(row) && row >= 0 && row < 10) {
        const cells = Array.from({ length: 10 }, (_, col) => {
          const cell = row * 10 + col, shot = shots[cell];
          return button(`ship:fire:${g.id}:${viewer}:${g.revision}:${cell}`, `${shipCoordinate(cell)}${shot ? shot === 'hit' ? ' 🎯' : ' ×' : ''}`,
            shot === 'hit' ? ButtonStyle.Danger : ButtonStyle.Secondary, !mine || !!shot);
        });
        components.push(rowOf(...cells.slice(0, 5)), rowOf(...cells.slice(5)));
      }
    }
  }
  components.push(rowOf(button(`ship:refresh:${g.id}:${viewer}`, 'تحديث لوحتي', ButtonStyle.Primary)));
  const name = `ship-private-${g.id}-${viewer}-${g.revision}.png`;
  embed.setDescription(`${notice ? `${notice}\n\n` : ''}${description}`).setImage(`attachment://${name}`)
    .setFooter({ text: 'لوحتك الخاصة • يمكنك فتح لوحة محدثة من زر لوحتي في رسالة التحدّي' });
  return frame(embed, components, [{ attachment: shipPrivateBoard(g, viewer, { selection: g.phase === 'placement' && active && !fleet.ready ? selection : null, row }), name }]);
}

export function parseShipAction(i) {
  const value = i.customId || '', buttonPress = !!i.isButton?.(), menu = !!i.isStringSelectMenu?.();
  let m;
  if (buttonPress && (m = /^ship:v1:(\d{17,20}):(\d+):(accept|reject)$/.exec(value))) return { kind: m[3], id: m[1], revision: Number(m[2]) };
  if (buttonPress && (m = /^ship:open:(\d{17,20})$/.exec(value))) return { kind: 'open', id: m[1] };
  if (menu && (m = /^ship:row:(\d{17,20}):(\d+)$/.exec(value))) return { kind: 'aim', id: m[1], revision: Number(m[2]) };
  if (buttonPress && (m = /^ship:refresh:(\d{17,20}):(\d{17,20})$/.exec(value))) return { kind: 'refresh', id: m[1], owner: m[2] };
  if (menu && (m = /^ship:aim:(\d{17,20}):(\d{17,20}):(\d+)$/.exec(value))) return { kind: 'aim', id: m[1], owner: m[2], revision: Number(m[3]) };
  if (buttonPress && (m = /^ship:fire:(\d{17,20}):(\d{17,20}):(\d+):(\d{1,2})$/.exec(value))) return { kind: 'fire', id: m[1], owner: m[2], revision: Number(m[3]), cell: Number(m[4]) };
  if ((buttonPress || menu) && (m = /^ship:setup:(\d{17,20}):(\d{17,20}):(\d+):([0-5]):([0-9]):([0-9]):([hv]):(ship|row|column|rotate|place|random|clear|ready)$/.exec(value))) {
    if (['ship', 'row', 'column'].includes(m[8]) !== menu) return null;
    return { kind: 'setup', id: m[1], owner: m[2], version: Number(m[3]), selection: { ship: Number(m[4]), row: Number(m[5]), column: Number(m[6]), direction: m[7] }, move: m[8] };
  }
  return null;
}
async function publish(i, game, g, bot) {
  if (!g.messageId || !g.dirty) return;
  const channel = i.channel || await (bot || i.client)?.channels.fetch(g.channelId);
  if (channel?.guildId !== game.clanId || !channel.messages?.fetch) throw new Error('تعذر تحديث رسالة التحدّي؛ سيحاول البوت مجددًا.');
  const message = await channel.messages.fetch(g.messageId);
  const botId = (bot || i.client)?.user?.id;
  if (botId && message.author?.id !== botId) throw new Error('رسالة التحدّي غير صالحة.');
  await message.edit(shipPayload(g)); await game.displayed(g);
}
export function createShipHandler({ config, service, isBankMember, shipManager, bot, onError = () => {} }) {
  let displays = shipManager?.displays;
  return async i => {
    const action = parseShipAction(i), command = i.commandName === 'سفينة', help = i.customId === 'ship:help';
    if (!action && !command && !help) return false;
    const deny = content => i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    if (i.guildId !== config.clanGuildId || i.user.bot) { await deny('اللعبة لأعضاء سيرفر الكلان فقط.'); return true; }
    if (help) { await deny('اكتب: سفينة @العضو المبلغ، مثال: سفينة @العضو 1000، أو استخدم /سفينة. بعد القبول افتح ترتيب سفني، ضع السفن الست أو اضغط عشوائي ثم جاهز. الهجوم باختيار الصف ثم الخانة. الإصابة تعطي دورًا آخر؛ أغرق سفن خصمك الست للفوز.'); return true; }
    // Secret images can only replace an ephemeral message owned by this player.
    if (action?.owner && (action.owner !== i.user.id || !i.message?.flags?.has?.(MessageFlags.Ephemeral))) {
      await deny('هذه اللوحة الخاصة لصاحبها فقط؛ افتح لوحتك من رسالة التحدّي.'); return true;
    }
    const publicAction = action && ['accept', 'reject'].includes(action.kind), privateUpdate = !!action?.owner;
    if (publicAction || privateUpdate) await i.deferUpdate();
    else await i.deferReply(command ? {} : { flags: MessageFlags.Ephemeral });
    const game = service.shipGame;
    displays ||= gameDisplays(game);
    await displays.runSerial(action?.id || i.id, async () => {
      try {
        const eligible = id => isBankMember ? isBankMember(id) : bankMember(i, config, id);
        if (command) {
          const target = i.options.getUser('العضو'), member = target?.id ? await i.guild?.members?.fetch?.(target.id) : null;
          const g = await game.open({ id: i.id, x: i.user.id, o: target?.id, bot: !!target?.bot, channelId: i.channelId,
            amount: i.options.getInteger('المبلغ'), requireDelivery: true,
            names: { [i.user.id]: (i.member?.displayName || i.user.username || 'اللاعب الأزرق').slice(0, 60),
              [target?.id]: (member?.displayName || target?.globalName || target?.username || 'اللاعب الأحمر').slice(0, 60) } }, eligible);
          const message = await i.editReply(shipPayload(g));
          if (message?.id && !g.messageId) await game.bind(g.id, message.id);
          await game.displayed(g); return;
        }
        const input = { id: action.id, userId: i.user.id, channelId: i.channelId,
          ...(!action.owner ? { messageId: i.message?.id } : {}) };
        if (publicAction) {
          const { round: g, stale } = await playGameAction(game, { ...input, revision: action.revision, move: action.kind }, eligible);
          await i.editReply(shipPayload(g)); await game.displayed(g);
          if (stale) await i.followUp({ content: STALE_GAME_NOTICE, flags: MessageFlags.Ephemeral });
          return;
        }
        let g = await game.inspect(input, eligible), selection = null, row = null, notice = '';
        if (action.kind === 'setup' && g.status === 'active' && g.phase === 'placement') {
          selection = action.selection;
          if (action.version !== g.fleets[i.user.id].version) { notice = STALE_GAME_NOTICE; selection = null; }
          else if (['place', 'random', 'clear', 'ready'].includes(action.move)) {
            const result = await playGameAction(game, { ...input, move: action.move, version: action.version, ship: selection.ship, placement: selection }, eligible);
            g = result.round; notice = result.stale ? STALE_GAME_NOTICE : ''; selection = null;
          } else if (!g.fleets[i.user.id].ready) {
            if (action.move === 'rotate') selection = { ...selection, direction: selection.direction === 'h' ? 'v' : 'h' };
            else {
              const choice = i.values?.[0];
              if (!/^[0-9]$/.test(choice || '') || (action.move === 'ship' && Number(choice) > 5)) throw new Error('اختيار غير صالح.');
              if (action.move === 'ship') selection = { ...selection, ship: Number(choice), ...(g.fleets[i.user.id].ships[Number(choice)] || {}) };
              else selection = { ...selection, [action.move]: Number(choice) };
            }
          }
        } else if (action.kind === 'fire') {
          const result = await playGameAction(game, { ...input, revision: action.revision, move: 'fire', cell: action.cell }, eligible);
          g = result.round; notice = result.stale ? STALE_GAME_NOTICE : ''; row = Math.floor(action.cell / 10);
        } else if (action.kind === 'aim' && g.status === 'active') {
          if (g.phase !== 'battle') throw new Error('انتظر جاهزية الطرفين أولًا.');
          if (action.revision !== g.revision) notice = STALE_GAME_NOTICE;
          else {
            if (g.turn !== i.user.id) throw new Error('ليس دورك الآن.');
            if (!/^[0-9]$/.test(i.values?.[0] || '')) throw new Error('اختر صفًا من A إلى J.');
            row = Number(i.values[0]);
          }
        }
        await i.editReply(shipPrivatePayload(g, i.user.id, { selection, row, notice }));
        // Always edit the original public message with the public-only payload.
        // A failed edit leaves dirty=true for the manager to repair or refund.
        await publish(i, game, g, bot);
      } catch (error) {
        onError(error);
        const payload = { content: /[\u0600-\u06ff]/.test(error.message) ? error.message : 'تعذر إكمال الطلب؛ حاول مجددًا.', allowedMentions: { parse: [] } };
        if (publicAction || privateUpdate) await i.followUp({ ...payload, flags: MessageFlags.Ephemeral });
        else await i.editReply({ ...payload, embeds: [], components: [], attachments: [] });
      }
    });
    return true;
  };
}
export class ShipManager extends XoManager {
  constructor(ctx) { super({ ...ctx, game: ctx.service.shipGame, payload: shipPayload }); }
}
