import { useMemo, useState, useEffect } from 'react';
import { Users, Clock, Trash2, MessageCircle, Link2, CreditCard, Package } from 'lucide-react';

function getTariffPaymentGroupKey(tariff) {
  return [
    tariff?.owner_id || '',
    tariff?.channel_id || '',
    String(tariff?.title || '').trim().toLowerCase(),
    String(tariff?.duration_days || '')
  ].join('|');
}

function sortTariffPaymentVariants(variants = []) {
  const currencyOrder = { TON: 1, RUB: 2, USDT: 3 };
  return [...variants].sort((left, right) => {
    const byCurrency = (currencyOrder[left.currency] || 99) - (currencyOrder[right.currency] || 99);
    if (byCurrency !== 0) return byCurrency;
    return Number(left.price || 0) - Number(right.price || 0);
  });
}

function buildTariffGroups(tariffs = []) {
  const groupsByKey = new Map();
  tariffs.forEach((tariff) => {
    const key = getTariffPaymentGroupKey(tariff);
    if (!groupsByKey.has(key)) {
      groupsByKey.set(key, { key, variants: [] });
    }
    groupsByKey.get(key).variants.push(tariff);
  });

  return Array.from(groupsByKey.values())
    .map((group) => {
      const variants = sortTariffPaymentVariants(group.variants);
      return {
        ...group,
        lead: variants[0],
        variants,
        tariffIds: variants.map((variant) => variant.id)
      };
    })
    .sort((left, right) => Number(left.lead?.price || 0) - Number(right.lead?.price || 0));
}

function dedupeBundleItems(items = []) {
  const byKey = new Map();
  items.forEach((item) => {
    const key = [
      item.item_type,
      item.channel_id || '',
      item.resource_title || '',
      item.resource_url || ''
    ].join('|');

    if (!byKey.has(key)) {
      byKey.set(key, { ...item, itemIds: [item.id] });
      return;
    }

    byKey.get(key).itemIds.push(item.id);
  });
  return Array.from(byKey.values());
}

function formatPaymentVariants(variants = []) {
  return sortTariffPaymentVariants(variants)
    .map((variant) => `${variant.price} ${variant.currency || 'TON'}`)
    .join(' / ');
}

function getBundleSummaryForItems(tariff, items = []) {
  if (items.length === 0 && tariff.channel_id) {
    return `Пока только базовый доступ в ${tariff.channels?.title || 'основной канал'}`;
  }
  if (items.length === 0) {
    return 'Бот пока ничего не выдает после оплаты';
  }

  const channelCount = items.filter((item) => item.item_type === 'channel').length;
  const resourceCount = items.filter((item) => item.item_type === 'resource').length;
  const parts = [];
  if (tariff.channel_id) parts.push('основная группа');
  if (channelCount > 0) parts.push(`${channelCount} Telegram-целей`);
  if (resourceCount > 0) parts.push(`${resourceCount} доп. материалов`);
  return parts.join(' + ');
}

function CreateTariffForm({
  newTariff,
  setNewTariff,
  channels,
  officialBots,
  onCreate
}) {
  const [errors, setErrors] = useState({});
  const groupAccess = newTariff.access_methods?.group || { enabled: true };
  const chatAccess = newTariff.access_methods?.chat || { enabled: false, channel_id: '' };
  const resourceAccess = newTariff.access_methods?.resource || { enabled: false, title: '', text: '' };
  const tonPayment = newTariff.payment_methods?.ton || { enabled: false, price: '' };
  const rubPayment = newTariff.payment_methods?.rub || { enabled: false, price: '' };
  const isLifetime = newTariff.is_lifetime || false;
  const selectedBotId = newTariff.bot_id || '';

  const botChannels = selectedBotId
    ? channels.filter((channel) => channel.bot_id === selectedBotId)
    : channels;
  const groupChannels = botChannels.filter((channel) => !['group', 'supergroup'].includes(String(channel.chat_type || '').toLowerCase()));
  const chatChannels = botChannels.filter((channel) => ['group', 'supergroup'].includes(String(channel.chat_type || '').toLowerCase()));

  // Автоматически выбираем первый вариант, если значение не задано
  useEffect(() => {
    if (groupAccess.enabled && !newTariff.channel_id && groupChannels.length > 0) {
      setNewTariff((prev) => ({ ...prev, channel_id: groupChannels[0].id }));
    }
  }, [groupAccess.enabled, groupChannels.length]);

  useEffect(() => {
    if (chatAccess.enabled && !chatAccess.channel_id && chatChannels.length > 0) {
      updateAccessMethod('chat', { channel_id: chatChannels[0].id });
    }
  }, [chatAccess.enabled, chatChannels.length]);

  useEffect(() => {
    setNewTariff((prev) => {
      const updates = { channel_id: '' };
      if (groupChannels.length > 0) updates.channel_id = groupChannels[0].id;
      return { ...prev, ...updates };
    });
    updateAccessMethod('chat', { channel_id: chatChannels.length > 0 ? chatChannels[0].id : '' });
  }, [selectedBotId]);

  const updatePaymentMethod = (method, patch) => {
    setNewTariff((prev) => ({
      ...prev,
      payment_methods: {
        ...prev.payment_methods,
        [method]: {
          ...prev.payment_methods?.[method],
          ...patch
        }
      }
    }));
  };

  const updateAccessMethod = (method, patch) => {
    setNewTariff((prev) => ({
      ...prev,
      access_methods: {
        ...prev.access_methods,
        [method]: {
          ...prev.access_methods?.[method],
          ...patch
        }
      }
    }));
  };

  const validateAndCreate = () => {
    const newErrors = {};

    if (!newTariff.title?.trim()) {
      newErrors.title = 'Укажи название тарифа';
    }

    if (!isLifetime && (!newTariff.duration_days || Number(newTariff.duration_days) <= 0)) {
      newErrors.duration_days = 'Укажи срок действия';
    }

    const hasAnyAccess = groupAccess.enabled || chatAccess.enabled || resourceAccess.enabled;
    if (!hasAnyAccess) {
      newErrors.access = 'Выбери хотя бы один метод выдачи';
    }

    if (groupAccess.enabled && !newTariff.channel_id) {
      if (groupChannels.length === 0) {
        newErrors.group_channel = 'Нет доступных закрытых групп';
      } else {
        newErrors.group_channel = 'Выбери закрытую группу';
      }
    }

    if (chatAccess.enabled && !chatAccess.channel_id) {
      if (chatChannels.length === 0) {
        newErrors.chat_channel = 'Нет доступных чатов';
      } else {
        newErrors.chat_channel = 'Выбери чат';
      }
    }

    if (resourceAccess.enabled && !resourceAccess.text?.trim()) {
      newErrors.resource_text = 'Заполни ссылку или текст';
    }

    const hasAnyPayment = tonPayment.enabled || rubPayment.enabled;
    if (!hasAnyPayment) {
      newErrors.payment = 'Включи хотя бы один способ оплаты';
    }

    if (tonPayment.enabled && (!tonPayment.price || Number(tonPayment.price) <= 0)) {
      newErrors.ton_price = 'Укажи стоимость в TON';
    }

    if (rubPayment.enabled && (!rubPayment.price || Number(rubPayment.price) <= 0)) {
      newErrors.rub_price = 'Укажи стоимость в RUB';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    onCreate();
  };

  const getAccessCount = () => {
    let count = 0;
    if (groupAccess.enabled) count++;
    if (chatAccess.enabled) count++;
    if (resourceAccess.enabled) count++;
    return count;
  };

  return (
    <div className="create-tariff-form">
      <div className="create-tariff-window">
        {/* Заголовок формы */}
        <div className="create-tariff-window__header">
          <div className="create-tariff-window__title">Создать новый тариф</div>
          <div className="create-tariff-window__subtitle">Настройте параметры тарифа для продажи доступа</div>
        </div>

        {/* Секции формы */}
        <div className="create-tariff-window__sections">
          {/* Базовые настройки */}
          <div className="create-tariff-section">
            <div className="create-tariff-section__header">
              <div className="create-tariff-section__title">
                <span className="create-tariff-section__number">1</span>
                Базовые настройки
              </div>
              <div className="create-tariff-section__hint">Название и срок действия тарифа</div>
            </div>
            <div className="create-tariff-section__body">
              <div className="form-grid">
                <div className={`field-group ${errors.title ? 'field-group--error' : ''}`}>
                  <label className="field-label">Название тарифа</label>
                  <input
                    className="field"
                    value={newTariff.title}
                    onChange={(e) => setNewTariff((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder="VIP месяц"
                  />
                  {errors.title && <div className="error-text">{errors.title}</div>}
                </div>
                {!isLifetime ? (
                  <div className={`field-group ${errors.duration_days ? 'field-group--error' : ''}`}>
                    <label className="field-label">Срок (дни)</label>
                    <input
                      className="field"
                      type="number"
                      min="1"
                      value={newTariff.duration_days}
                      onChange={(e) => setNewTariff((prev) => ({ ...prev, duration_days: e.target.value }))}
                      placeholder="30"
                    />
                    {errors.duration_days && <div className="error-text">{errors.duration_days}</div>}
                  </div>
                ) : (
                  <div className="field-group">
                    <label className="field-label">Срок доступа</label>
                    <div className="field" style={{ background: '#f0fdf4', borderColor: '#86efac', color: '#166534', fontWeight: '600' }}>
                      ✓ Навсегда
                    </div>
                  </div>
                )}
              </div>

              {/* Переключатель "Навсегда" */}
              <div className="create-tariff-option" style={{ marginTop: '12px' }}>
                <div
                  className="create-tariff-option__head"
                  onClick={() => setNewTariff((prev) => ({ ...prev, is_lifetime: !prev.is_lifetime }))}
                >
                  <div className="create-tariff-option__info">
                    <div className="create-tariff-option__title">Навсегда</div>
                    <div className="create-tariff-option__hint">Пожизненный доступ без ограничения по сроку</div>
                  </div>
                  <div
                    className={`toggle-switch ${isLifetime ? 'toggle-switch--on' : ''}`}
                    role="switch"
                    aria-checked={isLifetime}
                    aria-label="Навсегда"
                  >
                    <span className="toggle-switch__thumb" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="create-tariff-divider" />

          {/* Официальный бот */}
          <div className="create-tariff-section">
            <div className="create-tariff-section__header">
              <div className="create-tariff-section__title">
                <span className="create-tariff-section__number">2</span>
                Официальный бот
              </div>
              <div className="create-tariff-section__hint">Бот который будет выдавать доступ после оплаты</div>
            </div>
            <div className="create-tariff-section__body">
              <div className={`field-group ${errors.bot ? 'field-group--error' : ''}`}>
                <label className="field-label">Выбери бота</label>
                {officialBots.length > 0 ? (
                  <select
                    className="field"
                    value={selectedBotId}
                    onChange={(e) => setNewTariff((prev) => ({ ...prev, bot_id: e.target.value }))}
                  >
                    <option value="">Все боты</option>
                    {officialBots.map((bot) => (
                      <option key={bot.id} value={bot.id}>
                        {bot.tg_username ? `@${bot.tg_username}` : `ID ${bot.tg_account_id}`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select className="field" disabled>
                    <option value="">Нет подключённых ботов</option>
                  </select>
                )}
                {errors.bot && <div className="error-text">{errors.bot}</div>}
              </div>
            </div>
          </div>

          <div className="create-tariff-divider" />

          {/* Методы доступа */}
          <div className="create-tariff-section">
            <div className="create-tariff-section__header">
              <div className="create-tariff-section__title">
                <span className="create-tariff-section__number">3</span>
                Что выдаём после оплаты
                <span className="create-tariff-badge">{getAccessCount()} опций</span>
              </div>
              <div className="create-tariff-section__hint">Выбери одну или несколько опций для пакета</div>
            </div>
            <div className="create-tariff-section__body">
              {/* Закрытая группа */}
              <div className={`create-tariff-option ${groupAccess.enabled ? 'create-tariff-option--active' : ''}`}>
                <div
                  className="create-tariff-option__head"
                  onClick={() => updateAccessMethod('group', { enabled: !groupAccess.enabled })}
                >
                  <div className="create-tariff-option__info">
                    <div className="create-tariff-option__title">Закрытая группа</div>
                    <div className="create-tariff-option__hint">Бот отправит ссылку на вступление</div>
                  </div>
                  <div
                    className={`toggle-switch ${groupAccess.enabled ? 'toggle-switch--on' : ''}`}
                    role="switch"
                    aria-checked={groupAccess.enabled}
                    aria-label="Закрытая группа"
                  >
                    <span className="toggle-switch__thumb" />
                  </div>
                </div>
                {groupAccess.enabled && (
                  <div className="create-tariff-option__body">
                    <label className={`field-group ${errors.group_channel ? 'field-group--error' : ''}`}>
                      {groupChannels.length > 0 ? (
                        <select
                          className="field"
                          value={newTariff.channel_id}
                          onChange={(e) => setNewTariff((prev) => ({ ...prev, channel_id: e.target.value }))}
                        >
                          {groupChannels.map((channel) => (
                            <option key={channel.id} value={channel.id}>{channel.title}</option>
                          ))}
                        </select>
                      ) : (
                        <select className="field" disabled>
                          <option value="">Нет доступных групп</option>
                        </select>
                      )}
                      {errors.group_channel && <div className="error-text">{errors.group_channel}</div>}
                    </label>
                  </div>
                )}
              </div>

              {/* Чат */}
              <div className={`create-tariff-option ${chatAccess.enabled ? 'create-tariff-option--active' : ''}`}>
                <div
                  className="create-tariff-option__head"
                  onClick={() => updateAccessMethod('chat', { enabled: !chatAccess.enabled })}
                >
                  <div className="create-tariff-option__info">
                    <div className="create-tariff-option__title">Чат</div>
                    <div className="create-tariff-option__hint">Бот отправит ссылку на вступление в чат</div>
                  </div>
                  <div
                    className={`toggle-switch ${chatAccess.enabled ? 'toggle-switch--on' : ''}`}
                    role="switch"
                    aria-checked={chatAccess.enabled}
                    aria-label="Чат"
                  >
                    <span className="toggle-switch__thumb" />
                  </div>
                </div>
                {chatAccess.enabled && (
                  <div className="create-tariff-option__body">
                    <label className={`field-group ${errors.chat_channel ? 'field-group--error' : ''}`}>
                      {chatChannels.length > 0 ? (
                        <select
                          className="field"
                          value={chatAccess.channel_id || ''}
                          onChange={(e) => updateAccessMethod('chat', { channel_id: e.target.value })}
                        >
                          {chatChannels.map((channel) => (
                            <option key={channel.id} value={channel.id}>{channel.title}</option>
                          ))}
                        </select>
                      ) : (
                        <select className="field" disabled>
                          <option value="">Нет доступных чатов</option>
                        </select>
                      )}
                      {errors.chat_channel && <div className="error-text">{errors.chat_channel}</div>}
                    </label>
                  </div>
                )}
              </div>

              {/* Ссылка / текст */}
              <div className={`create-tariff-option ${resourceAccess.enabled ? 'create-tariff-option--active' : ''}`}>
                <div
                  className="create-tariff-option__head"
                  onClick={() => updateAccessMethod('resource', { enabled: !resourceAccess.enabled })}
                >
                  <div className="create-tariff-option__info">
                    <div className="create-tariff-option__title">Ссылка / текст</div>
                    <div className="create-tariff-option__hint">Бот отправит материал после оплаты</div>
                  </div>
                  <div
                    className={`toggle-switch ${resourceAccess.enabled ? 'toggle-switch--on' : ''}`}
                    role="switch"
                    aria-checked={resourceAccess.enabled}
                    aria-label="Ссылка / текст"
                  >
                    <span className="toggle-switch__thumb" />
                  </div>
                </div>
                {resourceAccess.enabled && (
                  <div className="create-tariff-option__body">
                    <div className="form-grid">
                      <div className="field-group">
                        <label className="field-label">Название материала</label>
                        <input
                          className="field"
                          value={resourceAccess.title || ''}
                          onChange={(e) => updateAccessMethod('resource', { title: e.target.value })}
                          placeholder="Гайд / курс / ссылка"
                        />
                      </div>
                      <div className={`field-group ${errors.resource_text ? 'field-group--error' : ''}`}>
                        <label className="field-label">URL или текст</label>
                        <textarea
                          className="field textarea-field"
                          value={resourceAccess.text || ''}
                          onChange={(e) => updateAccessMethod('resource', { text: e.target.value })}
                          placeholder="https://... или текст, который получит покупатель"
                          rows={2}
                        />
                        {errors.resource_text && <div className="error-text">{errors.resource_text}</div>}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {errors.access && <div className="error-text">{errors.access}</div>}
            </div>
          </div>

          <div className="create-tariff-divider" />

          {/* Способы оплаты */}
          <div className="create-tariff-section">
            <div className="create-tariff-section__header">
              <div className="create-tariff-section__title">
                <span className="create-tariff-section__number">4</span>
                Способы оплаты
              </div>
              <div className="create-tariff-section__hint">Включи один или оба способа</div>
            </div>
            <div className="create-tariff-section__body">
              <div className="create-tariff-payment">
                <div className={`create-tariff-payment-option ${tonPayment.enabled ? 'create-tariff-payment-option--active' : ''}`}>
                  <div
                    className="create-tariff-payment-option__head"
                    onClick={() => updatePaymentMethod('ton', { enabled: !tonPayment.enabled })}
                  >
                    <div className="create-tariff-payment-option__info">
                      <div className="create-tariff-payment-option__currency">TON</div>
                    </div>
                    <div
                      className={`toggle-switch ${tonPayment.enabled ? 'toggle-switch--on' : ''}`}
                      role="switch"
                      aria-checked={tonPayment.enabled}
                      aria-label="TON"
                    >
                      <span className="toggle-switch__thumb" />
                    </div>
                  </div>
                  {tonPayment.enabled && (
                    <div className="create-tariff-payment-option__body">
                      <div className={`field-group ${errors.ton_price ? 'field-group--error' : ''}`}>
                        <input
                          className="field"
                          type="number"
                          min="0"
                          step="0.01"
                          value={tonPayment.price}
                          onChange={(e) => updatePaymentMethod('ton', { price: e.target.value })}
                          placeholder="Стоимость в TON"
                        />
                        {errors.ton_price && <div className="error-text">{errors.ton_price}</div>}
                      </div>
                    </div>
                  )}
                </div>

                <div className={`create-tariff-payment-option ${rubPayment.enabled ? 'create-tariff-payment-option--active' : ''}`}>
                  <div
                    className="create-tariff-payment-option__head"
                    onClick={() => updatePaymentMethod('rub', { enabled: !rubPayment.enabled })}
                  >
                    <div className="create-tariff-payment-option__info">
                      <div className="create-tariff-payment-option__currency">RUB / СБП</div>
                    </div>
                    <div
                      className={`toggle-switch ${rubPayment.enabled ? 'toggle-switch--on' : ''}`}
                      role="switch"
                      aria-checked={rubPayment.enabled}
                      aria-label="RUB / СБП"
                    >
                      <span className="toggle-switch__thumb" />
                    </div>
                  </div>
                  {rubPayment.enabled && (
                    <div className="create-tariff-payment-option__body">
                      <div className={`field-group ${errors.rub_price ? 'field-group--error' : ''}`}>
                        <input
                          className="field"
                          type="number"
                          min="0"
                          step="0.01"
                          value={rubPayment.price}
                          onChange={(e) => updatePaymentMethod('rub', { price: e.target.value })}
                          placeholder="Стоимость в RUB"
                        />
                        {errors.rub_price && <div className="error-text">{errors.rub_price}</div>}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {errors.payment && <div className="error-text">{errors.payment}</div>}
            </div>
          </div>
        </div>

        {/* Кнопка создания */}
        <div className="create-tariff-window__footer">
          <button
            type="button"
            className="button button--primary button--large"
            onClick={validateAndCreate}
          >
            Создать тариф
          </button>
        </div>
      </div>
    </div>
  );
}

export function TariffsSection({
  addBundleItem,
  bundleDrafts,
  bundleSupport,
  channels,
  createTariff,
  deleteBundleItem,
  deleteTariff,
  ensureBundleDraft,
  getTariffBundleItems,
  newTariff,
  officialBots,
  setBundleDrafts,
  setNewTariff,
  tariffs
}) {
  const tariffGroups = useMemo(() => buildTariffGroups(tariffs), [tariffs]);
  const botsById = useMemo(() => {
    const map = new Map();
    (officialBots || []).forEach((bot) => map.set(String(bot.id), bot));
    return map;
  }, [officialBots]);

  return (
    <>
      <section className="plans-tariffs-section">
        {!bundleSupport ? (
          <div className="empty-inline" style={{ marginBottom: 16 }}>
            Bundle-пакеты в БД не активированы. Пока будет работать только схема один тариф → один основной канал.
          </div>
        ) : null}

        {/* Новая форма создания тарифа */}
        <CreateTariffForm
          newTariff={newTariff}
          setNewTariff={setNewTariff}
          channels={channels}
          officialBots={officialBots}
          onCreate={createTariff}
        />

        {tariffGroups.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">📦</div>
            <div className="empty-state__title">Пока нет тарифов</div>
            <div className="empty-state__hint">Создай первый тариф с помощью формы выше</div>
          </div>
        ) : (
          <div className="tariffs-grid">
            {tariffGroups.map((group) => {
              const tariff = group.lead;
              const bundleItems = dedupeBundleItems(getTariffBundleItems(group.tariffIds));
              const hasGroup = tariff.channel_id || tariff.channels;
              const hasBundleItems = bundleItems.length > 0;

              return (
                <div key={group.key} className="tariff-card">
                  {/* Header */}
                  <div className="tariff-card__header">
                    <div className="tariff-card__title-block">
                      <h3 className="tariff-card__title">{tariff.title}</h3>
                      <div className="tariff-card__meta">
                        <span className="tariff-card__meta-item">
                          <Users size={14} />
                          {(() => {
                            const bot = tariff.bot_id ? botsById.get(String(tariff.bot_id)) : null;
                            return bot ? (bot.tg_username ? `@${bot.tg_username}` : `Bot ${bot.tg_account_id}`) : (tariff.channels?.title || 'Нет группы');
                          })()}
                        </span>
                        <span className="tariff-card__meta-item">
                          <Clock size={14} />
                          {tariff.duration_days === 0 || !tariff.duration_days ? 'Навсегда' : `${tariff.duration_days} дней`}
                        </span>
                      </div>
                    </div>

                    <button
                      className="tariff-card__delete"
                      onClick={() => deleteTariff(group.tariffIds)}
                      title="Удалить тариф"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                    </button>
                  </div>

                  {/* Payment Methods */}
                  <div className="tariff-card__section">
                    <div className="tariff-card__section-title">Способы оплаты</div>
                    <div className="payment-methods-list">
                      {group.variants.map((variant) => (
                        <div key={variant.id} className="payment-method-item">
                          <span className="payment-method-item__currency">{variant.currency}</span>
                          {variant.price}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Access Methods */}
                  <div className="tariff-card__section">
                    <div className="tariff-card__section-title">Что выдаётся</div>
                    <div className="access-methods-list">
                      {hasGroup && (
                        <div className="access-method-item">
                          <div className="access-method-item__icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" strokeLinecap="round" strokeLinejoin="round"/>
                              <circle cx="9" cy="7" r="4" />
                            </svg>
                          </div>
                          <div className="access-method-item__content">
                            <div className="access-method-item__label">Основная группа</div>
                            <div className="access-method-item__value">{tariff.channels?.title || 'Закрытый канал'}</div>
                          </div>
                        </div>
                      )}

                      {bundleItems.map((item) => {
                        if (item.item_type === 'channel') {
                          return (
                            <div key={item.id} className="access-method-item">
                              <div className="access-method-item__icon">
                                <MessageCircle size={16} />
                              </div>
                              <div className="access-method-item__content">
                                <div className="access-method-item__label">Доп. чат</div>
                                <div className="access-method-item__value">{item.channels?.title || 'Telegram-чат'}</div>
                              </div>
                            </div>
                          );
                        } else {
                          return (
                            <div key={item.id} className="access-method-item">
                              <div className="access-method-item__icon">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102 1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656 0l4 4a4 4 0 105.656 5.656l-1.101 1.101m0-4.899L19.07 4.93a4 4 0 00-5.656 0l-4 4a4 4 0 00-5.656 0l4 4a4 4 0 005.656 5.656l-1.101 1.101M7 17h.01" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              </div>
                              <div className="access-method-item__content">
                                <div className="access-method-item__label">Материал</div>
                                <div className="access-method-item__value">{item.resource_title || 'Ссылка или текст'}</div>
                              </div>
                            </div>
                          );
                        }
                      })}
                    </div>
                  </div>

                  {/* Footer Stats */}
                  <div className="tariff-card__footer">
                    {group.variants.length > 1 && (
                      <div className="tariff-badge">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="2" y="5" width="20" height="14" rx="2" />
                          <line x1="2" y1="10" x2="22" y2="10" />
                        </svg>
                        {group.variants.length} {group.variants.length === 1 ? 'способ оплаты' : group.variants.length > 1 && group.variants.length < 5 ? 'способа оплаты' : 'способов оплаты'}
                      </div>
                    )}
                    {hasBundleItems && (
                      <div className="tariff-badge tariff-badge--bundle">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                        </svg>
                        Пакет из {bundleItems.length + (hasGroup ? 1 : 0)} {bundleItems.length + (hasGroup ? 1 : 0) === 1 ? 'элемента' : (bundleItems.length + (hasGroup ? 1 : 0)) < 5 ? 'элементов' : 'элементов'}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
