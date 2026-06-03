import { ManagedProxyService } from '../services/managed-proxy.service.js';

const DEFAULT_INTERVAL_MS = 3 * 60 * 1000;
const START_DELAY_MS = 20 * 1000;

function envFlag(name, defaultValue = true) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function resolveIntervalMs() {
  const value = Number(process.env.MANAGED_PROXY_RECONCILE_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  if (!Number.isFinite(value)) return DEFAULT_INTERVAL_MS;
  return Math.max(60 * 1000, value);
}

export function startManagedProxyReconcile(supabase) {
  if (!envFlag('MANAGED_PROXY_RECONCILE_ENABLED', true)) {
    console.log('[ManagedProxyReconcile] disabled');
    return null;
  }

  const service = new ManagedProxyService();
  const intervalMs = resolveIntervalMs();
  let running = false;

  const runOnce = async (reason) => {
    if (running) {
      console.log('[ManagedProxyReconcile] skipped: already running');
      return;
    }

    running = true;
    try {
      const result = await service.reconcileRuntimeFromDatabase(supabase);
      console.log('[ManagedProxyReconcile] result', {
        reason,
        restored: result.restored,
        dbCount: result.dbCount,
        stateCountBefore: result.stateCountBefore,
        stateCountAfter: result.stateCountAfter,
        missingPorts: result.missingPorts,
        extraStatePorts: result.extraStatePorts,
        publicHost: result.publicHost
      });
    } catch (error) {
      console.error('[ManagedProxyReconcile] failed', {
        reason,
        error: error?.message || String(error)
      });
    } finally {
      running = false;
    }
  };

  setTimeout(() => runOnce('startup'), START_DELAY_MS);
  const timer = setInterval(() => runOnce('interval'), intervalMs);
  return timer;
}
