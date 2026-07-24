import { createClient } from '@supabase/supabase-js';
import { loadProfileForUser } from '../utils/agent-mcp-auth.js';

// Инициализация Supabase для middleware
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * Middleware для проверки авторизации пользователя
 * Проверяет JWT токен из заголовка Authorization и добавляет пользователя в req.user
 */
export const authenticateUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Отсутствует или неверный Authorization заголовок' });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) return res.status(401).json({ error: 'Недействительный токен' });
    req.user = user;
    try {
        req.profile = await loadProfileForUser(supabase, user);
        next();
    } catch (profileError) {
        return res.status(500).json({ error: profileError.message || 'Не удалось загрузить профиль пользователя.' });
    }
};

/**
 * Опциональная авторизация: если JWT есть и валиден — ставит req.user,
 * если нет/просрочен/невалиден — req.user = null и пропускает дальше.
 * Не загружает profile (не нужно для optional-flow).
 */
export const optionalAuthenticateUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        req.user = null;
        return next();
    }
    try {
        const token = authHeader.split(' ')[1];
        const { data: { user } } = await supabase.auth.getUser(token);
        req.user = user || null;
    } catch {
        req.user = null;
    }
    next();
};

export const requireObserverRole = (req, res, next) => {
    if (req.profile?.role !== 'admin') {
        return res.status(403).json({ error: 'Этот экран доступен только наблюдателю.' });
    }

    next();
};
