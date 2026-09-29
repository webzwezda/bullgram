import { apiRequest } from '../../api/client.js';

// Общий вход в оплату Pro: кнопки главной и маршрут /get-account создают счёт одним кодом
export async function createTonConnectOrder(accessToken) {
  const data = await apiRequest('/api/billing/checkout/ton-connect', {
    accessToken,
    method: 'POST',
    body: {}
  });
  if (!data?.order_id) throw new Error('Не получили order_id от сервера');
  return data.order_id;
}

export function checkoutErrorMessage(e) {
  const status = e?.status || e?.statusCode;
  if (!status) return 'Не удалось связаться с сервером. Проверь интернет и попробуй ещё раз.';
  if (status >= 500) return 'Сервис оплаты недоступен. Напиши в поддержку.';
  return e.message || 'Не удалось создать счёт';
}
