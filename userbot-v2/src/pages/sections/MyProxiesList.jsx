import { Globe } from 'lucide-react';
import {
  STATUS_DOT_HEX,
  proxyBadge,
  proxyHealthMode,
  countryFlag,
  formatWhen,
  proxyEgressSummary,
} from './proxyShared.js';

export function MyProxiesList({ filter, setFilter, filteredProxies, checkingIds, armedDeleteId, setArmedDeleteId, checkProxy, deleteProxy }) {
  return (
        <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="p-6 md:p-8 border-b border-slate-100">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-violet-500/20">
                  <Globe className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Мои прокси</h2>
                  <p className="text-sm text-slate-500 font-medium mt-0.5">
                    Отфильтруй битые, shared и купленные
                  </p>
                </div>
              </div>

              <div className="px-4 py-2 bg-violet-50 text-violet-700 rounded-xl text-sm font-bold border border-violet-100">
                {filteredProxies.length}
              </div>
            </div>

            <div className="flex gap-2 p-1.5 bg-slate-100 rounded-2xl overflow-x-auto">
              {[
                { id: 'all', label: 'Все' },
                { id: 'working', label: 'Работают' },
                { id: 'broken', label: 'С ошибкой' }
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`px-4 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all whitespace-nowrap ${
                    filter === item.id
                      ? 'bg-white text-violet-600 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {filteredProxies.length === 0 ? (
              <div className="p-12 text-center">
                <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 mx-auto mb-4">
                  <Globe className="w-8 h-8" />
                </div>
                <p className="text-slate-500 font-bold">Прокси с этим фильтром нет</p>
              </div>
            ) : (
              filteredProxies.map((proxy) => {
                const badge = proxyBadge(proxy);
                const mode = proxyHealthMode(proxy);
                const geo = proxy.last_check_country
                  ? `${countryFlag(proxy.last_check_country_code) ? `${countryFlag(proxy.last_check_country_code)} ` : ''}${proxy.last_check_country}${proxy.last_check_city ? `, ${proxy.last_check_city}` : ''}`
                  : mode === 'telegram_only'
                    ? 'Telegram only'
                    : '—';
                const statusBgColor = badge.tone === 'ok'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : badge.tone === 'warning'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : badge.tone === 'danger'
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : 'bg-slate-50 text-slate-600 border-slate-200';

                return (
                  <div key={proxy.id} className="p-5 md:px-8 md:py-5 hover:bg-slate-50/50 transition-colors">
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                      <div className="flex-1 min-w-0 space-y-2.5">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_DOT_HEX[badge.tone] || STATUS_DOT_HEX.default }} />
                          <div className="text-[15px] font-bold text-slate-900">{proxy.name}</div>
                          <span className={`inline-flex px-2.5 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wide border ${statusBgColor}`}>
                            {badge.text}
                          </span>
                          {Number(proxy.userbot_count || 0) > 1 ? (
                            <span className="inline-flex px-2 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-100 text-[10px] font-black uppercase">Shared</span>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Адрес</span>
                            <span className="font-mono text-[13px] font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">{proxy.host}:{proxy.port}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Гео</span>
                            <span className="font-medium text-slate-700">{geo}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Нагрузка</span>
                            <span className={`font-bold ${Number(proxy.userbot_count || 0) > 0 ? 'text-slate-900' : 'text-emerald-600'}`}>
                              {Number(proxy.userbot_count || 0) > 0 ? `${proxy.userbot_count} userbot` : 'Свободен'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Исходящий</span>
                            <span className="font-mono text-[13px] text-slate-700">{proxyEgressSummary(proxy)}</span>
                          </div>
                        </div>

                        <div className="text-xs text-slate-500">
                          Проверен: <span className="text-slate-700">{formatWhen(proxy.last_checked_at)}</span>
                        </div>

                        {proxy.last_check_error ? (
                          <div className="text-xs text-red-700 bg-red-50 px-3 py-2 rounded-lg border border-red-200">
                            {proxy.last_check_error}
                          </div>
                        ) : null}
                        {mode === 'telegram_only' ? (
                          <div className="text-xs text-slate-500 bg-slate-50 px-3 py-2 rounded-lg border border-slate-100">
                            Работает только для Telegram-подключений
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          className="h-9 px-4 rounded-xl bg-blue-600 text-white text-[13px] font-bold hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          type="button"
                          disabled={checkingIds.has(String(proxy.id))}
                          onClick={() => checkProxy(proxy.id)}
                        >
                          {checkingIds.has(String(proxy.id)) ? 'Проверяем...' : 'Проверить'}
                        </button>
                        {proxy.provision_source !== 'manual_admin' ? (
                            <button
                              className={`h-9 px-4 rounded-xl text-[13px] font-bold transition-all ${
                                armedDeleteId === String(proxy.id)
                                  ? 'bg-red-600 text-white hover:bg-red-700'
                                  : 'border border-red-200 text-red-600 hover:bg-red-50'
                              }`}
                              type="button"
                              onClick={() => (armedDeleteId === String(proxy.id) ? deleteProxy(proxy) : setArmedDeleteId(String(proxy.id)))}
                            >
                              {armedDeleteId === String(proxy.id) ? 'Точно удалить?' : 'Удалить'}
                            </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
  );
}
