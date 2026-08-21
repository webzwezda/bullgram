const STORAGE_KEY = 'bullgram:my-invoice-ids';
const LIMIT = 30;

// Счета создают и незарегистрированные — авторские счета держим в localStorage
// этого браузера ({ id, created_at }), статус подтягиваем через public-view.
export function getRememberedInvoices() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((entry) => entry && typeof entry.id === 'string')
      .map((entry) => ({
        id: entry.id,
        created_at: entry.created_at || null
      }));
  } catch {
    return [];
  }
}

export function rememberInvoice(id) {
  if (!id) return;
  try {
    const existing = getRememberedInvoices();
    const prev = existing.find((entry) => entry.id === id);
    const rest = existing.filter((entry) => entry.id !== id);
    rest.unshift({ id, created_at: prev?.created_at || new Date().toISOString() });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rest.slice(0, LIMIT)));
  } catch {
    // localStorage недоступен — список просто не сохранится
  }
}

export function forgetInvoices(idsToRemove) {
  const drop = new Set(idsToRemove);
  if (!drop.size) return;
  try {
    const kept = getRememberedInvoices().filter((entry) => !drop.has(entry.id));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // ignore
  }
}
