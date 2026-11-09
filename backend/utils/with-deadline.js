// Дедлайн для промисов внешних вызовов (GramJS handshake/getMe/фото висят вечно
// через «чернящий» прокси — connectTimeout teleproto покрывает только TCP-коннект;
// кейс @craps_1921, 2026-11-10: sync висел 8+ минут при is_working прокси).
export function withDeadline(promise, ms = 45000, timeoutMessage = 'Не дождались ответа вовремя.') {
    let timer;
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
    });
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}
