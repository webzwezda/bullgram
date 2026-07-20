import { Router } from 'express';
import { verifyPaymentOnce } from '../services/ton-connect-verify.service.js';
import { claimPaid, markExpired } from '../services/payment-claim.service.js';
import {
  activateNormalForOrder,
  recordBillingEvent,
  NORMAL_PLAN
} from '../services/bullrun-billing.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIEW_RATE_LIMIT_RPM = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

function detectNetwork() {
  const base = String(process.env.TONCONNECT_TONAPI_BASE || '').toLowerCase();
  if (base.includes('testnet')) return 'testnet';
  return 'mainnet';
}

function tonUriFor(wallet, amountNano, memo) {
  if (!wallet) return null;
  return `ton://transfer/${wallet}?amount=${amountNano}&text=${encodeURIComponent(memo || '')}`;
}

function shapePublicView(order) {
  const payload = order.payload || {};
  const merchantWallet = payload.merchant_wallet || process.env.PLATFORM_TON_WALLET || '';
  const memo = payload.memo || order.provider_invoice_id || '';
  const amountNano = String(payload.expected_nanoton || '0');
  const amountTon = Number(payload.ton_amount || 0);
  const network = detectNetwork();
  return {
    id: order.id,
    kind: 'billing',
    status: order.status,
    amount_ton: amountTon,
    amount_nanoton: amountNano,
    memo,
    seller_wallet: merchantWallet,
    network,
    expires_at: order.expires_at,
    item_title: NORMAL_PLAN.title || 'Bullgram Normal',
    description: `Тариф Normal на ${order.duration_days || NORMAL_PLAN.durationDays} дн.`,
    ton_uri: tonUriFor(merchantWallet, amountNano, memo),
    ton_qr: null,
    plan_code: order.plan_code,
    duration_days: order.duration_days || NORMAL_PLAN.durationDays
  };
}

export function publicBillingRoutes(supabase) {
  const router = Router();
  const viewHitsByIp = new Map();
  const verifyHitsByIp = new Map();

  function pickIp(req) {
    const raw = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
      .split(',')[0].trim();
    if (!raw) return null;
    if (/^::ffff:\d+\.\d+\.\d+\.\d+$/.test(raw)) return raw.slice(7);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) return raw;
    if (/^[0-9a-f:]+$/i.test(raw)) return raw;
    return null;
  }

  function checkRateLimit(map, ip, limit, windowMs) {
    const now = Date.now();
    const windowStart = now - windowMs;
    const hits = (map.get(ip) || []).filter((t) => t > windowStart);
    if (hits.length >= limit) return false;
    hits.push(now);
    map.set(ip, hits);
    return true;
  }

  router.get('/public/:id/public-view', async (req, res) => {
    const ip = pickIp(req) || 'unknown';
    if (!checkRateLimit(viewHitsByIp, ip, VIEW_RATE_LIMIT_RPM, RATE_LIMIT_WINDOW_MS)) {
      return res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' });
    }

    const { id } = req.params;
    if (!UUID_RE.test(String(id))) {
      return res.status(400).json({ error: 'Некорректный ID счёта' });
    }

    try {
      const { data: order, error } = await supabase
        .from('billing_orders')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!order) return res.status(404).json({ error: 'Счёт не найден' });

      if (order.status === 'pending' && order.expires_at
          && new Date(order.expires_at).getTime() <= Date.now()) {
        const fresh = await markExpired({ supabase, table: 'billing_orders', id });
        if (fresh) order.status = 'expired';
      }

      return res.json(shapePublicView(order));
    } catch (err) {
      console.error('[billing-public] public-view failed:', err.message || err);
      return res.status(500).json({ error: 'Ошибка загрузки счёта' });
    }
  });

  router.post('/public/:id/verify-public', async (req, res) => {
    const ip = pickIp(req) || 'unknown';
    if (!checkRateLimit(verifyHitsByIp, ip, VIEW_RATE_LIMIT_RPM, RATE_LIMIT_WINDOW_MS)) {
      return res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' });
    }

    const { id } = req.params;
    if (!UUID_RE.test(String(id))) {
      return res.status(400).json({ error: 'Некорректный ID счёта' });
    }

    try {
      const { data: order, error } = await supabase
        .from('billing_orders')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!order) return res.status(404).json({ error: 'Счёт не найден' });

      if (order.status === 'paid') {
        return res.json({ status: 'paid', success: true, already: true });
      }
      if (order.status === 'expired') {
        return res.json({ status: 'expired', success: false });
      }

      if (order.expires_at && new Date(order.expires_at).getTime() <= Date.now()) {
        const fresh = await markExpired({ supabase, table: 'billing_orders', id });
        if (fresh) return res.json({ status: 'expired', success: false });
      }

      const payload = order.payload || {};
      const merchantWallet = payload.merchant_wallet || process.env.PLATFORM_TON_WALLET;
      const memo = payload.memo || order.provider_invoice_id;
      const expectedNano = payload.expected_nanoton;
      const senderWallet = req.body && typeof req.body.sender_wallet === 'string'
        ? req.body.sender_wallet
        : null;

      if (!merchantWallet || !memo || !expectedNano) {
        const fresh = await markExpired({ supabase, table: 'billing_orders', id });
        if (fresh) return res.json({ status: 'expired', success: false });
        return res.status(500).json({ error: 'Некорректные данные заказа' });
      }

      let result;
      try {
        result = await verifyPaymentOnce({
          merchantWallet,
          memo,
          expectedNanoTon: expectedNano,
          senderWallet
        });
      } catch (err) {
        console.error('[billing-public] tonapi fetch failed:', err.message || err);
        return res.json({ status: 'pending', success: false, retry: true });
      }

      if (!result.ok) {
        return res.json({ status: 'pending', success: false, retry: true });
      }

      const nowIso = new Date().toISOString();
      const claimed = await claimPaid({
        supabase,
        table: 'billing_orders',
        id: order.id,
        patch: {
          status: 'paid',
          paid_at: nowIso,
          updated_at: nowIso,
          provider_payment_id: result.txHash || null,
          payload: {
            ...payload,
            sender_wallet: result.matchedSender || senderWallet || null,
            matched_amount_nanoton: result.matchedAmountNano || null,
            tx_hash: result.txHash || null,
            verified_at: nowIso
          }
        }
      });

      if (!claimed) {
        // Race: другой worker уже заclaimил. Проверить активацию тарифа, при необходимости повторить.
        const { data: fresh } = await supabase
          .from('billing_orders')
          .select('*')
          .eq('id', order.id)
          .maybeSingle();

        if (fresh?.status === 'paid') {
          const { data: profile } = await supabase
            .from('profiles')
            .select('product_tier')
            .eq('id', fresh.owner_id)
            .maybeSingle();
          if (profile && String(profile.product_tier || '').toLowerCase() !== 'normal'
              && String(profile.product_tier || '').toLowerCase() !== 'pro') {
            try {
              await activateNormalForOrder(supabase, fresh);
            } catch (activateErr) {
              console.error('[billing-public] race-lost activate retry failed:', activateErr.message || activateErr);
            }
          }
        }
        return res.json({ status: 'paid', success: true, already: true });
      }

      await recordBillingEvent(supabase, {
        billing_order_id: claimed.id,
        owner_id: claimed.owner_id,
        event_type: 'ton_connect_payment_verified',
        provider: 'ton_connect',
        amount_rub: Number(claimed.amount_rub || 0),
        payload: {
          memo,
          tx_hash: result.txHash || null,
          sender_wallet: result.matchedSender || senderWallet || null,
          matched_amount_nanoton: result.matchedAmountNano || null
        }
      });

      try {
        await activateNormalForOrder(supabase, claimed);
      } catch (activateErr) {
        console.error('[billing-public] activate failed (claim already persisted):', activateErr.message || activateErr);
        // Не откатывать paid. Recovery через повторный verify (race-lost path) или ручной SQL.
      }

      return res.json({ status: 'paid', success: true });
    } catch (err) {
      console.error('[billing-public] verify-public failed:', err.message || err);
      return res.status(500).json({ error: 'Ошибка проверки оплаты' });
    }
  });

  return router;
}
