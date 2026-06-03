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
