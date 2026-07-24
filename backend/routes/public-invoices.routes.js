import { Router } from 'express';
import crypto from 'node:crypto';
import { Address, toNano } from '@ton/core';
import {
  verifyPaymentOnce
} from '../services/ton-connect-verify.service.js';
import { claimPaid, markExpired } from '../services/payment-claim.service.js';
import { sendPaymentReceivedEmail } from '../services/email.service.js';
import { authenticateUser, optionalAuthenticateUser } from '../middlewares/auth.middleware.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const VIEW_RATE_LIMIT_RPM = 60;
const CREATE_RATE_LIMIT_PER_HOUR = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
const CREATE_WINDOW_MS = 60 * 60_000;
const TTL_MS = 90 * 60_000;
const GRACE_MS = 5 * 60_000;
const VERIFY_MAX_ATTEMPTS = 1;

export function publicInvoiceRoutes(supabase) {
  const router = Router();
  const viewHitsByIp = new Map();
  const verifyHitsByIp = new Map();
  const createHitsByIp = new Map();

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

  function validateCreatePayload(body) {
    const errors = [];
    const amount = Number(body?.amount_ton);
    if (!Number.isFinite(amount) || amount < 0.01 || amount > 10000) {
      errors.push({ field: 'amount_ton', message: 'Сумма должна быть от 0.01 до 10000 TON' });
    }
    const title = String(body?.title || '').trim();
    if (!title || title.length > 120) {
      errors.push({ field: 'title', message: 'Название от 1 до 120 символов' });
    }
    const description = body?.description == null ? '' : String(body.description);
    if (description.length > 500) {
      errors.push({ field: 'description', message: 'Описание до 500 символов' });
    }
    const secret = String(body?.secret_payload || '');
    if (!secret || secret.length > 2000) {
      errors.push({ field: 'secret_payload', message: 'Секрет от 1 до 2000 символов' });
    }
    const wallet = String(body?.seller_wallet || '').trim();
    if (!wallet) {
      errors.push({ field: 'seller_wallet', message: 'Укажите TON-кошелёк' });
    } else {
      try {
        Address.parse(wallet);
      } catch {
        errors.push({ field: 'seller_wallet', message: 'Неверный TON-адрес' });
      }
    }
    const email = String(body?.seller_email || '').trim();
    if (!EMAIL_RE.test(email)) {
      errors.push({ field: 'seller_email', message: 'Неверный email' });
    }
    const network = String(body?.network || 'mainnet');
    if (network !== 'mainnet' && network !== 'testnet') {
      errors.push({ field: 'network', message: 'Сеть должна быть mainnet или testnet' });
    }
    return { errors, normalized: { amount, title, description, secret, wallet, email, network } };
  }

  function generateMemo() {
    return 'g_' + crypto.randomBytes(5).toString('hex').slice(0, 8);
  }

  function amountToNano(amount) {
    return toNano(String(amount)).toString(10);
  }

  router.get('/mine', authenticateUser, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('public_invoices')
        .select('id, status, amount_ton, title, seller_wallet, created_at, expires_at, paid_at, network')
        .eq('creator_user_id', req.user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return res.json({ items: data || [] });
    } catch (err) {
      console.error('[public-invoices] mine failed:', err.message || err);
      return res.status(500).json({ error: 'Не удалось загрузить счета' });
    }
  });

  router.post('/public/create', optionalAuthenticateUser, async (req, res) => {
    const rawIp = pickIp(req);
    const ip = rawIp || 'unknown';
    if (!checkRateLimit(createHitsByIp, ip, CREATE_RATE_LIMIT_PER_HOUR, CREATE_WINDOW_MS)) {
      return res.status(429).json({ error: 'Слишком много счетов за час. Попробуйте позже.' });
    }

    const { errors, normalized } = validateCreatePayload(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Ошибка валидации', errors });
    }

    const memo = generateMemo();
    const now = Date.now();
    const expiresAt = new Date(now + TTL_MS).toISOString();
    const graceUntil = new Date(now + TTL_MS + GRACE_MS).toISOString();

    const origin = String(process.env.PUBLIC_APP_ORIGIN || 'https://bullgram.xyz').replace(/\/$/, '');
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);

    try {
      const { data: row, error } = await supabase
        .from('public_invoices')
        .insert({
          amount_ton: normalized.amount,
          title: normalized.title,
          description: normalized.description || null,
          secret_payload: normalized.secret,
          seller_wallet: normalized.wallet,
          seller_email: normalized.email,
          memo,
          status: 'pending',
          network: normalized.network,
          expires_at: expiresAt,
          grace_until: graceUntil,
          creator_ip: rawIp,
          creator_user_agent: userAgent,
          creator_user_id: req.user?.id || null
        })
        .select('id')
        .single();
      if (error) throw error;

      const id = row.id;
      return res.json({
        id,
        pay_url: `${origin}/pay/${id}`,
        created_url: `${origin}/created/${id}`
      });
    } catch (err) {
      console.error('[public-invoices] create failed:', err.message || err);
      return res.status(500).json({ error: 'Не удалось создать счёт' });
    }
  });

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
      const { data: inv, error } = await supabase
        .from('public_invoices')
        .select('id, status, amount_ton, title, description, secret_payload, seller_wallet, memo, network, expires_at, grace_until, paid_at')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!inv) return res.status(404).json({ error: 'Счёт не найден' });

      const now = Date.now();
      const graceMs = inv.grace_until ? new Date(inv.grace_until).getTime() : 0;

      if (inv.status === 'pending' && graceMs && now > graceMs) {
        const fresh = await markExpired({ supabase, table: 'public_invoices', id });
        if (fresh) inv.status = 'expired';
      }

      const amountTon = Number(inv.amount_ton);
      const amountNano = amountToNano(inv.amount_ton);
      const wallet = inv.seller_wallet;
      const memo = inv.memo;
      const tonUri = `ton://transfer/${wallet}?amount=${amountNano}&text=${encodeURIComponent(memo || '')}`;

      const base = {
        id: inv.id,
        kind: 'public_invoice',
        status: inv.status,
        amount_ton: amountTon,
        amount_nanoton: amountNano,
        memo,
        seller_wallet: wallet,
        network: inv.network,
        expires_at: inv.expires_at,
        item_title: inv.title,
        description: inv.description || null,
        ton_uri: tonUri,
        ton_qr: null
      };

      if (inv.status === 'paid') {
        base.secret_payload = inv.secret_payload;
        base.paid_at = inv.paid_at;
      }

      return res.json(base);
    } catch (err) {
      console.error('[public-invoices] public-view failed:', err.message || err);
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
      const { data: inv, error } = await supabase
        .from('public_invoices')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!inv) return res.status(404).json({ error: 'Счёт не найден' });

      if (inv.status === 'paid') {
        return res.json({ status: 'paid', success: true, secret_payload: inv.secret_payload, tx_hash: inv.tx_hash || null });
      }
      if (inv.status === 'expired') {
        return res.json({ status: 'expired', success: false });
      }

      const now = Date.now();
      const graceMs = inv.grace_until ? new Date(inv.grace_until).getTime() : 0;
      if (now > graceMs) {
        const fresh = await markExpired({ supabase, table: 'public_invoices', id });
        if (fresh) return res.json({ status: 'expired', success: false });
      }

      const expectedNano = amountToNano(inv.amount_ton);

      let matched = null;
      try {
        const result = await verifyPaymentOnce({
          merchantWallet: inv.seller_wallet,
          memo: inv.memo,
          expectedNanoTon: expectedNano
        });
        if (result.ok) matched = result;
      } catch (err) {
        console.error('[public-invoices] tonapi fetch failed:', err.message || err);
      }

      if (!matched) {
        return res.json({ status: 'pending', success: false, retry: true });
      }

      const nowIso = new Date().toISOString();
      const claimed = await claimPaid({
        supabase,
        table: 'public_invoices',
        id: inv.id,
        patch: {
          status: 'paid',
          paid_at: nowIso,
          verified_at: nowIso,
          tx_hash: matched.txHash || null
        }
      });

      if (!claimed) {
        return res.json({ status: 'paid', success: true, secret_payload: inv.secret_payload });
      }

      const origin = String(process.env.PUBLIC_APP_ORIGIN || 'https://bullgram.xyz').replace(/\/$/, '');
      sendPaymentReceivedEmail({
        to: claimed.seller_email,
        invoiceId: claimed.id,
        amountTon: Number(claimed.amount_ton),
        title: claimed.title,
        payUrl: `${origin}/created/${claimed.id}`
      }).catch((err) => {
        console.error('[public-invoices] email send error:', err.message || err);
      });

      return res.json({
        status: 'paid',
        success: true,
        secret_payload: claimed.secret_payload,
        tx_hash: claimed.tx_hash || null
      });
    } catch (err) {
      console.error('[public-invoices] verify-public failed:', err.message || err);
      return res.status(500).json({ error: 'Ошибка проверки оплаты' });
    }
  });

  return router;
}
