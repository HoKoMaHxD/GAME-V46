import { ActivityGate } from './activity-gate.js';
import { isUserMessage } from './message-channels.js';

export const SPAM_WINDOW_MS = 3000;
export const SPAM_CHANNELS = { clan: '1552646864682221650', arena: '1470732708559851673' };
export function isSpam(previousAt, at) {
  return Number.isSafeInteger(previousAt) && at >= previousAt && at - previousAt < SPAM_WINDOW_MS;
}
export class SpamMonitor {
  constructor({ store, service, config, canRun, actorId, clock = Date.now }) {
    Object.assign(this, { store, service, config, canRun, actorId, clock });
    this.gate = new ActivityGate();
  }
  get records() { return this.store.db.collection('spam_messages'); }
  accepts(message) {
    return isUserMessage(message) && ((message.guildId === this.config.clanGuildId && message.channelId === SPAM_CHANNELS.clan)
      || (message.guildId === this.config.arenaGuildId && message.channelId === SPAM_CHANNELS.arena));
  }
  async initialize() {
    await this.records.createIndex({ clanId: 1, userId: 1, channelId: 1, at: -1 });
    await this.records.createIndex({ clanId: 1, status: 1 });
    await this.records.createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 });
  }
  receive(message) {
    if (!this.canRun() || !this.accepts(message) || this.clock() - message.createdTimestamp > 120000) return Promise.resolve();
    return this.gate.runSerial(`${message.channelId}:${message.author.id}`, async () => {
      if (!this.canRun()) return;
      await this.store.requireLease(this.clock());
      const _id = `${this.config.clanGuildId}:${message.id}`;
      let record = await this.records.findOne({ _id });
      if (!record) {
        const previous = await this.records.findOne({ clanId: this.config.clanGuildId, userId: message.author.id,
          channelId: message.channelId, at: { $lte: message.createdTimestamp, $gt: this.service.resumedAt || 0 } }, { sort: { at: -1 } });
        const penalty = isSpam(previous?.at, message.createdTimestamp);
        record = { _id, clanId: this.config.clanGuildId, userId: message.author.id, channelId: message.channelId,
          messageId: message.id, at: message.createdTimestamp, status: penalty ? 'pending' : 'clear',
          purgeAt: new Date(this.clock() + 7 * 86400000) };
        await this.records.updateOne({ _id }, { $setOnInsert: record }, { upsert: true });
      }
      await this.apply(record);
    });
  }
  async apply(record) {
    if (record.status !== 'pending' || !this.canRun()) return;
    // Resets supersede old penalties; successful receipts prevent double debit on retry.
    if (record.at <= Math.max(this.service.bankCutoff(record.userId), this.service.resumedAt || 0)) {
      await this.records.updateOne({ _id: record._id }, { $set: { status: 'reset' } }); return;
    }
    await this.service.penalizeSpam({ userId: record.userId, actorId: this.actorId(), operationId: record.messageId,
      at: record.at, reason: `سبام: إرسال رسائل بفاصل أقل من 3 ثوانٍ في الشات ${record.channelId}` });
    await this.store.requireLease(this.clock());
    await this.records.updateOne({ _id: record._id }, { $set: { status: 'paid' } });
  }
  async tick() {
    if (!this.canRun()) return;
    for (const record of await this.records.find({ clanId: this.config.clanGuildId, status: 'pending' }).sort({ at: 1 }).limit(100).toArray()) {
      await this.gate.runSerial(`${record.channelId}:${record.userId}`, () => this.apply(record));
    }
  }
}
