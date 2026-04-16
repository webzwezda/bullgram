import { useMemo } from 'react';

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
  const tonPayment = newTariff.payment_methods?.ton || { enabled: false, price: '' };
  const rubPayment = newTariff.payment_methods?.rub || { enabled: false, price: '' };
  const groupAccess = newTariff.access_methods?.group || { enabled: true };
  const chatAccess = newTariff.access_methods?.chat || { enabled: false, channel_id: '' };
  const resourceAccess = newTariff.access_methods?.resource || { enabled: false, title: '', text: '' };
  const groupChannels = channels.filter((channel) => !['group', 'supergroup'].includes(String(channel.chat_type || '').toLowerCase()));
  const chatChannels = channels.filter((channel) => ['group', 'supergroup'].includes(String(channel.chat_type || '').toLowerCase()));
  const tariffGroups = useMemo(() => buildTariffGroups(tariffs), [tariffs]);

  return (
    <>
      <section className="plans-tariffs-section">
        {!bundleSupport ? (
          <div className="empty-inline" style={{ marginBottom: 16 }}>
            Bundle-пакеты в БД не активированы. Пока будет работать только схема один тариф → один основной канал.
          </div>
        ) : null}

        <div className="plans-create-panel">
          <div className="toolbar-card__title">Создать тариф</div>
          <div className="form-grid plans-form-grid">
            <div className="plans-access-methods">
              <div className="plans-access-method">
                <div className="plans-access-method__head">
                  <div>
                    <div className="plans-access-method__title">Закрытая группа</div>
                    <div className="plans-access-method__hint">Бот выдаст одноразовую ссылку на вступление.</div>
                  </div>
                  <button
                    type="button"
                    className={`ios-switch${groupAccess.enabled ? ' ios-switch--on' : ''}`}
                    role="switch"
                    aria-checked={groupAccess.enabled}
                    aria-label="Закрытая группа"
                    onClick={() => updateAccessMethod('group', { enabled: !groupAccess.enabled })}
                  >
                    <span className="ios-switch__thumb" />
                  </button>
                </div>
                {groupAccess.enabled ? (
                  <label className="field-group plans-form-grid__channel">
                    <select className="field" value={newTariff.channel_id} onChange={(event) => setNewTariff((prev) => ({ ...prev, channel_id: event.target.value }))}>
                      <option value="">Выбери группу</option>
                      {groupChannels.map((channel) => (
                        <option key={channel.id} value={channel.id}>{channel.title}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              <label className="field-group plans-form-grid__title">
                <span>Название</span>
                <input className="field" value={newTariff.title} onChange={(event) => setNewTariff((prev) => ({ ...prev, title: event.target.value }))} placeholder="VIP месяц" />
              </label>

              <div className="plans-access-method">
                <div className="plans-access-method__head">
                  <div>
                    <div className="plans-access-method__title">Чат</div>
                    <div className="plans-access-method__hint">Бот выдаст ссылку на вступление в чат.</div>
                  </div>
                  <button
                    type="button"
                    className={`ios-switch${chatAccess.enabled ? ' ios-switch--on' : ''}`}
                    role="switch"
                    aria-checked={chatAccess.enabled}
                    aria-label="Чат"
                    onClick={() => updateAccessMethod('chat', { enabled: !chatAccess.enabled })}
                  >
                    <span className="ios-switch__thumb" />
                  </button>
                </div>
                {chatAccess.enabled ? (
                  <label className="field-group plans-form-grid__channel">
                    <select className="field" value={chatAccess.channel_id || ''} onChange={(event) => updateAccessMethod('chat', { channel_id: event.target.value })}>
                      <option value="">Выбери чат</option>
                      {chatChannels.map((channel) => (
                        <option key={channel.id} value={channel.id}>{channel.title}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              <div className="plans-access-method">
                <div className="plans-access-method__head">
                  <div>
                    <div className="plans-access-method__title">Ссылка / текст</div>
                    <div className="plans-access-method__hint">Бот отправит материал после оплаты.</div>
                  </div>
                  <button
                    type="button"
                    className={`ios-switch${resourceAccess.enabled ? ' ios-switch--on' : ''}`}
                    role="switch"
                    aria-checked={resourceAccess.enabled}
                    aria-label="Ссылка / текст"
                    onClick={() => updateAccessMethod('resource', { enabled: !resourceAccess.enabled })}
                  >
                    <span className="ios-switch__thumb" />
                  </button>
                </div>
                {resourceAccess.enabled ? (
                  <div className="plans-access-method__fields">
                    <input
                      className="field"
                      value={resourceAccess.title || ''}
                      onChange={(event) => updateAccessMethod('resource', { title: event.target.value })}
                      placeholder="Название"
                    />
                    <textarea
                      className="field textarea-field"
                      value={resourceAccess.text || ''}
                      onChange={(event) => updateAccessMethod('resource', { text: event.target.value })}
                      placeholder="https://... или текст, который получит покупатель"
                    />
                  </div>
                ) : null}
              </div>
            </div>

            <div className="plans-payment-methods">
              <div className="plans-payment-method">
                <div className="plans-payment-method__head">
                  <div className="plans-payment-method__title">TON</div>
                  <button
                    type="button"
                    className={`ios-switch${tonPayment.enabled ? ' ios-switch--on' : ''}`}
                    role="switch"
                    aria-checked={tonPayment.enabled}
                    aria-label="TON"
                    onClick={() => updatePaymentMethod('ton', { enabled: !tonPayment.enabled })}
                  >
                    <span className="ios-switch__thumb" />
                  </button>
                </div>
                {tonPayment.enabled ? (
                  <input
                    className="field plans-payment-method__price"
                    type="number"
                    min="0"
                    value={tonPayment.price}
                    onChange={(event) => updatePaymentMethod('ton', { price: event.target.value })}
                    placeholder="Стоимость в TON"
                  />
                ) : null}
              </div>

              <div className="plans-payment-method">
                <div className="plans-payment-method__head">
                  <div className="plans-payment-method__title">RUB / СБП</div>
                  <button
                    type="button"
                    className={`ios-switch${rubPayment.enabled ? ' ios-switch--on' : ''}`}
                    role="switch"
                    aria-checked={rubPayment.enabled}
                    aria-label="RUB / СБП"
                    onClick={() => updatePaymentMethod('rub', { enabled: !rubPayment.enabled })}
                  >
                    <span className="ios-switch__thumb" />
                  </button>
                </div>
                {rubPayment.enabled ? (
                  <input
                    className="field plans-payment-method__price"
                    type="number"
                    min="0"
                    value={rubPayment.price}
                    onChange={(event) => updatePaymentMethod('rub', { price: event.target.value })}
                    placeholder="Стоимость в RUB"
                  />
                ) : null}
              </div>
            </div>

            <label className="field-group">
              <span>Срок в днях</span>
              <input className="field" type="number" min="1" value={newTariff.duration_days} onChange={(event) => setNewTariff((prev) => ({ ...prev, duration_days: event.target.value }))} placeholder="30" />
            </label>
          </div>
          <div className="table-actions" style={{ marginTop: 14 }}>
            <button className="ghost-button" type="button" onClick={createTariff}>Создать тариф</button>
          </div>
        </div>

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
