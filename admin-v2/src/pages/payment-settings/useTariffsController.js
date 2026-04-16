import { useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { DEFAULT_NEW_TARIFF } from './payment-settings.constants.js';

export function useTariffsController({
  bundleItems,
  bundleSupport,
  tariffs,
  userId
}) {
  const [newTariff, setNewTariff] = useState(DEFAULT_NEW_TARIFF);
  const [bundleDrafts, setBundleDrafts] = useState({});

  function ensureBundleDraft(tariffId) {
    setBundleDrafts((prev) => {
      if (prev[tariffId]) return prev;
      return {
        ...prev,
        [tariffId]: {
          item_type: 'channel',
          channel_id: '',
          resource_title: '',
          resource_url: ''
        }
      };
    });
  }

  function getTariffBundleItems(tariffIdOrIds) {
    const tariffIds = Array.isArray(tariffIdOrIds) ? tariffIdOrIds.map(String) : [String(tariffIdOrIds)];
    return bundleItems.filter((item) => tariffIds.includes(String(item.tariff_id)));
  }

  async function createTariff() {
    if (!userId) return;
    const accessMethods = newTariff.access_methods || {};
    const groupAccess = accessMethods.group || { enabled: true };
    const chatAccess = accessMethods.chat || { enabled: false, channel_id: '' };
    const resourceAccess = accessMethods.resource || { enabled: false, title: '', text: '' };
    const paymentMethods = [
      {
        currency: 'TON',
        enabled: !!newTariff.payment_methods?.ton?.enabled,
        price: newTariff.payment_methods?.ton?.price
      },
      {
        currency: 'RUB',
        enabled: !!newTariff.payment_methods?.rub?.enabled,
        price: newTariff.payment_methods?.rub?.price
      }
    ].filter((method) => method.enabled);

    if (!newTariff.title || !newTariff.duration_days) {
      window.alert('Заполни название и срок.');
      return;
    }

    if (!groupAccess.enabled && !chatAccess.enabled && !resourceAccess.enabled) {
      window.alert('Включи хотя бы одну выдачу: группу, чат или ссылку/текст.');
      return;
    }

    if (groupAccess.enabled && !newTariff.channel_id) {
      window.alert('Выбери закрытую группу для выдачи доступа.');
      return;
    }

    if ((chatAccess.enabled || resourceAccess.enabled) && !bundleSupport) {
      window.alert('Пакеты в БД не активированы. Пока можно включить только выдачу основной группы.');
      return;
    }

    if (chatAccess.enabled && !chatAccess.channel_id) {
      window.alert('Выбери чат, куда бот будет выдавать ссылку на вступление.');
      return;
    }

    if (resourceAccess.enabled && !String(resourceAccess.text || '').trim()) {
      window.alert('Заполни ссылку или текст, который бот отправит после оплаты.');
      return;
    }

    if (paymentMethods.length === 0) {
      window.alert('Включи хотя бы один способ оплаты: TON или RUB/СБП.');
      return;
    }

    if (paymentMethods.some((method) => !method.price || Number(method.price) <= 0)) {
      window.alert('Заполни стоимость для каждого включенного способа оплаты.');
      return;
    }

    try {
      const payloads = paymentMethods.map((method) => ({
        owner_id: userId,
        channel_id: groupAccess.enabled ? newTariff.channel_id : null,
        title: newTariff.title,
        price: parseFloat(method.price),
        duration_days: parseInt(newTariff.duration_days, 10),
        currency: method.currency,
        is_active: true
      }));

      const insertResult = await supabase.from('tariffs').insert(payloads).select('id');
      if (insertResult.error) throw insertResult.error;

      const createdTariffIds = (insertResult.data || []).map((tariff) => tariff.id).filter(Boolean);
      const bundlePayloads = [];

      if (bundleSupport && chatAccess.enabled) {
        createdTariffIds.forEach((tariffId) => {
          bundlePayloads.push({
            owner_id: userId,
            tariff_id: tariffId,
            item_type: 'channel',
            channel_id: chatAccess.channel_id,
            sort_order: 0
          });
        });
      }

      if (bundleSupport && resourceAccess.enabled) {
        createdTariffIds.forEach((tariffId) => {
          bundlePayloads.push({
            owner_id: userId,
            tariff_id: tariffId,
            item_type: 'resource',
            resource_title: String(resourceAccess.title || '').trim() || 'Ссылка / текст',
            resource_url: String(resourceAccess.text || '').trim(),
            sort_order: chatAccess.enabled ? 1 : 0
          });
        });
      }

      if (bundlePayloads.length > 0) {
        const { error: bundleInsertError } = await supabase.from('tariff_bundle_items').insert(bundlePayloads);
        if (bundleInsertError) throw bundleInsertError;
      }

      setNewTariff(DEFAULT_NEW_TARIFF);
      window.alert(paymentMethods.length > 1
        ? 'Тарифы под оба способа оплаты созданы. Экран сам подхватит их после обновления.'
        : 'Тариф создан. Экран сам подхватит его после обновления.'
      );
      window.location.reload();
    } catch (error) {
      window.alert(error.message);
    }
  }

  async function deleteTariff(idOrIds) {
    if (!window.confirm('Точно убрать тариф? Старые чеки и статистика останутся.')) return;
    try {
      const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
      const { error } = await supabase.from('tariffs').update({ is_active: false }).in('id', ids);
      if (error) throw error;
      window.location.reload();
    } catch (err) {
      window.alert(err.message);
    }
  }

  async function addBundleItem(tariff, draftKey = tariff.id, targetTariffIds = [tariff.id]) {
    if (!bundleSupport) {
      window.alert('Bundle-пакеты еще не включены в БД.');
      return;
    }

    const draft = bundleDrafts[draftKey] || {
      item_type: 'channel',
      channel_id: '',
      resource_title: '',
      resource_url: ''
    };

    if (draft.item_type === 'channel' && !draft.channel_id) {
      window.alert('Выбери канал/чат для пакета.');
      return;
    }
    if (draft.item_type === 'resource' && (!draft.resource_title || !draft.resource_url)) {
      window.alert('Для материала нужны название и ссылка.');
      return;
    }

    try {
      const targetIds = targetTariffIds.length > 0 ? targetTariffIds : [tariff.id];
      const payloads = targetIds.map((tariffId) => ({
        owner_id: userId,
        tariff_id: tariffId,
        item_type: draft.item_type,
        sort_order: getTariffBundleItems(tariffId).length
      }));

      if (draft.item_type === 'channel') {
        payloads.forEach((payload) => {
          payload.channel_id = draft.channel_id;
        });
      } else {
        payloads.forEach((payload) => {
          payload.resource_title = draft.resource_title;
          payload.resource_url = draft.resource_url;
        });
      }

      const { error } = await supabase.from('tariff_bundle_items').insert(payloads);
      if (error) throw error;
      window.location.reload();
    } catch (err) {
      window.alert(err.message);
    }
  }

  async function deleteBundleItem(itemIdOrIds) {
    if (!window.confirm('Убрать этот элемент из пакета?')) return;
    try {
      const itemIds = Array.isArray(itemIdOrIds) ? itemIdOrIds : [itemIdOrIds];
      const { error } = await supabase.from('tariff_bundle_items').update({ is_active: false }).in('id', itemIds);
      if (error) throw error;
      window.location.reload();
    } catch (err) {
      window.alert(err.message);
    }
  }

  return {
    addBundleItem,
    bundleDrafts,
    createTariff,
    deleteBundleItem,
    deleteTariff,
    ensureBundleDraft,
    getTariffBundleItems,
    newTariff,
    setBundleDrafts,
    setNewTariff
  };
}
