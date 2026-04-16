export const DEFAULT_SETTINGS = {
  ton_wallet: '',
  sbp_phone: '',
  sbp_bank: '',
  sbp_fio: '',
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
  channel_id: '',
  title: '',
  access_methods: {
    group: {
      enabled: true
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
      enabled: false,
      price: ''
    },
    rub: {
      enabled: false,
      price: ''
    }
  },
  duration_days: '',
  is_lifetime: false
};

export const SBP_BANK_OPTIONS = [
  { value: 'Сбербанк', label: 'Сбербанк' },
  { value: 'Т-Банк', label: 'Т-Банк' }
];

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
