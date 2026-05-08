import { OfficialBotService } from '../services/official-bot.service.js';
import { decrypt } from '../utils/crypto.js';

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50;
const POLL_INTERVAL_MS = 2000;

function inferUpdateType(payload) {
    if (!payload || typeof payload !== 'object') return 'unknown';
    return Object.keys(payload).find((key) => key !== 'update_id') || 'unknown';
}

export const startOfficialBotWebhookQueue = (supabase) => {
    const officialBotService = new OfficialBotService(null);
    officialBotService.supabase = supabase;

    const activeBots = new Map();

    function getOrCreateBot(botId, token, username, role) {
        const existing = officialBotService.getBot(botId);
        if (existing) return existing;

        officialBotService.startWebhookBot(botId, token, username, role);
        return officialBotService.getBot(botId);
    }

    async function loadBotAccount(botId) {
        const { data, error } = await supabase
            .from('tg_accounts')
            .select('id, session_data, tg_username, bot_role')
            .eq('id', botId)
            .eq('account_type', 'bot')
            .maybeSingle();

        if (error || !data) return null;
        return {
            id: data.id,
            token: decrypt(data.session_data),
            username: data.tg_username,
            role: data.bot_role || 'sales'
        };
    }

    async function processBatch() {
        const { data: updates, error } = await supabase
            .from('official_bot_update_queue')
            .select('id, bot_id, payload, attempts')
            .eq('status', 'queued')
            .order('created_at', { ascending: true })
            .limit(BATCH_SIZE);

        if (error) {
            console.error('[WebhookQueue] Ошибка чтения очереди:', error.message);
            return;
        }

        if (!updates || updates.length === 0) return;

        console.log(`[WebhookQueue] Обработка ${updates.length} апдейтов из очереди`);

        for (const row of updates) {
            const { error: lockError } = await supabase
                .from('official_bot_update_queue')
                .update({
                    status: 'processing',
                    attempts: row.attempts + 1
                })
                .eq('id', row.id)
                .eq('status', 'queued');

            if (lockError) {
                console.error('[WebhookQueue] Ошибка блокировки:', lockError.message);
                continue;
            }

            try {
                let bot = officialBotService.getBot(row.bot_id);
                if (!bot) {
                    console.log(`[WebhookQueue] Загрузка бота ${row.bot_id} из БД`);
                    const account = await loadBotAccount(row.bot_id);
                    if (!account) {
                        await supabase
                            .from('official_bot_update_queue')
                            .update({ status: 'dead', last_error: 'Bot account not found' })
                            .eq('id', row.id);
                        continue;
                    }
                    bot = getOrCreateBot(account.id, account.token, account.username, account.role);
                    if (!bot) {
                        await supabase
                            .from('official_bot_update_queue')
                            .update({ status: 'dead', last_error: 'Failed to create bot instance' })
                            .eq('id', row.id);
                        continue;
                    }
                }

                const updateType = inferUpdateType(row.payload);
                console.log(`[WebhookQueue] handleUpdate ${row.id} type=${updateType}`);

                await bot.handleUpdate(row.payload);

                await supabase
                    .from('official_bot_update_queue')
                    .update({
                        status: 'done',
                        processed_at: new Date().toISOString()
                    })
                    .eq('id', row.id);

                console.log(`[WebhookQueue] ✅ Update ${row.id} обработан`);
            } catch (err) {
                const isDead = row.attempts + 1 >= MAX_ATTEMPTS;
                console.error(
                    `[WebhookQueue] ❌ Ошибка обработки update ${row.id} (attempt ${row.attempts + 1}/${MAX_ATTEMPTS}):`,
                    err.message
                );
                await supabase
                    .from('official_bot_update_queue')
                    .update({
                        status: isDead ? 'dead' : 'failed',
                        last_error: err.message?.slice(0, 500) || 'Unknown error'
                    })
                    .eq('id', row.id);

                if (!isDead) {
                    await supabase
                        .from('official_bot_update_queue')
                        .update({ status: 'queued' })
                        .eq('id', row.id);
                }
            }
        }
    }

    setInterval(processBatch, POLL_INTERVAL_MS);
    console.log(`[WebhookQueue] Процессор запущен (интервал ${POLL_INTERVAL_MS}ms, батч ${BATCH_SIZE})`);
};
