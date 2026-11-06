// Join-фаза подготовки рассылки: вступления юзерботов в целевые чаты,
// запись факта join'а для cleanup и env-тюнинг темпа. Выделено из
// broadcast-preparation.service.js при разрезке под pre-commit лимит:
// метод класса стал однострочным делегатом, инстанс сервиса передаётся
// первым аргументом (service).
import { classifyTelegramError } from '../../utils/telegram-error-events.js';
import { scanChatIdsCache } from './phase-scan.js';

function joinsPerHour() {
    const value = Number(process.env.USERBOT_JOIN_PER_HOUR);
    return Number.isFinite(value) && value > 0 ? value : 4;
}

function joinSleepMs() {
    const value = Number(process.env.USERBOT_JOIN_SLEEP_MS);
    return Number.isFinite(value) && value >= 5000 ? value : 45000;
}

function parseFloodWaitSeconds(error) {
    const raw = String(error?.errorMessage || error?.message || error?.description || '');
    const match = raw.match(/FLOOD_WAIT_(\d+)/i) || raw.match(/RETRY AFTER (\d+)/i);
    return match ? Number(match[1]) : null;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function jitter(baseMs) {
    return Math.round(baseMs * (0.85 + Math.random() * 0.3));
}

// channels.tg_chat_id хранится в MARKED-форме ('-100{id}' для каналов/supergroups, '-{id}' для
// basic-групп), а Telegram (joinChatByInvite) отдаёт голые положительные id. Cleanup сверяет
// recorded tg_chat_id с channels.tg_chat_id — в join-строку пишем только marked, иначе протекция
// не матчится и cleanup выкинет юзербота из собственного канала владельца.
export function toMarkedChatId(kind, rawId) {
    const value = String(rawId ?? '').trim();
    if (!value || value === 'null') return null;
    if (value.startsWith('-')) return value; // уже marked — оставляем как есть
    return String(kind) === 'group' ? `-${value}` : `-100${value}`;
}

// Приоритет: 1) target.chat_id уже marked (пришёл из channels) — берём его;
// 2) иначе выводим из joined.kind; 3) защита от двойного маркирования — внутри toMarkedChatId.
export function resolveMarkedChatId(targetChatId, kind, rawId) {
    const target = String(targetChatId ?? '').trim();
    if (target.startsWith('-')) return target;
    return toMarkedChatId(kind, rawId);
}

// Факт join'а «ради кампании» — источник истины для cleanup
// (jobs/broadcast-membership-cleanup.job.js): кто записан здесь — выходит по окончании
// рассылки. Всё, что не записано (старые membership, известные диалоги), cleanup не трогает.
// chatId ждём уже в MARKED-форме (см. resolveMarkedChatId в phaseJoin).
// Ошибка записи не должна ломать join-флоу — warn + continue.
export async function recordPreparationJoin(supabase, { ownerId, preparationId, userbotId, chatId, chatTitle = null, grantedAdmin = false }) {
    try {
        const tgChatId = String(chatId ?? '').trim();
        if (!tgChatId || tgChatId === 'null') return;
        const { data: existing } = await supabase
            .from('broadcast_preparation_joins')
            .select('id, granted_admin')
            .eq('preparation_id', preparationId)
            .eq('userbot_id', String(userbotId))
            .eq('tg_chat_id', tgChatId)
            .limit(1)
            .maybeSingle();
        if (existing) {
            if (grantedAdmin && !existing.granted_admin) {
                await supabase
                    .from('broadcast_preparation_joins')
                    .update({ granted_admin: true })
                    .eq('id', existing.id);
            }
            return;
        }
        const { error: insertError } = await supabase.from('broadcast_preparation_joins').insert({
            owner_id: ownerId,
            preparation_id: preparationId,
            userbot_id: String(userbotId),
            tg_chat_id: tgChatId,
            chat_title: chatTitle || null,
            granted_admin: !!grantedAdmin
        });
        if (insertError) {
            console.warn(`[broadcast-preparation] не записали join ${preparationId}/${userbotId}:`, insertError.message || insertError);
        }
    } catch (error) {
        console.warn(`[broadcast-preparation] не записали join ${preparationId}/${userbotId}:`, error?.message || error);
    }
}

export async function phaseJoin(service, preparation) {
    const ownerId = preparation.owner_id;
    await service.setStatus(preparation.id, 'joining');

    const rawPool = await service.loadPoolUserbots(ownerId, preparation.userbot_ids);
    const targets = await service.buildJoinTargets(preparation);
    const externalTargets = preparation.external_targets || [];
    const knownChats = scanChatIdsCache.get(preparation.id);

    // Сканные диалоги должны переживать рестарт процесса: объединяем in-memory кэш
    // с persisted-набором из phase_detail.scanned_chats (пишет phaseScan).
    // null = скана нет вовсе → юзербот не вступаем вслепую: он может уже быть
    // участником цели, и после join'а cleanup выкинет его, хотя тот был там раньше.
    const persistedScan = preparation.phase_detail?.scanned_chats || {};
    const knownChatsFor = (userbotId) => {
        const cached = knownChats?.get(String(userbotId));
        const persisted = persistedScan[String(userbotId)];
        if (!cached && !(Array.isArray(persisted) || persisted instanceof Set)) return null;
        const merged = new Set([...(persisted || [])].map(String));
        for (const id of cached || []) merged.add(String(id));
        return merged;
    };
    const pool = [];
    for (const userbot of rawPool) {
        if (knownChatsFor(userbot.id) === null) {
            console.warn(`[broadcast-preparation] ${preparation.id}: для @${userbot.tg_username || userbot.id} нет скана диалогов — не вступаем вслепую, юзербот пропущен`);
            continue;
        }
        pool.push(userbot);
    }

    const pausedUntil = new Map(); // userbot_id -> ts
    const joinStates = new Map(); // `${scope}:${raw}:${userbot_id}` -> 'done' | 'failed'
    let joinsDone = 0;
    const totalOps = targets.length * pool.length;

    let rounds = 0;
    while (rounds < 200) {
        const current = await service.getPreparationRow(null, preparation.id);
        if (!current || current.status !== 'joining') return;

        let progressed = false;
        let allDone = true;

        for (const target of targets) {
            if (target.raw == null && target.scope === 'owner') {
                continue; // приватный канал без юзернейма — обработаем отдельно ниже
            }
            for (const userbot of pool) {
                const key = `${target.scope}:${target.raw}:${userbot.id}`;
                if (joinStates.get(key) === 'done' || joinStates.get(key) === 'failed') continue;
                allDone = false;

                // JoinChannel идемпотентен: повторный вызов не падает USER_ALREADY_PARTICIPANT, но жжёт квоту —
                // если по скану диалогов (кэш ∪ persisted) юзербот уже в канале, отмечаем done без похода в Telegram
                if (target.scope === 'owner' && target.chat_id && knownChatsFor(userbot.id)?.has(String(target.chat_id))) {
                    joinStates.set(key, 'done');
                    joinsDone += 1;
                    progressed = true;
                    await service.updatePhaseDetail(preparation.id, { joins: { done: joinsDone, total: totalOps } });
                    continue;
                }

                const pauseTs = pausedUntil.get(userbot.id) || 0;
                if (Date.now() < pauseTs) continue;
                if ((await service.countRecentJoins(userbot.id)) >= joinsPerHour()) continue;

                try {
                    const joined = await service.userbotService.joinChatByInvite(userbot, { inviteLink: target.raw });
                    joinStates.set(key, 'done');
                    joinsDone += 1;
                    progressed = true;
                    await service.supabase.from('userbot_join_log').insert({ userbot_id: userbot.id, target: target.raw });

                    const chatId = joined?.chat_id ? String(joined.chat_id) : target.chat_id;
                    const accessHash = joined?.access_hash || null;
                    // успешный join именно в этот прогон — записываем для cleanup
                    // (USER_ALREADY_PARTICIPANT и skip по скану диалогов НЕ пишем: там юзербот был раньше);
                    // tg_chat_id приводим к MARKED-форме channels.tg_chat_id, иначе протекция cleanup не матчится
                    const markedChatId = resolveMarkedChatId(target.chat_id, joined?.kind, chatId);
                    await recordPreparationJoin(service.supabase, {
                        ownerId,
                        preparationId: preparation.id,
                        userbotId: userbot.id,
                        chatId: markedChatId,
                        chatTitle: joined?.title || target.title || null
                    });
                    if (chatId) {
                        try {
                            const confirmed = await service.scanChatParticipants(userbot, chatId, accessHash);
                            await service.applyConfirmedTouchpoints(preparation.id, userbot.id, confirmed, 'access_hash', chatId);
                        } catch (scanError) {
                            const scanMessage = String(scanError?.message || scanError);
                            if (scanMessage.toUpperCase().includes('CHAT_ADMIN_REQUIRED') && chatId) {
                                const granted = await service.tryGrantAdminRights(preparation, pool, userbot, chatId, target.raw);
                                if (granted) {
                                    // админку выдали в этом прогоне — cleanup учтёт granted_admin
                                    await recordPreparationJoin(service.supabase, {
                                        ownerId,
                                        preparationId: preparation.id,
                                        userbotId: userbot.id,
                                        chatId: markedChatId,
                                        chatTitle: joined?.title || target.title || null,
                                        grantedAdmin: true
                                    });
                                    try {
                                        const confirmed = await service.scanChatParticipants(userbot, chatId, accessHash);
                                        await service.applyConfirmedTouchpoints(preparation.id, userbot.id, confirmed, 'access_hash', chatId);
                                    } catch (retryError) {
                                        await service.updatePhaseDetail(preparation.id, {
                                            errors: [`Повторный скан участников ${target.raw}: ${String(retryError?.message || retryError).slice(0, 200)}`]
                                        });
                                    }
                                } else {
                                    await service.updatePhaseDetail(preparation.id, {
                                        admin_hints: [`Скан участников ${target.raw}: Telegram отдаёт список участников канала только админам. Сделай юзербота админом этого канала и нажми «Проверить снова» — точка касания сейчас считается по общему чату.`]
                                    });
                                }
                            } else {
                                await service.updatePhaseDetail(preparation.id, {
                                    errors: [`Скан участников ${target.raw}: ${scanMessage.slice(0, 200)}`]
                                });
                            }
                        }
                    }

                    if (target.scope === 'external' && target.index != null) {
                        const nextExternals = [...externalTargets];
                        nextExternals[target.index] = {
                            ...nextExternals[target.index],
                            kind: joined?.kind || 'unknown',
                            chat_id: chatId,
                            title: joined?.title || null,
                            status: 'joined'
                        };
                        await service.supabase
                            .from('broadcast_preparations')
                            .update({ external_targets: nextExternals, updated_at: new Date().toISOString() })
                            .eq('id', preparation.id);
                    }
                } catch (error) {
                    const message = String(error?.message || error?.errorMessage || error);
                    const classification = classifyTelegramError(error);
                    const floodSeconds = parseFloodWaitSeconds(error);

                    if (message.toUpperCase().includes('USER_ALREADY_PARTICIPANT')) {
                        joinStates.set(key, 'done');
                        joinsDone += 1;
                        progressed = true;
                        await service.updatePhaseDetail(preparation.id, { joins: { done: joinsDone, total: totalOps } });
                        continue;
                    }
                    if (floodSeconds) {
                        pausedUntil.set(userbot.id, Date.now() + Math.min(floodSeconds, 3600) * 1000 + 30_000);
                        await service.updatePhaseDetail(preparation.id, {
                            joins: { done: joinsDone, total: totalOps },
                            errors: [`Flood wait @${userbot.tg_username || userbot.id}: пауза ${floodSeconds}с на ${target.raw}`]
                        });
                        continue;
                    }
                    joinStates.set(key, 'failed');
                    progressed = true;
                    await service.updatePhaseDetail(preparation.id, {
                        joins: { done: joinsDone, total: totalOps },
                        errors: [`Вступление ${target.raw} через @${userbot.tg_username || userbot.id}: ${message.slice(0, 200)}`]
                    });
                    if (classification.restriction_kind === 'account_flagged' || classification.restriction_kind === 'session_revoked') {
                        pausedUntil.set(userbot.id, Date.now() + 24 * 60 * 60 * 1000);
                    }
                    if (target.scope === 'external' && target.index != null) {
                        const nextExternals = [...externalTargets];
                        nextExternals[target.index] = {
                            ...nextExternals[target.index],
                            status: 'failed',
                            error: message.slice(0, 300)
                        };
                        await service.supabase
                            .from('broadcast_preparations')
                            .update({ external_targets: nextExternals, updated_at: new Date().toISOString() })
                            .eq('id', preparation.id);
                    }
                }

                await service.updatePhaseDetail(preparation.id, { joins: { done: joinsDone, total: totalOps } });
                await sleep(jitter(joinSleepMs()));
            }
        }

        if (allDone) break;

        const stillPending = Array.from(joinStates.entries()).filter(([, state]) => state !== 'done' && state !== 'failed').length;
        const deferredKeys = targets.length * pool.length - Array.from(joinStates.values()).filter(state => state === 'done' || state === 'failed').length;
        if (!progressed && deferredKeys > 0) {
            const minPause = Math.min(...Array.from(pausedUntil.values()).filter(ts => ts > Date.now()).concat(Date.now() + 10 * 60 * 1000));
            const waitMs = Math.min(Math.max(minPause - Date.now(), 30_000), 10 * 60 * 1000);
            await service.updatePhaseDetail(preparation.id, {
                joins: { done: joinsDone, total: totalOps },
                note: `Ждём квоту на вступления (${stillPending || deferredKeys} осталось) — пауза ${Math.round(waitMs / 60000)} мин`
            });
            await sleep(waitMs);
        } else if (!progressed) {
            break;
        }

        rounds += 1;
    }

    await service.setStatus(preparation.id, 'recomputing');
}
