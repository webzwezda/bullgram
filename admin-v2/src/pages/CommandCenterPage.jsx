import { useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard,
  Wallet,
  LockKeyhole,
  Rocket,
  ShoppingBag,
  Shield,
  AlertTriangle,
  Users,
  FileText,
  Activity,
  RefreshCw,
  Send,
  Settings,
  ChevronRight,
  Database
} from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { ActionCard } from '../ui/ActionCard.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { StatCard } from '../ui/StatCard.jsx';
import { UpgradeCallout } from '../ui/UpgradeCallout.jsx';

const ASSET_MARKETPLACE_SELLER_STEPS = [
  {
    id: 'shop',
    title: 'Открой seller admin',
    href: '/app/shop'
  },
  {
    id: 'inventory',
    title: 'Подготовь seller inventory',
    href: '/app/proxies'
  },
  {
    id: 'bots',
    title: 'Подними seller-аккаунт',
    href: '/app/userbots'
  },
  {
    id: 'handoff',
    title: 'Проверь handoff после оплаты',
    href: '/app/payments'
  }
];

const TEXT_SERVICE_SELLER_STEPS = [
  {
    id: 'shop',
    title: 'Открой seller admin',
    href: '/app/shop'
  },
  {
    id: 'wallet',
    title: 'Подключи TON и P2P',
    href: '/app/payments'
  },
  {
    id: 'offer',
    title: 'Собери hidden-message оффер',
    href: '/app/shop'
  },
  {
    id: 'handoff',
    title: 'Проверь выдачу после оплаты',
    href: '/app/payments'
  }
];

function sellerPackageTitle(sellerCanSellAssets) {
  return sellerCanSellAssets ? 'Seller пакет' : 'P2P seller пакет';
}

function formatTon(value) {
  return Number(value || 0).toFixed(4);
}

function formatWhen(value) {
  if (!value) return 'Нет данных';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function InlineAction({ href, children }) {
  if (!href) {
    return <span className="inline-action inline-action--muted">{children}</span>;
  }

  return (
    <a className="inline-action" href={href}>
      {children}
    </a>
  );
}

function openAdminGroups(filter = 'all') {
  window.localStorage.setItem('admin_groups_filter_preset', JSON.stringify({ filter }));
  window.location.href = '/app/admin-groups';
}

function packageSignalStatusText(status) {
  if (status === 'failed') return 'Handoff сломан';
  if (status === 'awaiting_receipt') return 'Ждет ручную проверку';
  if (status === 'pending') return 'Checkout открыт';
  if (status === 'paid') return 'Уже куплено';
  if (status === 'expired') return 'Протухший checkout';
  return 'Есть движение';
}

function packageSignalTitle(signal, sellerCanSellAssets) {
  if (signal.id === 'trial') return 'Trial';
  if (signal.id === 'normal') return 'Normal';
  return sellerPackageTitle(sellerCanSellAssets);
}

function packageSignalHint(signal, profilePlan, sellerCanSellAssets) {
  if (signal.id === 'trial') {
    if (signal.status === 'paid') {
      return 'Trial уже закрыл входной checkout. Дальше собирай первый контур и смотри в сторону апгрейда на Normal.';
    }
    if (signal.status === 'pending') {
      return 'Сначала добей входной trial-checkout. Пока он открыт, не надо плодить новые платежные сценарии.';
    }
    if (signal.status === 'awaiting_receipt') {
      return 'Trial уже ждет ручной проверки. Не дублируй оплату и следи за этим checkout.';
    }
    if (signal.status === 'failed') {
      return 'Оплата уже есть, но handoff сломан. Сначала добей trial-покупку, а потом двигайся дальше.';
    }
    return 'Входной слой BullRun: первый checkout, первый юзербот и первый money-ops контур.';
  }

  if (signal.id === 'normal') {
    if (signal.status === 'paid' || profilePlan === 'normal' || profilePlan === 'pro') {
      return 'Normal уже открыт. Следующий шаг — докручивать рабочий контур: прокси, второго юзербота, CRM и seller-flow.';
    }
    if (signal.status === 'pending') {
      return 'Normal checkout уже открыт. Сначала закрой апгрейд, потом возвращайся к seller и расширению контура.';
    }
    if (signal.status === 'awaiting_receipt') {
      return 'Апгрейд на Normal уже ждет ручной проверки. Не открывай новый счет, пока этот не разберут.';
    }
    if (signal.status === 'failed') {
      return 'Normal оплачен, но handoff сломан. Сначала почини апгрейд, потом двигайся дальше.';
    }
    return 'Основной рабочий слой: снимает trial-лимиты и открывает нормальный money ops stack.';
  }

  if (signal.status === 'paid') {
    return sellerCanSellAssets
      ? 'Seller mode уже активен. Дальше важны inventory, seller-аккаунт и нормальный handoff продаж.'
      : 'P2P seller уже активен. Дальше важны TON/P2P контур, hidden-message офферы и чистый buyer-side handoff.';
  }
  if (signal.status === 'pending') {
    return sellerCanSellAssets
      ? 'Seller checkout уже открыт. Сначала добей оплату, потом открывай seller admin и собирай витрину.'
      : 'P2P seller checkout уже открыт. Сначала добей оплату, потом собирай hidden-message витрину и buyer-flow.';
  }
  if (signal.status === 'awaiting_receipt') {
    return sellerCanSellAssets
      ? 'Seller checkout уже ждет ручной проверки. Не запускай новый seller-flow поверх этого хвоста.'
      : 'P2P seller уже ждет ручной проверки. Не запускай новый seller-flow поверх этого хвоста.';
  }
  if (signal.status === 'failed') {
    return sellerCanSellAssets
      ? 'Seller оплачен, но передача прав сломалась. Сначала разбери handoff в shop.'
      : 'P2P seller оплачен, но buyer-side выдача сломалась. Сначала разбери handoff в shop.';
  }
  return sellerCanSellAssets
    ? 'Seller mode нужен, когда базовый контур уже жив и пора продавать офферы и активы через BullRun.'
    : 'P2P seller нужен, когда базовый контур уже жив и пора продавать hidden-message офферы через BullRun.';
}

function packageSignalHref(signal, profilePlan) {
  if (signal.id === 'trial') return signal.href || '/shop?offer=trial';
  if (signal.id === 'normal') {
    return signal.href || (profilePlan === 'trial' ? '/shop?offer=normal' : '/app/shop');
  }
  return signal.href || (profilePlan === 'normal' || profilePlan === 'pro' ? '/app/shop' : '/shop?offer=seller');
}

export function CommandCenterPage() {
  const { accessToken, profilePlan, profileRole, trialEndsAt } = useAuth();
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    error: '',
    data: null,
    updatedAt: null
  });

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard({ silent = false } = {}) {
      if (!silent) {
        setState((prev) => ({
          ...prev,
          loading: !prev.data,
          refreshing: !!prev.data,
          error: ''
        }));
      }

      try {
        const data = await apiRequest('/api/dashboard', { accessToken });
        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            error: '',
            data,
            updatedAt: new Date().toISOString()
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            error: error.message,
            data: null,
            updatedAt: null
          });
        }
      }
    }

    if (accessToken) {
      loadDashboard();
    }

    const intervalId = accessToken
      ? window.setInterval(() => {
          loadDashboard({ silent: true });
        }, 60_000)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [accessToken]);

  const summary = state.data?.summary || {};
  const urgentActions = state.data?.urgentActions || [];
  const channelStats = state.data?.channelStats || [];
  const recentInboxAlertRows = state.data?.recentInboxAlertRows || [];
  const recentTelegramErrorRows = state.data?.recentTelegramErrorRows || [];
  const recentFailoverRows = state.data?.recentFailoverRows || [];
  const sharedProxyRows = state.data?.sharedProxyRows || [];
  const buyerPackageSignals = state.data?.buyerPackageSignals || [];
  const paymentReadiness = state.data?.paymentReadiness || {};
  const trialHoursLeft = useMemo(() => {
    if (!trialEndsAt) return null;
    const diffMs = new Date(trialEndsAt).getTime() - Date.now();
    if (Number.isNaN(diffMs)) return null;
    return Math.ceil(diffMs / (1000 * 60 * 60));
  }, [trialEndsAt]);
  const trialUpgradeUrgent = profilePlan === 'trial' && trialHoursLeft !== null && trialHoursLeft > 0 && trialHoursLeft <= 72;
  const prioritySignals = useMemo(() => ([
    {
      title: 'Деньги висят',
      value: `${summary.pendingInvoices || 0} счетов`,
      tone: (summary.pendingInvoices || 0) > 0 || (summary.awaitingReceiptInvoices || 0) > 0 ? 'warning' : 'ok',
      hint: `Неоплаты: ${summary.pendingInvoices || 0} • ждут чек: ${summary.awaitingReceiptInvoices || 0}`
    },
    {
      title: 'Доступ течет',
      value: `${summary.expiredButInside || 0} хвост`,
      tone: (summary.expiredButInside || 0) > 0 || (summary.paidNotJoined || 0) > 0 ? 'warning' : 'ok',
      hint: `Вход не подтвержден: ${summary.paidNotJoined || 0}`
    },
    {
      title: 'Инфраструктура',
      value: `${summary.brokenProxyCount || 0} битых`,
      tone: (summary.brokenProxyCount || 0) > 0 || (summary.userbotDeadProxyCount || 0) > 0 ? 'danger' : 'ok',
      hint: `Юзерботов на мертвом прокси: ${summary.userbotDeadProxyCount || 0}`
    },
    {
      title: 'Shop',
      value: `${summary.shopPendingTransfers || 0} handoff`,
      tone: (summary.shopPendingTransfers || 0) > 0 ? 'warning' : 'ok',
      hint: `TON закрыто: ${formatTon(summary.shopTonRevenue || 0)}`
    }
  ]), [summary]);

  const topStats = useMemo(() => ([
    {
      title: 'Боевые юзерботы',
      value: summary.userbotCount || 0,
      hint: `Вне shop-резерва: ${summary.userbotListedInShopCount || 0} сейчас лежат на витрине.`
    },
    {
      title: 'Группы и чаты',
      value: summary.channelCount || 0,
      hint: `Готовы с bot-админом: ${summary.channelWithBotCount || 0}, без bot-админа: ${summary.channelWithoutBotCount || 0}.`
    },
    {
      title: 'Активные подписчики',
      value: summary.activeSubscribers || 0,
      hint: `Вход не подтвержден: ${summary.paidNotJoined || 0}. Сгорели, но еще внутри: ${summary.expiredButInside || 0}.`
    },
    {
      title: 'Shop TON',
      value: formatTon(summary.shopTonRevenue || 0),
      hint: `Оплачено: ${summary.shopPaidPurchases || 0}, перевод прав висит: ${summary.shopPendingTransfers || 0}.`
    }
  ]), [summary]);

  const moneyStats = useMemo(() => ([
    {
      title: 'MRR RUB',
      value: summary.mrrRub || 0,
      hint: `Автоподтверждения: ${summary.autoConfirmedPayments || 0}, ручные: ${summary.manualConfirmedPayments || 0}.`
    },
    {
      title: 'MRR TON',
      value: formatTon(summary.mrrTon || 0),
      hint: `Ждут оплату: ${summary.pendingInvoices || 0}, ждут чек: ${summary.awaitingReceiptInvoices || 0}.`
    },
    {
      title: 'Пробные счета',
      value: summary.trialPendingInvoices || 0,
      hint: `Напоминания уже ушли: ${summary.remindedInvoices || 0}.`
    },
    {
      title: 'Партнерка',
      value: summary.referralPartners || 0,
      hint: `Долг по партнерам: ${summary.referralPartnersWithDebt || 0} • RUB ${summary.referralOutstandingRub || 0}.`
    }
  ]), [summary]);

  const infraStats = useMemo(() => ([
    {
      title: 'Рабочие прокси',
      value: summary.workingProxyCount || 0,
      tone: (summary.brokenProxyCount || 0) > 0 ? 'warning' : 'default',
      hint: `Битые: ${summary.brokenProxyCount || 0}. Общие прокси: ${summary.sharedProxyCount || 0}.`
    },
    {
      title: 'Автопереключение',
      value: summary.userbotFailoverEnabledCount || 0,
      hint: `Недавние переключения: ${summary.recentFailoversCount || 0}. Пустой резерв: ${summary.userbotFailoverMisconfiguredCount || 0}.`
    },
    {
      title: 'Сигналы системы',
      value: summary.recentInboxAlerts || 0,
      tone: summary.signalRoutingReady ? 'default' : 'warning',
      hint: summary.signalRoutingReady
        ? `Контур собран: ${summary.opsBotCount || 0} ботов, админ задан.`
        : 'Контур не собран: настройте админа или ботов для сигналов.'
    },
    {
      title: 'Базы клиентов',
      value: summary.customerBaseCount || 0,
      hint: `Товаров в магазине: ${summary.shopPublishedItemCount || 0}.`
    }
  ]), [summary]);

  const trialLaunchSteps = useMemo(() => {
    if (profilePlan !== 'trial') return [];

    return [
      {
        title: 'Забери или проверь прокси',
        done: (summary.proxyCount || 0) > 0,
        hint: (summary.proxyCount || 0) > 0
          ? `Прокси уже есть: ${summary.proxyCount}. Проверь, что он работает с Telegram.`
          : 'Без прокси дальше не двигаемся: на Trial даем один бесплатный, чтобы собрать первый контур.',
        href: '/app/proxies'
      },
      {
        title: 'Подключи первого юзербота',
        done: (summary.userbotCount || 0) > 0,
        hint: (summary.userbotCount || 0) > 0
          ? 'Первый юзербот уже подключен. Теперь можно собирать входящие и контур.'
          : 'Следующий шаг после прокси — подключить одного юзербота и проверить, что он живой.',
        href: '/app/userbots'
      },
      {
        title: 'Настрой платежи',
        done: !!paymentReadiness.hasTon,
        hint: paymentReadiness.hasTon
          ? 'TON-кошелек задан. Можно принимать оплату.'
          : 'Задай TON-кошелек, чтобы принимать оплату за доступ.',
        href: '/app/payments'
      },
      {
        title: 'Продай первый доступ',
        done: (summary.shopPaidPurchases || 0) > 0 || (summary.activeSubscribers || 0) > 0,
        hint: (summary.shopPaidPurchases || 0) > 0 || (summary.activeSubscribers || 0) > 0
          ? 'Первая продажа уже есть. Теперь видно, где Trial начинает упираться в лимиты.'
          : 'Открой Магазин и продай первый доступ в TON или через P2P.',
        href: '/shop?offer=trial'
      }
    ];
  }, [paymentReadiness.hasTon, profilePlan, summary.activeSubscribers, summary.proxyCount, summary.shopPaidPurchases, summary.userbotCount]);

  const normalLaunchSteps = useMemo(() => {
    if (profilePlan !== 'normal') return [];

    return [
      {
        title: 'Добавь прокси для работы',
        done: (summary.proxyCount || 0) > 1,
        hint: (summary.proxyCount || 0) > 1
          ? `Прокси уже больше одного: ${summary.proxyCount}. Можно держать не только входной контур, но и рабочую операционку.`
          : 'Один бесплатный прокси уже не тянет рабочий режим. Добавь хотя бы второй прокси для работы.',
        href: '/app/proxies'
      },
      {
        title: 'Подними второй юзербот',
        done: (summary.userbotCount || 0) > 1,
        hint: (summary.userbotCount || 0) > 1
          ? 'В кабинете уже больше одного юзербота. Контур перестал быть одиночным.'
          : 'Normal начинается, когда у тебя не один входной юзербот, а рабочая связка под диалоги, группы и продажи.',
        href: '/app/userbots'
      },
      {
        title: 'Запусти рассылки',
        done: (summary.broadcastCount || 0) > 0 || (summary.remindedInvoices || 0) > 0,
        hint: (summary.broadcastCount || 0) > 0 || (summary.remindedInvoices || 0) > 0
          ? 'Рассылки уже пошли. Normal работает как контур возврата клиентов, а не как витрина.'
          : 'Запусти рассылки или напоминания о неоплаченных счетах.',
        href: '/app/broadcast'
      },
      {
        title: 'Настрой продажи через Магазин',
        done: (summary.shopPublishedItemCount || 0) > 0 || (summary.shopPaidPurchases || 0) > 0,
        hint: (summary.shopPublishedItemCount || 0) > 0 || (summary.shopPaidPurchases || 0) > 0
          ? 'Магазин уже работает: есть либо товары, либо продажи.'
          : 'Настрой Магазин для продаж: добавь товары или включи оплату доступа.',
        href: '/app/shop'
      }
    ];
  }, [profilePlan, summary.broadcastCount, summary.proxyCount, summary.remindedInvoices, summary.shopPaidPurchases, summary.shopPublishedItemCount, summary.userbotCount]);

  const sellerCanSellAssets = profileRole === 'admin';

  const sellerLaunchSteps = useMemo(() => {
    if (profilePlan !== 'normal') return [];

    const steps = sellerCanSellAssets ? ASSET_MARKETPLACE_SELLER_STEPS : TEXT_SERVICE_SELLER_STEPS;

    return steps.map((step) => {
      if (step.id === 'shop') {
        const done = (summary.shopPublishedItemCount || 0) > 0 || (summary.shopPendingTransfers || 0) > 0;
        return {
          ...step,
          done,
          hint: done
            ? 'Seller-контур уже живет в кабинете: есть лоты или уже пошел handoff.'
            : 'Первый шаг seller mode — зайти в seller admin и собрать живой контур продаж, а не держать это как идею.'
        };
      }

      if (step.id === 'inventory') {
        const done = (summary.workingProxyCount || 0) > 1;
        return {
          ...step,
          done,
          hint: done
            ? 'В inventory уже есть из чего собирать seller-flow.'
            : 'Seller-контур без inventory не полетит. Разведи прокси по группам и оставь готовые к продаже.'
        };
      }

      if (step.id === 'bots') {
        const done = (summary.userbotCount || 0) > 1;
        return {
          ...step,
          done,
          hint: done
            ? 'Есть отдельный Telegram-контур под seller-flow и входящие.'
            : 'Seller лучше не тащить на один входной юзербот. Подними отдельный аккаунт под seller-лички и handoff.'
        };
      }

      if (step.id === 'wallet') {
        const done = (summary.paymentSettingsConfigured || 0) > 0;
        return {
          ...step,
          done,
          hint: done
            ? 'Платежный контур уже заведен: TON/P2P можно использовать как seller-service.'
            : 'Для текстовых P2P-офферов сначала нужен живой TON/P2P-контур, иначе seller-mode не закроет первую оплату.'
        };
      }

      if (step.id === 'offer') {
        const done = (summary.shopPublishedItemCount || 0) > 0;
        return {
          ...step,
          done,
          hint: done
            ? 'Есть хотя бы один опубликованный hidden-message оффер.'
            : 'Не начинай с инвентаря. Для text-service seller-mode первым делом нужен один понятный hidden-message оффер.'
        };
      }

      const done = (summary.shopPaidPurchases || 0) > 0 && (summary.shopPendingTransfers || 0) === 0;
      return {
        ...step,
        done,
        hint: done
          ? 'Передача прав уже закрывалась без хвостов.'
          : sellerCanSellAssets
            ? 'До первых денег seller-mode не считается собранным. Проверяй handoff, buyer-side next steps и платежный контур.'
            : 'Для текстового seller-mode важно проверить, что после оплаты hidden-message реально доезжает, а checkout не зависает в handoff.'
      };
    });
  }, [
    profilePlan,
    profileRole,
    sellerCanSellAssets,
    summary.paymentSettingsConfigured,
    summary.shopPaidPurchases,
    summary.shopPendingTransfers,
    summary.shopPublishedItemCount,
    summary.userbotCount,
    summary.workingProxyCount
  ]);

  if (state.loading) {
    return <LoadingState text="Тянем живой Command Center..." />;
  }

  if (state.error) {
    return (
      <section className="page">
        <div className="page__header">
          <h1>Командный центр</h1>
          <p>Backend живой, но этот экран пока не смог дотянуть данные.</p>
        </div>
        <div className="error-card">{state.error}</div>
      </section>
    );
  }

  return (
    <section className="page page--flush space-y-6">
      {/* Main Dashboard Card */}
      <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">

        {/* Header Section */}
        <div className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
              <LayoutDashboard className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-900">Командный центр</h1>
              <p className="text-sm text-slate-500 font-medium mt-0.5">
                Главный экран управления: деньги, клиенты, инфраструктура и приоритетные задачи
              </p>
            </div>
          </div>

          {/* Priority Signals */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {prioritySignals.map((item, idx) => (
              <div key={idx} className={`p-5 rounded-2xl border ${
                item.tone === 'danger'
                  ? 'bg-red-50 border-red-100'
                  : item.tone === 'warning'
                    ? 'bg-amber-50 border-amber-100'
                    : 'bg-emerald-50 border-emerald-100'
              }`}>
                <div className="text-[10px] font-black uppercase tracking-widest mb-2 ${
                  item.tone === 'danger'
                    ? 'text-red-600'
                    : item.tone === 'warning'
                      ? 'text-amber-600'
                      : 'text-emerald-600'
                }">{item.title}</div>
                <div className={`text-2xl font-black tracking-tighter ${
                  item.tone === 'danger'
                    ? 'text-red-700'
                    : item.tone === 'warning'
                      ? 'text-amber-700'
                      : 'text-emerald-700'
                }`}>{item.value}</div>
                <div className="text-xs text-slate-600 mt-1.5 font-medium leading-snug">{item.hint}</div>
              </div>
            ))}
          </div>

          {/* Quick Actions */}
          <div className="mt-6 flex flex-wrap gap-2">
            <a className="px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 transition-all flex items-center gap-2" href="/app/customers?tab=orders">
              <Wallet className="w-4 h-4" />
              Деньги
            </a>
            <a className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition-all flex items-center gap-2" href="/app/customers?tab=access">
              <LockKeyhole className="w-4 h-4" />
              Доступ
            </a>
            <a className="px-5 py-2.5 rounded-xl bg-purple-600 text-white text-sm font-bold hover:bg-purple-700 transition-all flex items-center gap-2" href="/app/userbots">
              <Rocket className="w-4 h-4" />
              Юзерботы
            </a>
            <a className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-all flex items-center gap-2" href="/app/shop">
              <ShoppingBag className="w-4 h-4" />
              Магазин
            </a>
            <button className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-50 transition-all flex items-center gap-2" type="button" onClick={() => openAdminGroups('need_bot')}>
              <Shield className="w-4 h-4" />
              Права в группах
            </button>
          </div>
        </div>

        {/* Top Stats */}
        <div className="p-6 md:p-8 border-b border-slate-100">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {topStats.map((item, idx) => (
              <div key={idx} className="bg-slate-50/50 border border-slate-100 p-6 rounded-3xl">
                <div className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">{item.title}</div>
                <div className="text-3xl font-black tracking-tighter text-slate-900">{item.value}</div>
                <div className="text-xs text-slate-500 mt-2 font-medium leading-snug">{item.hint}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Urgent Actions */}
        {(urgentActions.length > 0) && (
          <div className="p-6 md:p-8 bg-amber-50/40 border-b border-amber-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900">Требует внимания</h3>
                <p className="text-sm text-slate-500">Приоритетные задачи, которые нужно решить первым</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {urgentActions.map((action) => (
                <ActionCard
                  key={action.id}
                  title={action.title}
                  value={action.value}
                  tone={action.tone}
                  hint={action.hint}
                  href={action.href}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {profilePlan === 'trial' && trialLaunchSteps.length > 0 ? (
        <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="p-6 md:p-8 border-b border-slate-100">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-white shadow-lg shadow-amber-500/20">
                <Rocket className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Первые шаги</h2>
                <p className="text-sm text-slate-500 font-medium mt-0.5">
                  Собери базовый контур: прокси, юзербот, платежи и первая продажа
                </p>
              </div>
            </div>
          </div>
          <div className="p-6 md:p-8">
            <div className="space-y-3">
              {trialLaunchSteps.map((step, index) => (
                <div
                  key={step.title}
                  className={`
                    flex items-center gap-4 p-4 rounded-2xl border transition-all duration-200
                    ${step.done
                      ? 'bg-green-50 border-green-200'
                      : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                    }
                  `}
                >
                  <div className={`
                    w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0
                    ${step.done
                      ? 'bg-green-500 text-white'
                      : 'bg-slate-300 text-slate-700'
                    }
                  `}>
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-900">{step.title}</div>
                    <div className="text-sm text-slate-500 mt-0.5">{step.hint}</div>
                  </div>
                  <a
                    href={step.href}
                    className={`
                      px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 flex-shrink-0
                      ${step.done
                        ? 'bg-green-600 text-white hover:bg-green-700'
                        : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-500/20'
                      }
                    `}
                  >
                    {step.done ? 'Готово' : 'Открыть'}
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {profilePlan === 'normal' && normalLaunchSteps.length > 0 ? (
        <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="p-6 md:p-8 border-b border-slate-100">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
                <Activity className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Развитие Normal</h2>
                <p className="text-sm text-slate-500 font-medium mt-0.5">
                  Расширь контур: больше прокси, второй юзербот, рассылки и продажи
                </p>
              </div>
            </div>
          </div>
          <div className="p-6 md:p-8">
            <div className="space-y-3">
              {normalLaunchSteps.map((step, index) => (
                <div
                  key={step.title}
                  className={`
                    flex items-center gap-4 p-4 rounded-2xl border transition-all duration-200
                    ${step.done
                      ? 'bg-green-50 border-green-200'
                      : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                    }
                  `}
                >
                  <div className={`
                    w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0
                    ${step.done
                      ? 'bg-green-500 text-white'
                      : 'bg-slate-300 text-slate-700'
                    }
                  `}>
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-900">{step.title}</div>
                    <div className="text-sm text-slate-500 mt-0.5">{step.hint}</div>
                  </div>
                  <a
                    href={step.href}
                    className={`
                      px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 flex-shrink-0
                      ${step.done
                        ? 'bg-green-600 text-white hover:bg-green-700'
                        : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-500/20'
                      }
                    `}
                  >
                    {step.done ? 'Готово' : 'Открыть'}
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* topStats и urgentActions теперь показаны только в главной карточке выше */}

      {moneyStats.length > 0 ? (
        <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="p-6 md:p-8 border-b border-slate-100">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center text-white shadow-lg shadow-green-500/20">
                <Wallet className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Бизнес метрики</h2>
                <p className="text-sm text-slate-500 font-medium mt-0.5">
                  Деньги, клиенты и продажи
                </p>
              </div>
            </div>
          </div>
          <div className="p-6 md:p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {moneyStats.map((item) => (
                <div
                  key={item.title}
                  className={`
                    p-4 rounded-2xl border transition-all duration-200
                    ${item.tone === 'warning'
                      ? 'bg-amber-50 border-amber-200'
                      : 'bg-slate-50 border-slate-200'
                    }
                  `}
                >
                  <div className="text-sm text-slate-500 font-medium mb-1">{item.title}</div>
                  <div className="text-2xl font-black text-slate-900">{item.value}</div>
                  <div className="text-xs text-slate-400 mt-2">{item.hint}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {infraStats.length > 0 ? (
        <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="p-6 md:p-8 border-b border-slate-100">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-violet-500/20">
                <Database className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Инфраструктура</h2>
                <p className="text-sm text-slate-500 font-medium mt-0.5">
                  Прокси, юзерботы, группы и ошибки
                </p>
              </div>
            </div>
          </div>
          <div className="p-6 md:p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {infraStats.map((item) => (
                <div
                  key={item.title}
                  className={`
                    p-4 rounded-2xl border transition-all duration-200
                    ${item.tone === 'warning'
                      ? 'bg-amber-50 border-amber-200'
                      : 'bg-slate-50 border-slate-200'
                    }
                  `}
                >
                  <div className="text-sm text-slate-500 font-medium mb-1">{item.title}</div>
                  <div className="text-2xl font-black text-slate-900">{item.value}</div>
                  <div className="text-xs text-slate-400 mt-2">{item.hint}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {channelStats.length > 0 ? (
        <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="p-6 md:p-8 border-b border-slate-100">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center text-white shadow-lg shadow-red-500/20">
                <Shield className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Группы без прав</h2>
                <p className="text-sm text-slate-500 font-medium mt-0.5">
                  {channelStats.length} {channelStats.length === 1 ? 'группа' : 'групп'} нужно разобрать
                </p>
              </div>
            </div>
          </div>
          <div className="p-6 md:p-8">
            <div className="space-y-3">
              {channelStats.map((row) => (
                <div
                  key={row.id}
                  className="p-4 rounded-2xl border border-slate-200 bg-slate-50 hover:border-slate-300 transition-all duration-200"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-900 mb-2">{row.title}</div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div>
                          <div className="text-slate-500">Бот админ</div>
                          <div className="font-medium text-slate-900">{row.hasOfficialBot ? '✓ Да' : '✗ Нет'}</div>
                        </div>
                        <div>
                          <div className="text-slate-500">Активных</div>
                          <div className="font-medium text-slate-900">{row.activeSubscribers}</div>
                        </div>
                        <div>
                          <div className="text-slate-500">Не подтвердили</div>
                          <div className="font-medium text-amber-600">{row.paidNotJoined}</div>
                        </div>
                        <div>
                          <div className="text-slate-500">Сгорели, но внутри</div>
                          <div className="font-medium text-red-600">{row.expiredButInside}</div>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-500/20 flex-shrink-0"
                      onClick={() => openAdminGroups(row.hasOfficialBot ? 'ready' : 'need_bot')}
                    >
                      Разобрать права
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {recentInboxAlertRows.length > 0 ? (
        <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="p-6 md:p-8 border-b border-slate-100">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                <Send className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Сообщения от юзерботов</h2>
                <p className="text-sm text-slate-500 font-medium mt-0.5">
                  {recentInboxAlertRows.length} {recentInboxAlertRows.length === 1 ? 'новый сигнал' : 'новых сигналов'}
                </p>
              </div>
            </div>
          </div>
          <div className="p-6 md:p-8">
            <div className="space-y-3">
              {recentInboxAlertRows.slice(0, 5).map((row) => (
                <div
                  key={`${row.userbot_id}-${row.tg_user_id}-${row.notified_at}`}
                  className="p-4 rounded-2xl border border-slate-200 bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-900 mb-1">{row.userbot_label}</div>
                      <div className="text-sm text-slate-600 mb-2 truncate">{row.preview_text || 'Без текста'}</div>
                      <div className="flex items-center gap-4 text-sm text-slate-500">
                        <span>TG ID: <span className="font-medium text-slate-900">{row.tg_user_id}</span></span>
                        <span>{formatWhen(row.notified_at)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {recentTelegramErrorRows.length > 0 ? (
        <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="p-6 md:p-8 border-b border-slate-100">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center text-white shadow-lg shadow-orange-500/20">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Ошибки и ограничения</h2>
                <p className="text-sm text-slate-500 font-medium mt-0.5">
                  {recentTelegramErrorRows.length} {recentTelegramErrorRows.length === 1 ? 'проблема' : 'проблем'}
                </p>
              </div>
            </div>
          </div>
          <div className="p-6 md:p-8">
            <div className="space-y-3">
              {recentTelegramErrorRows.slice(0, 5).map((row) => (
                <div
                  key={row.id}
                  className="p-4 rounded-2xl border border-red-200 bg-red-50"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-900 mb-1">{row.userbot_label}</div>
                      <div className="text-sm text-red-700 font-medium mb-2">{row.restriction_kind}</div>
                      <div className="text-sm text-slate-600 mb-1">{row.error_message || row.event_type}</div>
                      <div className="flex items-center gap-4 text-sm text-slate-500 mt-2">
                        <span>Источник: <span className="font-medium text-slate-900">{row.event_source}</span></span>
                        {row.tg_user_id && <span>TG ID: <span className="font-medium text-slate-900">{row.tg_user_id}</span></span>}
                        <span>{formatWhen(row.happened_at)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
