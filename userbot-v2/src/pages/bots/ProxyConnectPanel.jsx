import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { apiRequest } from '../../api/client.js';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { LoadingState } from '../../ui/LoadingState.jsx';
import { Button } from '@/components/ui/button';
import { AdminServerProxyForm, CARD_CLASS } from './AdminServerProxyForm.jsx';

// Инлайн-панель поднятия прокси на /userbot (2026-10-23): открывается над
// окном подключения аккаунта по кнопке «Подключить прокси» в шаге 1.
// Форма и saveProxy — дословная копия карточек со страницы /proxies
// (ProxyManagerPage: админская «Поднять серверный прокси» и клиентская
// «Добавить свой прокси»); сама страница /proxies не редактировалась.
// Цена подхода: логика создания прокси живёт в двух местах — до выноса
// в общий компонент правки нужно делать синхронно (см. план-ноту волны).

function buildServerProxyName(existingNames = []) {
  const normalized = new Set(existingNames.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  let index = 1;
  while (normalized.has(`прокси #${index}`)) {
    index += 1;
  }
  return `Прокси #${index}`;
}

const INITIAL_FORM_STATE = {
  name: '',
  host: '',
  port: '1080',
  username: '',
  password: '',
  inventory_group: 'self_use'
};

export function ProxyConnectPanel({ onClose, onCreated }) {
  const { accessToken } = useAuth();
  const [formState, setFormState] = useState(INITIAL_FORM_STATE);
  const [bulkCount, setBulkCount] = useState('1');
  const [externalProxyMode, setExternalProxyMode] = useState(false);
  const [raisePriceTon, setRaisePriceTon] = useState('');
  const [state, setState] = useState({
    loading: true,
    saving: false,
    error: '',
    proxies: [],
    support: null
  });
  const panelRef = useRef(null);
  const scrolledRef = useRef(false);

  // Окно открывается над панелью подключения — после загрузки данных подводим
  // к нему скролл один раз (обёртка рендерится всегда, цель существует).
  useEffect(() => {
    if (state.loading || scrolledRef.current) return;
    scrolledRef.current = true;
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [state.loading]);

  useEffect(() => {
    let cancelled = false;

    async function loadProxies() {
      if (!accessToken) return;
      try {
        const data = await apiRequest('/api/userbot/proxies', { accessToken });
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: '',
          proxies: data.proxies || [],
          support: data.support || null
        }));
      } catch (error) {
        if (cancelled) return;
        setState((prev) => ({ ...prev, loading: false, error: error.message || 'Не удалось загрузить прокси.' }));
      }
    }

    loadProxies();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const isAdminCreate = state.support?.profile_role === 'admin';
  const serverProxyMode = isAdminCreate && !externalProxyMode;
  const serverBatchCount = Math.min(Math.max(Number.parseInt(bulkCount, 10) || 1, 1), 100);
  const canCreateManualProxy = !!state.support?.can_create_manual_proxy;
  const showQuotaLock = !!state.support && state.support.profile_role !== 'admin' && !canCreateManualProxy;

  const suggestedServerProxyName = useMemo(() => buildServerProxyName(
    state.proxies
      .filter((proxy) => proxy.provision_source === 'manual_admin')
      .map((proxy) => proxy.name)
  ), [state.proxies]);

  useEffect(() => {
    if (state.support?.profile_role !== 'admin') return;

    setFormState((prev) => {
      if (prev.name.trim()) return prev;
      return {
        ...prev,
        name: buildServerProxyName(
          state.proxies
            .filter((proxy) => proxy.provision_source === 'manual_admin')
            .map((proxy) => proxy.name)
        )
      };
    });
  }, [state.proxies, state.support?.profile_role]);

  async function saveProxy() {
    setState((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      const isServerBatch = isAdminCreate && !externalProxyMode;
      const forSale = formState.inventory_group === 'shop_sale';
      const salePrice = Number(raisePriceTon);
      const normalizedName = formState.name.trim();
      const normalizedHost = formState.host.trim();
      const normalizedPort = Number.parseInt(formState.port, 10);

      if (!normalizedName) {
        throw new Error('Сначала задай имя прокси.');
      }
      if (!isAdminCreate && !normalizedHost) {
        throw new Error('Сначала укажи host или IP прокси.');
      }
      if (isAdminCreate && externalProxyMode && !normalizedHost) {
        throw new Error('Укажи host внешнего прокси или вернись к серверному.');
      }
      if (isServerBatch && forSale && !(salePrice > 0)) {
        throw new Error('Укажи цену прокси в TON или выключи «На продажу в shop».');
      }
      if (!isAdminCreate && (!Number.isInteger(normalizedPort) || normalizedPort <= 0 || normalizedPort > 65535)) {
        throw new Error('Укажи корректный порт прокси.');
      }

      const result = await apiRequest('/api/userbot/proxies', {
        accessToken,
        method: 'POST',
        body: {
          name: normalizedName,
          host: normalizedHost || undefined,
          port: Number.isInteger(normalizedPort) ? normalizedPort : undefined,
          username: formState.username.trim() || null,
          password: formState.password.trim() || null,
          inventory_group: formState.inventory_group,
          count: isServerBatch ? serverBatchCount : undefined
        }
      });
      const data = await apiRequest('/api/userbot/proxies', { accessToken });

      let listedCount = 0;
      if (isServerBatch && forSale && Array.isArray(result?.proxy_ids) && result.proxy_ids.length && salePrice > 0) {
        try {
          const listing = await apiRequest('/api/shop/seller/items/batch-proxy', {
            accessToken,
            method: 'POST',
            body: { proxy_ids: result.proxy_ids, price_ton: salePrice }
          });
          listedCount = Number(listing?.created || 0);
          for (const failure of listing?.errors || []) {
            toast.error(`Не выставлен на продажу: ${failure.error}`);
          }
        } catch (listingError) {
          toast.error(`Прокси подняты, но на продажу не встали: ${listingError.message}`);
        }
      }

      setBulkCount('1');
      setExternalProxyMode(false);
      setRaisePriceTon('');
      setFormState({ ...INITIAL_FORM_STATE, port: '' });
      setState((prev) => ({
        ...prev,
        saving: false,
        proxies: data.proxies || [],
        support: data.support || prev.support
      }));
      if (listedCount > 0) {
        toast.success(`Поднято ${result?.created || result.proxy_ids.length} прокси, на витрину встало ${listedCount}.`);
      } else {
        toast.success(result?.message || 'Прокси сохранен.');
      }
      onCreated?.(Array.isArray(result?.proxy_ids) ? result.proxy_ids : []);
    } catch (error) {
      setState((prev) => ({ ...prev, saving: false, error: error.message }));
      toast.error(error.message);
    }
  }

  const closeTrigger = (
    <Button
      variant="ghost"
      size="icon"
      className="shrink-0"
      onClick={onClose}
      title="Скрыть окно подключения прокси"
    >
      <X className="w-4 h-4" />
    </Button>
  );

  return (
    <div ref={panelRef} id="proxy-connect-panel" className="scroll-mt-4 mb-6">
      {state.loading ? (
        <LoadingState text="Тянем прокси и квоты..." />
      ) : isAdminCreate ? (
        <AdminServerProxyForm
          formState={formState}
          setFormState={setFormState}
          bulkCount={bulkCount}
          setBulkCount={setBulkCount}
          externalProxyMode={externalProxyMode}
          setExternalProxyMode={setExternalProxyMode}
          raisePriceTon={raisePriceTon}
          setRaisePriceTon={setRaisePriceTon}
          support={state.support}
          showQuotaLock={showQuotaLock}
          serverProxyMode={serverProxyMode}
          serverBatchCount={serverBatchCount}
          suggestedServerProxyName={suggestedServerProxyName}
          isAdminCreate={isAdminCreate}
          error={state.error}
          saving={state.saving}
          saveProxy={saveProxy}
          onClose={onClose}
        />
      ) : (
        <div className={CARD_CLASS}>
          <div className="p-6 md:p-8 border-b border-slate-100">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                <Plus className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-slate-900">Добавить свой прокси</h2>
                <p className="text-sm text-slate-500 font-medium mt-0.5">
                  Укажи данные SOCKS5 прокси, который будешь использовать для юзербота
                </p>
              </div>
              {closeTrigger}
            </div>
          </div>

          <div className="p-6 md:p-8">
            {showQuotaLock ? (
              <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800 font-medium">
                На Trial можно держать только один свой прокси. Чтобы добавить ещё, сначала перейди на Pro.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-slate-700">Название</label>
                  <input
                    className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-slate-50 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 shadow-sm"
                    type="text"
                    value={formState.name}
                    onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="Например: Мой SOCKS5"
                  />
                </div>

                <div className="rounded-[16px] bg-slate-50/50 p-4 border border-slate-100">
                  <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500 mb-3">Подключение</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[13px] font-semibold text-slate-700">Host / IP</label>
                      <input
                        className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                        type="text"
                        value={formState.host}
                        onChange={(event) => setFormState((prev) => ({ ...prev, host: event.target.value }))}
                        placeholder="192.168.1.1"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[13px] font-semibold text-slate-700">Порт</label>
                      <input
                        className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                        type="number"
                        min="1"
                        max="65535"
                        value={formState.port}
                        onChange={(event) => setFormState((prev) => ({ ...prev, port: event.target.value }))}
                        placeholder="1080"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-[16px] bg-slate-50/50 p-4 border border-slate-100">
                  <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500 mb-3">Авторизация</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[13px] font-semibold text-slate-700">Username</label>
                      <input
                        className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                        type="text"
                        value={formState.username}
                        onChange={(event) => setFormState((prev) => ({ ...prev, username: event.target.value }))}
                        placeholder="Необязательно"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[13px] font-semibold text-slate-700">Password</label>
                      <input
                        className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                        type="password"
                        autoComplete="new-password"
                        value={formState.password}
                        onChange={(event) => setFormState((prev) => ({ ...prev, password: event.target.value }))}
                        placeholder="Необязательно"
                      />
                    </div>
                  </div>
                </div>

                {state.error ? (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-100 text-sm font-medium text-rose-600">
                    {state.error}
                  </div>
                ) : null}

                <div className="pt-4 border-t border-slate-100">
                  <button
                    className="w-full h-11 rounded-[14px] bg-blue-600 text-[14px] font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                    onClick={saveProxy}
                    disabled={state.saving}
                  >
                    {state.saving ? 'Сохраняем...' : 'Добавить прокси'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
