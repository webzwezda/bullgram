import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';

function formatDateOnly(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium'
  }).format(new Date(value));
}

function getTrialDaysLeft(value) {
  if (!value) return null;
  const diffMs = new Date(value).getTime() - Date.now();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function getTrialHoursLeft(value) {
  if (!value) return null;
  const diffMs = new Date(value).getTime() - Date.now();
  return Math.ceil(diffMs / (1000 * 60 * 60));
}

function planMeta(plan, trialEndsAt) {
  if (plan === 'pro') {
    return {
      title: 'Текущий план: Pro',
      hint: 'Скрытый высокий контур. Тут уже не trial, а тяжелая операционка и более жирный стек.',
      pillClass: 'pill pill--warning',
      pillText: 'Pro'
    };
  }

  if (plan === 'normal') {
    return {
      title: 'Текущий план: Normal',
      hint: 'Основной рабочий контур. Trial уже не держит тебя за горло по базовым ограничениям.',
      pillClass: 'pill pill--ok',
      pillText: 'Normal'
    };
  }

  const daysLeft = getTrialDaysLeft(trialEndsAt);
  const expired = daysLeft !== null && daysLeft < 0;
  const dueSoon = daysLeft !== null && daysLeft <= 3;

  return {
    title: 'Текущий план: Trial',
    hint: trialEndsAt
      ? expired
        ? `Trial закончился ${formatDateOnly(trialEndsAt)}. Пора переводить контур на рабочий тариф.`
        : dueSoon
          ? `Trial до ${formatDateOnly(trialEndsAt)}. Осталось ${Math.max(daysLeft, 0)} дн.`
          : `Trial до ${formatDateOnly(trialEndsAt)}. Пока есть время спокойно собрать контур.`
      : 'Trial включен, но дата окончания пока не прописана.',
    pillClass: dueSoon || expired ? 'pill pill--danger' : 'pill pill--info',
    pillText: expired ? 'Trial истек' : 'Trial'
  };
}

function packageSignalStatusText(status) {
  if (status === 'failed') return 'Handoff сломан';
  if (status === 'awaiting_receipt') return 'Ждет ручную проверку';
  if (status === 'pending') return 'Checkout открыт';
  if (status === 'paid') return 'Уже куплено';
  if (status === 'expired') return 'Протухший checkout';
  return 'Есть движение';
}

function packageSignalPillClass(tone) {
  if (tone === 'danger') return 'pill pill--danger';
  if (tone === 'warning') return 'pill pill--warning';
  if (tone === 'ok') return 'pill pill--ok';
  return 'pill pill--info';
}

function packageSignalTitle(signal) {
  if (signal.id === 'trial') return 'Trial';
  if (signal.id === 'normal') return 'Normal';
  return 'Seller mode';
}

function sellerModeTitle(sellerCanSellAssets) {
  return sellerCanSellAssets ? 'Asset marketplace' : 'P2P seller';
}

function packageSignalHint(signal, profilePlan) {
  if (signal.id === 'trial') {
    if (signal.status === 'paid') {
      return 'Trial уже куплен. Теперь не зависай в витрине: забери бесплатный прокси, подключи первого юзербота и собери первый рабочий контур.';
    }
    if (signal.status === 'pending') {
      return 'Входной Trial checkout уже открыт. Сначала закрой его, а не запускай новый сценарий сверху.';
    }
    if (signal.status === 'awaiting_receipt') {
      return 'Trial уже ждет ручной проверки. Не плодись новыми оплатами, пока этот хвост не разберут.';
    }
    if (signal.status === 'failed') {
      return 'Оплата уже была, но handoff сломан. Сначала добей входной Trial, потом двигайся дальше.';
    }
    return 'Стартовый пакет BullRun: первый checkout, первый юзербот и первый money-ops контур.';
  }

  if (signal.id === 'normal') {
    if (signal.status === 'paid' || profilePlan === 'normal' || profilePlan === 'pro') {
      return 'Normal уже открыт. Следующий шаг — снять trial-стопоры и дожать CRM, рассылки, seller-flow и второй юзербот.';
    }
    if (signal.status === 'pending') {
      return 'Апгрейд на Normal уже открыт. Закрой checkout и только потом расширяй рабочий контур.';
    }
    if (signal.status === 'awaiting_receipt') {
      return 'Normal уже ждет ручной проверки. Не открывай новый апгрейд поверх этого хвоста.';
    }
    if (signal.status === 'failed') {
      return 'Normal уже оплачен, но handoff сломан. Сначала почини апгрейд, потом двигайся в seller и масштабирование.';
    }
    return 'Основной рабочий пакет: снимает Trial-лимиты и открывает полноценный money ops stack.';
  }

  if (signal.status === 'paid') {
    return 'Seller mode уже куплен. Теперь важны inventory, seller-аккаунт, публикация лотов и чистый handoff продаж.';
  }
  if (signal.status === 'pending') {
    return 'Seller checkout уже открыт. Сначала добей его, потом открывай seller admin и собирай витрину.';
  }
  if (signal.status === 'awaiting_receipt') {
    return 'Seller mode уже ждет ручной проверки. Не запускай новый seller-flow, пока этот checkout не разберут.';
  }
  if (signal.status === 'failed') {
    return 'Seller уже оплачен, но передача прав сломалась. Сначала разбери handoff, потом открывай продажу лотов.';
  }
  return 'Seller mode нужен, когда Trial/Normal уже собраны и пора продавать офферы, активы и базы через BullRun.';
}

function packageSignalHref(signal, profilePlan) {
  if (signal.id === 'trial') return signal.href || '/shop?offer=trial';
  if (signal.id === 'normal') {
    return signal.href || (profilePlan === 'trial' ? '/shop?offer=normal' : '/app/shop');
  }
  return signal.href || (profilePlan === 'normal' || profilePlan === 'pro' ? '/app/shop' : '/shop?offer=seller');
}

function ChecklistItem({ item }) {
  const stateClass = item.state === 'done'
    ? 'checklist__item checklist__item--ok'
    : item.state === 'active'
      ? 'checklist__item checklist__item--active'
      : 'checklist__item checklist__item--warn';

  return (
    <div className={stateClass}>
      <div className="checklist__row">
        <div className="checklist__step">
          <span className={`checklist__index checklist__index--${item.state}`}>{item.index}</span>
          <div className="checklist__title">{item.title}</div>
        </div>
        <span className={`pill ${
          item.state === 'done'
            ? 'pill--ok'
            : item.state === 'active'
              ? 'pill--warning'
              : 'pill--info'
        }`}>
          {item.state === 'done' ? 'Готово' : item.state === 'active' ? 'Следующий' : 'Потом'}
        </span>
      </div>
      <div className="checklist__hint">{item.hint}</div>
      {item.onClick ? (
        <button className="checklist__link checklist__link--button" onClick={item.onClick}>
          {item.actionLabel || 'Открыть'}
        </button>
      ) : item.href ? (
        <a className="checklist__link" href={item.href}>
          {item.actionLabel || 'Открыть'}
        </a>
      ) : null}
    </div>
  );
}

export function OpsChecklistRail() {
  const {
    accessToken,
    loading,
    user,
    profileRole,
    profilePlan,
    trialStartedAt,
    trialEndsAt,
    login,
    logout
  } = useAuth();
  const [state, setState] = useState({
    loading: true,
    error: '',
    summary: null,
    paymentReadiness: null,
    buyerPackageSignals: [],
    updatedAt: null
  });

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      if (!accessToken) return;
      try {
        const [data, settingsResponse] = await Promise.all([
          apiRequest('/api/dashboard', { accessToken }),
          apiRequest('/api/payment-settings', { accessToken }).catch(() => null)
        ]);

        const settings = settingsResponse?.settings || null;

        const paymentReadiness = settings
          ? {
              ...(data.paymentReadiness || {}),
              hasSettings: true,
              hasTon: !!settings.ton_wallet,
              hasSbp: !!(settings.sbp_phone || settings.sbp_bank),
              adminTgId: settings.admin_tg_id ? String(settings.admin_tg_id) : ''
            }
          : (data.paymentReadiness || {});
        if (cancelled) return;
        setState({
          loading: false,
          error: '',
          summary: data.summary || {},
          paymentReadiness,
          buyerPackageSignals: data.buyerPackageSignals || [],
          updatedAt: new Date().toISOString()
        });
      } catch (error) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: error.message
        }));
      }
    }

    loadData();
    const intervalId = accessToken ? window.setInterval(loadData, 60_000) : null;
    const refreshHandler = (event) => {
      if (event?.detail?.paymentReadiness) {
        setState((prev) => ({
          ...prev,
          paymentReadiness: {
            ...(prev.paymentReadiness || {}),
            ...event.detail.paymentReadiness
          },
          updatedAt: new Date().toISOString()
        }));
      }
      window.setTimeout(() => {
        loadData();
      }, 150);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('bullrun:payment-settings-updated', refreshHandler);
    }

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
      if (typeof window !== 'undefined') {
        window.removeEventListener('bullrun:payment-settings-updated', refreshHandler);
      }
    };
  }, [accessToken]);

  const currentPlan = useMemo(() => planMeta(profilePlan, trialEndsAt), [profilePlan, trialEndsAt]);
  const trialHoursLeft = useMemo(() => getTrialHoursLeft(trialEndsAt), [trialEndsAt]);
  const trialUpgradeUrgent = profilePlan === 'trial' && trialHoursLeft !== null && trialHoursLeft > 0 && trialHoursLeft <= 72;
  const buyerPackageSignals = state.buyerPackageSignals || [];
  const sellerCanSellAssets = profileRole === 'admin';
  const sellerSignal = buyerPackageSignals.find((signal) => signal.id === 'seller');

  const sellerPulse = useMemo(() => {
    if (!sellerSignal && profilePlan === 'trial') return null;

    if (!sellerSignal) {
      return {
        title: sellerModeTitle(sellerCanSellAssets),
        hint: sellerCanSellAssets
          ? 'Когда Trial и Normal уже собраны, следующий слой денег — собрать seller inventory, seller-аккаунт и handoff активов.'
          : 'Когда Trial и Normal уже собраны, следующий слой денег — скрытые P2P-офферы, TON/P2P checkout и buyer-side handoff без ручной каши.',
        href: sellerCanSellAssets ? '/shop?offer=seller' : '/shop?offer=seller',
        pillClass: 'pill',
        pillText: 'Следующий слой'
      };
    }

    if (sellerSignal.status === 'paid') {
      return {
        title: sellerModeTitle(sellerCanSellAssets),
        hint: sellerCanSellAssets
          ? 'Seller mode уже открыт. Теперь важны inventory, seller-аккаунт, опубликованные лоты и чистый handoff активов.'
          : 'P2P seller уже открыт. Теперь ключевые шаги — реквизиты, hidden-message оффер и buyer-side handoff без ручной возни.',
        href: '/app/shop',
        pillClass: 'pill pill--ok',
        pillText: 'Открыт'
      };
    }

    if (sellerSignal.status === 'pending') {
      return {
        title: sellerModeTitle(sellerCanSellAssets),
        hint: 'Seller checkout уже открыт. Сначала добей текущую покупку, а не запускай новый seller-сценарий сверху.',
        href: '/shop?offer=seller',
        pillClass: 'pill pill--warning',
        pillText: 'Checkout открыт'
      };
    }

    if (sellerSignal.status === 'awaiting_receipt') {
      return {
        title: sellerModeTitle(sellerCanSellAssets),
        hint: 'Seller checkout уже ждет ручной проверки. Не плодись новыми апгрейдами, пока этот хвост не закроют.',
        href: '/shop?offer=seller',
        pillClass: 'pill pill--warning',
        pillText: 'Ждет чек'
      };
    }

    if (sellerSignal.status === 'failed') {
      return {
        title: sellerModeTitle(sellerCanSellAssets),
        hint: 'Seller mode уже оплачен, но handoff сломан. Сначала добей передачу прав, потом открывай seller-операционку.',
        href: '/shop?offer=seller',
        pillClass: 'pill pill--danger',
        pillText: 'Handoff сломан'
      };
    }

    return {
      title: sellerModeTitle(sellerCanSellAssets),
      hint: sellerCanSellAssets
        ? 'Seller mode нужен, когда пора продавать активы BullRun: прокси, юзерботов, комплекты и базы.'
        : 'Seller mode нужен, когда пора закрывать P2P/hidden-message офферы на сайте как отдельный денежный слой.',
      href: '/shop?offer=seller',
      pillClass: 'pill',
      pillText: 'Следующий слой'
    };
  }, [profilePlan, sellerCanSellAssets, sellerSignal]);

  const checklist = useMemo(() => {
    const summary = state.summary || {};
    const payment = state.paymentReadiness || {};

    const steps = [
      {
        key: 'payments',
        done: !!payment.hasTon && !!payment.hasSbp,
        title: 'Заполни реквизиты',
        hint: (!!payment.hasTon && !!payment.hasSbp)
          ? 'TON и СБП уже на месте. Покупателю будет куда платить.'
          : 'Сначала укажи TON-кошелек и СБП. Без этого checkout будет пустым.',
        href: '/app/payments',
        actionLabel: 'Открыть реквизиты'
      },
      {
        key: 'official-bot',
        done: (summary.salesBotCount || 0) > 0 || (summary.channelWithBotCount || 0) > 0,
        title: 'Добавь official bot',
        hint: ((summary.salesBotCount || 0) > 0 || (summary.channelWithBotCount || 0) > 0)
          ? 'Official bot уже подключен и участвует в доступе.'
          : 'Добавь official bot и доведи его до админа в группах, где будут продажи и доступ.',
        href: '/app/admin-groups',
        actionLabel: 'Открыть группы и права'
      },
      {
        key: 'proxy',
        done: (summary.proxyCount || 0) > 0,
        title: 'Создай прокси',
        hint: (summary.proxyCount || 0) > 0
          ? `Прокси уже есть: ${summary.proxyCount}. Можно сажать на него юзербота.`
          : 'Подними первый прокси. У вас правило жесткое: один прокси = один юзербот.',
        href: '/app/proxies',
        actionLabel: 'Открыть прокси'
      },
      {
        key: 'userbot',
        done: (summary.userbotCount || 0) > 0,
        title: 'Подключи юзербота',
        hint: (summary.userbotCount || 0) > 0
          ? 'Юзербот уже подключен. Telegram-контур начал собираться.'
          : 'После прокси подключи первого юзербота. Без него не будет ручной работы и части Telegram-операционки.',
        href: '/app/userbots',
        actionLabel: 'Открыть юзерботов'
      }
    ];

    let firstPendingFound = false;
    return steps.map((item, index) => {
      let state = 'todo';
      if (item.done) {
        state = 'done';
      } else if (!firstPendingFound) {
        state = 'active';
        firstPendingFound = true;
      }

      return {
        ...item,
        index: index + 1,
        state
      };
    });
  }, [accessToken, login, state.paymentReadiness, state.summary, user]);

  const profileName = user?.user_metadata?.full_name || user?.user_metadata?.name || 'Оператор BullRun';
  const profileEmail = user?.email || '';
  const avatarUrl = user?.user_metadata?.avatar_url || '';
  const profileInitial = (profileEmail || profileName || 'U').trim().charAt(0).toUpperCase();
  const planText = currentPlan?.pillText || 'План не определен';
  const summary = state.summary || {};
  const completedChecklistCount = checklist.filter((item) => item.state === 'done').length;
  const activeChecklistItem = checklist.find((item) => item.state === 'active');

  return (
    <aside className="ops-rail">
      <div className="ops-rail__card ops-rail__card--profile ops-rail__card--surface">
        <div className="sidebar-profile__head">
          {avatarUrl ? (
            <img className="sidebar-profile__avatar" src={avatarUrl} alt={profileName} />
          ) : (
            <div className="sidebar-profile__fallback">{profileInitial}</div>
          )}
          <div className="sidebar-profile__info">
            <div className="sidebar-profile__name sidebar-profile__name--dark">{profileName}</div>
            <div className="sidebar-profile__email sidebar-profile__email--dark">{profileEmail || 'Без email в профиле'}</div>
          </div>
        </div>
        <div className="sidebar-profile__plan">
          <div className="sidebar-profile__plan-label">Тарифный план</div>
          <div className="sidebar-profile__plan-row">
            <span className={`sidebar-profile__plan-value ${currentPlan?.pillClass || 'pill pill--info'}`}>
              {planText}
            </span>
          </div>
          <div className="sidebar-profile__plan-hint">{currentPlan?.hint || 'План еще не подтянулся из профиля.'}</div>
        </div>
        <a className="checklist__link" href="/pricing">
          Изменить тариф
        </a>
        {user ? (
          <button className="sidebar-profile__logout sidebar-profile__logout--dark" onClick={logout}>
            Выйти из системы
          </button>
        ) : (
          <button className="sidebar-profile__logout sidebar-profile__logout--dark" onClick={login}>
            Войти через Google
          </button>
        )}
      </div>

      <div className="ops-rail__card ops-rail__card--surface ops-rail__card--checklist">
        <div className="ops-rail__card-head">
          <div>
          </div>
          <span className="pill pill--info">{completedChecklistCount}/{checklist.length}</span>
        </div>
        <div className="ops-rail__text">
          Сначала реквизиты, потом official bot, потом прокси и только после этого юзербот.
        </div>
        {activeChecklistItem ? (
          <div className="ops-rail__meta">
            Сейчас главный следующий шаг: <strong>{activeChecklistItem.title.toLowerCase()}</strong>
          </div>
        ) : (
          <div className="ops-rail__meta">
            Базовый контур уже собран. Дальше можно спокойно дожимать shop, доступ и продажи.
          </div>
        )}
        <div className="ops-rail__stack">
          {checklist.map((item) => (
            <ChecklistItem key={item.key} item={item} />
          ))}
        </div>
      </div>

      <div className="ops-rail__card ops-rail__card--profile ops-rail__card--surface">
        <div className="ops-rail__text">
          Проверка чеков:{' '}
          <strong className="status-text status-text--ok">
            под рукой
          </strong>
        </div>
        <div className="ops-rail__text">
          Сюда падают СБП-чеки, которые покупатель уже отправил и которые надо подтвердить или отклонить вручную.
        </div>
        <a className="checklist__link checklist__link--gradient" href="/app/shop-receipts">
          Открыть проверку чеков
        </a>
      </div>

    </aside>
  );
}
