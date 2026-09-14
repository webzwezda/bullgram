import { useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase.js';
import { DEFAULT_NEW_TARIFF } from './payment-settings.constants.js';

export function useTariffsController({
  bundleItems,
  bundleSupport,
  tariffs,
  userId,
  onChanged
}) {
  const [newTariff, setNewTariff] = useState(DEFAULT_NEW_TARIFF);
  const [bundleDrafts, setBundleDrafts] = useState({});
  const [creating, setCreating] = useState(false);

  // Мутация уже применилась в БД — падение refresh не должно врать
  // «Не удалось создать/отключить»
  async function refreshList() {
    try {
      await refreshList();
    } catch (error) {
      console.error('Не удалось обновить список тарифов:', error);
    }
  }

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
    if (!userId || creating) return;
    const accessMethods = newTariff.access_methods || {};
    const groupAccess = accessMethods.group || { enabled: true };
    const chatAccess = accessMethods.chat || { enabled: false, channel_id: '' };
    const resourceAccess = accessMethods.resource || { enabled: false, title: '', text: '' };
    const isLifetime = newTariff.is_lifetime || false;
    const isFree = newTariff.is_free || false;
    const paymentMethods = [
      {
        currency: 'TON',
        enabled: true,
        price: isFree ? 0 : newTariff.payment_methods?.ton?.price
      }
    ];

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

    if (!isFree && paymentMethods.some((method) => !method.price || Number(method.price) <= 0)) {
      toast.error('Заполни стоимость для каждого включенного способа оплаты.');
      return;
    }

    setCreating(true);
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
      await refreshList();
      toast.success('Тариф создан.');
    } catch (error) {
      console.error('Не удалось создать тариф:', error);
      toast.error('Не удалось создать тариф');
    } finally {
      setCreating(false);
    }
  }

  async function deleteTariff(idOrIds) {
    if (!userId) return;
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    try {
      // Soft-delete: is_active=false, строка и история чеков остаются. Defense-in-depth
      // поверх RLS — фильтр по owner_id и на клиенте.
      const { error } = await supabase
        .from('tariffs')
        .update({ is_active: false })
        .in('id', ids)
        .eq('owner_id', userId);
      if (error) throw error;
      await refreshList();
      toast('Тариф отключён. Чеки и статистика остаются в журнале.');
    } catch (err) {
      console.error('Не удалось отключить тариф:', err);
      toast.error('Не удалось отключить тариф');
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
      await refreshList();
    } catch (err) {
      console.error('Не удалось добавить вариант в пакет:', err);
      toast.error('Не удалось добавить вариант в пакет');
    }
  }

  async function deleteBundleItem(itemIdOrIds) {
    if (!userId) return;
    const itemIds = Array.isArray(itemIdOrIds) ? itemIdOrIds : [itemIdOrIds];
    try {
      const { error } = await supabase
        .from('tariff_bundle_items')
        .update({ is_active: false })
        .in('id', itemIds)
        .eq('owner_id', userId);
      if (error) throw error;
      // Undo теперь живой: тост не убивается синхронным reload,
      // реактивация и refresh происходят по клику
      toast('Элемент убран из пакета.', {
        action: {
          label: 'Вернуть',
          onClick: async () => {
            try {
              const { error: undoError } = await supabase
                .from('tariff_bundle_items')
                .update({ is_active: true })
                .in('id', itemIds)
                .eq('owner_id', userId);
              if (undoError) throw undoError;
              await refreshList();
            } catch (undoErr) {
              console.error('Не удалось вернуть элемент в пакет:', undoErr);
              toast.error('Не удалось вернуть элемент');
            }
          }
        }
      });
      await refreshList();
    } catch (err) {
      console.error('Не удалось удалить вариант пакета:', err);
      toast.error('Не удалось удалить вариант пакета');
    }
  }

  return {
    addBundleItem,
    bundleDrafts,
    createTariff,
    creating,
    deleteBundleItem,
    deleteTariff,
    ensureBundleDraft,
    getTariffBundleItems,
    newTariff,
    setBundleDrafts,
    setNewTariff
  };
}
