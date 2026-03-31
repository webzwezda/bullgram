import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { APP_CONFIG } from '../config.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { StatCard } from '../ui/StatCard.jsx';

const DEFAULT_SETTINGS = {
  ton_wallet: '',
  sbp_phone: '',
  sbp_bank: '',
  sbp_fio: '',
  sbp_qr_url: '',
  sbp_payment_url: '',
  admin_tg_id: '',
  billing_provider: 'generic',
  billing_mode: 'manual',
  billing_webhook_secret: '',
  billing_shop_id: '',
  billing_api_key: '',
  referral_enabled: false,
  referral_reward_percent: 20,
  referral_welcome_text: ''
};

const DEFAULT_NEW_TARIFF = {
  channel_id: '',
  title: '',
  price: '',
  currency: 'TON',
  duration_days: '',
  is_trial: false,
  upsell_tariff_id: '',
  trial_label: ''
};

function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');

  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
  }

  if (digits.length === 10) {
    return `+7 ${digits.slice(0, 3)} ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 10)}`;
  }

  if (digits.length > 11 && raw.startsWith('+')) {
    return `+${digits}`;
  }

  return raw;
}

function normalizePhoneLive(value) {
  const raw = String(value || '');
  if (!raw.trim()) return '';

  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('8')) {
    digits = `7${digits.slice(1)}`;
  }

  const hasCountryPrefix = digits.startsWith('7');
  const body = hasCountryPrefix ? digits.slice(1, 11) : digits.slice(0, 10);

  const parts = [];
  if (body.length > 0) parts.push(body.slice(0, 3));
  if (body.length > 3) parts.push(body.slice(3, 6));

  let suffix = '';
  if (body.length > 6) {
    suffix = body.slice(6, 8);
  }
  if (body.length > 8) {
    suffix += `-${body.slice(8, 10)}`;
  }

  const left = hasCountryPrefix ? '+7' : '+7';
  const middle = parts.filter(Boolean).join(' ');
  return [left, middle, suffix].filter(Boolean).join(' ').trim();
}

function normalizeTonWallet(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function isValidTonWallet(value) {
  const wallet = normalizeTonWallet(value);
  if (!wallet) return true;
  return /^[A-Za-z0-9_-]{48,}$/.test(wallet);
}

function isValidSbpPhone(value) {
  if (!String(value || '').trim()) return true;
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) return true;
  if (digits.length === 10) return true;
  return digits.length >= 11 && String(value || '').trim().startsWith('+');
}

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function paymentEventBadge(event) {
  if (event.event_type === 'invoice_completed') return { text: 'Оплата закрылась', className: 'pill pill--ok' };
  if (event.event_type === 'webhook_received' || event.event_type === 'webhook_test') return { text: 'Webhook дошел', className: 'pill pill--warning' };
  if (event.event_type === 'rejected_secret' || event.status === 'rejected') return { text: 'Косяк / отказ', className: 'pill pill--danger' };
  return { text: event.event_type || 'Событие', className: 'pill' };
}

function downloadCsv(filename, header, rows) {
  const escapeCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((line) => line.map(escapeCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function resolveBackendAssetUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (url.startsWith('/')) return `${APP_CONFIG.backendUrl}${url}`;
  return `${APP_CONFIG.backendUrl}/${url}`;
}

export function PaymentSettingsPage({ mode = 'requisites' }) {
  const { user, accessToken, profileRole } = useAuth();
  const [sbpQrFile, setSbpQrFile] = useState(null);
  const [selectedUserbotId, setSelectedUserbotId] = useState('');
  const [paymentEventFilter, setPaymentEventFilter] = useState('all');
  const [newTariff, setNewTariff] = useState(DEFAULT_NEW_TARIFF);
  const [bundleDrafts, setBundleDrafts] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    saving: false,
    error: '',
    settings: DEFAULT_SETTINGS,
    userbots: [],
    channels: [],
    tariffs: [],
    bundleItems: [],
    bundleSupport: true,
    trialSupport: true,
    billingHealth: null,
    paymentEvents: [],
    updatedAt: null
  });
  useEffect(() => {
    let cancelled = false;

    async function loadPage({ silent = false } = {}) {
      if (!user?.id || !accessToken) return;

      if (!silent) {
        setState((prev) => ({
          ...prev,
          loading: !prev.updatedAt,
          refreshing: !!prev.updatedAt,
          error: ''
        }));
      }

      try {
        const [
          { data: settings },
          { data: userbots, error: userbotsError },
          { data: channels, error: channelsError },
          health,
          { data: paymentEvents, error: paymentEventsError }
        ] = await Promise.all([
          supabase.from('payment_settings').select('*').eq('owner_id', user.id).maybeSingle(),
          supabase
            .from('tg_accounts')
            .select('id, tg_account_id, tg_username')
            .eq('owner_id', user.id)
            .eq('account_type', 'userbot')
            .order('created_at', { ascending: false }),
          supabase
            .from('channels')
            .select('id, title, tg_chat_id')
            .eq('owner_id', user.id)
            .order('created_at', { ascending: false }),
          apiRequest('/api/payment/health', { accessToken }),
          supabase
            .from('payment_events')
            .select('*')
            .eq('owner_id', user.id)
            .order('created_at', { ascending: false })
            .limit(30)
        ]);

        if (userbotsError) throw userbotsError;
        if (channelsError) throw channelsError;
        if (paymentEventsError && !(paymentEventsError.message || '').includes('payment_events')) {
          throw paymentEventsError;
        }

        let tariffs = [];
        let bundleItems = [];
        let trialSupport = true;
        let bundleSupport = true;

        const tariffsResult = await supabase
          .from('tariffs')
          .select('*, channels(title)')
          .eq('owner_id', user.id)
          .eq('is_active', true)
          .order('created_at', { ascending: false });

        if (tariffsResult.error) {
          if ((tariffsResult.error.message || '').includes('is_trial') || (tariffsResult.error.message || '').includes('upsell_tariff_id') || (tariffsResult.error.message || '').includes('trial_label')) {
            trialSupport = false;
            const fallbackTariffs = await supabase
              .from('tariffs')
              .select('id, owner_id, channel_id, title, price, duration_days, currency, is_active, channels(title)')
              .eq('owner_id', user.id)
              .eq('is_active', true)
              .order('created_at', { ascending: false });
            if (fallbackTariffs.error) throw fallbackTariffs.error;
            tariffs = fallbackTariffs.data || [];
          } else {
            throw tariffsResult.error;
          }
        } else {
          tariffs = tariffsResult.data || [];
        }

        const bundleItemsResult = await supabase
          .from('tariff_bundle_items')
          .select('*, channels(id, title)')
          .eq('owner_id', user.id)
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true });

        if (bundleItemsResult.error) {
          if ((bundleItemsResult.error.message || '').includes('tariff_bundle_items')) {
            bundleSupport = false;
          } else {
            throw bundleItemsResult.error;
          }
        } else {
          bundleItems = bundleItemsResult.data || [];
        }

        if (!cancelled) {
          const nextUserbots = userbots || [];
          const nextTariffs = tariffs || [];
          setState({
            loading: false,
            refreshing: false,
            saving: false,
            error: '',
            settings: {
              ...DEFAULT_SETTINGS,
              ...(settings || {})
            },
            userbots: nextUserbots,
            channels: channels || [],
            tariffs: nextTariffs,
            bundleItems,
            bundleSupport,
            trialSupport,
            billingHealth: health || null,
            paymentEvents: paymentEvents || [],
            updatedAt: new Date().toISOString()
          });

          if (!selectedUserbotId && nextUserbots.length > 0) {
            setSelectedUserbotId(String(nextUserbots[0].id));
          }

          setBundleDrafts((prev) => {
            const nextDrafts = { ...prev };
            nextTariffs.forEach((tariff) => {
              if (!nextDrafts[tariff.id]) {
                nextDrafts[tariff.id] = {
                  item_type: 'channel',
                  channel_id: '',
                  resource_title: '',
                  resource_url: ''
                };
              }
            });
            return nextDrafts;
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            loading: false,
            refreshing: false,
            saving: false,
            error: error.message
          }));
        }
      }
    }

    loadPage();
    const intervalId = user?.id && accessToken
      ? window.setInterval(() => {
          loadPage({ silent: true });
        }, 60_000)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [user?.id, accessToken, selectedUserbotId]);

  const billingStats = useMemo(() => {
    return state.paymentEvents.reduce((stats, event) => {
      stats.total += 1;
      if (event.event_type === 'webhook_received' || event.event_type === 'webhook_test') stats.webhook += 1;
      if (event.event_type === 'invoice_completed') stats.completed += 1;
      if (event.event_type === 'rejected_secret' || event.status === 'rejected') stats.rejected += 1;
      return stats;
    }, { total: 0, webhook: 0, completed: 0, rejected: 0 });
  }, [state.paymentEvents]);

  const filteredPaymentEvents = useMemo(() => {
    return state.paymentEvents.filter((event) => {
      if (paymentEventFilter === 'webhook') {
        return event.event_type === 'webhook_received' || event.event_type === 'webhook_test';
      }
      if (paymentEventFilter === 'completed') {
        return event.event_type === 'invoice_completed';
      }
      if (paymentEventFilter === 'rejected') {
        return event.event_type === 'rejected_secret' || event.status === 'rejected';
      }
      return true;
    });
  }, [paymentEventFilter, state.paymentEvents]);

  const billingStatsCards = useMemo(() => ([
    { title: 'Webhook событий', value: billingStats.total, hint: `Дошли: ${billingStats.webhook}, закрылись: ${billingStats.completed}.` },
    { title: 'TON задан', value: state.settings.ton_wallet ? 'Да' : 'Нет', hint: 'Кошелек, на который приходят TON оплаты.', tone: state.settings.ton_wallet ? 'ok' : 'warning' },
    { title: 'Рефералка', value: state.settings.referral_enabled ? 'Вкл' : 'Выкл', hint: `Награда: ${state.settings.referral_reward_percent || 0}%`, tone: state.settings.referral_enabled ? 'ok' : 'default' },
    { title: 'Billing mode', value: state.settings.billing_mode || 'manual', hint: `Провайдер: ${state.settings.billing_provider || 'generic'}` }
  ]), [billingStats, state.settings]);

  const prioritySignals = useMemo(() => {
    const signals = [];
    if (!state.settings.ton_wallet) {
      signals.push({
        tone: 'danger',
        title: 'TON-кошелек не указан',
        text: 'Пока здесь пусто, P2P/TON деньги просто некуда принимать. Пропиши кошелек продавца и владельца.'
      });
    }
    if (!state.settings.admin_tg_id) {
      signals.push({
        tone: 'warning',
        title: 'Главный admin_tg_id не указан',
        text: 'Ops-сигналы, ручные подтверждения и сервисный контур будут слепыми. Заполни главный Telegram ID.'
      });
    }
    if (state.billingHealth && state.billingHealth.success !== true) {
      signals.push({
        tone: 'warning',
        title: 'Billing health не в норме',
        text: 'Webhook или provider mode выглядят криво. Разбери health до того, как оплаты зависнут в серой зоне.'
      });
    }
    if (billingStats.rejected > 0) {
      signals.push({
        tone: 'danger',
        title: `Есть ошибки кассы: ${billingStats.rejected}`,
        text: 'В журнале уже лежат rejected-события. Разгреби их раньше, чем админы начнут руками искать потерянные деньги.'
      });
    }
    if (billingStats.total === 0) {
      signals.push({
        tone: 'info',
        title: 'Касса еще не прогрета',
        text: 'Еще не было ни одного живого webhook/event цикла. Дай тестовый прогон и посмотри, как лягут события.'
      });
    }
    return signals;
  }, [state.settings, state.billingHealth, billingStats]);

  const tariffStats = useMemo(() => {
    const trialCount = state.tariffs.filter((tariff) => tariff.is_trial).length;
    const bundleCount = state.tariffs.filter((tariff) => state.bundleItems.some((item) => item.tariff_id === tariff.id)).length;
    return { total: state.tariffs.length, trialCount, bundleCount };
  }, [state.bundleItems, state.tariffs]);

  const isFirstRun = useMemo(() => {
    return (
      !state.settings.ton_wallet &&
      !state.settings.sbp_phone &&
      !state.settings.sbp_bank &&
      !state.settings.sbp_fio &&
      billingStats.total === 0 &&
      state.tariffs.length === 0
    );
  }, [billingStats.total, state.settings.sbp_bank, state.settings.sbp_fio, state.settings.sbp_phone, state.settings.ton_wallet, state.tariffs.length]);

  const showBillingStats = useMemo(() => {
    return (
      billingStats.total > 0 ||
      !!state.settings.ton_wallet ||
      !!state.settings.billing_shop_id ||
      !!state.settings.billing_api_key ||
      !!state.settings.billing_webhook_secret ||
      !!state.settings.referral_enabled
    );
  }, [billingStats.total, state.settings]);

  const isRequisitesMode = mode === 'requisites';
  const isPlansMode = mode === 'plans';
  const isBillingMode = mode === 'billing';
  const requisitesSummaryCards = useMemo(() => ([
    {
      label: 'TON',
      value: state.settings.ton_wallet ? 'Готов' : 'Пусто',
      hint: state.settings.ton_wallet ? 'TON-кошелек уже сохранен для сайта и shop.' : 'Пока TON платить некуда.',
      tone: state.settings.ton_wallet ? 'ok' : 'warning'
    },
    {
      label: 'СБП',
      value: state.settings.sbp_phone ? 'Готово' : 'Не задано',
      hint: state.settings.sbp_phone ? 'Ручной СБП checkout можно показать покупателю.' : 'СБП-реквизиты еще не заполнены.',
      tone: state.settings.sbp_phone ? 'ok' : 'neutral'
    },
    {
      label: 'QR / ссылка',
      value: state.settings.sbp_qr_url || state.settings.sbp_payment_url ? 'Есть' : 'Нет',
      hint: state.settings.sbp_qr_url || state.settings.sbp_payment_url
        ? 'Покупателю есть куда перейти или что сканировать.'
        : 'Для СБП лучше сразу добавить QR или deeplink банка.',
      tone: state.settings.sbp_qr_url || state.settings.sbp_payment_url ? 'ok' : 'neutral'
    },
    {
      label: 'Первый запуск',
      value: isFirstRun ? 'Да' : 'Нет',
      hint: isFirstRun ? 'Сейчас нужен только кошелек и базовые СБП-реквизиты.' : 'База уже собрана, тут можно просто поддерживать реквизиты в порядке.',
      tone: isFirstRun ? 'warning' : 'neutral'
    }
  ]), [isFirstRun, state.settings]);

  const pageCopy = useMemo(() => {
    if (isPlansMode) {
      return {
        title: 'Тарифы и планы',
        description: 'Собери продукт: тарифы, пакеты, trial/upsell и партнерку. Это место для упаковки продукта, а не для кассы.',
        refreshHint: 'Тарифы и планы подхватываются автоматически после обновления данных.'
      };
    }
    if (isBillingMode) {
      return {
        title: 'Касса / webhook',
        description: 'Тут живет касса: webhook, provider mode, ручная проверка и журнал событий. Реквизиты и тарифы вынесены отдельно.',
        refreshHint: 'Экран обновляется сам раз в минуту, чтобы не пропускать потерянные оплаты.'
      };
    }
    return {
      title: 'Реквизиты',
      description: 'Укажи TON-кошелек и базовые реквизиты для первого checkout.',
      refreshHint: ''
    };
  }, [isBillingMode, isPlansMode]);

  function ensureBundleDraft(tariffId) {
    setBundleDrafts((prev) => {
      if (prev[tariffId]) return prev;
      return {
        ...prev,
        [tariffId]: {
          item_type: 'channel',
          channel_id: '',
          resource_title: '',
          resource_url: ''
        }
      };
    });
  }

  function getTariffBundleItems(tariffId) {
    return state.bundleItems.filter((item) => item.tariff_id === tariffId);
  }

  function getUpsellOptions(currentTariffId) {
    return state.tariffs.filter((tariff) => String(tariff.id) !== String(currentTariffId));
  }

  function getBundleSummary(tariff) {
    const items = getTariffBundleItems(tariff.id);
    if (items.length === 0) {
      return `Пока только базовый доступ в ${tariff.channels?.title || 'основной канал'}`;
    }

    const channelCount = items.filter((item) => item.item_type === 'channel').length;
    const resourceCount = items.filter((item) => item.item_type === 'resource').length;
    const parts = [];
    if (channelCount > 0) parts.push(`${channelCount} Telegram-целей`);
    if (resourceCount > 0) parts.push(`${resourceCount} доп. материалов`);
    return parts.join(' + ');
  }

  function patchSettings(nextPatch) {
    setState((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        ...nextPatch
      }
    }));
  }

  function validatePaymentFields(partialSettings = state.settings) {
    const nextErrors = {};
    const tonWallet = normalizeTonWallet(partialSettings.ton_wallet);
    const sbpPhone = String(partialSettings.sbp_phone || '').trim();

    if (tonWallet && !isValidTonWallet(tonWallet)) {
      nextErrors.ton_wallet = 'Укажи корректный TON-кошелек без пробелов.';
    }

    if (sbpPhone && !isValidSbpPhone(sbpPhone)) {
      nextErrors.sbp_phone = 'Укажи телефон в формате +7 999 123-45-67.';
    }

    setFieldErrors(nextErrors);
    return nextErrors;
  }

  async function saveSettings(overrides = null) {
    const nextErrors = validatePaymentFields();
    if (Object.keys(nextErrors).length > 0) {
      setState((prev) => ({ ...prev, error: 'Проверь заполнение реквизитов.' }));
      return;
    }
    setState((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      const payload = {
        ...state.settings,
        ...(overrides || {})
      };
      const response = await apiRequest('/api/payment-settings', {
        accessToken,
        method: 'POST',
        body: payload
      });
      const savedSettings = {
        ...payload,
        ...(response.settings || {})
      };
      const health = await apiRequest('/api/payment/health', { accessToken });
      setState((prev) => ({
        ...prev,
        saving: false,
        settings: {
          ...prev.settings,
          ...savedSettings
        },
        billingHealth: health,
        updatedAt: new Date().toISOString()
      }));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('bullrun:payment-settings-updated', {
          detail: {
            paymentReadiness: {
              hasTon: !!savedSettings.ton_wallet,
              hasSbp: !!(savedSettings.sbp_phone || savedSettings.sbp_bank),
              adminTgId: savedSettings.admin_tg_id ? String(savedSettings.admin_tg_id) : ''
            }
          }
        }));
      }
      window.alert('Настройки сохранены.');
    } catch (error) {
      setState((prev) => ({ ...prev, saving: false, error: error.message }));
    }
  }

  async function saveTonSettings() {
    await saveSettings();
  }

  async function saveSbpSettings() {
    let nextSettings = null;

    if (profileRole === 'admin' && sbpQrFile) {
      try {
        const formData = new FormData();
        formData.append('file', sbpQrFile);
        const uploadResult = await apiRequest('/api/payment-settings/sbp-qr', {
          accessToken,
          method: 'POST',
          body: formData
        });
        nextSettings = {
          ...state.settings,
          sbp_qr_url: uploadResult.url || state.settings.sbp_qr_url || ''
        };
        setState((prev) => ({
          ...prev,
          settings: {
            ...prev.settings,
            sbp_qr_url: uploadResult.url || prev.settings.sbp_qr_url || ''
          }
        }));
        setSbpQrFile(null);
      } catch (error) {
        setState((prev) => ({ ...prev, saving: false, error: error.message }));
        return;
      }
    }

    await saveSettings(nextSettings);
  }

  async function sendWebhookTest() {
    try {
      await apiRequest('/api/payment/test-webhook', {
        accessToken,
        method: 'POST',
        body: { provider: state.settings.billing_provider || 'generic' }
      });
      window.alert('Тестовое webhook-событие записано. Обнови журнал ниже.');
    } catch (error) {
      window.alert(error.message);
    }
  }

  function fillAdminIdFromUserbot() {
    const userbot = state.userbots.find((item) => String(item.id) === String(selectedUserbotId)) || state.userbots[0];
    if (!userbot) {
      window.alert('Сначала подключи юзербота.');
      return;
    }
    setState((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        admin_tg_id: String(userbot.tg_account_id)
      }
    }));
  }

  async function createTariff() {
    if (!user?.id) return;
    if (!newTariff.channel_id || !newTariff.title || !newTariff.price || !newTariff.duration_days) {
      window.alert('Заполни канал, название, цену и срок.');
      return;
    }

    try {
      const payload = {
        owner_id: user.id,
        channel_id: newTariff.channel_id,
        title: newTariff.title,
        price: parseFloat(newTariff.price),
        duration_days: parseInt(newTariff.duration_days, 10),
        currency: newTariff.currency,
        is_active: true
      };

      if (state.trialSupport) {
        payload.is_trial = !!newTariff.is_trial;
        payload.upsell_tariff_id = newTariff.upsell_tariff_id || null;
        payload.trial_label = newTariff.trial_label || null;
      }

      let insertResult = await supabase.from('tariffs').insert(payload);
      if (insertResult.error && ((insertResult.error.message || '').includes('is_trial') || (insertResult.error.message || '').includes('upsell_tariff_id') || (insertResult.error.message || '').includes('trial_label'))) {
        const fallbackPayload = {
          owner_id: user.id,
          channel_id: newTariff.channel_id,
          title: newTariff.title,
          price: parseFloat(newTariff.price),
          duration_days: parseInt(newTariff.duration_days, 10),
          currency: newTariff.currency,
          is_active: true
        };
        insertResult = await supabase.from('tariffs').insert(fallbackPayload);
        setState((prev) => ({ ...prev, trialSupport: false }));
      }

      if (insertResult.error) throw insertResult.error;

      setNewTariff(DEFAULT_NEW_TARIFF);
      window.alert('Тариф создан. Экран сам подхватит его после обновления.');
      window.location.reload();
    } catch (error) {
      window.alert(error.message);
    }
  }

  async function deleteTariff(id) {
    if (!window.confirm('Точно убрать тариф? Старые чеки и статистика останутся.')) return;
    try {
      const { error } = await supabase.from('tariffs').update({ is_active: false }).eq('id', id);
      if (error) throw error;
      window.location.reload();
    } catch (err) {
      window.alert(err.message);
    }
  }

  async function addBundleItem(tariff) {
    if (!state.bundleSupport) {
      window.alert('Bundle-пакеты еще не включены в БД.');
      return;
    }

    const draft = bundleDrafts[tariff.id] || {
      item_type: 'channel',
      channel_id: '',
      resource_title: '',
      resource_url: ''
    };

    if (draft.item_type === 'channel' && !draft.channel_id) {
      window.alert('Выбери канал/чат для пакета.');
      return;
    }
    if (draft.item_type === 'resource' && (!draft.resource_title || !draft.resource_url)) {
      window.alert('Для материала нужны название и ссылка.');
      return;
    }

    try {
      const payload = {
        owner_id: user.id,
        tariff_id: tariff.id,
        item_type: draft.item_type,
        sort_order: getTariffBundleItems(tariff.id).length
      };

      if (draft.item_type === 'channel') {
        payload.channel_id = draft.channel_id;
      } else {
        payload.resource_title = draft.resource_title;
        payload.resource_url = draft.resource_url;
      }

      const { error } = await supabase.from('tariff_bundle_items').insert(payload);
      if (error) throw error;
      window.location.reload();
    } catch (err) {
      window.alert(err.message);
    }
  }

  async function deleteBundleItem(itemId) {
    if (!window.confirm('Убрать этот элемент из пакета?')) return;
    try {
      const { error } = await supabase.from('tariff_bundle_items').update({ is_active: false }).eq('id', itemId);
      if (error) throw error;
      window.location.reload();
    } catch (err) {
      window.alert(err.message);
    }
  }

  if (state.loading) {
    return <LoadingState text="Тянем реквизиты и billing..." />;
  }

  return (
    <section className={`page${isRequisitesMode ? ' payment-page' : ''}`}>
      {isRequisitesMode ? (
        <>
          <div className="payment-overview proxy-surface-card">
            <div className="payment-overview__top">
              <div className="payment-overview__copy">
                <div className="proxy-page__eyebrow">Payments</div>
                <div className="page__header">
                  <h1>{pageCopy.title}</h1>
                </div>
                <p className="proxy-page__intro">
                  Тут держим только чистые реквизиты для первого checkout: TON, СБП, QR и deeplink. Без billing-каши и служебного шума.
                </p>
              </div>
              <div className="payment-overview__rule">
                <div className="payment-overview__rule-label">Что нужно на старте</div>
                <div className="payment-overview__rule-title">TON + СБП</div>
                <div className="payment-overview__rule-text">
                  Для MVP хватает TON-кошелька и базовых СБП-реквизитов. Остальное можно докрутить позже, когда уже пойдут оплаты.
                </div>
              </div>
            </div>
            <div className="payment-summary-grid">
              {requisitesSummaryCards.map((card) => (
                <div key={card.label} className={`proxy-summary-card proxy-summary-card--${card.tone}`}>
                  <div className="proxy-summary-card__label">{card.label}</div>
                  <div className="proxy-summary-card__value">{card.value}</div>
                  <div className="proxy-summary-card__hint">{card.hint}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="page__header">
          <h1>{pageCopy.title}</h1>
          <p>{pageCopy.description}</p>
          <div className="page__meta">
            <span>Последнее обновление: {formatWhen(state.updatedAt)}</span>
            <span>{state.refreshing ? 'Обновляем фон...' : pageCopy.refreshHint}</span>
          </div>
        </div>
      )}

      {!isRequisitesMode && prioritySignals.length > 0 ? (
        <div className="priority-grid section">
          {prioritySignals.map((signal) => (
            <article key={signal.title} className={`priority-card priority-card--${signal.tone}`}>
              <h3>{signal.title}</h3>
              <p>{signal.text}</p>
            </article>
          ))}
        </div>
      ) : null}

      {state.error ? <div className="error-card" style={{ marginTop: 20 }}>{state.error}</div> : null}

      {isBillingMode && showBillingStats ? (
        <div className="grid">
          {billingStatsCards.map((card) => (
            <StatCard key={card.title} title={card.title} value={card.value} hint={card.hint} tone={card.tone} />
          ))}
        </div>
      ) : null}

      {isRequisitesMode ? (
          <div className="payment-form-grid">
        <div className="table-card proxy-surface-card payment-card payment-card--ton">
          <div className="payment-card__header">
            <div>
              <div className="payment-card__eyebrow">Основной checkout</div>
              <div className="table-card__title">TON</div>
              <div className="table-subtext payment-card__intro">Сюда будут приходить TON-оплаты из сайта и из shop.</div>
            </div>
            <span className={`pill ${state.settings.ton_wallet ? 'pill--ok' : 'pill--warning'}`}>
              {state.settings.ton_wallet ? 'Готов' : 'Пусто'}
            </span>
          </div>
          <div className="form-grid form-grid--stacked payment-card__form">
            <label className="field-group">
              <span>TON-кошелек</span>
              <input
                className="field"
                value={state.settings.ton_wallet || ''}
                onChange={(event) => {
                  const normalized = normalizeTonWallet(event.target.value);
                  patchSettings({ ton_wallet: normalized });
                  validatePaymentFields({ ...state.settings, ton_wallet: normalized });
                }}
                onBlur={(event) => {
                  const value = normalizeTonWallet(event.target.value);
                  patchSettings({ ton_wallet: value });
                  validatePaymentFields({ ...state.settings, ton_wallet: value });
                }}
                placeholder="UQA..."
                autoComplete="off"
              />
              <div className="table-subtext">Кошелек проверяем сразу, без пробелов и лишнего мусора.</div>
              {fieldErrors.ton_wallet ? <div className="error-inline">{fieldErrors.ton_wallet}</div> : null}
            </label>
          </div>
          <div className="payment-card__note">
            Покупатель увидит только checkout и сумму. Здесь важен один чистый TON-кошелек без ручной путаницы.
          </div>
          <div className="table-actions" style={{ marginTop: 14 }}>
            <button className="ghost-button ghost-button--primary" type="button" onClick={saveTonSettings} disabled={state.saving}>
              {state.saving ? 'Сохраняем...' : 'Сохранить TON'}
            </button>
          </div>
        </div>
        <div className="table-card proxy-surface-card payment-card payment-card--sbp">
          <div className="payment-card__header">
            <div>
              <div className="payment-card__eyebrow">Ручная оплата</div>
              <div className="table-card__title">СБП / карта</div>
              <div className="table-subtext payment-card__intro">Покупатель увидит эти реквизиты в ручном СБП checkout.</div>
            </div>
            <span className={`pill ${state.settings.sbp_phone ? 'pill--ok' : 'pill--warning'}`}>
              {state.settings.sbp_phone ? 'Готово' : 'Не задано'}
            </span>
          </div>
          <div className="payment-card__section-title">Реквизиты</div>
          <div className="payment-card__subgrid payment-card__subgrid--details">
            <label className="field-group">
              <span>Номер для СБП</span>
              <input
                className="field"
                value={state.settings.sbp_phone || ''}
                onChange={(event) => {
                  const normalized = normalizePhoneLive(event.target.value);
                  patchSettings({ sbp_phone: normalized });
                  validatePaymentFields({ ...state.settings, sbp_phone: normalized });
                }}
                onBlur={(event) => {
                  const normalized = normalizePhone(event.target.value);
                  patchSettings({ sbp_phone: normalized });
                  validatePaymentFields({ ...state.settings, sbp_phone: normalized });
                }}
                placeholder="+7..."
                inputMode="tel"
                autoComplete="tel"
              />
              <div className="table-subtext">Например: +7 999 123-45-67</div>
              {fieldErrors.sbp_phone ? <div className="error-inline">{fieldErrors.sbp_phone}</div> : null}
            </label>
            <label className="field-group">
              <span>ФИО получателя</span>
              <input
                className="field"
                value={state.settings.sbp_fio || ''}
                onChange={(event) => patchSettings({ sbp_fio: event.target.value })}
                onBlur={(event) => patchSettings({ sbp_fio: event.target.value.trim() })}
                placeholder="Иванов Иван Иванович"
                autoComplete="name"
              />
              <div className="table-subtext">Покажем покупателю рядом с номером СБП.</div>
            </label>
            <label className="field-group payment-field payment-field--wide">
              <span>Банк</span>
              <input
                className="field"
                value={state.settings.sbp_bank || ''}
                onChange={(event) => patchSettings({ sbp_bank: event.target.value })}
                onBlur={(event) => patchSettings({ sbp_bank: event.target.value.trim() })}
                placeholder="Т-Банк, Сбер..."
                autoComplete="organization"
              />
              <div className="table-subtext">Укажи банк, чтобы покупателю не пришлось гадать, куда переводить.</div>
            </label>
          </div>
          {profileRole === 'admin' ? (
            <>
            <div className="payment-card__section-title payment-card__section-title--spaced">QR и deeplink</div>
            <div className="payment-assets-panel">
              <div className="payment-card__subgrid payment-card__subgrid--assets">
                <label className="field-group">
                  <span>Ссылка на оплату</span>
                  <input
                    className="field"
                    value={state.settings.sbp_payment_url || ''}
                    onChange={(event) => patchSettings({ sbp_payment_url: event.target.value })}
                    onBlur={(event) => patchSettings({ sbp_payment_url: event.target.value.trim() })}
                    placeholder="https://t.tb.ru/..."
                    autoComplete="off"
                  />
                  <div className="table-subtext">Deeplink банка. Нужен, если человек платит не по картинке QR, а через кнопку.</div>
                </label>
                <label className="field-group payment-upload">
                  <span>Картинка QR</span>
                  <input
                    className="field"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(event) => setSbpQrFile(event.target.files?.[0] || null)}
                  />
                  <div className="table-subtext">Отдельная картинка QR для checkout. Лучше `png` или `jpg`.</div>
                  {sbpQrFile ? (
                    <div className="payment-upload__meta">Выбран файл: <strong>{sbpQrFile.name}</strong></div>
                  ) : null}
                  {state.settings.sbp_qr_url ? (
                    <div className="payment-qr-preview">
                      <div className="payment-qr-preview__label">Текущий QR</div>
                      <img
                        src={resolveBackendAssetUrl(state.settings.sbp_qr_url)}
                        alt="СБП QR"
                        className="payment-qr-preview__image"
                      />
                    </div>
                  ) : null}
                </label>
              </div>
            </div>
            </>
          ) : null}
          <div className="payment-card__note">
            Для ручного СБП checkout лучше держать и deeplink банка, и отдельный QR. Тогда у покупателя будет оба пути оплаты.
          </div>
          <div className="table-actions" style={{ marginTop: 14 }}>
            <button className="ghost-button ghost-button--primary" type="button" onClick={saveSbpSettings} disabled={state.saving}>
              {state.saving ? 'Сохраняем...' : 'Сохранить реквизиты СБП'}
            </button>
          </div>
        </div>
      </div>
      ) : null}

      {isBillingMode ? (
      <div className="grid grid--double" style={{ marginBottom: 20 }}>
        <div className="table-card">
          <div className="table-card__title">Сервисный Telegram ID</div>
          <div className="form-grid">
            <div className="field-group">
              <span>admin_tg_id</span>
              <div className="field-inline">
                <input
                  className="field"
                  value={state.settings.admin_tg_id || ''}
                  onChange={(event) => setState((prev) => ({ ...prev, settings: { ...prev.settings, admin_tg_id: event.target.value } }))}
                  placeholder="123456789"
                />
                <button className="ghost-button" type="button" onClick={fillAdminIdFromUserbot}>
                  Из юзербота
                </button>
              </div>
            </div>
            <label className="field-group">
              <span>Какой юзербот брать</span>
              <select className="field" value={selectedUserbotId} onChange={(event) => setSelectedUserbotId(event.target.value)}>
                <option value="">Выбери юзербота</option>
                {state.userbots.map((userbot) => (
                  <option key={userbot.id} value={userbot.id}>
                    {userbot.tg_username ? `@${userbot.tg_username}` : `ID ${userbot.tg_account_id}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>
      ) : null}

      {isBillingMode ? (
        <div className="table-card">
          <div className="table-card__title">Дополнительно: webhook и ручная проверка</div>
          <div className="form-grid">
            <label className="field-group">
              <span>Режим</span>
              <select
                className="field"
                value={state.settings.billing_mode || 'manual'}
                onChange={(event) => setState((prev) => ({ ...prev, settings: { ...prev.settings, billing_mode: event.target.value } }))}
              >
                <option value="manual">manual</option>
                <option value="webhook">webhook</option>
              </select>
            </label>
            <label className="field-group">
              <span>Провайдер</span>
              <select
                className="field"
                value={state.settings.billing_provider || 'generic'}
                onChange={(event) => setState((prev) => ({ ...prev, settings: { ...prev.settings, billing_provider: event.target.value } }))}
              >
                <option value="generic">generic</option>
                <option value="cryptomus">cryptomus</option>
                <option value="cryptobot">cryptobot</option>
              </select>
            </label>
            <label className="field-group">
              <span>Shop / Merchant ID</span>
              <input
                className="field"
                value={state.settings.billing_shop_id || ''}
                onChange={(event) => setState((prev) => ({ ...prev, settings: { ...prev.settings, billing_shop_id: event.target.value } }))}
                placeholder="merchant-id"
              />
            </label>
            <label className="field-group">
              <span>Webhook secret</span>
              <input
                className="field"
                value={state.settings.billing_webhook_secret || ''}
                onChange={(event) => setState((prev) => ({ ...prev, settings: { ...prev.settings, billing_webhook_secret: event.target.value } }))}
                placeholder="secret"
              />
            </label>
            <label className="field-group" style={{ gridColumn: '1 / -1' }}>
              <span>API key провайдера</span>
              <input
                className="field"
                value={state.settings.billing_api_key || ''}
                onChange={(event) => setState((prev) => ({ ...prev, settings: { ...prev.settings, billing_api_key: event.target.value } }))}
                placeholder="api-key"
              />
            </label>
          </div>
          <div className="table-subtext" style={{ marginTop: 14, lineHeight: 1.8 }}>
            Webhook URL: <strong>{state.billingHealth?.webhook_url || 'https://bullrun.ru/api/payment/webhook/generic'}</strong>
          </div>
          <div className="table-actions" style={{ marginTop: 14 }}>
            <button className="inline-action" onClick={sendWebhookTest}>Тест webhook-а</button>
            <a className="inline-action" href="/app/orders" target="_blank" rel="noreferrer">Открыть заказы</a>
          </div>
        </div>
      ) : null}

      {isPlansMode ? (
      <>
      <div className="grid">
        <StatCard title="Тарифов всего" value={tariffStats.total} hint="Все активные тарифы, которые реально продаются ботом." />
        <StatCard title="Пробников" value={tariffStats.trialCount} hint="Пробные тарифы, которые потом надо дожимать в upsell." tone={tariffStats.trialCount ? 'warning' : 'default'} />
        <StatCard title="Пакетных тарифов" value={tariffStats.bundleCount} hint="Тарифы, где кроме основного канала есть еще доп. цели или материалы." tone={tariffStats.bundleCount ? 'ok' : 'default'} />
      </div>

      <div className="table-card">
        <div className="table-card__title">Тарифы и пакеты</div>
        <div className="table-subtext" style={{ marginBottom: 16, lineHeight: 1.7 }}>
          Тут собираешь продукт: куда идет человек, сколько платит, что получает в пакете и во что дожимается после пробника.
        </div>

        {!state.bundleSupport ? (
          <div className="empty-inline" style={{ marginBottom: 16 }}>
            Bundle-пакеты в БД не активированы. Пока будет работать только схема один тариф → один основной канал.
          </div>
        ) : null}

        {!state.trialSupport ? (
          <div className="empty-inline" style={{ marginBottom: 16 }}>
            Trial/upsell поля в БД не активированы. Пробники пока урежутся до обычного тарифа.
          </div>
        ) : null}

        <div className="toolbar-card" style={{ marginBottom: 18 }}>
          <div className="toolbar-card__title">Создать тариф</div>
          <div className="form-grid">
            <label className="field-group">
              <span>Канал</span>
              <select className="field" value={newTariff.channel_id} onChange={(event) => setNewTariff((prev) => ({ ...prev, channel_id: event.target.value }))}>
                <option value="">Выбери канал</option>
                {state.channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>{channel.title}</option>
                ))}
              </select>
            </label>
            <label className="field-group">
              <span>Название</span>
              <input className="field" value={newTariff.title} onChange={(event) => setNewTariff((prev) => ({ ...prev, title: event.target.value }))} placeholder="VIP месяц" />
            </label>
            <label className="field-group">
              <span>Цена</span>
              <input className="field" type="number" min="0" value={newTariff.price} onChange={(event) => setNewTariff((prev) => ({ ...prev, price: event.target.value }))} placeholder="50" />
            </label>
            <label className="field-group">
              <span>Срок в днях</span>
              <input className="field" type="number" min="1" value={newTariff.duration_days} onChange={(event) => setNewTariff((prev) => ({ ...prev, duration_days: event.target.value }))} placeholder="30" />
            </label>
            <label className="field-group">
              <span>Валюта</span>
              <select className="field" value={newTariff.currency} onChange={(event) => setNewTariff((prev) => ({ ...prev, currency: event.target.value }))}>
                <option value="TON">TON</option>
                <option value="RUB">RUB</option>
                <option value="USDT">USDT</option>
              </select>
            </label>
            {state.trialSupport ? (
              <>
                <label className="field-group">
                  <span>Это пробник?</span>
                  <select className="field" value={newTariff.is_trial ? 'yes' : 'no'} onChange={(event) => setNewTariff((prev) => ({ ...prev, is_trial: event.target.value === 'yes' }))}>
                    <option value="no">Нет</option>
                    <option value="yes">Да</option>
                  </select>
                </label>
                {newTariff.is_trial ? (
                  <>
                    <label className="field-group">
                      <span>Во что дожимать после пробника</span>
                      <select className="field" value={newTariff.upsell_tariff_id} onChange={(event) => setNewTariff((prev) => ({ ...prev, upsell_tariff_id: event.target.value }))}>
                        <option value="">Выбери основной тариф</option>
                        {state.tariffs.map((tariff) => (
                          <option key={tariff.id} value={tariff.id}>{tariff.title}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field-group">
                      <span>Лейбл пробника</span>
                      <input className="field" value={newTariff.trial_label} onChange={(event) => setNewTariff((prev) => ({ ...prev, trial_label: event.target.value }))} placeholder="Тест / прогрев / 3 дня" />
                    </label>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
          <div className="table-actions" style={{ marginTop: 14 }}>
            <button className="ghost-button" type="button" onClick={createTariff}>Создать тариф</button>
          </div>
        </div>

        {state.tariffs.length === 0 ? (
          <div className="empty-inline">Пока нет тарифов. Создай первый прямо тут.</div>
        ) : (
          <div className="grid">
            {state.tariffs.map((tariff) => {
              const draft = bundleDrafts[tariff.id] || { item_type: 'channel', channel_id: '', resource_title: '', resource_url: '' };
              const bundleItems = getTariffBundleItems(tariff.id);
              return (
                <div key={tariff.id} className="table-card">
                  <div className="action-card__head">
                    <div>
                      <div className="table-card__title">{tariff.title}</div>
                      <div className="table-subtext">
                        {tariff.channels?.title || 'Канал не подтянулся'} • {tariff.price} {tariff.currency || 'TON'} • {tariff.duration_days} дн.
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {tariff.is_trial ? <span className="pill pill--warning">Пробник</span> : null}
                      {bundleItems.length > 0 ? <span className="pill pill--ok">Пакет</span> : null}
                    </div>
                  </div>

                  <div className="table-subtext" style={{ marginTop: 12 }}>{getBundleSummary(tariff)}</div>

                  {state.trialSupport && tariff.is_trial ? (
                    <div className="empty-inline" style={{ marginTop: 12 }}>
                      Дожимается в: {getUpsellOptions(tariff.id).find((option) => String(option.id) === String(tariff.upsell_tariff_id))?.title || 'не задано'}.
                    </div>
                  ) : null}

                  {state.bundleSupport ? (
                    <>
                      <div className="toolbar-card" style={{ marginTop: 14 }}>
                        <div className="toolbar-card__title">Состав пакета</div>
                        {bundleItems.length === 0 ? (
                          <div className="empty-inline">Пока пусто. Есть только основной канал.</div>
                        ) : (
                          <div className="list-stack">
                            {bundleItems.map((item) => (
                              <div key={item.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', padding: 12 }}>
                                <div>
                                  <strong>{item.item_type === 'channel' ? 'Telegram-цель' : 'Материал'}</strong>
                                  <div className="table-subtext">
                                    {item.item_type === 'channel' ? item.channels?.title || 'Канал не найден' : `${item.resource_title || 'Без названия'} • ${item.resource_url || ''}`}
                                  </div>
                                </div>
                                <button className="inline-action" onClick={() => deleteBundleItem(item.id)}>Убрать</button>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="form-grid" style={{ marginTop: 14 }}>
                          <label className="field-group">
                            <span>Что добавить</span>
                            <select
                              className="field"
                              value={draft.item_type}
                              onChange={(event) => {
                                const value = event.target.value;
                                ensureBundleDraft(tariff.id);
                                setBundleDrafts((prev) => ({
                                  ...prev,
                                  [tariff.id]: {
                                    ...prev[tariff.id],
                                    item_type: value
                                  }
                                }));
                              }}
                            >
                              <option value="channel">Канал / чат</option>
                              <option value="resource">Материал / ссылка</option>
                            </select>
                          </label>

                          {draft.item_type === 'channel' ? (
                            <label className="field-group">
                              <span>Канал / чат</span>
                              <select
                                className="field"
                                value={draft.channel_id}
                                onChange={(event) => {
                                  ensureBundleDraft(tariff.id);
                                  setBundleDrafts((prev) => ({
                                    ...prev,
                                    [tariff.id]: {
                                      ...prev[tariff.id],
                                      channel_id: event.target.value
                                    }
                                  }));
                                }}
                              >
                                <option value="">Выбери цель</option>
                                {state.channels.map((channel) => (
                                  <option key={channel.id} value={channel.id}>{channel.title}</option>
                                ))}
                              </select>
                            </label>
                          ) : (
                            <>
                              <label className="field-group">
                                <span>Название материала</span>
                                <input
                                  className="field"
                                  value={draft.resource_title}
                                  onChange={(event) => {
                                    ensureBundleDraft(tariff.id);
                                    setBundleDrafts((prev) => ({
                                      ...prev,
                                      [tariff.id]: {
                                        ...prev[tariff.id],
                                        resource_title: event.target.value
                                      }
                                    }));
                                  }}
                                  placeholder="Гайд / курс / ссылка"
                                />
                              </label>
                              <label className="field-group">
                                <span>URL</span>
                                <input
                                  className="field"
                                  value={draft.resource_url}
                                  onChange={(event) => {
                                    ensureBundleDraft(tariff.id);
                                    setBundleDrafts((prev) => ({
                                      ...prev,
                                      [tariff.id]: {
                                        ...prev[tariff.id],
                                        resource_url: event.target.value
                                      }
                                    }));
                                  }}
                                  placeholder="https://..."
                                />
                              </label>
                            </>
                          )}
                        </div>

                        <div className="table-actions" style={{ marginTop: 12 }}>
                          <button className="ghost-button" type="button" onClick={() => addBundleItem(tariff)}>
                            Добавить в пакет
                          </button>
                        </div>
                      </div>
                    </>
                  ) : null}

                  <div className="table-actions" style={{ marginTop: 14 }}>
                    <button className="inline-action" onClick={() => deleteTariff(tariff.id)}>Выключить тариф</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="table-card">
        <div className="table-card__title">Рефералка</div>
        <div className="form-grid">
          <label className="field-group">
            <span>Партнерка включена</span>
            <select
              className="field"
              value={state.settings.referral_enabled ? 'yes' : 'no'}
              onChange={(event) => setState((prev) => ({
                ...prev,
                settings: { ...prev.settings, referral_enabled: event.target.value === 'yes' }
              }))}
            >
              <option value="no">Нет</option>
              <option value="yes">Да</option>
            </select>
          </label>
          <label className="field-group">
            <span>Процент награды</span>
            <input
              className="field"
              type="number"
              min="0"
              max="100"
              value={state.settings.referral_reward_percent || 0}
              onChange={(event) => setState((prev) => ({
                ...prev,
                settings: { ...prev.settings, referral_reward_percent: Number(event.target.value || 0) }
              }))}
            />
          </label>
          <label className="field-group" style={{ gridColumn: '1 / -1' }}>
            <span>Текст приветствия по рефке</span>
            <textarea
              className="field field--textarea"
              value={state.settings.referral_welcome_text || ''}
              onChange={(event) => setState((prev) => ({
                ...prev,
                settings: { ...prev.settings, referral_welcome_text: event.target.value }
              }))}
              placeholder="Что увидит человек, пришедший по партнерской ссылке"
            />
          </label>
        </div>
      </div>
      </>
      ) : null}

      {!isRequisitesMode ? (
      <div className="toolbar-card">
        <div className="toolbar-card__title">Финальный шаг</div>
        <div className="toolbar-card__body">
          <button className="ghost-button" type="button" onClick={saveSettings} disabled={state.saving}>
            {state.saving ? 'Сохраняем...' : 'Сохранить настройки'}
          </button>
          {isPlansMode ? (
            <a className="ghost-button" href="/app/referrals" target="_blank" rel="noreferrer">
              Открыть партнерку
            </a>
          ) : null}
        </div>
      </div>
      ) : null}

      {isBillingMode ? (
      <div className="table-card">
        <div className="table-card__title">Последние события кассы</div>
        <div className="filter-strip">
          {[
            { id: 'all', label: 'Все' },
            { id: 'webhook', label: 'Webhook' },
            { id: 'completed', label: 'Закрылись' },
            { id: 'rejected', label: 'Косяки' }
          ].map((item) => (
            <button
              key={item.id}
              className={`filter-chip${paymentEventFilter === item.id ? ' filter-chip--active' : ''}`}
              onClick={() => setPaymentEventFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="table-actions" style={{ marginTop: 12, marginBottom: 12 }}>
          <button
            className="inline-action"
            onClick={() => downloadCsv(
              `payment-events-${new Date().toISOString().slice(0, 10)}.csv`,
              ['created_at', 'provider', 'event_type', 'status', 'invoice_id'],
              filteredPaymentEvents.map((event) => [
                event.created_at,
                event.provider,
                event.event_type,
                event.status,
                event.invoice_id
              ])
            )}
          >
            Журнал CSV
          </button>
        </div>
        {filteredPaymentEvents.length === 0 ? (
          <div className="empty-inline">Пока событий нет. Как только касса начнет стучать webhook-ами, они появятся здесь.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Провайдер</th>
                <th>Событие</th>
                <th>Статус</th>
                <th>Invoice</th>
                <th>Дальше</th>
              </tr>
            </thead>
            <tbody>
              {filteredPaymentEvents.map((event) => {
                const badge = paymentEventBadge(event);
                return (
                  <tr key={event.id}>
                    <td>{formatWhen(event.created_at)}</td>
                    <td>{event.provider}</td>
                    <td><span className={badge.className}>{badge.text}</span></td>
                    <td>{event.status || '—'}</td>
                    <td>{event.invoice_id || '—'}</td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="inline-action"
                          onClick={() => {
                            window.localStorage.setItem('orders_search_preset', JSON.stringify({
                              search: event.invoice_id ? String(event.invoice_id) : '',
                              source: 'admin_v2_payment_event'
                            }));
                            window.open('/app/orders', '_blank', 'noopener,noreferrer');
                          }}
                        >
                          Заказы
                        </button>
                        {event.payload?.tg_user_id ? (
                          <a
                            className="inline-action"
                            href={`/app/dossier?tg=${encodeURIComponent(event.payload.tg_user_id)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Досье
                          </a>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      ) : null}
    </section>
  );
}
