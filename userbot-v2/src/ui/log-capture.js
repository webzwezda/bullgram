/**
 * Клиентский capture ошибок SPA (фаза 4 логирования, план:
 * docs/plans/2026-11-05-logging-research.md §5.7). Общий файл всех шести
 * аппов — байт-в-байт копии, гейт design/ui-sync.mjs (канон admin-v2).
 *
 * installLogCapture() ставит window listeners: 'error' + 'unhandledrejection'
 * (rejections НЕ триггерят onerror) и flush на pagehide.
 * reportWebError() — точка входа для ErrorBoundary (render-ошибки React не
 * доходят до window listeners).
 *
 * Доставка: очередь ≤10 событий, flush-таймер 5с, fetch keepalive; на уход со
 * страницы — navigator.sendBeacon. Клиентский rate-limit 20/сессия и дедуп по
 * подписи ошибки. Свои сбои доставки никогда не репортятся (петля).
 * fetchLater() не используем — не Baseline-wide (Safari/Firefox без фолбэка).
 */

const ENDPOINT = '/api/log';
const FLUSH_MS = 5000;
const MAX_QUEUE = 10;
const MAX_EVENTS_PER_SESSION = 20;

const queue = [];
const seen = new Set();
let sentCount = 0;
let flushTimer = null;
let installed = false;

function appName() {
  const known = {
    '/': 'site',
    '/paywall/': 'paywall',
    '/userbot/': 'userbot',
    '/bots/': 'bots',
    '/treasury/': 'treasury',
    '/profile/': 'profile'
  };
  const base = import.meta.env?.BASE_URL || '/';
  return known[base] || base.replaceAll('/', '') || 'site';
}

function normalizeError(error) {
  if (error instanceof Error) {
    return {
      message: `${error.name}: ${error.message}`.slice(0, 300),
      stack: String(error.stack || '').slice(0, 2000)
    };
  }
  return { message: String(error ?? 'unknown error').slice(0, 300), stack: '' };
}

export function reportWebError({ message, stack = '', level = 'error', url } = {}) {
  if (!message || sentCount >= MAX_EVENTS_PER_SESSION) return;
  const normalizedStack = String(stack || '').slice(0, 2000);
  const signature = `${level}|${message}|${normalizedStack.split('\n')[1] || ''}`;
  if (seen.has(signature)) return;
  seen.add(signature);
  queue.push({
    app: appName(),
    level,
    message: String(message).slice(0, 300),
    stack: normalizedStack,
    url: String(url || window.location.href).slice(0, 500)
  });
  sentCount += 1;
  scheduleFlush();
}

/**
 * Точка входа для ErrorBoundary: render-ошибка React не доходит до window
 * listeners, boundary обязан репортить сам. componentStack режем до 1000 —
 * он многострочный и без него понятно, что упал именно рендер.
 */
export function reportCaughtError(error, info) {
  const { message, stack } = normalizeError(error);
  const componentStack = String(info?.componentStack || '').slice(0, 1000);
  reportWebError({ message, stack: stack ? `${stack}\n${componentStack}` : componentStack });
}

function sendBatch(events) {
  if (!events.length) return;
  const payload = JSON.stringify({ events });
  try {
    // keepalive: запрос доживает после закрытия вкладки (Baseline-wide).
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      keepalive: true
    }).catch(() => {});
  } catch {
    try {
      navigator.sendBeacon?.(ENDPOINT, new Blob([payload], { type: 'application/json' }));
    } catch {
      // логировать некуда — приёмник и есть лог
    }
  }
}

function flushNow() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!queue.length) return;
  const events = queue.splice(0, MAX_QUEUE);
  sendBatch(events);
  // Остаток (не должен накапливаться — очередь ≤10) уйдёт со следующим flush.
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flushNow, FLUSH_MS);
}

function onPageHide() {
  if (!queue.length) return;
  const payload = JSON.stringify({ events: queue.splice(0) });
  try {
    navigator.sendBeacon?.(ENDPOINT, new Blob([payload], { type: 'application/json' }));
  } catch {
    // sendBeacon недоступен — хвост очереди теряем осознанно
  }
}

export function installLogCapture() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event) => {
    // Resource-ошибки (img/script) приходят с target != window и без error —
    // это не апп-ошибки, их не репортим.
    if (event.target && event.target !== window && !event.error) return;
    const { message, stack } = normalizeError(event.error || event.message);
    reportWebError({ message, stack });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const { message, stack } = normalizeError(event.reason);
    reportWebError({ message, stack });
  });

  window.addEventListener('pagehide', onPageHide);
}
