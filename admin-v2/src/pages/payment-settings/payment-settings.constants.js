export const DEFAULT_SETTINGS = {
  ton_wallet: '',
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

export const AUTOFILL_BLOCK_PROPS = {
  autoComplete: 'off',
  spellCheck: false,
  'data-lpignore': 'true',
  'data-1p-ignore': 'true',
  'data-bwignore': 'true'
};

export const PAYMENT_EVENT_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'webhook', label: 'Webhook' },
  { id: 'completed', label: 'Закрылись' },
  { id: 'rejected', label: 'Косяки' }
];
