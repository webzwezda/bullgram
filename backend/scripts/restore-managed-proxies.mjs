import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { ManagedProxyService } from '../services/managed-proxy.service.js';

const service = new ManagedProxyService();

try {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const supabaseServiceKey = String(process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const result = await service.reconcileRuntimeFromDatabase(supabase);
  console.log(JSON.stringify(result));
  // Self-heal случился (слушатели/IPv6/контейнер пересозданы) — это событие
  // уровня алерта: значит до этого рантайм был сломан (инцидент 2026-11-07).
  if (result.restored) {
    const token = String(process.env.TG_BOT_TOKEN || '');
    const chat = String(process.env.TG_ADMIN_CHAT_ID || '');
    if (token && chat) {
      const text = '🛠 Bullgram managed-proxies self-heal: слушатели пересозданы ' +
        `(db=${result.dbCount}, missingPorts=${(result.missingPorts||[]).length}, missingIpv6=${(result.missingIpv6||[]).length})`;
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text })
      }).catch(() => {});
    }
  }
  process.exit(0);
} catch (error) {
  console.error('[managed-proxy-restore] database reconcile failed:', error?.message || error);
  try {
    const fallback = await service.restoreRuntimeFromState();
    console.log(JSON.stringify({ ...fallback, fallback: 'state' }));
    process.exit(fallback.restored ? 0 : 1);
  } catch (fallbackError) {
    console.error('[managed-proxy-restore] state fallback failed:', fallbackError?.message || fallbackError);
    process.exit(1);
  }
}
