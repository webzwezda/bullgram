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
