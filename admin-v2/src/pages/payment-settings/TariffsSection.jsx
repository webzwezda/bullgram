import { useMemo, useState, useEffect } from 'react';

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
  onCreate
}) {
  const [errors, setErrors] = useState({});
  const groupAccess = newTariff.access_methods?.group || { enabled: true };
  const chatAccess = newTariff.access_methods?.chat || { enabled: false, channel_id: '' };
  const resourceAccess = newTariff.access_methods?.resource || { enabled: false, title: '', text: '' };
  const tonPayment = newTariff.payment_methods?.ton || { enabled: false, price: '' };
  const rubPayment = newTariff.payment_methods?.rub || { enabled: false, price: '' };

  const groupChannels = channels.filter((channel) => !['group', 'supergroup'].includes(String(channel.chat_type || '').toLowerCase()));
  const chatChannels = channels.filter((channel) => ['group', 'supergroup'].includes(String(channel.chat_type || '').toLowerCase()));

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

    if (!newTariff.duration_days || Number(newTariff.duration_days) <= 0) {
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
              </div>
            </div>
          </div>

          <div className="create-tariff-divider" />

          {/* Методы доступа */}
          <div className="create-tariff-section">
            <div className="create-tariff-section__header">
              <div className="create-tariff-section__title">
                <span className="create-tariff-section__number">2</span>
                Что выдаём после оплаты
                <span className="create-tariff-badge">{getAccessCount()} опций</span>
              </div>
              <div className="create-tariff-section__hint">Выбери одну или несколько опций для пакета</div>
            </div>
            <div className="create-tariff-section__body">
              {/* Закрытая группа */}
              <div className={`create-tariff-option ${groupAccess.enabled ? 'create-tariff-option--active' : ''}`}>
                <div className="create-tariff-option__head">
                  <div className="create-tariff-option__info">
                    <div className="create-tariff-option__title">Закрытая группа</div>
                    <div className="create-tariff-option__hint">Бот отправит ссылку на вступление</div>
                  </div>
                  <button
                    type="button"
                    className={`toggle-switch ${groupAccess.enabled ? 'toggle-switch--on' : ''}`}
                    onClick={() => updateAccessMethod('group', { enabled: !groupAccess.enabled })}
                  >
                    <span className="toggle-switch__thumb" />
                  </button>
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
                <div className="create-tariff-option__head">
                  <div className="create-tariff-option__info">
                    <div className="create-tariff-option__title">Чат</div>
                    <div className="create-tariff-option__hint">Бот отправит ссылку на вступление в чат</div>
                  </div>
                  <button
                    type="button"
                    className={`toggle-switch ${chatAccess.enabled ? 'toggle-switch--on' : ''}`}
                    onClick={() => updateAccessMethod('chat', { enabled: !chatAccess.enabled })}
                  >
                    <span className="toggle-switch__thumb" />
                  </button>
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
                <div className="create-tariff-option__head">
                  <div className="create-tariff-option__info">
                    <div className="create-tariff-option__title">Ссылка / текст</div>
                    <div className="create-tariff-option__hint">Бот отправит материал после оплаты</div>
                  </div>
                  <button
                    type="button"
                    className={`toggle-switch ${resourceAccess.enabled ? 'toggle-switch--on' : ''}`}
                    onClick={() => updateAccessMethod('resource', { enabled: !resourceAccess.enabled })}
                  >
                    <span className="toggle-switch__thumb" />
                  </button>
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
                <span className="create-tariff-section__number">3</span>
                Способы оплаты
              </div>
              <div className="create-tariff-section__hint">Включи один или оба способа</div>
            </div>
            <div className="create-tariff-section__body">
              <div className="create-tariff-payment">
                <div className={`create-tariff-payment-option ${tonPayment.enabled ? 'create-tariff-payment-option--active' : ''}`}>
                  <div className="create-tariff-payment-option__head">
                    <div className="create-tariff-payment-option__info">
                      <div className="create-tariff-payment-option__currency">TON</div>
                    </div>
                    <button
                      type="button"
                      className={`toggle-switch ${tonPayment.enabled ? 'toggle-switch--on' : ''}`}
                      onClick={() => updatePaymentMethod('ton', { enabled: !tonPayment.enabled })}
                    >
                      <span className="toggle-switch__thumb" />
                    </button>
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
                  <div className="create-tariff-payment-option__head">
                    <div className="create-tariff-payment-option__info">
                      <div className="create-tariff-payment-option__currency">RUB / СБП</div>
                    </div>
                    <button
                      type="button"
                      className={`toggle-switch ${rubPayment.enabled ? 'toggle-switch--on' : ''}`}
                      onClick={() => updatePaymentMethod('rub', { enabled: !rubPayment.enabled })}
                    >
                      <span className="toggle-switch__thumb" />
                    </button>
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
  setBundleDrafts,
  setNewTariff,
  tariffs
}) {
  const tariffGroups = useMemo(() => buildTariffGroups(tariffs), [tariffs]);

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
          onCreate={createTariff}
        />

        {tariffGroups.length === 0 ? (
          <div className="empty-inline">Пока нет тарифов. Создай первый прямо тут.</div>
        ) : (
          <div className="plans-tariff-grid">
            {tariffGroups.map((group) => {
              const tariff = group.lead;
              const draft = bundleDrafts[group.key] || { item_type: 'channel', channel_id: '', resource_title: '', resource_url: '' };
              const bundleItems = dedupeBundleItems(getTariffBundleItems(group.tariffIds));
              return (
                <div key={group.key} className="table-card plans-tariff-card">
                  <div className="plans-tariff-head">
                    <div className="plans-tariff-head__copy">
                      <div className="table-card__title">{tariff.title}</div>
                      <div className="table-subtext">
                        {tariff.channels?.title || 'Без основной группы'} • {formatPaymentVariants(group.variants)} • {tariff.duration_days} дн.
                      </div>
                    </div>
                    <div className="plans-tariff-head__badges">
                      {bundleItems.length > 0 ? <span className="pill pill--ok">Пакет</span> : null}
                      {group.variants.length > 1 ? <span className="pill pill--info">{group.variants.length} способа оплаты</span> : null}
                    </div>
                  </div>

                  <div className="table-subtext" style={{ marginTop: 12 }}>{getBundleSummaryForItems(tariff, bundleItems)}</div>

                  {bundleSupport ? (
                    <div className="plans-bundle-panel">
                      <div className="toolbar-card__title">Состав пакета</div>
                      {bundleItems.length === 0 ? (
                        <div className="empty-inline">Пока пусто. Есть только основной канал.</div>
                      ) : (
                        <div className="list-stack">
                          {bundleItems.map((item) => (
                            <div key={item.id} className="plans-bundle-item">
                              <div className="plans-bundle-item__copy">
                                <strong>{item.item_type === 'channel' ? 'Telegram-цель' : 'Материал'}</strong>
                                <div className="table-subtext">
                                  {item.item_type === 'channel' ? item.channels?.title || 'Канал не найден' : `${item.resource_title || 'Без названия'} • ${item.resource_url || ''}`}
                                </div>
                              </div>
                              <button className="inline-action" onClick={() => deleteBundleItem(item.itemIds || [item.id])}>Убрать</button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="form-grid plans-form-grid plans-bundle-form">
                        <label className="field-group">
                          <span>Что добавить</span>
                          <select
                            className="field"
                            value={draft.item_type}
                            onChange={(event) => {
                              const value = event.target.value;
                              ensureBundleDraft(group.key);
                              setBundleDrafts((prev) => ({
                                ...prev,
                                [group.key]: {
                                  ...prev[group.key],
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
                                ensureBundleDraft(group.key);
                                setBundleDrafts((prev) => ({
                                  ...prev,
                                  [group.key]: {
                                    ...prev[group.key],
                                    channel_id: event.target.value
                                  }
                                }));
                              }}
                            >
                              <option value="">Выбери цель</option>
                              {channels.map((channel) => (
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
                                  ensureBundleDraft(group.key);
                                  setBundleDrafts((prev) => ({
                                    ...prev,
                                    [group.key]: {
                                      ...prev[group.key],
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
                                  ensureBundleDraft(group.key);
                                  setBundleDrafts((prev) => ({
                                    ...prev,
                                    [group.key]: {
                                      ...prev[group.key],
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
                        <button className="ghost-button" type="button" onClick={() => addBundleItem(tariff, group.key, group.tariffIds)}>
                          Добавить в пакет
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="table-actions" style={{ marginTop: 14 }}>
                    <button className="inline-action" onClick={() => deleteTariff(group.tariffIds)}>Выключить тариф</button>
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
