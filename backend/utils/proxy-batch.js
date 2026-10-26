// Общие хелперы managed-прокси: имена батчей и маркер «ещё на фоновой
// проверке». Жили в userbot.routes.js, вынесены, чтобы intake-сервис и роуты
// пользовались одним местом.

// Стабильный маркер «прокси ещё не прошёл фоновую проверку». Живёт в
// last_check_error до завершения фоновой проверки; фронт больше не должен
// парсить текст — используем его только внутри isManagedProxyPending.
export const MANAGED_PROXY_PENDING_MARKER = 'фоновую проверку Telegram';

export function buildManagedProxyPendingMessage() {
    return `Сервер поднимает прокси и гоняет ${MANAGED_PROXY_PENDING_MARKER}. Подожди немного и обнови список.`;
}

export function buildBatchProxyNames(baseName, existingNames, count) {
    const base = String(baseName || '').replace(/\s*#?\d+\s*$/, '').trim() || 'Прокси';
    const used = new Set((existingNames || []).map((value) => String(value || '').trim()).filter(Boolean));
    const names = [];
    let index = 1;
    while (names.length < count) {
        const candidate = `${base} #${index}`;
        if (!used.has(candidate)) {
            names.push(candidate);
            used.add(candidate);
        }
        index += 1;
    }
    return names;
}
