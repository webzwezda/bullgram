import { useEffect, useMemo, useState } from 'react';
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
      title: 'Пробники висят',
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
      hint: `Битые: ${summary.brokenProxyCount || 0}. Старые опасные shared-связки: ${summary.sharedProxyCount || 0}.`
    },
    {
      title: 'Failover включен',
      value: summary.userbotFailoverEnabledCount || 0,
      hint: `Недавние авто-переезды: ${summary.recentFailoversCount || 0}. Пустой fallback-пул: ${summary.userbotFailoverMisconfiguredCount || 0}.`
    },
    {
      title: 'Ops-сигналы',
      value: summary.recentInboxAlerts || 0,
      tone: summary.signalRoutingReady ? 'default' : 'warning',
      hint: summary.signalRoutingReady
        ? `Контур собран: ops-ботов ${summary.opsBotCount || 0}, admin_tg_id задан.`
        : 'Контур не собран: либо нет admin_tg_id, либо нет official-бота с ролью ops.'
    },
    {
      title: 'Базы',
      value: summary.customerBaseCount || 0,
      hint: `Доступно seller-лотов: ${summary.shopPublishedItemCount || 0}.`
    }
  ]), [summary]);

  const trialLaunchSteps = useMemo(() => {
    if (profilePlan !== 'trial') return [];

    return [
      {
        title: 'Забери или проверь прокси',
        done: (summary.proxyCount || 0) > 0,
        hint: (summary.proxyCount || 0) > 0
          ? `Прокси уже есть: ${summary.proxyCount}. Проверь, что он Telegram-compatible.`
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
        title: 'Проверь платежный контур',
        done: !!paymentReadiness.hasTon,
        hint: paymentReadiness.hasTon
          ? 'TON-кошелек задан. Можно идти в shop и закрывать первый платеж.'
          : 'Задай TON-кошелек, чтобы Trial не был просто красивой витриной без денег.',
        href: '/app/payments'
      },
      {
        title: 'Закрой первый checkout',
        done: (summary.shopPaidPurchases || 0) > 0 || (summary.activeSubscribers || 0) > 0,
        hint: (summary.shopPaidPurchases || 0) > 0 || (summary.activeSubscribers || 0) > 0
          ? 'Первый checkout уже есть. Теперь видно, где Trial начинает упираться в лимиты.'
          : 'Иди в Shop, закрой первый TON/P2P checkout и потом возвращайся сюда смотреть, где течет контур.',
        href: '/shop?offer=trial'
      }
    ];
  }, [paymentReadiness.hasTon, profilePlan, summary.activeSubscribers, summary.proxyCount, summary.shopPaidPurchases, summary.userbotCount]);

  const normalLaunchSteps = useMemo(() => {
    if (profilePlan !== 'normal') return [];

    return [
      {
        title: 'Собери боевой proxy stack',
        done: (summary.proxyCount || 0) > 1,
        hint: (summary.proxyCount || 0) > 1
          ? `Прокси уже больше одного: ${summary.proxyCount}. Можно держать не только входной контур, но и рабочую операционку.`
          : 'Один trial-прокси уже не тянет рабочий режим. Добери хотя бы второй прокси под боевой контур.',
        href: '/app/proxies'
      },
      {
        title: 'Подними второй юзербот или seller-аккаунт',
        done: (summary.userbotCount || 0) > 1,
        hint: (summary.userbotCount || 0) > 1
          ? 'В кабинете уже больше одного юзербота. Контур перестал быть trial-одиночкой.'
          : 'Normal начинает ощущаться, когда у тебя не один входной юзербот, а рабочая связка под диалоги, группы и seller-flow.',
        href: '/app/userbots'
      },
      {
        title: 'Запусти первый боевой дожим',
        done: (summary.broadcastCount || 0) > 0 || (summary.remindedInvoices || 0) > 0,
        hint: (summary.broadcastCount || 0) > 0 || (summary.remindedInvoices || 0) > 0
          ? 'Рассылки и дожим уже пошли. Normal работает как контур возврата хвостов, а не как витрина.'
          : 'Дальше Normal надо проверять не словами, а реальной рассылкой, abandoned или retention-дожимом.',
        href: '/app/broadcast'
      },
      {
        title: 'Собери seller или рабочий checkout',
        done: (summary.shopPublishedItemCount || 0) > 0 || (summary.shopPaidPurchases || 0) > 0,
        hint: (summary.shopPublishedItemCount || 0) > 0 || (summary.shopPaidPurchases || 0) > 0
          ? 'Shop уже не пустой: есть либо лоты, либо реальные продажи.'
          : 'Normal надо дожимать до денег: выставь рабочий оффер, seller-лот или закрой нормальный checkout под свой сценарий.',
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
    <section className="page">
      <div className="page__header">
        <h1>Командный центр</h1>
        <p>
          Первый реальный экран `admin-v2`. Здесь уже тянется живой backend и видно, где деньги, где
          инфраструктура течет и куда надо бежать прямо сейчас.
        </p>
        <div className="page__meta">
          <span>Последнее обновление: {formatWhen(state.updatedAt)}</span>
          <span>{state.refreshing ? 'Обновляем фон...' : 'Экран обновляется сам раз в минуту.'}</span>
          <span>
            Платежный контур: {paymentReadiness.hasTon ? 'TON задан' : 'TON не настроен'}
            {paymentReadiness.adminTgId ? ` • admin_tg_id ${paymentReadiness.adminTgId}` : ' • admin_tg_id нет'}
          </span>
        </div>
      </div>

      <div className="hero-panel">
        <div className="hero-panel__body">
          <div className="hero-panel__eyebrow">Центр управления</div>
          <div className="hero-panel__title">Смотри, где деньги, где течет контур и кто из админов сейчас не дотягивает.</div>
          <div className="hero-panel__text">
            Это уже не старый dashboard ради цифр. Здесь у тебя оперативный вход в деньги, доступ,
            прокси, shop и сигналы от юзерботов. Открыл утром — сразу понял, куда жать первым.
          </div>
          <div className="hero-panel__actions">
            <a className="hero-link" href="/app/customers?tab=orders">Разобрать деньги</a>
            <a className="hero-link" href="/app/customers?tab=access">Разобрать доступ</a>
            <a className="hero-link" href="/app/userbots">Чинить ботов и прокси</a>
            <a className="hero-link" href="/app/shop">Открыть seller ops</a>
            <button className="hero-link hero-link--button" type="button" onClick={() => openAdminGroups('need_bot')}>Права в группах</button>
          </div>
        </div>
        <div className="hero-panel__grid">
          {prioritySignals.map((item) => (
            <div key={item.title} className={`priority-chip priority-chip--${item.tone}`}>
              <div className="priority-chip__title">{item.title}</div>
              <div className="priority-chip__value">{item.value}</div>
              <div className="priority-chip__hint">{item.hint}</div>
            </div>
          ))}
        </div>
      </div>

      {profilePlan === 'trial' ? (
        <div className="section">
          <div className="section__title">Как дожать Trial до первого результата</div>
          <div className="grid grid--double">
            <div className="table-card">
              <div className="table-card__title">Путь первого запуска</div>
              <div className="checklist-stack">
                {trialLaunchSteps.map((step) => (
                  <div key={step.title} className={`checklist-row${step.done ? ' checklist-row--done' : ''}`}>
                    <div>
                      <div className="checklist-row__title">{step.title}</div>
                      <div className="checklist-row__hint">{step.hint}</div>
                    </div>
                    <a className="inline-action" href={step.href}>
                      {step.done ? 'Проверить' : 'Сделать'}
                    </a>
                  </div>
                ))}
              </div>
            </div>
            <div className="table-card">
              <div className="table-card__title">Когда уже пора на Normal</div>
              <div className="empty-inline">
                {trialUpgradeUrgent
                  ? `До конца trial осталось около ${trialHoursLeft} ч. Если контур уже прогрет, не тяни: переводи кабинет на Normal до дедлайна, а не после него.`
                  : `Trial до ${formatWhen(trialEndsAt)}. Как только уперся во второй юзербот, seller-mode, рассылки или нормальный боевой CRM-контур, не тяни и переводи кабинет на рабочий тариф.`}
              </div>
              <UpgradeCallout
                title={trialUpgradeUrgent ? `Trial скоро сгорит: осталось около ${trialHoursLeft} ч` : 'Trial дал первый результат. Дальше нужен Normal.'}
                text={trialUpgradeUrgent
                  ? 'Если уже закрыл первый платеж или собрал базовый контур, не жди жесткого стопора. Переходи на Normal прямо сейчас и снимай trial-лимиты до истечения срока.'
                  : 'На Trial важно закрыть первый платеж и понять контур. Как только начинаешь строить регулярную работу, seller flow или несколько аккаунтов, пора идти в Normal.'}
              />
            </div>
          </div>
        </div>
      ) : null}

      {profilePlan === 'normal' ? (
        <div className="section">
          <div className="section__title">Как дожать Normal до боевого контура</div>
          <div className="grid grid--double">
            <div className="table-card">
              <div className="table-card__title">Следующие шаги после апгрейда</div>
              <div className="checklist-stack">
                {normalLaunchSteps.map((step) => (
                  <div key={step.title} className={`checklist-row${step.done ? ' checklist-row--done' : ''}`}>
                    <div>
                      <div className="checklist-row__title">{step.title}</div>
                      <div className="checklist-row__hint">{step.hint}</div>
                    </div>
                    <a className="inline-action" href={step.href}>
                      {step.done ? 'Проверить' : 'Сделать'}
                    </a>
                  </div>
                ))}
              </div>
            </div>
            <div className="table-card">
              <div className="table-card__title">Что уже должен дать Normal</div>
              <div className="empty-inline">
                Теперь задача не “понять продукт”, а собрать устойчивый money ops stack: несколько прокси, рабочий Telegram-контур, seller-flow, рассылки и возврат хвостов без trial-затыков.
              </div>
              <div className="checklist-stack" style={{ marginTop: 14 }}>
                <div className="checklist-row checklist-row--done">
                  <div>
                    <div className="checklist-row__title">Trial закончился как тест</div>
                    <div className="checklist-row__hint">Теперь новый кабинет должен жить на регулярных checkout, CRM и seller-операционке, а не на одной демонстрационной покупке.</div>
                  </div>
                </div>
                <div className="checklist-row">
                  <div>
                    <div className="checklist-row__title">Следующий рост — уже в seller mode или Pro</div>
                    <div className="checklist-row__hint">Как только упрешься в тяжелый inventory, много активов и высокий seller-flow, дальше уже нужен следующий продуктовый слой.</div>
                  </div>
                  <a className="inline-action" href="/shop?offer=seller">
                    Смотреть seller mode
                  </a>
                </div>
              </div>
            </div>
          </div>
          <div className="table-card" style={{ marginTop: 16 }}>
            <div className="table-card__title">Seller launch board</div>
            <div className="empty-inline">
              Когда Normal уже собран, следующий денежный слой — не просто “посмотреть seller mode”, а собрать seller inventory, отдельный seller-аккаунт и рабочий handoff после оплаты.
            </div>
            <div className="checklist-stack" style={{ marginTop: 14 }}>
              {sellerLaunchSteps.map((step) => (
                <div key={step.title} className={`checklist-row${step.done ? ' checklist-row--done' : ''}`}>
                  <div>
                    <div className="checklist-row__title">{step.title}</div>
                    <div className="checklist-row__hint">{step.hint}</div>
                  </div>
                  <a className="inline-action" href={step.href}>
                    {step.done ? 'Проверить' : 'Сделать'}
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid">
        {topStats.map((item) => (
          <StatCard key={item.title} title={item.title} value={item.value} hint={item.hint} tone={item.tone} />
        ))}
      </div>

      <div className="section">
        <div className="section__title">Куда бежать прямо сейчас</div>
        <div className="grid">
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

      {buyerPackageSignals.length ? (
        <div className="section">
          <div className="section__title">Продуктовый маршрут по пакетам</div>
          <div className="grid">
            {buyerPackageSignals.map((signal) => (
              <ActionCard
                key={`package-${signal.id}`}
                title={packageSignalTitle(signal, sellerCanSellAssets)}
                value={packageSignalStatusText(signal.status)}
                tone={signal.tone}
                hint={packageSignalHint(signal, profilePlan, sellerCanSellAssets)}
                href={packageSignalHref(signal, profilePlan)}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="section">
        <div className="section__title">Деньги и оплаты</div>
        <div className="grid">
          {moneyStats.map((item) => (
            <StatCard key={item.title} title={item.title} value={item.value} hint={item.hint} tone={item.tone} />
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section__title">Инфраструктура</div>
        <div className="grid">
          {infraStats.map((item) => (
            <StatCard key={item.title} title={item.title} value={item.value} hint={item.hint} tone={item.tone} />
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section__title">Проблемные группы и чаты</div>
        <div className="table-card">
          {channelStats.length === 0 ? (
            <div className="empty-inline">Пока нет групп, которые нужно разбирать первыми.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Группа</th>
                  <th>Bot admin</th>
                  <th>Активных</th>
                  <th>Вход не подтвержден</th>
                  <th>Сгорели, но внутри</th>
                  <th>Действие</th>
                </tr>
              </thead>
              <tbody>
                {channelStats.map((row) => (
                  <tr key={row.id}>
                    <td>{row.title}</td>
                    <td>{row.hasOfficialBot ? 'Да' : 'Нет'}</td>
                    <td>{row.activeSubscribers}</td>
                    <td>{row.paidNotJoined}</td>
                    <td>{row.expiredButInside}</td>
                    <td>
                      <button
                        type="button"
                        className="inline-action inline-action--button"
                        onClick={() => openAdminGroups(row.hasOfficialBot ? 'ready' : 'need_bot')}
                      >
                        Разобрать права
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid grid--double">
        <div className="table-card">
          <div className="table-card__title">Последние сигналы от юзерботов</div>
          {recentInboxAlertRows.length === 0 ? (
            <div className="empty-inline">Пока тихо. Новых ops-сигналов нет.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Юзербот</th>
                  <th>TG ID</th>
                  <th>Превью</th>
                  <th>Когда</th>
                </tr>
              </thead>
              <tbody>
                {recentInboxAlertRows.map((row) => (
                  <tr key={`${row.userbot_id}-${row.tg_user_id}-${row.notified_at}`}>
                    <td>{row.userbot_label}</td>
                    <td>{row.tg_user_id}</td>
                    <td>{row.preview_text || 'Без текста'}</td>
                    <td>{formatWhen(row.notified_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="table-card">
          <div className="table-card__title">Telegram ошибки и ограничения</div>
          {recentTelegramErrorRows.length === 0 ? (
            <div className="empty-inline">Свежих flood/restricted/session ошибок не видно.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Аккаунт</th>
                  <th>Что случилось</th>
                  <th>Кому</th>
                  <th>Когда</th>
                </tr>
              </thead>
              <tbody>
                {recentTelegramErrorRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div>{row.userbot_label}</div>
                      <div className="table-subtext">{row.event_source}</div>
                    </td>
                    <td>
                      <div>{row.restriction_kind}</div>
                      <div className="table-subtext">{row.error_message || row.event_type}</div>
                    </td>
                    <td>{row.tg_user_id || '—'}</td>
                    <td>{formatWhen(row.happened_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid grid--double">
        <div className="table-card">
          <div className="table-card__title">Последние failover-переезды</div>
          {recentFailoverRows.length === 0 ? (
            <div className="empty-inline">За последние сутки авто-переездов на резервный прокси не было.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Юзербот</th>
                  <th>Откуда</th>
                  <th>Куда</th>
                  <th>Когда</th>
                </tr>
              </thead>
              <tbody>
                {recentFailoverRows.map((row) => (
                  <tr key={`${row.userbot_id}-${row.happened_at}`}>
                    <td>{row.userbot_label}</td>
                    <td>{row.from_proxy_label}</td>
                    <td>{row.to_proxy_label}</td>
                    <td>{formatWhen(row.happened_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="section">
        <div className="section__title">Старые опасные хвосты, которые надо разруливать</div>
        <div className="table-card">
          {sharedProxyRows.length === 0 ? (
            <div className="empty-inline">Ок. Старых shared-proxy связок сейчас нет.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Прокси</th>
                  <th>Страна</th>
                  <th>Юзерботов</th>
                  <th>Кто сидит</th>
                  <th>Действие</th>
                </tr>
              </thead>
              <tbody>
                {sharedProxyRows.map((row) => (
                  <tr key={row.proxy_id}>
                    <td>{row.proxy_label}</td>
                    <td>{row.proxy_country || 'Неизвестно'}</td>
                    <td>{row.userbot_count}</td>
                    <td>{row.userbot_labels.join(', ')}</td>
                    <td>
                      <InlineAction href="/app/proxies">Открыть прокси</InlineAction>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="section">
        <div className="section__title">Почему сюда переносим первыми</div>
        <div className="grid">
          <StatCard
            title="Что уже живое"
            value="API"
            hint="Командный центр уже сидит на живом /api/dashboard, а не на моках или рассказах про будущее."
          />
          <StatCard
            title="Что еще дочищаем"
            value="Triage"
            hint="Дальше сюда же дотягиваем последние редкие сценарии и потом окончательно закапываем старый кабинет."
          />
          <StatCard
            title="Принцип"
            value="Не ломать"
            hint="Новая админка должна переезжать по одному рабочему сценарию, а не переписываться залпом и терять операционку."
          />
        </div>
      </div>
    </section>
  );
}
