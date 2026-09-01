import { Router } from 'express';
import { rateLimit } from '../middlewares/rate-limit.middleware.js';

// Публичные заявки на доступ к сайту (режим Normal, без юзерботов и прокси).
// Форма: /access-request на сайте. Заявки складываются в Supabase и
// дублируются админу в Telegram (бот авторизации).

const TELEGRAM_BOT_TOKEN = String(process.env.TG_BOT_TOKEN || '').trim();
const TELEGRAM_ADMIN_CHAT_ID = String(process.env.TG_ADMIN_CHAT_ID || '').trim();

function clamp(value, max) {
    return String(value ?? '').trim().slice(0, max);
}

async function notifyAdmin(request) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_ID) {
        return { notified: false, reason: 'telegram not configured' };
    }
    try {
        const text = [
            '♿ Заявка на особый доступ (Normal)',
            `Имя: ${request.name}`,
            `Контакт: ${request.contact}`,
            request.note ? `Комментарий: ${request.note}` : null,
            `Дата: ${new Date().toLocaleString('ru-RU')}`
        ].filter(Boolean).join('\n');

        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_ADMIN_CHAT_ID, text })
        });
        const data = await response.json();
        return { notified: data?.ok === true, reason: data?.description || null };
    } catch (error) {
        return { notified: false, reason: error?.message || 'unknown' };
    }
}

export function accessRequestRoutes(supabase) {
    const router = Router();

    const limiter = rateLimit({
        windowMs: 60 * 60 * 1000,
        max: 5,
        message: 'Слишком много заявок с этого адреса. Напишите нам в Telegram — примем заявку вручную.'
    });

    router.post('/', limiter, async (req, res) => {
        // Honeypot: скрытое поле для людей заполнено — значит, это бот.
        if (String(req.body?.website ?? '').trim() !== '') {
            return res.status(200).json({ ok: true });
        }

        const name = clamp(req.body?.name, 100);
        const contact = clamp(req.body?.contact, 100);
        const note = clamp(req.body?.note, 500);

        if (name.length < 2) {
            return res.status(400).json({ ok: false, error: 'Укажите имя (минимум 2 символа)' });
        }
        if (contact.length < 3) {
            return res.status(400).json({ ok: false, error: 'Укажите контакт — Telegram или email' });
        }

        const { data, error } = await supabase
            .from('access_requests')
            .insert({ name, contact, note: note || null })
            .select('id, created_at')
            .single();

        if (error) {
            console.error('[access-requests] insert failed:', error.message);
            return res.status(500).json({ ok: false, error: 'Не удалось сохранить заявку. Напишите нам в Telegram — примем вручную.' });
        }

        const notify = await notifyAdmin({ name, contact, note });
        if (!notify.notified) {
            console.warn('[access-requests] telegram notify skipped/failed:', notify.reason);
        }

        return res.status(201).json({ ok: true, id: data.id });
    });

    return router;
}
