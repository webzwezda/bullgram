import { useState } from 'react';
import { toast } from 'sonner';
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
    const isLifetime = newTariff.is_lifetime || false;
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

    if (!newTariff.title || (!isLifetime && !newTariff.duration_days)) {
      toast.error('Заполни название и срок.');
      return;
    }

    if (!groupAccess.enabled && !chatAccess.enabled && !resourceAccess.enabled) {
      toast.error('Включи хотя бы одну выдачу: группу, чат или ссылку/текст.');
      return;
    }

    if (groupAccess.enabled && !newTariff.channel_id) {
      toast.error('Выбери закрытый канал для выдачи доступа.');
      return;
    }

    if ((chatAccess.enabled || resourceAccess.enabled) && !bundleSupport) {
      toast.error('Пакеты в БД не активированы. Пока можно включить только выдачу основной группы.');
      return;
    }

    if (chatAccess.enabled && !chatAccess.channel_id) {
      toast.error('Выбери чат, куда бот будет выдавать ссылку на вступление.');
      return;
    }

    if (resourceAccess.enabled && !String(resourceAccess.text || '').trim()) {
      toast.error('Заполни ссылку или текст, который бот отправит после оплаты.');
      return;
    }

    if (paymentMethods.length === 0) {
      toast.error('Включи хотя бы один способ оплаты: TON или RUB/СБП.');
      return;
    }

    if (paymentMethods.some((method) => !method.price || Number(method.price) <= 0)) {
      toast.error('Заполни стоимость для каждого включенного способа оплаты.');
      return;
    }

    try {
      const payloads = paymentMethods.map((method) => ({
        owner_id: userId,
        bot_id: newTariff.bot_id || null,
        channel_id: groupAccess.enabled ? newTariff.channel_id : null,
        title: newTariff.title,
        price: parseFloat(method.price),
        duration_days: isLifetime ? 0 : parseInt(newTariff.duration_days, 10),
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
      toast.success(paymentMethods.length > 1
        ? 'Тарифы под оба способа оплаты созданы.'
        : 'Тариф создан.');
      window.location.reload();
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function deleteTariff(idOrIds) {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    try {
      const { error } = await supabase.from('tariffs').update({ is_active: false }).in('id', ids);
      if (error) throw error;
      toast('Тариф убран. Старые чеки и статистика остаются.', {
        action: {
          label: 'Вернуть',
          onClick: async () => {
            await supabase.from('tariffs').update({ is_active: true }).in('id', ids);
            window.location.reload();
          }
        }
      });
      window.location.reload();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function addBundleItem(tariff, draftKey = tariff.id, targetTariffIds = [tariff.id]) {
    if (!bundleSupport) {
      toast.error('Bundle-пакеты еще не включены в БД.');
      return;
    }

    const draft = bundleDrafts[draftKey] || {
      item_type: 'channel',
      channel_id: '',
      resource_title: '',
      resource_url: ''
    };

    if (draft.item_type === 'channel' && !draft.channel_id) {
      toast.error('Выбери канал/чат для пакета.');
      return;
    }
    if (draft.item_type === 'resource' && (!draft.resource_title || !draft.resource_url)) {
      toast.error('Для материала нужны название и ссылка.');
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
      toast.error(err.message);
    }
  }

  async function deleteBundleItem(itemIdOrIds) {
    const itemIds = Array.isArray(itemIdOrIds) ? itemIdOrIds : [itemIdOrIds];
    try {
      const { error } = await supabase.from('tariff_bundle_items').update({ is_active: false }).in('id', itemIds);
      if (error) throw error;
      toast('Элемент убран из пакета.', {
        action: {
          label: 'Вернуть',
          onClick: async () => {
            await supabase.from('tariff_bundle_items').update({ is_active: true }).in('id', itemIds);
            window.location.reload();
          }
        }
      });
      window.location.reload();
    } catch (err) {
      toast.error(err.message);
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
