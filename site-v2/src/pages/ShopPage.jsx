import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CTASection, FeatureGrid, HighlightBand, SectionIntro } from '../components/MarketingPrimitives.jsx';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { apiRequest } from '../api/client.js';

const SHOP_TYPES = [
  {
    title: 'Пакеты запуска',
    text: 'Здесь можно выбрать пакет, который подходит под ваш текущий этап: первый запуск или уже рабочий канал.',
    meta: 'Trial и Normal без лишних страниц'
  },
  {
    title: 'Мои покупки',
    text: 'После оплаты здесь же видно статусы покупок, следующие шаги и то, где что зависло.',
    meta: 'Оплата, статус и доступ в одном месте'
  },
  {
    title: 'Следующий рабочий шаг',
    text: 'Если пакет уже куплен, страница должна вести не в лишние описания, а в понятное действие: кабинет, доступ или разбор хвоста.',
    meta: 'Покупка должна вести в работу'
  }
];

const CHECKOUT_PATHS = [
  {
    id: 'trial',
    eyebrow: 'Trial',
    title: 'Быстрый старт',
    text: 'Нужно вставить токен, проверить первую оплату и убедиться, что канал можно запускать без ручной возни.',
    href: '/shop?offer=trial'
  },
  {
    id: 'normal',
    eyebrow: 'Normal',
    title: 'Рабочий пакет',
    text: 'Нужен, когда канал уже живет и надо нормально вести оплаты, доступ, клиентов и продления.',
    href: '/shop?offer=normal'
  },
  {
    id: 'seller',
    eyebrow: 'Следующий слой',
    title: 'Более широкий сценарий',
    text: 'Подключается позже, когда базовый контур уже собран и простой запуск канала больше не покрывает задачи.',
    href: '/shop?offer=seller'
  }
];

const NORMAL_UPGRADE_DIFF = [
  {
    title: 'Юзерботы и прокси',
    trial: '1 юзербот и 1 бесплатный прокси',
    normal: 'Несколько юзерботов, докупка прокси и боевой proxy stack'
  },
  {
    title: 'Деньги и checkout',
    trial: 'Первый TON / P2P checkout и входной контур',
    normal: 'Нормальный рабочий checkout без trial-стопоров и с повторяемым потоком'
  },
  {
    title: 'CRM и дожим',
    trial: 'Посмотреть хвост и понять сценарий',
    normal: 'Писать, дожимать, рассылать и крутить реальный outreach-контур'
  },
  {
    title: 'Shop и seller mode',
    trial: 'Только посмотреть seller flow',
    normal: 'Продавать активы и офферы уже как рабочий seller-контур'
  }
];

const P2P_PAYMENT_MODES = [
  {
    title: 'TON',
    text: 'Сразу видишь QR, memo и дедлайн оплаты. После проверки BullRun сам открывает скрытое сообщение или двигает покупку дальше.'
  },
  {
    title: 'P2P / карта',
    text: 'Видишь реквизиты продавца, жмешь «Я оплатил» и ждешь ручное подтверждение. Подходит, если продавец работает не только через TON.'
  }
];

const TEXT_OFFER_STEPS = [
  'Выбери скрытый оффер и сразу увидишь, подходит ли он под Trial, Normal или быстрый P2P.',
  'Оплати через TON или P2P прямо на сайте, без прыжка в Telegram-бота.',
  'После закрытия оплаты BullRun откроет скрытое сообщение в твоих покупках.'
];

const PACKAGE_UNLOCKS = {
  trial: [
    '1 юзербот и 1 бесплатный прокси',
    'Первый TON / P2P checkout',
    'Проверка hidden-message сценария руками'
  ],
  normal: [
    'Рабочий money ops stack без trial-стопоров',
    'CRM, дожим и рассылки',
    'Нормальный seller и proxy flow'
  ],
  seller: [
    'Seller storefront и скрытые сделки',
    'Продажа активов BullRun',
    'Прямой денежный поток продавцу'
  ]
};

const NORMAL_UNLOCK_ACTIONS = [
  {
    title: 'Собери proxy stack',
    text: 'Normal перестает быть словами, когда у тебя больше одного рабочего прокси и они уже готовы под боевой контур.',
    href: '/app/proxies',
    label: 'Открыть прокси'
  },
  {
    title: 'Подключи второй юзербот',
    text: 'Следующий шаг после апгрейда — не смотреть витрину, а поднимать второй рабочий Telegram-аккаунт под диалоги, группы и seller-flow.',
    href: '/app/bots',
    label: 'Открыть боты'
  },
  {
    title: 'Запусти CRM и дожим',
    text: 'Normal дает смысл не сам по себе, а когда ты начинаешь возвращать хвосты, писать людям и крутить рабочий outreach-контур.',
    href: '/app/crm',
    label: 'Открыть CRM'
  },
  {
    title: 'Расширься в seller mode',
    text: 'Когда боевой контур уже жив, следующий денежный слой — seller storefront, скрытые лоты и продажа активов BullRun.',
    href: '/shop?offer=seller',
    label: 'Открыть seller mode'
  }
];

function buildSellerUnlockActions(isAssetMarketplace) {
  if (!isAssetMarketplace) {
    return [
      {
        title: 'Открой P2P seller',
        text: 'Первое действие после seller-покупки — зайти в seller admin и проверить, что hidden-офферы, handoff и buyer-side хвост уже под контролем.',
        href: '/app/shop',
        label: 'Открыть P2P seller'
      },
      {
        title: 'Подключи TON и P2P',
        text: 'P2P seller приносит деньги только если кошелек, реквизиты и seller-checkout уже готовы к первой оплате.',
        href: '/app/payments',
        label: 'Открыть реквизиты'
      },
      {
        title: 'Собери hidden-message оффер',
        text: 'Для текстового seller-flow нужен не inventory, а внятный скрытый оффер, который покупатель реально получает после оплаты.',
        href: '/app/shop',
        label: 'Собрать оффер'
      },
      {
        title: 'Проверь buyer-side handoff',
        text: 'Сразу проверь, что после оплаты покупатель видит скрытое сообщение и понятный следующий шаг, а не мертвый статус.',
        href: '/shop?offer=seller',
        label: 'Проверить checkout'
      }
    ];
  }

  return [
    {
      title: 'Открой seller admin',
      text: 'Первое действие после seller-покупки — зайти в seller admin и проверить, что витрина, handoff и очередь продаж уже под твоим контролем.',
      href: '/app/shop',
      label: 'Открыть seller admin'
    },
    {
      title: 'Подготовь inventory',
      text: 'Seller mode начинает приносить деньги, когда у тебя есть что реально продавать: прокси, юзерботы, комплекты или базы.',
      href: '/app/proxies',
      label: 'Прокси и inventory'
    },
    {
      title: 'Собери рабочий seller-аккаунт',
      text: 'Для реального seller-flow нужен не только checkout, но и боевой Telegram-контур: юзерботы, seller-лички и обработка входящих.',
      href: '/app/bots',
      label: 'Открыть боты'
    },
    {
      title: 'Проверь базы и handoff',
      text: 'Если продаешь базы или сложные активы, сразу проверь, что post-purchase handoff и buyer-side маршрут читаются без ручной путаницы.',
      href: '/app/bases',
      label: 'Открыть базы'
    }
  ];
}

function sellerUpgradeMomentum(profilePlan, purchases, isAssetMarketplace) {
  if (profilePlan !== 'normal') return null;

  const hasSellerPurchase = purchases.some((purchase) => offerCode(purchase.item) === 'seller' && ['pending', 'awaiting_receipt', 'paid'].includes(purchase.status));
  if (hasSellerPurchase) return null;

  const failedCount = purchases.filter((purchase) => purchase.ownership_transfer_status === 'failed').length;
  if (failedCount > 0) {
    return {
      title: 'Сначала добей сломанный handoff',
      text: `У тебя есть ${failedCount} покупок со сломанной передачей прав. Прежде чем открывать seller mode, сначала почини buyer-side хвост, чтобы не тащить хаос дальше.`,
      primaryHref: '/shop',
      primaryLabel: 'Открыть мои покупки',
      secondaryHref: '/app/payments',
      secondaryLabel: 'Проверить платежный контур'
    };
  }

  return {
    title: isAssetMarketplace ? 'Normal уже собран. Следующий денежный слой — seller mode' : 'Normal уже собран. Следующий денежный слой — P2P seller',
    text: isAssetMarketplace
      ? 'Если базовый контур уже жив, дальше деньги лежат в seller storefront: свои офферы, активы BullRun и seller-операционка без ручной возни.'
      : 'Если базовый контур уже жив, дальше деньги лежат в P2P seller: свои скрытые офферы, TON/P2P checkout и выдача результата прямо на сайте.',
    primaryHref: '/shop?offer=seller',
    primaryLabel: isAssetMarketplace ? 'Открыть seller mode' : 'Открыть P2P seller',
    secondaryHref: '/app/shop',
    secondaryLabel: isAssetMarketplace ? 'Смотреть seller admin' : 'Смотреть P2P seller'
  };
}

function sellerCheckoutNextMoves(sellerPulse, isAssetMarketplace) {
  const sellerEntryLabel = isAssetMarketplace ? 'seller mode' : 'P2P seller';
  const sellerAdminLabel = isAssetMarketplace ? 'seller admin' : 'P2P seller';
  if (!sellerPulse?.hasAny) {
    return [
      {
        title: `${sellerEntryLabel} еще не начат`,
        text: isAssetMarketplace
          ? 'Если базовый контур уже собран, seller mode станет следующим денежным слоем: своя витрина, скрытые лоты и продажа активов внутри BullRun.'
          : 'Если базовый контур уже собран, P2P seller станет следующим денежным слоем: свои hidden-message офферы, TON/P2P checkout и выдача результата на сайте.',
        href: '/shop?offer=seller',
        label: isAssetMarketplace ? 'Открыть seller mode' : 'Открыть P2P seller'
      },
      {
        title: `Сначала проверь ${sellerAdminLabel}`,
        text: isAssetMarketplace
          ? 'Даже до первой покупки seller admin нужен, чтобы понимать, какой inventory уже готов и чего не хватает для первой продажи.'
          : 'Даже до первой покупки P2P seller нужен, чтобы понимать, какие hidden-офферы уже готовы и чего не хватает для первой оплаты.',
        href: '/app/shop',
        label: `Открыть ${sellerAdminLabel}`
      }
    ];
  }

  if (sellerPulse.failedCount > 0) {
    return [
      {
        title: 'Seller handoff сломан',
        text: `Есть ${sellerPulse.failedCount} seller-покупок, где деньги уже есть, а передача прав не добита. Сначала чини это, потом открывай новые seller-checkout.`,
        href: '/shop',
        label: 'Открыть seller-покупки'
      },
      {
        title: `Проверь ${sellerAdminLabel}`,
        text: isAssetMarketplace
          ? 'Seller admin покажет, где именно споткнулась передача прав и что нужно добить первым делом.'
          : 'P2P seller покажет, где именно споткнулась выдача скрытого результата и что нужно добить первым делом.',
        href: '/app/shop',
        label: `Открыть ${sellerAdminLabel}`
      }
    ];
  }

  if (sellerPulse.awaitingReceiptCount > 0) {
    return [
      {
        title: 'Seller-чек ждет ручной проверки',
        text: `Есть ${sellerPulse.awaitingReceiptCount} seller-покупок, которые уже ждут ручного P2P-подтверждения. Не зови в новый checkout, пока продавец не разберет этот хвост.`,
        href: '/shop',
        label: 'Вернуться к seller checkout'
      },
      {
        title: `Открой ${sellerAdminLabel}`,
        text: isAssetMarketplace
          ? 'В seller admin уже виден хвост продаж и можно сразу разбирать seller-операционку по оплатам.'
          : 'В P2P seller уже виден хвост оплат и можно сразу разбирать hidden-офферы и ручные проверки.',
        href: '/app/shop',
        label: `Открыть ${sellerAdminLabel}`
      }
    ];
  }

  if (sellerPulse.pendingCount > 0) {
    return [
      {
        title: 'Seller checkout уже открыт',
        text: `Есть ${sellerPulse.pendingCount} seller-checkout в ожидании оплаты. Сначала добей текущий платежный хвост, а потом уже расширяй витрину.`,
        href: '/shop?offer=seller',
        label: 'Открыть seller checkout'
      },
      {
        title: `Проверь ${sellerAdminLabel}`,
        text: isAssetMarketplace
          ? 'Seller admin поможет понять, готовы ли inventory, лоты и handoff к первой нормальной seller-сделке.'
          : 'P2P seller поможет понять, готовы ли hidden-офферы, seller-checkout и выдача результата к первой нормальной продаже.',
        href: '/app/shop',
        label: `Открыть ${sellerAdminLabel}`
      }
    ];
  }

  if (sellerPulse.paidCount > 0) {
    return [
      {
        title: `${sellerEntryLabel} уже куплен и работает`,
        text: isAssetMarketplace
          ? `У тебя уже есть ${sellerPulse.paidCount} seller-покупок. Следующий шаг — не покупать seller еще раз, а добивать витрину, inventory и handoff в seller admin.`
          : `У тебя уже есть ${sellerPulse.paidCount} seller-покупок. Следующий шаг — не покупать P2P seller еще раз, а добивать hidden-офферы, платежный контур и buyer-side handoff.`,
        href: '/app/shop',
        label: `Открыть ${sellerAdminLabel}`
      },
      {
        title: isAssetMarketplace ? 'Расширяй inventory' : 'Докрути платежный контур',
        text: isAssetMarketplace
          ? 'Если seller-контур уже жив, самое полезное действие — докладывать прокси, юзерботы и базы, которые реально готовы к продаже.'
          : 'Если P2P seller уже жив, самое полезное действие — докрутить TON/P2P реквизиты и собрать еще один скрытый оффер вместо повторной покупки режима.',
        href: isAssetMarketplace ? '/app/proxies' : '/app/payments',
        label: isAssetMarketplace ? 'Открыть inventory' : 'Открыть реквизиты'
      }
    ];
  }

  return null;
}

function visibilityLabel(value) {
  if (value === 'unlisted') return 'Только по ссылке';
  if (value === 'private') return 'Private';
  return 'Публичный';
}

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function formatTon(value) {
  return Number(value || 0).toFixed(2);
}

function formatRub(value) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function hoursUntil(value) {
  if (!value) return null;
  const diffMs = new Date(value).getTime() - Date.now();
  if (Number.isNaN(diffMs)) return null;
  return Math.ceil(diffMs / (1000 * 60 * 60));
}

function purchaseStatusLabel(purchase) {
  if (purchase.ownership_transfer_status === 'failed') return 'Оплата есть, но handoff сломался';
  if (purchase.status === 'awaiting_receipt') return 'Ждет ручной проверки продавцом';
  if (purchase.status === 'rejected') return 'P2P отклонен';
  if (purchase.status === 'expired') return 'Счет протух';
  if (purchase.status === 'paid' && purchase.ownership_transfer_status === 'completed') return 'Оплата закрыта';
  if (purchase.status === 'paid') return 'Оплата есть, передача еще идет';
  return 'Ждет оплату';
}

function paymentMethodLabel(value) {
  return value === 'p2p' ? 'P2P / карта' : 'TON';
}

function itemPaymentMethods(item) {
  const source = Array.isArray(item?.available_payment_methods) && item.available_payment_methods.length
    ? item.available_payment_methods
    : Array.isArray(item?.payment_methods) && item.payment_methods.length
      ? item.payment_methods
      : ['ton', 'p2p'];
  return source.filter((method) => method === 'ton' || method === 'p2p');
}

function itemPriceSummary(item) {
  const methods = itemPaymentMethods(item);
  const parts = [];
  if (methods.includes('ton') && Number(item?.price_ton || 0) > 0) {
    parts.push(`${formatTon(item.price_ton)} TON`);
  }
  if (methods.includes('p2p') && Number(item?.price_rub || 0) > 0) {
    parts.push(`${formatRub(item.price_rub)} RUB`);
  }
  return parts.join(' / ') || `${formatTon(item?.price_ton || 0)} TON`;
}

function purchaseAmountSummary(purchase) {
  if (purchase?.payload?.payment_method === 'p2p') {
    const rub = Number(purchase?.amount_rub || purchase?.payload?.amount_rub || purchase?.item?.price_rub || 0);
    return rub > 0 ? `${formatRub(rub)} RUB` : 'СБП';
  }
  return `${formatTon(purchase?.amount_ton || purchase?.item?.price_ton || 0)} TON`;
}

function itemDescription(item) {
  return item.preview_text || item.description || 'Описание пока не задано.';
}

function itemTypeLabel(item) {
  const itemType = item?.item_type;
  if (itemType === 'text_offer') {
    if (offerCode(item) === 'trial') return 'Trial checkout';
    if (offerCode(item) === 'normal') return 'Normal checkout';
    if (offerCode(item) === 'seller') return 'Seller checkout';
    return 'P2P / скрытый оффер';
  }
  if (itemType === 'bundle') return 'Комплект userbot + proxy';
  if (itemType === 'userbot') return 'Юзербот';
  if (itemType === 'proxy') return 'Прокси';
  if (itemType === 'customer_base_asset') return 'База клиентов';
  return itemType;
}

function offerCode(item) {
  return String(item?.offer_code || '').trim().toLowerCase();
}

function offerFitLabels(item) {
  if (item.item_type === 'text_offer') {
    if (offerCode(item) === 'trial') return ['Trial'];
    if (offerCode(item) === 'normal') return ['Normal'];
    if (offerCode(item) === 'p2p') return ['P2P'];
    if (offerCode(item) === 'seller') return ['Seller mode'];
    return ['Trial', 'Normal', 'P2P'];
  }

  if (item.item_type === 'bundle' || item.item_type === 'userbot' || item.item_type === 'proxy') {
    return ['Seller mode', 'Normal'];
  }

  if (item.item_type === 'customer_base_asset') {
    return ['Seller mode', 'CRM'];
  }

  return ['BullRun'];
}

function offerMatchRank(item, offer) {
  if (!offer) return 0;

  if (offer === 'trial') {
    if (offerCode(item) === 'trial') return 5;
    if (item.item_type === 'text_offer') return 3;
    return 1;
  }

  if (offer === 'normal') {
    if (offerCode(item) === 'normal') return 5;
    if (item.item_type === 'text_offer') return 3;
    if (item.item_type === 'bundle' || item.item_type === 'userbot' || item.item_type === 'proxy') return 3;
    if (item.item_type === 'customer_base_asset') return 2;
    return 1;
  }

  if (offer === 'seller') {
    if (offerCode(item) === 'seller') return 5;
    if (item.item_type === 'bundle') return 4;
    if (item.item_type === 'userbot' || item.item_type === 'proxy' || item.item_type === 'customer_base_asset') return 3;
    if (item.item_type === 'text_offer') return 2;
    return 1;
  }

  if (offer === 'p2p') {
    if (offerCode(item) === 'p2p') return 5;
    if (item.item_type === 'text_offer') return 3;
    return 1;
  }

  return 0;
}

function offerBestFitLabel(item, offer) {
  const rank = offerMatchRank(item, offer);
  if (rank < 4) return '';

  if (offer === 'trial') return 'Лучший вход в Trial';
  if (offer === 'normal') return 'Лучший лот для Normal';
  if (offer === 'seller') return 'Лучший seller-лот';
  if (offer === 'p2p') return 'Лучший P2P-оффер';
  return '';
}

function offerFitCopy(item) {
  if (item.item_type === 'text_offer') {
    if (offerCode(item) === 'trial') {
      return 'Подходит для входа в Trial: первый checkout, hidden message и стартовый Telegram-контур.';
    }
    if (offerCode(item) === 'normal') {
      return 'Подходит для апгрейда на Normal: рабочий checkout, CRM, дожим и money ops stack без trial-лимитов.';
    }
    if (offerCode(item) === 'seller') {
      return 'Подходит для seller mode: скрытый seller-оффер и более тяжелый коммерческий контур.';
    }
    return 'Подходит для быстрого TON/P2P checkout, hidden message и входного Trial/Normal сценария.';
  }

  if (item.item_type === 'bundle') {
    return 'Подходит для seller mode: продаешь уже готовый комплект userbot + proxy и передаешь права внутри BullRun.';
  }

  if (item.item_type === 'userbot') {
    return 'Подходит для seller mode и расширения Normal-контура, когда нужен отдельный рабочий Telegram-аккаунт.';
  }

  if (item.item_type === 'proxy') {
    return 'Подходит для seller mode и расширения proxy stack после входа в Normal.';
  }

  if (item.item_type === 'customer_base_asset') {
    return 'Подходит для seller mode и CRM-сценариев, когда продается уже готовая база внутри BullRun.';
  }

  return 'Подходит для рабочего контура BullRun.';
}

function offerCopy(offer) {
  if (offer === 'trial') {
    return {
      title: 'Trial начинается здесь',
      text: 'Выбирай входной оффер и оплачивай его прямо на сайте. Telegram нужен только как канал доставки, а не как шаг checkout.'
    };
  }
  if (offer === 'normal') {
    return {
      title: 'Normal теперь тоже идет через on-site checkout',
      text: 'Ниже уже не абстрактный прайс, а живые офферы и checkout на сайте. Выбирай рабочий оффер, плати через TON или P2P и собирай контур без прыжка в Telegram.'
    };
  }
  if (offer === 'p2p') {
    return {
      title: 'P2P-оплата живет на сайте',
      text: 'Ниже уже on-site checkout: TON, P2P, memo, QR и ручная проверка продавцом без ухода в Telegram-бота.'
    };
  }
  if (offer === 'seller') {
    return {
      title: 'Seller mode тоже продается через Shop',
      text: 'Смотри seller storefront, скрытые лоты и реальные активы BullRun. Оплата и handoff идут внутри сайта.'
    };
  }
  return null;
}

function offerSummary(offer) {
  if (offer === 'trial') {
    return {
      title: 'Что ты получаешь в Trial',
      bullets: [
        '1 юзербот и 1 бесплатный прокси',
        'TON / P2P checkout прямо на сайте',
        'Быстрая проверка первого Telegram-контура'
      ]
    };
  }
  if (offer === 'normal') {
    return {
      title: 'Что открывает Normal',
      bullets: [
        'Несколько юзерботов и рабочий proxy stack',
        'CRM, рассылки, abandoned и seller ops',
        'Боевой контур без trial-лимитов'
      ]
    };
  }
  if (offer === 'seller') {
    return {
      title: 'Что включает seller mode',
      bullets: [
        'Seller storefront и скрытые лоты',
        'Продажа активов BullRun и P2P-офферов',
        'Handoff прав после оплаты внутри платформы'
      ]
    };
  }
  if (offer === 'p2p') {
    return {
      title: 'Что дает P2P-оффер',
      bullets: [
        'TON или ручной P2P на сайте',
        'Скрытое сообщение после оплаты',
        'Checkout без прыжка в Telegram-бота'
      ]
    };
  }
  return null;
}

function recommendedItemsForOffer(offer, items) {
  if (!offer) return [];
  if (offer === 'seller') {
    return items
      .filter((item) => item.item_type !== 'text_offer')
      .slice(0, 4);
  }
  if (offer === 'trial' || offer === 'normal' || offer === 'p2p') {
    const textOffers = items.filter((item) => {
      if (item.item_type !== 'text_offer') return false;
      if (offer === 'trial') return offerCode(item) === 'trial' || !offerCode(item);
      if (offer === 'normal') return offerCode(item) === 'normal' || !offerCode(item);
      if (offer === 'p2p') return offerCode(item) === 'p2p' || !offerCode(item);
      return true;
    });
    return textOffers.slice(0, 4);
  }
  return [];
}

function checkoutPackages(items) {
  const textOffers = items.filter((item) => item.item_type === 'text_offer');
  const trialItem = textOffers.find((item) => offerCode(item) === 'trial') || textOffers[0] || null;
  const normalItem = textOffers.find((item) => offerCode(item) === 'normal') || textOffers.find((item) => offerCode(item) === 'trial') || textOffers[0] || null;
  const sellerItem = items.find((item) => item.item_type === 'bundle')
    || items.find((item) => item.item_type === 'userbot')
    || items.find((item) => item.item_type === 'proxy')
    || null;

  return [
    {
      id: 'trial',
      title: 'Trial',
      text: 'Входной checkout для первого запуска: быстрый платежный сценарий и первый Telegram-контур без тяжелого внедрения.',
      href: '/shop?offer=trial',
      item: trialItem
    },
    {
      id: 'normal',
      title: 'Normal',
      text: 'Основной рабочий checkout: деньги, доступ, CRM и дожим уже как нормальный продуктовый контур.',
      href: '/shop?offer=normal',
      item: normalItem
    },
    {
      id: 'seller',
      title: 'Seller mode',
      text: 'Сценарий для продавцов активов и офферов: storefront, handoff прав и seller-операционка.',
      href: '/shop?offer=seller',
      item: sellerItem
    }
  ];
}

function topTextOffers(items, limit = 3) {
  return items
    .filter((item) => item.item_type === 'text_offer')
    .sort((a, b) => {
      const aRank = Number(a.price_ton || 0);
      const bRank = Number(b.price_ton || 0);
      return aRank - bRank;
    })
    .slice(0, limit);
}

function packageStatus(pkgId, profilePlan) {
  if (!profilePlan) return '';
  if (profilePlan === 'trial' && pkgId === 'trial') return 'Твой текущий план';
  if (profilePlan === 'normal' && pkgId === 'normal') return 'Ты уже на Normal';
  if (profilePlan === 'pro' && pkgId === 'seller') return 'Тяжелый контур';
  return '';
}

function packagePurchaseState(pkgId, purchases) {
  if (!Array.isArray(purchases) || purchases.length === 0) return null;

  const textOfferPurchases = purchases.filter((purchase) => purchase?.item?.item_type === 'text_offer');
  const activeStatuses = ['pending', 'awaiting_receipt', 'paid'];
  const expiredStatuses = ['expired', 'rejected'];

  if (pkgId === 'trial') {
    const active = textOfferPurchases.find((purchase) => (offerCode(purchase.item) === 'trial' || !offerCode(purchase.item)) && activeStatuses.includes(purchase.status));
    if (active) {
      return {
        label: active.status === 'awaiting_receipt' ? 'Ждет проверки' : active.status === 'paid' ? 'Уже закрыт' : 'Есть открытый checkout',
        href: '/shop',
        actionLabel: active.status === 'paid' ? 'Открыть мои покупки' : 'Вернуться к checkout'
      };
    }

    const expired = textOfferPurchases.find((purchase) => (offerCode(purchase.item) === 'trial' || !offerCode(purchase.item)) && expiredStatuses.includes(purchase.status));
    if (expired) {
      return {
        label: 'Есть протухший Trial checkout',
        href: '/shop',
        actionLabel: 'Разобрать покупки'
      };
    }
  }

  if (pkgId === 'normal') {
    const active = textOfferPurchases.find((purchase) => offerCode(purchase.item) === 'normal' && activeStatuses.includes(purchase.status));
    if (active) {
      return {
        label: active.status === 'awaiting_receipt' ? 'Normal ждет проверки' : active.status === 'paid' ? 'Normal уже куплен' : 'Normal checkout открыт',
        href: '/shop?offer=normal',
        actionLabel: active.status === 'paid' ? 'Открыть мои покупки' : 'Вернуться к checkout'
      };
    }
  }

  if (pkgId === 'seller') {
    const active = purchases.find((purchase) => {
      if (!activeStatuses.includes(purchase.status)) return false;
      if (purchase?.item?.item_type !== 'text_offer') return true;
      return offerCode(purchase.item) === 'seller';
    });
    if (active) {
      return {
        label: active.status === 'awaiting_receipt' ? 'Seller-лот ждет проверки' : active.status === 'paid' ? 'Seller-покупка закрыта' : 'Seller checkout открыт',
        href: '/shop?offer=seller',
        actionLabel: active.status === 'paid' ? 'Открыть мои покупки' : 'Вернуться к checkout'
      };
    }
  }

  return null;
}

function packageProgressSignals(purchases) {
  const ids = ['trial', 'normal', 'seller'];
  return ids.map((pkgId) => {
    const state = packagePurchaseState(pkgId, purchases);
    const unlocks = PACKAGE_UNLOCKS[pkgId] || [];
    const title = pkgId === 'trial' ? 'Trial' : pkgId === 'normal' ? 'Normal' : 'Seller mode';

    if (!state) {
      return {
        id: pkgId,
        title,
        tone: 'idle',
        label: 'Еще не начат',
        text:
          pkgId === 'trial'
            ? 'Начни с первого checkout и собери входной Telegram-контур.'
            : pkgId === 'normal'
              ? 'Этот слой откроет рабочий контур без trial-стопоров.'
              : 'Seller mode нужен, когда контур уже жив и пора продавать свои офферы и активы.',
        href: `/shop?offer=${pkgId}`,
        actionLabel: `Открыть ${title}`,
        unlocks
      };
    }

    const tone =
      /сломан|failed/i.test(state.label || '')
        ? 'failed'
        : /проверки|чек/i.test(state.label || '')
          ? 'review'
          : /куплен|закрыт/i.test(state.label || '')
            ? 'paid'
            : 'pending';

    const text =
      tone === 'failed'
        ? 'Оплата уже есть, но handoff споткнулся. Сначала добей этот пакет, а потом двигайся дальше.'
        : tone === 'review'
          ? 'Пакет уже ушел на ручную проверку. Не создавай новый счет, пока этот не разберут.'
          : tone === 'paid'
            ? 'Пакет уже закрыт. Дальше не покупай его заново, а иди в следующий product-step.'
            : 'Checkout уже открыт. Вернись в него и закрой оплату, прежде чем идти в следующий слой.';

    return {
      id: pkgId,
      title,
      tone,
      label: state.label,
      text,
      href: state.href || `/shop?offer=${pkgId}`,
      actionLabel: state.actionLabel || `Открыть ${title}`,
      unlocks
    };
  });
}

function purchaseNextSteps(purchase) {
  const itemType = purchase?.item?.item_type;
  if (!itemType || purchase?.status !== 'paid') return [];

  if (itemType === 'proxy') {
    return [
      { label: 'Открыть прокси', href: '/app/proxies' },
      { label: 'Подключить юзербота', href: '/app/bots' }
    ];
  }

  if (itemType === 'userbot' || itemType === 'bundle') {
    return [
      { label: 'Открыть боты и аккаунты', href: '/app/bots' },
      { label: 'Открыть центр юзербота', href: '/app/userbot-center' }
    ];
  }

  if (itemType === 'customer_base_asset') {
    return [
      { label: 'Открыть базы', href: '/app/bases' },
      { label: 'Открыть CRM', href: '/app/crm' }
    ];
  }

  if (itemType === 'text_offer') {
    if (offerCode(purchase.item) === 'normal') {
      return [
        { label: 'Открыть кабинет', href: '/app/' },
        { label: 'Запустить боевой checkout', href: '/app/payments' }
      ];
    }
    return [
      { label: 'Открыть кабинет', href: '/app/' },
      { label: 'Подключить первый юзербот', href: '/app/bots' }
    ];
  }

  return [{ label: 'Открыть кабинет', href: '/app/' }];
}

function packagePurchaseGuidance(purchase) {
  const code = offerCode(purchase?.item);
  if (!code) return null;

  if (purchase?.ownership_transfer_status === 'failed') {
    return {
      eyebrow: 'Checkout сломан',
      title: 'Не плати заново, сначала добей этот handoff',
      text: 'Оплата уже есть, но передача результата споткнулась. Правильный следующий шаг — не покупать заново, а дождаться добивки или открыть seller admin / кабинет и разобрать хвост.',
      primaryHref: '/shop',
      primaryLabel: 'Открыть мои покупки',
      secondaryHref: '/app/',
      secondaryLabel: 'Открыть кабинет'
    };
  }

  if (purchase?.status === 'awaiting_receipt') {
    return {
      eyebrow: 'Ждет ручной проверки',
      title: 'Чек уже отправлен продавцу',
      text: 'Теперь главное не плодить новые счета. Продавец увидит этот checkout у себя и либо одобрит его, либо отклонит.',
      primaryHref: '/shop',
      primaryLabel: 'Следить за покупкой',
      secondaryHref: '/app/shop',
      secondaryLabel: 'Открыть seller admin'
    };
  }

  if (purchase?.status === 'pending') {
    if (code === 'trial') {
      return {
        eyebrow: 'Trial checkout открыт',
        title: 'Сначала закрой первый Trial-платеж',
        text: 'Этот checkout — вход в BullRun. Пока он открыт, правильный следующий шаг — не читать сайт дальше, а добить оплату до конца.',
        primaryHref: '/shop',
        primaryLabel: 'Продолжить оплату',
        secondaryHref: '/pricing',
        secondaryLabel: 'Сравнить Trial и Normal'
      };
    }

    if (code === 'normal') {
      return {
        eyebrow: 'Normal checkout открыт',
        title: 'Сейчас фокус только на апгрейде в Normal',
        text: 'Не распыляйся на seller и другие лоты, пока не закрыт этот checkout. После оплаты откроется рабочий контур без trial-лимитов.',
        primaryHref: '/shop',
        primaryLabel: 'Продолжить checkout',
        secondaryHref: '/pricing',
        secondaryLabel: 'Что откроет Normal'
      };
    }

    if (code === 'seller') {
      return {
        eyebrow: 'Seller checkout открыт',
        title: 'Seller mode уже в процессе',
        text: 'Сначала добей текущий seller-checkout. Следующий шаг после оплаты — открыть seller admin и проверить inventory, лоты и handoff.',
        primaryHref: '/shop',
        primaryLabel: 'Продолжить seller checkout',
        secondaryHref: '/app/shop',
        secondaryLabel: 'Открыть seller admin'
      };
    }
  }

  if (purchase?.status === 'paid') {
    if (code === 'trial') {
      return {
        eyebrow: 'Trial уже закрыт',
        title: 'Trial оплачен. Теперь собери первый контур и смотри в сторону Normal',
        text: 'Первый checkout уже сделал свое дело. Следующий шаг — зайти в кабинет, собрать базовый контур и потом идти в апгрейд на Normal.',
        primaryHref: '/app/',
        primaryLabel: 'Открыть кабинет',
        secondaryHref: '/shop?offer=normal',
        secondaryLabel: 'Перейти на Normal'
      };
    }

    if (code === 'normal') {
      return {
        eyebrow: 'Normal уже активен',
        title: 'Апгрейд закрыт. Теперь иди в рабочую операционку',
        text: 'Покупка сама по себе ничего не дает, пока ты не включил второй юзербот, proxy stack, CRM и seller-flow внутри кабинета.',
        primaryHref: '/app/',
        primaryLabel: 'Открыть /app',
        secondaryHref: '/app/crm',
        secondaryLabel: 'Открыть CRM'
      };
    }

    if (code === 'seller') {
      return {
        eyebrow: 'Seller mode уже куплен',
        title: 'Теперь открывай seller admin, а не покупай seller еще раз',
        text: 'Seller checkout уже отработал. Следующий шаг — seller admin, inventory, лоты и первый нормальный handoff покупателю.',
        primaryHref: '/app/shop',
        primaryLabel: 'Открыть seller admin',
        secondaryHref: '/app/proxies',
        secondaryLabel: 'Открыть inventory'
      };
    }
  }

  return null;
}

function checkoutStageState(profilePlan, offer, purchases) {
  const hasPaid = purchases.some((purchase) => purchase.status === 'paid');
  const hasPending = purchases.some((purchase) => purchase.status === 'pending' || purchase.status === 'awaiting_receipt');

  return [
    {
      id: 'trial',
      title: 'Trial',
      text: 'Первый checkout и входной контур.',
      status:
        profilePlan === 'trial'
          ? hasPaid
            ? 'закрыт'
            : hasPending
              ? 'идет'
              : 'текущий'
          : profilePlan === 'normal' || profilePlan === 'pro'
            ? 'пройден'
            : offer === 'trial'
              ? 'в фокусе'
              : 'доступен'
    },
    {
      id: 'normal',
      title: 'Normal',
      text: 'Рабочий money ops stack без trial-лимитов.',
      status:
        profilePlan === 'normal'
          ? 'текущий'
          : profilePlan === 'pro'
            ? 'пройден'
            : offer === 'normal'
              ? 'в фокусе'
              : profilePlan === 'trial' && hasPaid
                ? 'следующий'
                : 'закрыт'
    },
    {
      id: 'seller',
      title: 'Seller mode',
      text: 'Витрина, seller-flow и продажа активов.',
      status:
        offer === 'seller'
          ? 'в фокусе'
          : profilePlan === 'pro'
            ? 'текущий'
            : profilePlan === 'normal'
              ? 'доступен'
              : 'позже'
    }
  ];
}

function checkoutNextMoves(profilePlan, purchases) {
  const pendingCount = purchases.filter((purchase) => purchase.status === 'pending' || purchase.status === 'awaiting_receipt').length;
  const paidCount = purchases.filter((purchase) => purchase.status === 'paid').length;
  const expiredCount = purchases.filter((purchase) => purchase.status === 'expired').length;
  const failedCount = purchases.filter((purchase) => purchase.ownership_transfer_status === 'failed').length;

  if (profilePlan === 'trial') {
    const moves = [];

    if (pendingCount > 0) {
      moves.push({
        title: 'Добить открытые счета',
        text: `У тебя ${pendingCount} незакрытых checkout. Сначала закрой их, потом иди в апгрейд.`,
        href: '/shop',
        label: 'Открыть мои покупки'
      });
    }

    if (paidCount > 0) {
      moves.push({
        title: 'Переходить на Normal',
        text: 'Первый checkout уже закрыт. Теперь Trial должен превратиться в рабочий money ops stack без лимитов.',
        href: '/shop?offer=normal',
        label: 'Открыть Normal'
      });
    } else {
      moves.push({
        title: 'Закрыть первый Trial checkout',
        text: 'Самый полезный следующий шаг — взять входной оффер и провести первый платеж до конца прямо на сайте.',
        href: '/shop?offer=trial',
        label: 'Открыть Trial'
      });
    }

    moves.push({
      title: 'Проверить, что откроет Normal',
      text: 'Сравни Trial и Normal до апгрейда, чтобы не покупать вслепую и сразу понимать следующий контур.',
      href: '/pricing',
      label: 'Сравнить планы'
    });

    return moves.slice(0, 3);
  }

  if (profilePlan === 'normal') {
    const moves = [];

    if (failedCount > 0) {
      moves.push({
        title: 'Добить сломанный handoff',
        text: `Есть ${failedCount} покупок, где оплата прошла, а передача прав еще сломана. Не плодить новые сделки, пока это не добито.`,
        href: '/shop',
        label: 'Открыть мои покупки'
      });
    }

    moves.push({
      title: 'Открыть основной кабинет',
      text: 'Normal уже куплен. Значит вопрос теперь не в покупке, а в запуске контура внутри BullRun.',
      href: '/app/',
      label: 'Открыть /app'
    });

    moves.push({
      title: 'Расширить seller-flow',
      text: 'Если базовый контур уже жив, открывай seller mode и добивай витрину, скрытые лоты и seller-операционку.',
      href: '/shop?offer=seller',
      label: 'Открыть seller mode'
    });

    if (expiredCount > 0) {
      moves.push({
        title: 'Пересобрать протухшие счета',
        text: `У тебя ${expiredCount} протухших checkout. Если это важные сделки, пересоздай их по актуальным лотам.`,
        href: '/shop',
        label: 'Показать протухшие'
      });
    }

    return moves.slice(0, 3);
  }

  return [
    {
      title: 'Зайти через Trial',
      text: 'Самый короткий путь — не читать весь каталог, а взять Trial и пройти первый checkout прямо внутри сайта.',
      href: '/shop?offer=trial',
      label: 'Начать Trial'
    },
    {
      title: 'Смотреть Normal как следующий слой',
      text: 'Если нужен уже не тест, а рабочий money ops stack, смотри Normal и его on-site checkout.',
      href: '/shop?offer=normal',
      label: 'Открыть Normal'
    },
    {
      title: 'Посмотреть все уровни',
      text: 'Если пока неясно, какой контур нужен, сначала сравни Trial и Normal без лишней теории.',
      href: '/pricing',
      label: 'Сравнить планы'
    }
  ];
}

export function ShopPage() {
  const { user, accessToken, login, logout, profilePlan, profileRole, trialEndsAt, sellerPulse } = useAuth();
  const sellerIsAssetMarketplace = profileRole === 'admin';
  const sellerLabel = sellerIsAssetMarketplace ? 'Seller mode' : 'P2P seller';
  const sellerAdminLabel = sellerIsAssetMarketplace ? 'seller admin' : 'P2P seller';
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState({
    loading: true,
    error: '',
    items: [],
    sellerCards: [],
    sellerProfile: null,
    sellerStats: null
  });
  const [purchasesState, setPurchasesState] = useState({
    loading: false,
    error: '',
    rows: []
  });
  const [filter, setFilter] = useState('all');
  const [fitMode, setFitMode] = useState('recommended');
  const [purchaseFilter, setPurchaseFilter] = useState('all');
  const [activePurchaseId, setActivePurchaseId] = useState('');
  const [activePurchaseError, setActivePurchaseError] = useState('');
  const [receiptNote, setReceiptNote] = useState('');
  const [receiptFile, setReceiptFile] = useState(null);
  const [busyItemId, setBusyItemId] = useState('');
  const [busyPurchaseId, setBusyPurchaseId] = useState('');

  const sellerId = params.get('seller') || '';
  const focusedItemId = params.get('item') || '';
  const offer = params.get('offer') || '';

  useEffect(() => {
    let cancelled = false;

    async function loadItems() {
      setState((prev) => ({ ...prev, loading: true, error: '' }));
      try {
        const query = new URLSearchParams();
        if (sellerId) query.set('seller', sellerId);
        if (focusedItemId) query.set('item', focusedItemId);

        const data = await apiRequest(`/api/shop/public/items${query.toString() ? `?${query.toString()}` : ''}`);
        if (cancelled) return;
        setState({
          loading: false,
          error: '',
          items: data.items || [],
          sellerCards: data.seller_cards || [],
          sellerProfile: data.seller_profile || null,
          sellerStats: data.seller_stats || null
        });
      } catch (error) {
        if (cancelled) return;
        setState({
          loading: false,
          error: error.message,
          items: [],
          sellerCards: [],
          sellerProfile: null,
          sellerStats: null
        });
      }
    }

    loadItems();
    return () => {
      cancelled = true;
    };
  }, [sellerId, focusedItemId]);

  useEffect(() => {
    let cancelled = false;

    async function loadPurchases() {
      if (!accessToken) {
        setPurchasesState({ loading: false, error: '', rows: [] });
        return;
      }

      setPurchasesState((prev) => ({ ...prev, loading: true, error: '' }));

      try {
        const data = await apiRequest('/api/shop/public/my-purchases', { accessToken });
        if (cancelled) return;
        const rows = data.purchases || [];
        setPurchasesState({ loading: false, error: '', rows });
        if (!activePurchaseId && rows[0]?.id) {
          setActivePurchaseId(rows[0].id);
        }
      } catch (error) {
        if (cancelled) return;
        setPurchasesState({ loading: false, error: error.message, rows: [] });
      }
    }

    loadPurchases();
    return () => {
      cancelled = true;
    };
  }, [accessToken, activePurchaseId]);

  const visibleItems = useMemo(() => {
    const source = offer === 'p2p'
      ? state.items.filter((item) => item.item_type === 'text_offer')
      : state.items;
    const filtered = filter === 'all'
      ? source
      : source.filter((item) => item.item_type === filter);
    const ranked = [...filtered].sort((left, right) => {
      const rankDiff = offerMatchRank(right, offer) - offerMatchRank(left, offer);
      if (rankDiff !== 0) return rankDiff;
      return Number(right.price_ton || 0) - Number(left.price_ton || 0);
    });
    if (!offer || fitMode === 'all') {
      return ranked;
    }

    const threshold = offer === 'seller' ? 3 : 4;
    const recommended = ranked.filter((item) => offerMatchRank(item, offer) >= threshold);
    return recommended.length > 0 ? recommended : ranked;
  }, [filter, fitMode, offer, state.items]);

  const offerBanner = useMemo(() => offerCopy(offer), [offer]);
  const offerPlan = useMemo(() => offerSummary(offer), [offer]);
  const recommendedItems = useMemo(
    () => recommendedItemsForOffer(offer, state.items),
    [offer, state.items]
  );
  const featuredTextOffers = useMemo(() => topTextOffers(state.items), [state.items]);
  const packages = useMemo(() => checkoutPackages(state.items), [state.items]);
  const packageSignals = useMemo(() => ({
    trial: packagePurchaseState('trial', purchasesState.rows),
    normal: packagePurchaseState('normal', purchasesState.rows),
    seller: packagePurchaseState('seller', purchasesState.rows)
  }), [purchasesState.rows]);
  const packageProgress = useMemo(() => packageProgressSignals(purchasesState.rows), [purchasesState.rows]);

  useEffect(() => {
    if (offer === 'trial' || offer === 'p2p' || offer === 'normal') {
      setFilter('text_offer');
      setFitMode('recommended');
      return;
    }
    if (offer === 'seller') {
      setFilter('all');
      setFitMode('recommended');
      return;
    }
    setFilter('all');
    setFitMode('all');
  }, [offer]);

  const recommendedVisibleCount = useMemo(() => {
    if (!offer) return 0;
    const source = offer === 'p2p'
      ? state.items.filter((item) => item.item_type === 'text_offer')
      : state.items;
    const filtered = filter === 'all'
      ? source
      : source.filter((item) => item.item_type === filter);
    const threshold = offer === 'seller' ? 3 : 4;
    return filtered.filter((item) => offerMatchRank(item, offer) >= threshold).length;
  }, [filter, offer, state.items]);

  const visiblePurchases = useMemo(() => {
    if (purchaseFilter === 'all') return purchasesState.rows;
    return purchasesState.rows.filter((purchase) => {
      if (purchaseFilter === 'pending') return purchase.status === 'pending';
      if (purchaseFilter === 'awaiting_receipt') return purchase.status === 'awaiting_receipt';
      if (purchaseFilter === 'expired') return purchase.status === 'expired';
      if (purchaseFilter === 'paid') return purchase.status === 'paid';
      if (purchaseFilter === 'failed') return purchase.ownership_transfer_status === 'failed';
      return true;
    });
  }, [purchaseFilter, purchasesState.rows]);

  const purchaseStats = useMemo(() => ({
    all: purchasesState.rows.length,
    pending: purchasesState.rows.filter((purchase) => purchase.status === 'pending').length,
    awaiting_receipt: purchasesState.rows.filter((purchase) => purchase.status === 'awaiting_receipt').length,
    paid: purchasesState.rows.filter((purchase) => purchase.status === 'paid').length,
    expired: purchasesState.rows.filter((purchase) => purchase.status === 'expired').length,
    failed: purchasesState.rows.filter((purchase) => purchase.ownership_transfer_status === 'failed').length
  }), [purchasesState.rows]);

  const stats = useMemo(() => ({
    total: state.items.length,
    bundle: state.items.filter((item) => item.item_type === 'bundle').length,
    userbot: state.items.filter((item) => item.item_type === 'userbot').length,
    proxy: state.items.filter((item) => item.item_type === 'proxy').length,
    textOffer: state.items.filter((item) => item.item_type === 'text_offer').length
  }), [state.items]);

  const sellerCards = state.sellerCards || [];

  const activePurchase = useMemo(
    () => purchasesState.rows.find((purchase) => String(purchase.id) === String(activePurchaseId)) || null,
    [activePurchaseId, purchasesState.rows]
  );
  const activePurchaseSteps = useMemo(() => purchaseNextSteps(activePurchase), [activePurchase]);
  const activePurchasePackageGuidance = useMemo(
    () => packagePurchaseGuidance(activePurchase),
    [activePurchase]
  );
  const sellerStorefrontNote = useMemo(() => {
    if (!sellerId || !state.sellerProfile) return null;
    const isAssetMarketplace = state.sellerProfile.mode === 'asset_marketplace';
    return {
      eyebrow: isAssetMarketplace ? 'Seller storefront' : 'P2P storefront',
      title: isAssetMarketplace
        ? `${state.sellerProfile.name} продает активы BullRun`
        : `${state.sellerProfile.name} продает скрытые P2P-офферы`,
      text: isAssetMarketplace
        ? 'Здесь не общий каталог, а витрина конкретного продавца: комплекты, юзерботы, прокси и базы с прямым handoff после оплаты.'
        : 'Здесь не общий каталог, а витрина конкретного продавца: скрытые P2P/TON-офферы и seller-checkout с выдачей результата прямо на сайте.'
    };
  }, [sellerId, state.sellerProfile]);
  const stageStrip = useMemo(
    () => checkoutStageState(profilePlan, offer, purchasesState.rows),
    [offer, profilePlan, purchasesState.rows]
  );
  const trialHoursLeft = useMemo(() => hoursUntil(trialEndsAt), [trialEndsAt]);
  const trialUpgradeUrgent = profilePlan === 'trial' && trialHoursLeft !== null && trialHoursLeft > 0 && trialHoursLeft <= 72;
  const nextMoves = useMemo(
    () => {
      const moves = checkoutNextMoves(profilePlan, purchasesState.rows);
      if (!trialUpgradeUrgent) return moves;

      return [
        {
          title: `Trial скоро сгорит: осталось около ${trialHoursLeft} ч`,
          text: `Дедлайн trial уже близко. Если контур хоть чуть-чуть прогрет, лучше не ждать упора в лимиты, а сразу открыть Normal и закрыть апгрейд до сгорания trial.`,
          href: '/shop?offer=normal',
          label: 'Открыть Normal'
        },
        ...moves
      ];
    },
    [profilePlan, purchasesState.rows, trialHoursLeft, trialUpgradeUrgent]
  );
  const checkoutMomentumState = useMemo(() => {
    if (!user) return null;

    if (profilePlan === 'normal') {
      const hasPaid = purchasesState.rows.some((purchase) => purchase.status === 'paid');
      const hasHandoffFailure = purchasesState.rows.some((purchase) => purchase.ownership_transfer_status === 'failed');

      if (hasHandoffFailure) {
        return {
          title: 'Normal уже живет, но handoff где-то споткнулся',
          text: 'Не создавай хаос новыми счетами. Сначала добей проблемные покупки и потом уже расширяй seller-flow или inventory.',
          primaryLabel: 'Открыть мои покупки',
          primaryHref: '/shop',
          secondaryLabel: 'Открыть кабинет',
          secondaryHref: '/app/'
        };
      }

      if (hasPaid) {
        return {
          title: 'Ты уже на Normal. Теперь добивай рабочий контур, а не просто покупку.',
          text: 'Следующий шаг — зайти в кабинет, поднять боевой стек, запустить seller-flow или собрать нормальный CRM-дожим без trial-стопоров.',
          primaryLabel: 'Открыть кабинет',
          primaryHref: '/app/',
          secondaryLabel: 'Открыть seller mode',
          secondaryHref: '/shop?offer=seller'
        };
      }

      return {
        title: 'Normal открыт. Закрой первый боевой checkout.',
        text: 'Теперь сайт уже не песочница. Выбери рабочий оффер, закрой покупку и потом иди собирать нормальный money ops stack в кабинете.',
        primaryLabel: 'Открыть Normal checkout',
        primaryHref: '/shop?offer=normal',
        secondaryLabel: 'Открыть кабинет',
        secondaryHref: '/app/'
      };
    }

    if (profilePlan !== 'trial') return null;

    if (trialUpgradeUrgent) {
      return {
        title: `Trial скоро сгорит: осталось около ${trialHoursLeft} ч`,
        text: `Дедлайн уже близко. Если не хочешь снова собирать контур с нуля и упираться в trial-лимиты, закрывай апгрейд на Normal до окончания trial.`,
        primaryLabel: 'Перейти на Normal',
        primaryHref: '/shop?offer=normal',
        secondaryLabel: 'Открыть мои покупки',
        secondaryHref: '/shop'
      };
    }

    const hasPaid = purchasesState.rows.some((purchase) => purchase.status === 'paid');
    const hasPending = purchasesState.rows.some((purchase) => purchase.status === 'pending' || purchase.status === 'awaiting_receipt');

    if (hasPaid) {
      return {
        title: 'Ты уже закрыл первый checkout на Trial',
        text: 'Теперь не топчись на входном контуре. Переходи на Normal, если нужен второй юзербот, нормальные рассылки, seller-mode и рабочая операционка без trial-стопоров.',
        primaryLabel: 'Перейти на Normal',
        primaryHref: '/shop?offer=normal',
        secondaryLabel: 'Сравнить Trial и Normal',
        secondaryHref: '/pricing'
      };
    }

    if (hasPending) {
      return {
        title: 'Trial уже прогрет, осталось добить первый платеж',
        text: 'У тебя уже есть живой счет в checkout. Закрой его и потом сразу иди в Normal, если Trial начинает жать по лимитам.',
        primaryLabel: 'Открыть мои покупки',
        primaryHref: '/shop',
        secondaryLabel: 'Перейти на Normal',
        secondaryHref: '/shop?offer=normal'
      };
    }

    return {
      title: 'Trial открыт. Теперь нужен первый реальный checkout',
      text: `Дедлайн trial: ${formatWhen(trialEndsAt)}. Закрой первый TON/P2P платеж на сайте, а потом уже решай, когда переходить на Normal.`,
      primaryLabel: 'Открыть Trial checkout',
      primaryHref: '/shop?offer=trial',
      secondaryLabel: 'Что дает Normal',
        secondaryHref: '/pricing'
      };
  }, [profilePlan, purchasesState.rows, trialEndsAt, trialHoursLeft, trialUpgradeUrgent, user]);
  const normalUnlockBoardVisible = useMemo(() => {
    if (profilePlan === 'normal') return true;
    return Boolean(packageSignals.normal && /куплен|закрыт/i.test(packageSignals.normal.label || ''));
  }, [packageSignals.normal, profilePlan]);
  const sellerUnlockBoardVisible = useMemo(() => (
    Boolean(packageSignals.seller && /куплен|закрыт/i.test(packageSignals.seller.label || ''))
  ), [packageSignals.seller]);
  const sellerUpgradeState = useMemo(() => (
    sellerUpgradeMomentum(profilePlan, purchasesState.rows, sellerIsAssetMarketplace)
  ), [profilePlan, purchasesState.rows, sellerIsAssetMarketplace]);
  const sellerCheckoutMoves = useMemo(() => (
    sellerCheckoutNextMoves(sellerPulse, sellerIsAssetMarketplace)
  ), [sellerPulse, sellerIsAssetMarketplace]);
  const sellerUnlockActions = useMemo(
    () => buildSellerUnlockActions(sellerIsAssetMarketplace),
    [sellerIsAssetMarketplace]
  );

  async function reloadPurchases() {
    if (!accessToken) return;
    const data = await apiRequest('/api/shop/public/my-purchases', { accessToken });
    const rows = data.purchases || [];
    setPurchasesState({ loading: false, error: '', rows });
    if (activePurchaseId) {
      const stillExists = rows.some((row) => String(row.id) === String(activePurchaseId));
      if (!stillExists) {
        setActivePurchaseId(rows[0]?.id || '');
      }
    } else {
      setActivePurchaseId(rows[0]?.id || '');
    }
  }

  async function createPurchase(itemId, paymentMethod) {
    setBusyItemId(itemId);
    setActivePurchaseError('');
    try {
      const data = await apiRequest('/api/shop/public/purchase', {
        accessToken,
        method: 'POST',
        body: {
          item_id: itemId,
          payment_method: paymentMethod
        }
      });
      await reloadPurchases();
      setActivePurchaseId(data.purchase_id);
    } catch (error) {
      setActivePurchaseError(error.message);
    } finally {
      setBusyItemId('');
    }
  }

  async function checkPurchase(purchaseId) {
    setBusyPurchaseId(purchaseId);
    setActivePurchaseError('');
    try {
      await apiRequest('/api/shop/public/purchase/check', {
        accessToken,
        method: 'POST',
        body: {
          purchase_id: purchaseId
        }
      });
      await reloadPurchases();
    } catch (error) {
      setActivePurchaseError(error.message);
      await reloadPurchases();
    } finally {
      setBusyPurchaseId('');
    }
  }

  async function markPaid(purchaseId) {
    setBusyPurchaseId(purchaseId);
    setActivePurchaseError('');
    try {
      const formData = new FormData();
      formData.append('purchase_id', purchaseId);
      formData.append('receipt_note', receiptNote);
      if (receiptFile) {
        formData.append('receipt_file', receiptFile);
      }
      await apiRequest('/api/shop/public/purchase/mark-paid', {
        accessToken,
        method: 'POST',
        body: formData
      });
      setReceiptNote('');
      setReceiptFile(null);
      await reloadPurchases();
    } catch (error) {
      setActivePurchaseError(error.message);
    } finally {
      setBusyPurchaseId('');
    }
  }

  return (
    <section className="marketing-page">
      <SectionIntro
        eyebrow="Маркетплейс офферов и активов"
        title="Shop — это не просто витрина. Это вход в продажи внутри BullRun."
        text="Здесь можно продавать P2P-офферы, активы платформы и seller storefront без общей кассы. Деньги идут продавцу напрямую, а BullRun берет на себя проверку оплаты и передачу прав."
        actions={
          <>
            {user ? (
              <>
                <button className="site-button site-button--primary" type="button" onClick={() => reloadPurchases()}>
                  Обновить мои покупки
                </button>
                <button className="site-button" type="button" onClick={() => logout()}>
                  Выйти
                </button>
              </>
            ) : (
              <button className="site-button site-button--primary" type="button" onClick={() => login()}>
                Войти и покупать
              </button>
            )}
            <a className="site-button" href="/app/shop" target="_blank" rel="noreferrer">
              Открыть seller admin
            </a>
          </>
        }
      />

      <FeatureGrid items={SHOP_TYPES} />

      {sellerStorefrontNote ? (
        <section className="marketing-card marketing-card--accent">
          <div className="marketing-card__meta">{sellerStorefrontNote.eyebrow}</div>
          <div className="marketing-card__title">{sellerStorefrontNote.title}</div>
          <div className="marketing-card__text">{sellerStorefrontNote.text}</div>
          {state.sellerStats ? (
            <div className="seller-surface__stats" style={{ marginTop: 16 }}>
              <div className="seller-surface__stat">
                <strong>{state.sellerStats.total_items}</strong>
                <span>лотов</span>
              </div>
              <div className="seller-surface__stat">
                <strong>{state.sellerStats.bundles}</strong>
                <span>комплектов</span>
              </div>
              <div className="seller-surface__stat">
                <strong>{state.sellerStats.text_offers}</strong>
                <span>P2P-офферов</span>
              </div>
              <div className="seller-surface__stat">
                <strong>{state.sellerStats.reserved}</strong>
                <span>в броне</span>
              </div>
            </div>
          ) : null}
          <div className="shop-preview__actions" style={{ marginTop: 16 }}>
            <a className="site-button" href="/shop">
              Вернуться в общий Shop
            </a>
          </div>
        </section>
      ) : null}

      <section className="shop-stage-strip">
        {stageStrip.map((stage) => (
          <article key={stage.id} className={`shop-stage-card shop-stage-card--${stage.status.replace(/\s+/g, '-')}`}>
            <div className="shop-stage-card__topline">
              <div className="shop-stage-card__title">{stage.title}</div>
              <div className="package-badge">{stage.status}</div>
            </div>
            <div className="shop-stage-card__text">{stage.text}</div>
          </article>
        ))}
      </section>

      <section className="shop-next-moves">
        {nextMoves.map((move) => (
          <article key={move.title} className="shop-next-move-card">
            <div className="marketing-card__title">{move.title}</div>
            <div className="marketing-card__text">{move.text}</div>
            <div className="shop-preview__actions" style={{ marginTop: 14 }}>
              <a className="site-button site-button--primary" href={move.href}>
                {move.label}
              </a>
            </div>
          </article>
        ))}
      </section>

      {checkoutMomentumState ? (
        <section className="marketing-card marketing-card--accent">
          <div className="marketing-card__meta">Твой текущий продуктовый путь</div>
          <div className="marketing-card__title">{checkoutMomentumState.title}</div>
          <div className="marketing-card__text">{checkoutMomentumState.text}</div>
          <div className="shop-preview__actions" style={{ marginTop: 14 }}>
            <a className="site-button site-button--primary" href={checkoutMomentumState.primaryHref}>
              {checkoutMomentumState.primaryLabel}
            </a>
            <a className="site-button" href={checkoutMomentumState.secondaryHref}>
              {checkoutMomentumState.secondaryLabel}
            </a>
          </div>
        </section>
      ) : null}

      {normalUnlockBoardVisible ? (
        <section className="marketing-card">
          <div className="marketing-card__meta">Normal unlock board</div>
          <div className="marketing-card__title">Normal уже открыт. Теперь собери из него рабочий контур, а не оставляй покупку лежать в истории.</div>
          <div className="marketing-card__text">
            После апгрейда следующий смысл не в том, чтобы еще раз смотреть витрину, а в том, чтобы быстро открыть кабинет и закрыть первые боевые шаги: прокси, юзерботы, CRM и seller-flow.
          </div>
          <div className="checkout-recommendations" style={{ marginTop: 18 }}>
            {NORMAL_UNLOCK_ACTIONS.map((action) => (
              <article key={action.title} className="checkout-recommendations__card">
                <div className="marketing-card__title">{action.title}</div>
                <div className="marketing-card__text">{action.text}</div>
                <div className="shop-preview__actions" style={{ marginTop: 12 }}>
                  <a className="site-button site-button--primary" href={action.href}>
                    {action.label}
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {sellerUnlockBoardVisible ? (
        <section className="marketing-card marketing-card--accent">
          <div className="marketing-card__meta">Seller unlock board</div>
          <div className="marketing-card__title">Seller mode уже куплен. Теперь превращай его в рабочую витрину, а не в мертвую галочку на тарифе.</div>
          <div className="marketing-card__text">
            После seller-покупки следующий шаг не в том, чтобы снова читать про seller storefront, а в том, чтобы открыть seller admin, подготовить inventory и добить первый реальный handoff покупателю.
          </div>
          <div className="checkout-recommendations" style={{ marginTop: 18 }}>
            {sellerUnlockActions.map((action) => (
              <article key={action.title} className="checkout-recommendations__card">
                <div className="marketing-card__title">{action.title}</div>
                <div className="marketing-card__text">{action.text}</div>
                <div className="shop-preview__actions" style={{ marginTop: 12 }}>
                  <a className="site-button site-button--primary" href={action.href}>
                    {action.label}
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {sellerUpgradeState ? (
        <section className="marketing-card marketing-card--accent">
          <div className="marketing-card__meta">Следующий апгрейд после Normal</div>
          <div className="marketing-card__title">{sellerUpgradeState.title}</div>
          <div className="marketing-card__text">{sellerUpgradeState.text}</div>
          <div className="shop-preview__actions" style={{ marginTop: 14 }}>
            <a className="site-button site-button--primary" href={sellerUpgradeState.primaryHref}>
              {sellerUpgradeState.primaryLabel}
            </a>
            <a className="site-button" href={sellerUpgradeState.secondaryHref}>
              {sellerUpgradeState.secondaryLabel}
            </a>
          </div>
        </section>
      ) : null}

      {sellerCheckoutMoves?.length ? (
        <section className="marketing-card marketing-card--accent">
          <div className="marketing-card__meta">Seller checkout next steps</div>
          <div className="marketing-card__title">{sellerLabel} должен вести в конкретное действие, а не в еще один общий seller CTA</div>
          <div className="marketing-card__text">
            Если seller-контур уже начат, витрина должна вести в правильный следующий шаг: добить оплату, проверить handoff или открыть {sellerAdminLabel}. Ниже именно такой seller-хвост.
          </div>
          <div className="checkout-recommendations" style={{ marginTop: 18 }}>
            {sellerCheckoutMoves.map((move) => (
              <article key={move.title} className="checkout-recommendations__card">
                <div className="marketing-card__title">{move.title}</div>
                <div className="marketing-card__text">{move.text}</div>
                <div className="shop-preview__actions" style={{ marginTop: 12 }}>
                  <a className="site-button site-button--primary" href={move.href}>
                    {move.label}
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="package-stack">
        {packages.map((pkg) => (
          <article
            key={pkg.id}
            className={`package-card${offer === pkg.id ? ' package-card--highlight' : ''}`}
          >
            <div className="package-card__header">
              <div>
                <div className="marketing-card__title">{pkg.id === 'seller' ? sellerLabel : pkg.title}</div>
                <div className="marketing-card__text">
                  {pkg.id === 'seller' && !sellerIsAssetMarketplace
                    ? 'Сценарий для продавцов hidden-message офферов: свои P2P/TON checkout, seller storefront и выдача результата прямо на сайте.'
                    : pkg.text}
                </div>
              </div>
              <div className="package-card__meta-stack">
                <div className="marketing-card__meta">
                  {pkg.item ? itemPriceSummary(pkg.item) : 'Оффер готовится'}
                </div>
                {packageStatus(pkg.id, profilePlan) ? (
                  <div className="package-badge">
                    {packageStatus(pkg.id, profilePlan)}
                  </div>
                ) : null}
                {packageSignals[pkg.id] ? (
                  <div className="package-badge">
                    {packageSignals[pkg.id].label}
                  </div>
                ) : null}
                {pkg.id === 'normal' && trialUpgradeUrgent ? (
                  <div className="package-badge">
                    Trial скоро сгорит
                  </div>
                ) : null}
              </div>
            </div>
            <div className="package-card__fit">
              {pkg.item
                ? `Базовый лот: ${pkg.item.title}`
                : 'Под этот сценарий пока нет готового лота. Можно открыть витрину и выбрать вручную.'}
            </div>
            <div className="shop-offer-summary__list" style={{ marginTop: 12 }}>
              {(pkg.id === 'seller' && !sellerIsAssetMarketplace
                ? ['Свой P2P seller storefront', 'Скрытые офферы и услуги', 'Прямой TON/P2P поток продавцу']
                : PACKAGE_UNLOCKS[pkg.id])?.map((bullet) => (
                <div key={`${pkg.id}-${bullet}`} className="shop-offer-summary__bullet">
                  {bullet}
                </div>
              ))}
            </div>
            <div className="package-card__footer">
              <a className="site-button site-button--primary" href={packageSignals[pkg.id]?.href || pkg.href}>
                {packageSignals[pkg.id]?.actionLabel || (offer === pkg.id ? 'Ты уже в этом checkout' : `Открыть ${pkg.id === 'seller' ? sellerLabel : pkg.title}`)}
              </a>
              {pkg.item ? (
                <a className="site-button" href={`/shop/?item=${encodeURIComponent(pkg.item.id)}`}>
                  Открыть базовый лот
                </a>
              ) : (
                <a className="site-button" href="/shop">
                  Смотреть витрину
                </a>
              )}
            </div>
          </article>
        ))}
      </section>

      {(offer === 'normal' || profilePlan === 'trial' || profilePlan === 'normal') ? (
        <section className="marketing-card">
          <div className="marketing-card__meta">Почему вообще нужен Normal</div>
          <div className="marketing-card__title">Normal — это момент, где Trial перестает быть песочницей и становится рабочим контуром</div>
          <div className="marketing-card__text">
            Trial нужен, чтобы быстро почувствовать продукт руками. Normal нужен, когда ты уже не хочешь смотреть демо-витрину, а хочешь стабильно принимать деньги, держать доступ, дожимать хвосты и жить в нормальной операционке.
          </div>
          <div className="upgrade-diff-grid">
            {NORMAL_UPGRADE_DIFF.map((row) => (
              <article key={row.title} className="upgrade-diff-card">
                <div className="upgrade-diff-card__title">{row.title}</div>
                <div className="upgrade-diff-card__row">
                  <strong>Trial</strong>
                  <span>{row.trial}</span>
                </div>
                <div className="upgrade-diff-card__row upgrade-diff-card__row--accent">
                  <strong>Normal</strong>
                  <span>{row.normal}</span>
                </div>
              </article>
            ))}
          </div>
          <div className="shop-preview__actions" style={{ marginTop: 16 }}>
            <a className="site-button site-button--primary" href="/shop?offer=normal">
              Перейти в checkout Normal
            </a>
            <a className="site-button" href="/pricing">
              Сравнить все уровни
            </a>
          </div>
        </section>
      ) : null}

      <section className="offer-router offer-router--checkout">
        {CHECKOUT_PATHS.map((path) => (
          <article
            key={path.id}
            className={`offer-router__card${offer === path.id ? ' offer-router__card--active' : ''}`}
          >
            <div className="offer-router__eyebrow">{path.eyebrow}</div>
            <h3>{path.title}</h3>
            <p>{path.text}</p>
            <a className="site-button site-button--primary" href={path.href}>
              {offer === path.id ? 'Ты уже в этом checkout' : 'Открыть этот checkout'}
            </a>
          </article>
        ))}
      </section>

      {offerBanner ? (
        <div className="marketing-card marketing-card--accent">
          <div className="marketing-card__title">{offerBanner.title}</div>
          <div className="marketing-card__text">{offerBanner.text}</div>
          {offerPlan ? (
            <div className="shop-offer-summary">
              <div className="shop-offer-summary__title">{offerPlan.title}</div>
              <div className="shop-offer-summary__list">
                {offerPlan.bullets.map((bullet) => (
                  <div key={bullet} className="highlight-band__pill">
                    {bullet}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="shop-preview__actions" style={{ marginTop: 14 }}>
            {offer === 'normal' ? (
              <>
                <a className="site-button site-button--primary" href="/shop?offer=normal">
                  Checkout Normal
                </a>
                <a className="site-button" href="/pricing">
                  Сравнить Trial и Normal
                </a>
              </>
            ) : null}
            {offer === 'trial' ? (
              <>
                <a className="site-button site-button--primary" href="/shop?offer=trial">
                  Checkout Trial
                </a>
                <a className="site-button" href="/pricing">
                  Как работает Trial
                </a>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {featuredTextOffers.length > 0 ? (
        <section className="marketing-card marketing-card--accent">
          <div className="marketing-card__meta">Быстрый P2P / hidden-message контур</div>
          <div className="marketing-card__title">Самый быстрый способ начать брать деньги прямо на сайте</div>
          <div className="marketing-card__text">
            Эти лоты не переводят права на актив, а сразу продают скрытое сообщение, ссылку, инструкцию или простой
            цифровой результат. Идеально для TON/P2P-офферов, первых продаж и быстрого Trial-входа.
          </div>
          <div className="checkout-recommendations">
            {featuredTextOffers.map((item) => (
              <article key={`featured-${item.id}`} className="checkout-recommendations__card">
                <div className="marketing-card__meta">P2P / скрытый оффер • {visibilityLabel(item.visibility)} • {itemPriceSummary(item)}</div>
                <div className="marketing-card__title">{item.title}</div>
                <div className="marketing-card__text">{itemDescription(item)}</div>
                <div className="offer-fit-copy">{offerFitCopy(item)}</div>
                <div className="shop-preview__price">{itemPriceSummary(item)}</div>
                <div className="shop-preview__actions">
                  {user ? (
                    <>
                      {itemPaymentMethods(item).map((method, index) => (
                        <button
                          key={`${item.id}-${method}`}
                          className={`site-button${index === 0 ? ' site-button--primary' : ''}`}
                          type="button"
                          disabled={busyItemId === item.id}
                          onClick={() => createPurchase(item.id, method)}
                        >
                          {method === 'p2p' ? 'Купить через СБП' : 'Купить через TON'}
                        </button>
                      ))}
                    </>
                  ) : (
                    <button className="site-button site-button--primary" type="button" onClick={() => login()}>
                      Войти и купить
                    </button>
                  )}
                  <a className="site-button" href={`/shop/?item=${encodeURIComponent(item.id)}`}>
                    Открыть лот
                  </a>
                </div>
              </article>
            ))}
          </div>
          <div className="marketing-grid" style={{ marginTop: 18 }}>
            {P2P_PAYMENT_MODES.map((mode) => (
              <div key={mode.title} className="marketing-card">
                <div className="marketing-card__title">{mode.title}</div>
                <div className="marketing-card__text">{mode.text}</div>
              </div>
            ))}
          </div>
          <div className="timeline-card__list" style={{ marginTop: 18 }}>
            {TEXT_OFFER_STEPS.map((step, index) => (
              <div key={step} className="timeline-card__step">
                <strong>{index + 1}.</strong>
                <span>{step}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {offer ? (
        <section className="marketing-card">
          <div className="marketing-card__meta">Рекомендуемый checkout</div>
          <div className="marketing-card__title">
            {offer === 'seller'
              ? `С чего начать в ${sellerLabel}`
              : offer === 'normal'
                ? 'Что покупать в checkout Normal'
                : offer === 'trial'
                  ? 'Что брать в checkout Trial'
                  : 'Что брать в этом checkout'}
          </div>
          <div className="marketing-card__text">
            {offer === 'seller'
              ? (sellerIsAssetMarketplace
                ? 'Ниже собраны активы BullRun, которые подходят под seller storefront: комплекты, юзерботы, прокси и базы.'
                : 'Ниже собраны hidden-message и seller-офферы, которые подходят для собственного P2P seller storefront без продажи активов BullRun.')
              : 'Ниже собраны офферы, которые подходят для on-site checkout: покупаешь, оплачиваешь TON или P2P и сразу получаешь результат на сайте.'}
          </div>
          {recommendedItems.length > 0 ? (
            <div className="checkout-recommendations">
              {recommendedItems.map((item) => (
                <article key={item.id} className="checkout-recommendations__card">
                  <div className="marketing-card__meta">
                    {itemTypeLabel(item)} • {visibilityLabel(item.visibility)} • {itemPriceSummary(item)}
                  </div>
                  <div className="offer-fit-list">
                    {offerFitLabels(item).map((label) => (
                      <span key={`${item.id}-${label}`} className="offer-fit-pill">
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className="marketing-card__title">{item.title}</div>
                  <div className="marketing-card__text">{itemDescription(item)}</div>
                  <div className="offer-fit-copy">{offerFitCopy(item)}</div>
                  <div className="shop-preview__price">{itemPriceSummary(item)}</div>
                  <div className="shop-preview__actions">
                    {user ? (
                      <>
                        {itemPaymentMethods(item).map((method, index) => (
                          <button
                            key={`${item.id}-${method}`}
                            className={`site-button${index === 0 ? ' site-button--primary' : ''}`}
                            type="button"
                            disabled={busyItemId === item.id}
                            onClick={() => createPurchase(item.id, method)}
                          >
                            {method === 'p2p' ? 'Купить через СБП' : 'Купить через TON'}
                          </button>
                        ))}
                      </>
                    ) : (
                      <button className="site-button site-button--primary" type="button" onClick={() => login()}>
                        Войти и купить
                      </button>
                    )}
                    <a className="site-button" href={`/shop/?item=${encodeURIComponent(item.id)}`}>
                      Открыть лот
                    </a>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="marketing-card__text" style={{ marginTop: 14 }}>
              Под этот checkout пока нет готовых лотов. Открой общий Shop ниже или смени сценарий сверху.
            </div>
          )}
        </section>
      ) : null}

      {offer && visibleItems.length > 0 ? (
        <section className="marketing-card marketing-card--accent">
          <div className="marketing-card__meta">Как сейчас отсортирована витрина</div>
          <div className="marketing-card__title">
            {offer === 'seller'
              ? 'Сначала seller-совместимые лоты'
              : offer === 'normal'
                ? 'Сначала лоты, которые лучше всего двигают в Normal'
                : offer === 'trial'
                  ? 'Сначала самые простые входные лоты для Trial'
                  : 'Сначала лоты, которые лучше всего подходят под этот checkout'}
          </div>
          <div className="marketing-card__text">
            Витрина выше уже перестроена под текущий сценарий. Лучшие лоты для этого checkout подняты наверх, чтобы не копаться в общем каталоге.
          </div>
          <div className="shop-preview__actions" style={{ marginTop: 14 }}>
            <button
              className={`filter-chip${fitMode === 'recommended' ? ' filter-chip--active' : ''}`}
              type="button"
              onClick={() => setFitMode('recommended')}
            >
              Только рекомендуемые ({recommendedVisibleCount || visibleItems.length})
            </button>
            <button
              className={`filter-chip${fitMode === 'all' ? ' filter-chip--active' : ''}`}
              type="button"
              onClick={() => setFitMode('all')}
            >
              Вся витрина
            </button>
          </div>
        </section>
      ) : null}

      {user ? (
        <section className="timeline-card timeline-card--split shop-checkout-panel">
          <div className="timeline-card__copy">
            <div className="hero-card__eyebrow">Мои покупки</div>
            <h2>Покупка, оплата и выдача уже живут прямо на сайте</h2>
            <p>
              Ниже твои активные покупки. Для TON есть QR и `memo`, для `P2P` — реквизиты продавца и кнопка `Я оплатил`.
              После оплаты BullRun либо откроет скрытое сообщение, либо передаст актив в твой кабинет.
            </p>
          </div>
          <div className="timeline-card__list">
            <div className="package-progress-grid">
              {packageProgress.map((pkg) => (
                <article
                  key={pkg.id}
                  className={`package-progress-card package-progress-card--${pkg.tone}`}
                >
                  <div className="package-progress-card__topline">
                    <div className="marketing-card__title">{pkg.title}</div>
                    <div className="package-badge">{pkg.label}</div>
                  </div>
                  <div className="marketing-card__text">{pkg.text}</div>
                  <div className="shop-offer-summary__list" style={{ marginTop: 12 }}>
                    {pkg.unlocks.slice(0, 2).map((unlock) => (
                      <div key={`${pkg.id}-${unlock}`} className="shop-offer-summary__bullet">
                        {unlock}
                      </div>
                    ))}
                  </div>
                  <div className="shop-preview__actions" style={{ marginTop: 14 }}>
                    <a className="site-button" href={pkg.href}>
                      {pkg.actionLabel}
                    </a>
                  </div>
                </article>
              ))}
            </div>
            <div className="shop-purchase-stats">
              {[
                ['all', 'Всего', purchaseStats.all],
                ['pending', 'Ждут оплату', purchaseStats.pending],
                ['awaiting_receipt', 'Ждут чек', purchaseStats.awaiting_receipt],
                ['paid', 'Оплачены', purchaseStats.paid],
                ['expired', 'Протухли', purchaseStats.expired],
                ['failed', 'Handoff сломан', purchaseStats.failed]
              ].map(([id, label, value]) => (
                <button
                  key={id}
                  type="button"
                  className={`shop-purchase-stat${purchaseFilter === id ? ' shop-purchase-stat--active' : ''}`}
                  onClick={() => setPurchaseFilter(id)}
                >
                  <strong>{value}</strong>
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="filter-strip">
              {[
                ['all', 'Все'],
                ['pending', 'Ждут оплату'],
                ['awaiting_receipt', 'Ждут чек'],
                ['paid', 'Оплачены'],
                ['expired', 'Протухли'],
                ['failed', 'Handoff сломан']
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`filter-chip${purchaseFilter === id ? ' filter-chip--active' : ''}`}
                  onClick={() => setPurchaseFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {purchasesState.loading ? (
              <div className="marketing-card">
                <div className="marketing-card__title">Тянем покупки</div>
                <div className="marketing-card__text">Сейчас покажем, что уже оплачено, что висит и что еще надо добить.</div>
              </div>
            ) : purchasesState.error ? (
              <div className="marketing-card">
                <div className="marketing-card__title">Покупки не дотянулись</div>
                <div className="marketing-card__text">{purchasesState.error}</div>
              </div>
            ) : visiblePurchases.length === 0 ? (
              <div className="marketing-card">
                <div className="marketing-card__title">Под фильтр ничего не попало</div>
                <div className="marketing-card__text">Купи лот ниже и он появится здесь со своим платежным сценарием.</div>
              </div>
            ) : (
              <div className="shop-purchase-layout">
                <div className="shop-purchase-list">
                  {visiblePurchases.map((purchase) => (
                    <button
                      key={purchase.id}
                      type="button"
                      className={`shop-purchase-list__item${String(activePurchaseId) === String(purchase.id) ? ' shop-purchase-list__item--active' : ''}`}
                      onClick={() => setActivePurchaseId(purchase.id)}
                    >
                      <strong>{purchase.item?.title || 'Лот'}</strong>
                      <span>{paymentMethodLabel(purchase.payload?.payment_method)}</span>
                      <span>{purchaseStatusLabel(purchase)}</span>
                    </button>
                  ))}
                </div>
                <div className="shop-purchase-detail">
                  {activePurchase ? (
                    <>
                      <div className="marketing-card__meta">
                        {paymentMethodLabel(activePurchase.payload?.payment_method)} • {purchaseStatusLabel(activePurchase)}
                      </div>
                      <div className="marketing-card__title">{activePurchase.item?.title || 'Лот'}</div>
                      <div className="marketing-card__text">
                        {activePurchase.item?.post_purchase_message && activePurchase.status === 'paid'
                          ? activePurchase.item.post_purchase_message
                          : itemDescription(activePurchase.item || {})}
                      </div>
                      <div className="shop-purchase-detail__meta">
                        <div><strong>Сумма:</strong> {purchaseAmountSummary(activePurchase)}</div>
                        <div><strong>Создан:</strong> {formatWhen(activePurchase.created_at)}</div>
                        <div><strong>Дедлайн:</strong> {formatWhen(activePurchase.expires_at)}</div>
                        <div><strong>Memo:</strong> <code>{activePurchase.payload?.memo || '—'}</code></div>
                      </div>
                      {activePurchase.payload?.payment_method === 'ton' ? (
                        <div className="shop-payment-box">
                          <div><strong>TON wallet продавца:</strong> <code>{activePurchase.payload?.seller_wallet || '—'}</code></div>
                          {activePurchase.payload?.ton_qr ? (
                            <img className="shop-qr" src={activePurchase.payload.ton_qr} alt="TON QR" />
                          ) : null}
                          <div className="shop-preview__actions">
                            {activePurchase.payload?.ton_uri ? (
                              <a className="site-button site-button--primary" href={activePurchase.payload.ton_uri}>
                                Открыть TON-ссылку
                              </a>
                            ) : null}
                            <button
                              className="site-button"
                              type="button"
                              disabled={busyPurchaseId === activePurchase.id}
                              onClick={() => checkPurchase(activePurchase.id)}
                            >
                              Проверить оплату
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="shop-payment-box">
                          <div><strong>Карта / СБП:</strong> {activePurchase.payload?.sbp_phone || '—'}</div>
                          {activePurchase.payload?.sbp_fio ? (
                            <div><strong>Получатель:</strong> {activePurchase.payload.sbp_fio}</div>
                          ) : null}
                          <div><strong>Банк:</strong> {activePurchase.payload?.sbp_bank || 'СБП'}</div>
                          <div><strong>Комментарий / memo:</strong> <code>{activePurchase.payload?.memo || '—'}</code></div>
                          {activePurchase.payload?.receipt_file_url ? (
                            <div>
                              <strong>Чек:</strong>{' '}
                              <a href={activePurchase.payload.receipt_file_url} target="_blank" rel="noreferrer">открыть файл</a>
                            </div>
                          ) : null}
                          {activePurchase.status === 'pending' ? (
                            <>
                              <textarea
                                className="field"
                                rows="3"
                                placeholder="Что отправил: банк, сумма, время, комментарий"
                                value={receiptNote}
                                onChange={(event) => setReceiptNote(event.target.value)}
                              />
                              <input
                                className="field"
                                type="file"
                                accept="image/*,.pdf"
                                onChange={(event) => setReceiptFile(event.target.files?.[0] || null)}
                              />
                              <div className="shop-preview__actions">
                                <button
                                  className="site-button site-button--primary"
                                  type="button"
                                  disabled={busyPurchaseId === activePurchase.id}
                                  onClick={() => markPaid(activePurchase.id)}
                                >
                                  Я оплатил
                                </button>
                              </div>
                            </>
                          ) : null}
                          {activePurchase.status === 'awaiting_receipt' ? (
                            <div className="marketing-card__meta">
                              Продавец уже увидит этот счет в seller admin и сможет одобрить или отклонить его вручную.
                            </div>
                          ) : null}
                        </div>
                      )}
                      {activePurchase.status === 'expired' ? (
                        <div className="marketing-card marketing-card--accent">
                          <div className="marketing-card__title">Счет протух</div>
                          <div className="marketing-card__text">
                            Не плати по старым реквизитам. Открой этот лот и создай новый счет, чтобы продавец видел актуальную бронь.
                          </div>
                        </div>
                      ) : null}
                      {activePurchase.ownership_transfer_status === 'failed' ? (
                        <div className="marketing-card marketing-card--dark">
                          <div className="marketing-card__title">Не плати заново</div>
                          <div className="marketing-card__text">
                            Оплата уже есть, но передача прав сломалась. Сохрани memo и дождись, пока продавец добьет handoff.
                          </div>
                        </div>
                      ) : null}
                      {activePurchase.status === 'paid' && activePurchaseSteps.length > 0 ? (
                        <div className="marketing-card marketing-card--accent">
                          <div className="marketing-card__title">Что делать дальше</div>
                          <div className="marketing-card__text">
                            Покупка уже закрыта. Не зависай на экране оплаты — сразу переходи в рабочий кабинет и собирай следующий шаг контура.
                          </div>
                          <div className="shop-preview__actions" style={{ marginTop: 14 }}>
                            {activePurchaseSteps.map((step) => (
                              <a key={step.href} className="site-button" href={step.href}>
                                {step.label}
                              </a>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {activePurchasePackageGuidance ? (
                        <div className="marketing-card marketing-card--accent">
                          <div className="marketing-card__meta">{activePurchasePackageGuidance.eyebrow}</div>
                          <div className="marketing-card__title">{activePurchasePackageGuidance.title}</div>
                          <div className="marketing-card__text">{activePurchasePackageGuidance.text}</div>
                          <div className="shop-preview__actions" style={{ marginTop: 14 }}>
                            <a className="site-button site-button--primary" href={activePurchasePackageGuidance.primaryHref}>
                              {activePurchasePackageGuidance.primaryLabel}
                            </a>
                            <a className="site-button" href={activePurchasePackageGuidance.secondaryHref}>
                              {activePurchasePackageGuidance.secondaryLabel}
                            </a>
                          </div>
                        </div>
                      ) : null}
                      {activePurchaseError ? (
                        <div className="marketing-card">
                          <div className="marketing-card__title">Что-то сломалось</div>
                          <div className="marketing-card__text">{activePurchaseError}</div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="marketing-card">
                      <div className="marketing-card__title">Выбери покупку</div>
                      <div className="marketing-card__text">Слева уже есть твои счета. Выбери один из них, чтобы увидеть платежный сценарий.</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      ) : (
        <div className="marketing-card marketing-card--accent">
          <div className="marketing-card__title">Чтобы покупать, нужно войти</div>
          <div className="marketing-card__text">
            Site теперь не только продает, но и реально ведет checkout. Войди через Google, и здесь появятся твои покупки, QR для TON и P2P-реквизиты продавца.
          </div>
          <div className="shop-preview__actions">
            <button className="site-button site-button--primary" type="button" onClick={() => login()}>
              Войти через Google
            </button>
          </div>
        </div>
      )}

      <section className="timeline-card timeline-card--split">
        <div className="timeline-card__copy">
          <div className="hero-card__eyebrow">Как идет сделка</div>
          <h2>У продавца не “витрина ради витрины”, а рабочий seller flow</h2>
          <p>
            Продавец выставляет лот, покупатель платит TON напрямую ему или отправляет P2P-платеж, BullRun проверяет оплату и либо открывает
            скрытое сообщение, либо переводит права на актив. Так shop становится сервисом продаж, а не каталогом.
          </p>
        </div>
        <div className="timeline-card__list">
          <div className="timeline-card__item">
            <strong>1</strong>
            <span>Seller публикует P2P-оффер или актив и получает прямую ссылку на лот или свою лавку.</span>
          </div>
          <div className="timeline-card__item">
            <strong>2</strong>
            <span>Покупатель выбирает `TON` или `P2P`, получает QR или реквизиты с memo и дедлайном оплаты.</span>
          </div>
          <div className="timeline-card__item">
            <strong>3</strong>
            <span>После оплаты BullRun либо открывает скрытый результат, либо передает актив в кабинет покупателя.</span>
          </div>
        </div>
      </section>

      <HighlightBand
        title="Почему это сильный слой"
        text="BullRun умеет не только принимать оплату. Он умеет после оплаты сделать что-то полезное: выдать скрытый оффер, перевести права на актив или открыть уже купленную базу в рабочем кабинете."
        items={[
          'TON прямо на кошелек продавца',
          'P2P с ручной seller-проверкой',
          'QR, memo и дедлайн оплаты',
          'Передача owner_id после оплаты'
        ]}
      />

      <section className="shop-preview">
        <div className="shop-preview__header">
          <div>
            <div className="hero-card__eyebrow">Живая витрина</div>
            <h2>Что уже лежит в публичном Shop</h2>
            <p>
              Это не мокап. Ниже реальные лоты из текущего `shop`, которые уже тянутся с backend и показывают, как
              выглядит продающий слой BullRun.
            </p>
          </div>
          <div className="shop-preview__stats">
            <div className="shop-preview__stat"><strong>{stats.total}</strong><span>всего</span></div>
            <div className="shop-preview__stat"><strong>{stats.bundle}</strong><span>комплекты</span></div>
            <div className="shop-preview__stat"><strong>{stats.userbot}</strong><span>юзерботы</span></div>
            <div className="shop-preview__stat"><strong>{stats.proxy}</strong><span>прокси</span></div>
            <div className="shop-preview__stat"><strong>{stats.textOffer}</strong><span>P2P-офферы</span></div>
          </div>
        </div>

        <div className="shop-preview__filters">
          {[
            ['all', 'Все'],
            ['bundle', 'Комплекты'],
            ['userbot', 'Юзерботы'],
            ['proxy', 'Прокси'],
            ['customer_base_asset', 'Базы'],
            ['text_offer', 'P2P-офферы']
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`filter-chip${filter === id ? ' filter-chip--active' : ''}`}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {offer ? (
          <div className="shop-preview__mode-note">
            Сейчас показан режим: <strong>{fitMode === 'recommended' ? 'рекомендуемые лоты под этот checkout' : 'вся витрина'}</strong>.
          </div>
        ) : null}

        {state.loading ? (
          <div className="marketing-card">
            <div className="marketing-card__title">Тянем живой Shop</div>
            <div className="marketing-card__text">Сейчас подтянем лоты и покажем, как выглядит реальная витрина.</div>
          </div>
        ) : state.error ? (
          <div className="marketing-card">
            <div className="marketing-card__title">Живой Shop пока не дотянулся</div>
            <div className="marketing-card__text">{state.error}</div>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="marketing-card">
            <div className="marketing-card__title">Под этот фильтр лотов пока нет</div>
            <div className="marketing-card__text">Можно открыть общий Shop или сменить тип лота выше.</div>
          </div>
        ) : (
          <div className="marketing-grid marketing-grid--wide">
            {visibleItems.slice(0, 6).map((item) => (
              <article key={item.id} className="marketing-card">
                <div className="marketing-card__meta">{itemTypeLabel(item)} • {visibilityLabel(item.visibility)} • {itemPriceSummary(item)}</div>
                {offerBestFitLabel(item, offer) ? (
                  <div className="package-badge" style={{ marginBottom: 10 }}>
                    {offerBestFitLabel(item, offer)}
                  </div>
                ) : null}
                <div className="offer-fit-list">
                  {offerFitLabels(item).map((label) => (
                    <span key={`${item.id}-grid-${label}`} className="offer-fit-pill">
                      {label}
                    </span>
                  ))}
                </div>
                <div className="marketing-card__title">{item.title}</div>
                <div className="marketing-card__text">{itemDescription(item)}</div>
                <div className="offer-fit-copy">{offerFitCopy(item)}</div>
                <div className="shop-preview__price">{itemPriceSummary(item)}</div>
                <div className="shop-preview__actions">
                  {user ? (
                    <>
                      {itemPaymentMethods(item).map((method, index) => (
                        <button
                          key={`${item.id}-${method}`}
                          className={`site-button${index === 0 ? ' site-button--primary' : ''}`}
                          type="button"
                          disabled={busyItemId === item.id}
                          onClick={() => createPurchase(item.id, method)}
                        >
                          {method === 'p2p' ? 'Купить через СБП' : 'Купить через TON'}
                        </button>
                      ))}
                    </>
                  ) : (
                    <button className="site-button site-button--primary" type="button" onClick={() => login()}>
                      Войти и купить
                    </button>
                  )}
                  <a className="site-button" href={`/shop/?item=${encodeURIComponent(item.id)}`}>
                    Открыть лот
                  </a>
                  {item.owner_id ? (
                    <a className="site-button" href={`/shop/?seller=${encodeURIComponent(item.owner_id)}`}>
                      Лавка продавца
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="marketing-grid marketing-grid--wide">
        <article className="marketing-card marketing-card--accent">
          <div className="marketing-card__title">Что получает продавец</div>
          <div className="marketing-card__text">
            Seller admin с бронями, протухшими счетами, P2P-чеками, сломанными handoff и seller storefront. То есть не просто
            форма создания лота, а реальный seller-ops контур.
          </div>
        </article>
        <article className="marketing-card marketing-card--dark">
          <div className="marketing-card__title">Что получает покупатель</div>
          <div className="marketing-card__text">
            Понятный `TON + P2P` flow: QR, memo, дедлайн, статус оплаты и понятный следующий шаг после покупки, а не “дальше
            сам разберись”.
          </div>
        </article>
      </section>

      <section className="seller-surface">
        <div className="seller-surface__copy">
          <div className="hero-card__eyebrow">Seller storefront</div>
          <h2>У каждого продавца может быть своя лавка внутри BullRun</h2>
          <p>
            Это не один общий каталог без хозяина. У каждого продавца может быть свой storefront, скрытые лоты по
            ссылке и свой денежный поток напрямую на его TON-кошелек или P2P-реквизиты.
          </p>
        </div>

        {sellerCards.length === 0 ? (
          <div className="marketing-card">
            <div className="marketing-card__title">Пока нет продавцов для витрины</div>
            <div className="marketing-card__text">
              Как только в `Shop` появится несколько продавцов, здесь будет видно, как выглядят их отдельные лавки.
            </div>
          </div>
        ) : (
          <div className="marketing-grid marketing-grid--wide">
            {sellerCards.map((seller) => (
              <article key={seller.owner_id} className="marketing-card seller-surface__card">
                <div className="marketing-card__title">{seller.seller_name}</div>
                <div className="marketing-card__meta">
                  {seller.seller_mode === 'asset_marketplace' ? 'Asset marketplace' : 'P2P storefront'}
                </div>
                <div className="marketing-card__text">
                  {seller.seller_mode === 'asset_marketplace'
                    ? 'Отдельная витрина с активами BullRun, комплектами и handoff-потоком без общей кассы.'
                    : 'Отдельная P2P-витрина со скрытыми офферами, TON/P2P checkout и прямой выдачей результата после оплаты.'}
                </div>
                <div className="seller-surface__stats">
                  <div className="seller-surface__stat">
                    <strong>{seller.total}</strong>
                    <span>лотов</span>
                  </div>
                  <div className="seller-surface__stat">
                    <strong>{seller.bundles}</strong>
                    <span>комплектов</span>
                  </div>
                  <div className="seller-surface__stat">
                    <strong>{seller.text_offers}</strong>
                    <span>P2P-офферов</span>
                  </div>
                  <div className="seller-surface__stat">
                    <strong>{seller.reserved}</strong>
                    <span>в броне</span>
                  </div>
                </div>
                <div className="shop-preview__actions">
                  <a
                    className="site-button site-button--primary"
                    href={`/shop/?seller=${encodeURIComponent(seller.owner_id)}`}
                  >
                    Открыть лавку
                  </a>
                  <a className="site-button" href="/shop?offer=seller">
                    Хочу такой seller mode
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <CTASection
        title="Хочешь посмотреть живой магазин?"
        text="Сначала открываешь витрину, потом продавца, потом конкретный лот. Теперь здесь же можно реально логиниться, покупать и видеть свои оплаты."
        primary={{ label: user ? 'Мои покупки' : 'Открыть Trial checkout', href: user ? '/shop' : '/shop?offer=trial' }}
        secondary={{ label: 'Сравнить Trial и Normal', href: '/pricing' }}
      />
    </section>
  );
}
