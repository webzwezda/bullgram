import fs from 'fs';
import path from 'path';
import axios from 'axios';
import {
    pendingGiftCodeInputs,
    pendingGiftCodeKey,
    pendingReferralWalletInputs,
    pendingReferralWalletKey
} from '../shared/pending-state.js';

async function downloadFile(url, destPath) {
    const writer = fs.createWriteStream(destPath);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

export function registerMessageHandlers(bot, { service, botId }) {
    bot.on('message', async (ctx) => {
        if (ctx.chat.type === 'private' && ctx.message?.text) {
            const pendingGiftCode = pendingGiftCodeInputs.get(pendingGiftCodeKey(botId, ctx.from.id));
            if (pendingGiftCode?.mode === 'redeem') {
                pendingGiftCodeInputs.delete(pendingGiftCodeKey(botId, ctx.from.id));

                if (Date.now() - Number(pendingGiftCode.requestedAt || 0) > 15 * 60 * 1000) {
                    await ctx.reply('Ввод кода устарел. Нажми кнопку «Ввести код» еще раз.');
                    return;
                }

                try {
                    const result = await service.redeemGiftAccessCode({
                        bot,
                        botId,
                        tgUserId: ctx.from.id,
                        code: ctx.message.text
                    });
                    if (result.error) {
                        await ctx.reply(`🎁 ${result.error}`);
                        return;
                    }

                    const linksText = result.inviteLinks.map((link, i) => `${i + 1}. <b>${link.title}</b>\n${link.url}`).join('\n\n');
                    const resourcesText = result.resourceTargets.length 
                        ? `\n\n📚 <b>Дополнительные материалы:</b>\n${result.resourceTargets.map((r, i) => `${i + 1}. <b>${r.title}</b>: ${r.url}`).join('\n')}`
                        : '';
                    const successText = `🎁 <b>ПРОМОКОД УСПЕШНО АКТИВИРОВАН!</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `${result.tariffTitle ? `<b>Тариф:</b> ${result.tariffTitle}\n` : ''}` +
                        `<b>Срок доступа:</b> <code>${result.durationText}</code>` +
                        `${result.expiresAt ? `\n<b>Доступ до:</b> <code>${new Date(result.expiresAt).toLocaleDateString('ru-RU')}</code>` : ''}\n\n` +
                        `📦 <b>Ваши ссылки для вступления:</b>\n${linksText}${resourcesText}\n\n` +
                        `⚠️ Все ссылки работают через запрос на вступление и закреплены за вашим аккаунтом.`;

                    const inlineKeyboard = [[{ text: '🔙 В главное меню', callback_data: 'back_to_main' }]];

                    await ctx.reply(successText, {
                        parse_mode: 'HTML',
                        disable_web_page_preview: true,
                        reply_markup: { inline_keyboard: inlineKeyboard }
                    });
                } catch (error) {
                    console.error('Ошибка активации gift code:', error);
                    await ctx.reply('Не получилось активировать код.');
                }
                return;
            }
 
            const pendingWallet = pendingReferralWalletInputs.get(pendingReferralWalletKey(botId, ctx.from.id));
            if (pendingWallet) {
                pendingReferralWalletInputs.delete(pendingReferralWalletKey(botId, ctx.from.id));
 
                if (Date.now() - Number(pendingWallet.requestedAt || 0) > 15 * 60 * 1000) {
                    await ctx.reply('Ввод кошелька устарел. Нажми кнопку в партнерке еще раз.');
                    return;
                }
 
                try {
                    const result = await service.saveReferralPayoutWallet(pendingWallet.ownerId, ctx.from.id, ctx.message.text);
                    if (result.error) {
                        await ctx.reply(result.error);
                        return;
                    }
 
                    const saveMsg = `👛 <b>КОШЕЛЕК СОХРАНЕН</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `Готово. Ваш TON-кошелек для выплат успешно сохранен:\n<code>${result.wallet.ton_wallet}</code>`;
                    await ctx.reply(saveMsg, {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '💸 Открыть партнерку', callback_data: 'referral_info' }],
                                [{ text: '🔙 В главное меню', callback_data: 'back_to_main' }]
                            ]
                        }
                    });
                } catch (error) {
                    console.error('Ошибка сохранения referral payout wallet:', error);
                    await ctx.reply('Не получилось сохранить TON-кошелек.');
                }
                return;
            }
        }
 
        if (!ctx.message || (!ctx.message.photo && !ctx.message.document)) return;
        if (ctx.chat.type !== 'private') return;
 
        const userId = ctx.from.id;
 
        try {
            const { data: invoices, error } = await service.supabase.from('invoices')
                .select('*').eq('tg_user_id', userId).eq('status', 'awaiting_receipt').order('created_at', { ascending: false }).limit(1);
            const invoice = invoices && invoices.length > 0 ? invoices[0] : null;
 
            if (error || !invoice) {
                const noWaitingText = `⚠️ <b>ОЖИДАНИЕ ОПЛАТЫ</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `Я не жду от вас чек в данный момент.\n\n` +
                    `Если вы ошиблись скриншотом — введите /start и начните процесс заново.`;
                return ctx.reply(noWaitingText, { parse_mode: 'HTML' });
            }
 
            let tariffName = 'Неизвестный тариф';
            if (invoice.tariff_id) {
                const { data: tariff } = await service.supabase.from('tariffs').select('title').eq('id', invoice.tariff_id).single();
                if (tariff) tariffName = tariff.title;
            }
 
            const ownerId = await service.getBotOwner(botId);
            const adminContext = await service.getBotAdminContext(botId, ownerId);
 
            if (!adminContext?.adminTgId) return ctx.reply('❌ Ошибка системы: у этого бота не указан Telegram ID админа.');
 
            let receiptFileUrl = null;
            let fileId = null;
            let extension = 'jpg';

            if (ctx.message.photo && ctx.message.photo.length > 0) {
                fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                extension = 'jpg';
            } else if (ctx.message.document) {
                fileId = ctx.message.document.file_id;
                const origName = ctx.message.document.file_name || '';
                const extMatch = origName.match(/\.([^.]+)$/);
                if (extMatch) {
                    extension = extMatch[1];
                } else {
                    extension = 'pdf';
                }
            }

            if (fileId) {
                try {
                    const fileLinkObj = await ctx.telegram.getFileLink(fileId);
                    const fileLinkUrl = typeof fileLinkObj === 'string' ? fileLinkObj : fileLinkObj.href;

                    const dir = path.join(process.cwd(), 'uploads', 'bot-receipts');
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }

                    const fileName = `${invoice.id}-${Date.now()}.${extension}`;
                    const destPath = path.join(dir, fileName);
                    await downloadFile(fileLinkUrl, destPath);
                    receiptFileUrl = `/uploads/bot-receipts/${fileName}`;
                } catch (err) {
                    console.error('Error downloading receipt file from Telegram:', err);
                }
            }

            const updatedPayload = {
                ...(invoice.payload || {}),
                receipt_file_url: receiptFileUrl
            };

            await service.supabase.from('invoices').update({ 
                status: 'wait_admin',
                payload: updatedPayload 
            }).eq('id', invoice.id);
            
            await service.logPaymentEvent({
                ownerId,
                invoiceId: invoice.id,
                provider: 'manual_rub',
                eventType: 'receipt_uploaded',
                status: 'wait_admin',
                payload: {
                    memo: invoice.memo,
                    tg_user_id: userId,
                    receipt_file_url: receiptFileUrl
                }
            });
 
            const captionForAdmin = `🔔 **Новый чек на проверку!**\n\nПокупатель: @${ctx.from.username || 'Без юзернейма'} (ID: \`${userId}\`)\nТариф: **${tariffName}**\nСумма: **${invoice.amount} RUB**\n\nНажмите кнопку ниже после проверки.`;
 
            await ctx.telegram.copyMessage(adminContext.adminTgId, ctx.chat.id, ctx.message.message_id, {
                caption: captionForAdmin, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '✅ Одобрить и выдать доступ', callback_data: `admin_approve_${invoice.memo}` }], [{ text: '❌ Отклонить (Фейк)', callback_data: `admin_reject_${invoice.memo}` }]]}
            });
 
            const successSentMsg = `✅ <b>ЧЕК ОТПРАВЛЕН</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `Чек успешно отправлен администратору на проверку!\n\n` +
                `Как только перевод будет подтвержден, бот мгновенно отправит вам ссылки на доступ.`;
            await ctx.reply(successSentMsg, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: '🔙 В главное меню', callback_data: 'back_to_main' }]] }
            });
        } catch (err) { await ctx.reply('❌ Произошла ошибка при отправке чека администратору.'); }
    });
}
