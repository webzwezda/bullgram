import { Clock } from 'lucide-react';

function formatExpiresIn(iso) {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  const diff = ts - Date.now();
  if (diff <= 0) return 'истекло';
  const hours = Math.floor(diff / 3600_000);
  if (hours >= 1) return `истекает через ${hours} ч`;
  const mins = Math.floor(diff / 60_000);
  return `истекает через ${mins} мин`;
}

/* Секция «Истекают в ближайшие 24ч» retention-страницы. Чистый рендер. */
export function RetentionExpiringSection({ expiring, channelTitleById }) {
  return (
    <section className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-500">
              Истекают в ближайшие 24ч
            </h3>
            <span className="text-xs font-bold text-slate-400">{expiring.length}</span>
          </div>

          {expiring.length === 0 ? (
            <div className="text-sm text-slate-500 font-medium py-4">
              Никто не истекает — всё спокойно.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {expiring.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-amber-50/50 border border-amber-100"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Clock className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-900 truncate">
                        {sub.tg_username ? `@${sub.tg_username}` : `ID ${sub.tg_user_id}`}
                      </div>
                      <div className="text-xs text-slate-500 font-medium">
                        {channelTitleById.get(sub.channel_id) || 'Канал'}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs font-black text-amber-700 flex-shrink-0 ml-3">
                    {formatExpiresIn(sub.expires_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
    </section>
  );
}
