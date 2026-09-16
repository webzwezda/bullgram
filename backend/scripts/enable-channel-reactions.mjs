#!/usr/bin/env node
/**
 * Разовый ops-скрипт: включает реакции канала через юзербота (MTProto
 * messages.setChatAvailableReactions).
 *
 * Причина (2026-09-16): в bullrun.ru реакции не включаются из приложения —
 * сервер Telegram отдаёт ошибку на переключателе, а автопостеру они нужны
 * для seed-реакций (расследование: 248x REACTION_INVALID в error.log).
 *
 * Использование (из backend/, на проде):
 *   node scripts/enable-channel-reactions.mjs [chatId]
 * По умолчанию: канал bullrun.ru (-1001323964374), юзербот Erik (8414225338),
 * список реакций = seed-конфиг канала (👎, 👍).
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { Api } from 'telegram';
import { UserbotService } from '../services/userbot.service.js';

const TG_ACCOUNT_ID = Number(process.env.USERBOT_TG_ACCOUNT_ID || 8414225338);
const CHANNEL = process.argv[2] || '-1001323964374';
const EMOJIS = ['👎', '👍'];

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const svc = new UserbotService(
    supabase,
    Number(process.env.TG_API_ID) || 4,
    process.env.TG_API_HASH || '014b35b6184100b085b0d0572f9b5103'
);

const { data: userbot, error } = await supabase
    .from('tg_accounts')
    .select('*, proxies(id, host, port, username, password, is_working)')
    .eq('tg_account_id', TG_ACCOUNT_ID)
    .single();
if (error || !userbot) {
    console.error('юзербот не найден:', error?.message || TG_ACCOUNT_ID);
    process.exit(1);
}
console.log(`юзербот: ${userbot.tg_username || userbot.id}; канал: ${CHANNEL}; реакции: ${EMOJIS.join(' ')}`);

const client = await svc.createAuthorizedClient(userbot);
try {
    const peer = await client.getInputEntity(CHANNEL);
    await client.invoke(new Api.messages.SetChatAvailableReactions({
        peer,
        availableReactions: new Api.ChatReactionsSome({
            reactions: EMOJIS.map((emoticon) => new Api.ReactionTypeEmoji({ emoticon }))
        })
    }));
    console.log(`OK — доступные реакции канала установлены: ${EMOJIS.join(' ')} (режим «некоторые»)`);
} catch (err) {
    console.error('FAIL:', err?.errorMessage || err?.message);
    process.exitCode = 1;
} finally {
    try { await client.disconnect(); } catch {}
}
