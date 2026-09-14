// Ошибка «таблицы нет в БД»: PGRST205 — PostgREST не нашёл таблицу в schema cache,
// 42P01 — undefined_table из Postgres. Только такие ошибки можно тихо глотать
// (таблица ещё не создана — это легитимный feature-flag). Ошибки RLS/прав
// (permission denied и пр.) должны показываться админу, а не превращаться в пустой журнал.
export function isMissingTableError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const message = String(error.message || '');
  return code === 'PGRST205' || code === '42P01' || message.includes('does not exist');
}

export const DEFAULT_NEW_TARIFF = {
  bot_id: '',
  channel_id: '',
  title: '',
  is_free: false,
  access_methods: {
    group: {
      enabled: false
    },
    chat: {
      enabled: false,
      channel_id: ''
    },
    resource: {
      enabled: false,
      title: '',
      text: ''
    }
  },
  payment_methods: {
    ton: {
      enabled: true,
      price: ''
    }
  },
  duration_days: '',
  is_lifetime: false
};
