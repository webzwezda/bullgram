/**
 * Cron-задача: Мониторинг прав официальных ботов в каналах и чатах.
 * Запускается каждые 12 часов.
 * Выполняет запросы к Telegram API строго последовательно с паузой в 1 секунду.
 */
import { Telegraf } from 'telegraf';
import { decrypt } from '../utils/crypto.js';
import { SalesContourService } from '../services/sales-contour.service.js';
import { ContourAdminRightsService } from '../services/contour-admin-rights.service.js';

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 часов
const SERIAL_DELAY_MS = 1000; // 1 секунда паузы между проверками

const TARGET_FIELDS = {
    public_channel: 'public_channel_id',
    paid_channel: 'paid_channel_id',
    public_chat: 'public_chat_id',
    paid_chat: 'paid_chat_id'
};

export const startBotRightsMonitor = (supabase) => {
    const salesContourService = new SalesContourService(supabase);

    async function runMonitor() {
        console.log('[bot-rights-monitor] Starting background check...');
        // Один инстанс сервиса ensure-admin на весь прогон (переиспользуется между контурами).
        const contourAdminRightsService = new ContourAdminRightsService(supabase);
        try {
            // Загружаем все контуры, у которых настроен хотя бы один ресурс
            const { data: contours, error } = await supabase
                .from('sales_bot_contours')
                .select(`
                    bot_id,
                    owner_id,
                    public_channel_id,
                    paid_channel_id,
                    public_chat_id,
                    paid_chat_id,
                    tg_accounts!sales_bot_contours_bot_id_fkey (
                        id,
                        tg_account_id,
                        tg_username,
                        session_data
                    )
                `);

            if (error) throw error;
            if (!contours || contours.length === 0) {
                console.log('[bot-rights-monitor] No active contours found.');
                return;
            }

            for (const contour of contours) {
                const botAccount = contour.tg_accounts;
                if (!botAccount) continue;

                const botId = botAccount.id;
                const ownerId = contour.owner_id;
                const botTelegramId = String(botAccount.tg_account_id || '').trim();
                const sessionData = botAccount.session_data;

                if (!sessionData || !botTelegramId) {
                    console.warn(`[bot-rights-monitor] Skipping bot ${botId} due to missing session or tg_account_id`);
                    continue;
                }

                // Дешифруем токен
                let token = '';
                try {
                    token = decrypt(sessionData);
                } catch (decErr) {
                    console.error(`[bot-rights-monitor] Token decryption failed for bot ${botId}:`, decErr.message);
                    continue;
                }

                if (!token) continue;

                let botApi;
                try {
                    botApi = new Telegraf(token).telegram;
                } catch (err) {
                    console.error(`[bot-rights-monitor] Failed to init Telegraf for bot ${botId}:`, err.message);
                    continue;
                }

                // Перебираем все 4 возможных типа ресурсов
                for (const [targetType, fieldName] of Object.entries(TARGET_FIELDS)) {
                    const channelId = contour[fieldName];
                    if (!channelId) continue;

                    // Пауза перед каждым запросом для защиты от перегрузки CPU и Telegram rate-limit
                    await new Promise(resolve => setTimeout(resolve, SERIAL_DELAY_MS));

                    try {
                        // Загружаем инфо о канале
                        const { data: channel, error: channelErr } = await supabase
                            .from('channels')
                            .select('id, title, tg_chat_id')
                            .eq('id', channelId)
                            .single();

                        if (channelErr || !channel?.tg_chat_id) {
                            console.warn(`[bot-rights-monitor] Channel ${channelId} not found or missing chat_id`);
                            continue;
                        }

                        console.log(`[bot-rights-monitor] Checking bot ${botTelegramId} in chat ${channel.tg_chat_id} (${targetType})...`);

                        // Получаем статус бота в чате
                        await salesContourService.getBotChatRights(
                            ownerId,
                            { bot_id: botId, target: targetType },
                            botApi
                        );
                    } catch (checkErr) {
                        console.error(`[bot-rights-monitor] Error checking rights for bot ${botId} on target ${targetType}:`, checkErr.message);

                        // Если проверка упала из-за того, что бот выгнан или не имеет доступа, обновим статус в БД
                        try {
                            const isForbidden = String(checkErr.message).includes('forbidden') || checkErr.statusCode === 409;
                            await supabase
                                .from('sales_bot_contour_rights')
                                .upsert({
                                    owner_id: ownerId,
                                    bot_id: botId,
                                    channel_id: channelId,
                                    target: targetType,
                                    status: isForbidden ? 'error' : 'needs_attention',
                                    message: `Ошибка автопроверки: ${checkErr.message}`,
                                    checked_at: new Date().toISOString(),
                                    updated_at: new Date().toISOString()
                                }, { onConflict: 'bot_id,target' });
                        } catch (dbSaveErr) {
                            console.error(`[bot-rights-monitor] Failed to save error status to DB:`, dbSaveErr.message);
                        }
                    }
                }

                // ensure-admin: самовосстановление прав юзерботов контура (добор
                // can_restrict_members и т.п.). autoJoin=false — монитор никогда не
                // вступает сам: нет членства → состояние missing_membership, без вступления.
                // repairMode=true — права самого бота только что проверены выше, не дублируем.
                try {
                    const { data: bindings, error: bindingsError } = await supabase
                        .from('official_bot_userbot_bindings')
                        .select('userbot_id')
                        .eq('bot_id', botId)
                        .eq('is_active', true);

                    if (bindingsError) throw bindingsError;

                    if ((bindings || []).length > 0) {
                        console.log(`[bot-rights-monitor] ensure-admin for bot ${botId} (${bindings.length} userbot bindings)...`);
                        await contourAdminRightsService.ensureAll(ownerId, {
                            botId,
                            autoJoin: false,
                            repairMode: true
                        });
                    }
                } catch (ensureErr) {
                    console.error(`[bot-rights-monitor] ensure-admin failed for bot ${botId}:`, ensureErr.message);
                }
            }
        } catch (globalErr) {
            console.error('[bot-rights-monitor] Global error in monitor loop:', globalErr.message);
        }
        console.log('[bot-rights-monitor] Check completed.');
    }

    // Запускаем через 5 минут после старта сервера, чтобы не забивать инициализацию.
    // Прогон последовательный: при сотнях контуров он идёт десятки минут, поэтому
    // перекрывать тики нельзя — пропускаем, если предыдущий ещё не дошёл до конца.
    // Guard общий и для первого запуска: зависший стартовый прогон не должен
    // перекрываться первым тиком интервала.
    let monitorRunning = false;
    const runGuarded = async () => {
        if (monitorRunning) {
            console.warn('[bot-rights-monitor] previous run still in progress, skipping tick');
            return;
        }
        monitorRunning = true;
        try {
            await runMonitor();
        } finally {
            monitorRunning = false;
        }
    };
    setTimeout(() => {
        runGuarded();
        setInterval(runGuarded, CHECK_INTERVAL_MS);
    }, 5 * 60 * 1000);
};
