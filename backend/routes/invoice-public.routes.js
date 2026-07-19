import { Router } from 'express';
import { verifyTonConnectPayment } from '../services/ton-connect-verify.service.js';
import { OfficialBotService } from '../services/official-bot.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_RATE_LIMIT_RPM = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

export function invoicePublicRoutes(supabase, getBotById) {
  const router = Router();
  const officialBotService = new OfficialBotService(supabase);
  const viewHitsByIp = new Map();
  const verifyHitsByIp = new Map();

  function pickIp(req) {
    return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
      .split(',')[0].trim();
  }

  function checkRateLimit(map, ip) {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    const hits = (map.get(ip) || []).filter((t) => t > windowStart);
    if (hits.length >= PUBLIC_RATE_LIMIT_RPM) return false;
    hits.push(now);
    map.set(ip, hits);
    return true;
  }

  router.get('/public/:invoiceId/public-view', async (req, res) => {
    const ip = pickIp(req);
    if (!checkRateLimit(viewHitsByIp, ip)) {
      return res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' });
    }

    const { invoiceId } = req.params;
    if (!UUID_RE.test(String(invoiceId))) {
      return res.status(400).json({ error: 'Некорректный ID счёта' });
    }

    try {
      const { data: invoice, error } = await supabase
        .from('invoices')
        .select('id, status, amount, currency, memo, expires_at, tariff_id')
        .eq('id', invoiceId)
        .maybeSingle();
      if (error) throw error;
      if (!invoice) return res.status(404).json({ error: 'Счёт не найден' });

      if (invoice.status === 'pending' && invoice.expires_at
          && new Date(invoice.expires_at).getTime() <= Date.now()) {
        const { data: fresh, error: expErr } = await supabase
          .from('invoices')
          .update({ status: 'expired' })
          .eq('id', invoiceId)
          .eq('status', 'pending')
          .select('status, expires_at')
          .maybeSingle();
        if (!expErr && fresh) {
          invoice.status = fresh.status;
          invoice.expires_at = fresh.expires_at;
        }
      }

      const { data: tariff, error: tariffErr } = await supabase
        .from('tariffs')
        .select('title, owner_id')
        .eq('id', invoice.tariff_id)
        .maybeSingle();
      if (tariffErr) throw tariffErr;

      let wallet = null;
      let network = 'mainnet';
      if (tariff?.owner_id) {
        const { data: settings } = await supabase
          .from('payment_settings')
          .select('ton_wallet, ton_network')
          .eq('owner_id', tariff.owner_id)
          .maybeSingle();
        wallet = settings?.ton_wallet || null;
        network = settings?.ton_network || 'mainnet';
      }

      const memo = invoice.memo;
      const amountTon = Number(invoice.amount || 0);
      const amountNano = Math.round(amountTon * 1e9);
      const tonUri = wallet
        ? `ton://transfer/${wallet}?amount=${amountNano}&text=${encodeURIComponent(memo || '')}`
        : null;

      return res.json({
        id: invoice.id,
        kind: 'invoice',
        status: invoice.status,
        amount_ton: amountTon,
        amount_nanoton: amountNano,
        memo,
        seller_wallet: wallet,
        network,
        expires_at: invoice.expires_at,
        item_title: tariff?.title || 'Заказ',
        ton_uri: tonUri,
        ton_qr: null
      });
    } catch (err) {
      console.error('Ошибка public-view invoice:', err);
      res.status(500).json({ error: 'Ошибка загрузки счёта' });
    }
  });

  router.post('/public/:invoiceId/verify-public', async (req, res) => {
    const ip = pickIp(req);
    if (!checkRateLimit(verifyHitsByIp, ip)) {
      return res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' });
    }

    const { invoiceId } = req.params;
    if (!UUID_RE.test(String(invoiceId))) {
      return res.status(400).json({ error: 'Некорректный ID счёта' });
    }

    try {
      const { data: invoice, error } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', invoiceId)
        .maybeSingle();
      if (error) throw error;
      if (!invoice) return res.status(404).json({ error: 'Счёт не найден' });

      if (invoice.status === 'paid') {
        return res.json({ status: 'paid', success: true });
      }
      if (invoice.status !== 'pending') {
        return res.json({ status: invoice.status, success: false });
      }

      const { data: tariff } = await supabase
        .from('tariffs')
        .select('owner_id, bot_id')
        .eq('id', invoice.tariff_id)
        .maybeSingle();

      if (!tariff?.owner_id) {
        return res.status(500).json({ error: 'Тариф не найден' });
      }

      const { data: settings } = await supabase
        .from('payment_settings')
        .select('ton_wallet')
        .eq('owner_id', tariff.owner_id)
        .maybeSingle();

      const merchantWallet = settings?.ton_wallet;
      if (!merchantWallet) {
        return res.status(500).json({ error: 'У продавца не настроен TON-кошелёк' });
      }

      const expectedNano = String(Math.round(Number(invoice.amount || 0) * 1e9));
      const result = await verifyTonConnectPayment({
        merchantWallet,
        memo: invoice.memo,
        expectedNanoTon: expectedNano,
        maxAttempts: 1
      });

      if (!result?.ok) {
        return res.json({ status: 'pending', success: false, retry: true });
      }

      const { data: claimed, error: claimErr } = await supabase
        .from('invoices')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          verified_at: new Date().toISOString(),
          tx_hash: result.txHash || null
        })
        .eq('id', invoice.id)
        .eq('status', 'pending')
        .select()
        .maybeSingle();
      if (claimErr) throw claimErr;

      if (!claimed) {
        return res.json({ status: 'paid', success: true });
      }

      const botId = tariff.bot_id;
      const bot = typeof getBotById === 'function' && botId ? getBotById(botId) : null;
      if (bot) {
        try {
          await officialBotService.activateSubscription(bot, claimed);
        } catch (actErr) {
          console.error(`[invoice-public] activateSubscription failed for ${claimed.id}:`, actErr.message || actErr);
        }
      } else {
        console.warn(`[invoice-public] bot not running for invoice ${claimed.id} (bot_id=${botId}); activation deferred`);
      }

      return res.json({ status: 'paid', success: true });
    } catch (err) {
      console.error('Ошибка verify-public invoice:', err);
      res.status(500).json({ error: 'Ошибка проверки оплаты' });
    }
  });

  return router;
}
