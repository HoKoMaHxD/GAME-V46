import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { canManageBot, MANAGEMENT_DENIED } from './permissions.js';
import { isId } from './config.js';

export const PAUSED_MESSAGE = 'البوت متوقف بالكامل بقرار الإدارة. لإعادة تشغيله استخدم /البنك تشغيل.';
export function buildRuntimeCommand() {
  return new SlashCommandBuilder().setName('البنك').setDescription('تشغيل البوت بالكامل أو إيقاف جميع وظائفه واحتسابه')
    .setDefaultMemberPermissions(null)
    .addSubcommand(s => s.setName('تشغيل').setDescription('تشغيل جميع وظائف البوت واستئناف الاحتساب من الآن'))
    .addSubcommand(s => s.setName('ايقاف').setDescription('إيقاف جميع وظائف البوت والاحتساب حتى تشغيله مجددًا'));
}
export class RuntimeControl {
  constructor({ store, service, clock = Date.now, onChanged = async () => {}, onResumed = async () => {} }) {
    Object.assign(this, { store, service, clock, onChanged, onResumed }); this.tail = Promise.resolve();
  }
  load(settings) {
    this.service.paused = settings?.runtimeControl?.enabled === false;
    this.service.resumedAt = settings?.runtimeControl?.resumedAt || 0;
  }
  change({ enabled, actorId, operationId }) {
    const operation = this.tail.then(async () => {
      if (typeof enabled !== 'boolean' || !isId(actorId) || !isId(operationId)) throw new Error('طلب تشغيل البوت غير صالح.');
      // Stop ingress immediately; finish earlier atomic operations before committing the switch.
      this.service.paused = true;
      let state;
      try {
        state = await this.service.gate.exclusive(async () => {
          await this.store.requireLease(this.clock());
          const previous = (await this.store.settings()).runtimeControl;
          if (previous?.operationId && BigInt(operationId) <= BigInt(previous.operationId)) {
            if (previous.operationId !== operationId) throw new Error('طلب قديم؛ استخدم أمر البنك مجددًا.');
            return previous;
          }
          const now = this.clock();
          const next = { enabled, actorId, operationId, changedAt: now,
            resumedAt: enabled && previous?.enabled === false ? now : previous?.resumedAt || 0 };
          try {
            await this.store.db.collection('settings').updateOne({ _id: this.store.settingsId }, { $set: { runtimeControl: next } }, { upsert: true });
          } catch (error) {
            const saved = (await this.store.settings()).runtimeControl;
            if (saved?.operationId !== operationId) throw error;
            return saved;
          }
          return next;
        });
      } catch (error) {
        try { this.load(await this.store.settings()); } catch { this.service.paused = true; }
        throw error;
      }
      // Keep all event consumers stopped until voice and game boundaries are reset.
      this.service.resumedAt = state.resumedAt;
      await this.onChanged(state.enabled);
      this.load({ runtimeControl: state });
      if (state.enabled) await this.onResumed();
      return state;
    });
    this.tail = operation.catch(() => {}); return operation;
  }
}
export function createRuntimeHandler({ config, access, runtimeControl }) {
  return async interaction => {
    if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'البنك') return false;
    if (!canManageBot(interaction, config, access?.roleId)) {
      await interaction.reply({ content: MANAGEMENT_DENIED, flags: MessageFlags.Ephemeral }); return true;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const enabled = interaction.options.getSubcommand() === 'تشغيل';
      const state = await runtimeControl.change({ enabled, actorId: interaction.user.id, operationId: interaction.id });
      await interaction.editReply({ content: state.enabled
        ? '✅ تم تشغيل البوت بالكامل. يستأنف الاحتساب من الآن دون احتساب فترة الإيقاف.'
        : '⛔ تم إيقاف البوت بالكامل: الاحتساب، الرواتب، الجوائز، الألعاب، النهب، المزادات، خصم السبام والتنبيهات. الحالة محفوظة بعد إعادة التشغيل. استخدم /البنك تشغيل للاستئناف.' });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${error.message}` });
    }
    return true;
  };
}
