import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';
import crypto from 'crypto';

const execFileAsync = promisify(execFile);

const STATE_DIR = '/var/lib/bullrun/managed-proxies';
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const CONFIG_FILE = path.join(STATE_DIR, '3proxy.cfg');
const CONTAINER_NAME = 'bullrun-managed-3proxy';
const IMAGE_NAME = 'ghcr.io/tarampampam/3proxy:latest';
const INTERFACE_NAME = 'ens3';
const PORT_START = 21080;
const MANAGED_PROXY_PUBLIC_HOST = String(process.env.MANAGED_PROXY_PUBLIC_HOST || '').trim();

function normalizeManagedInventoryGroup(value) {
  if (value === 'self_use') return 'self_use';
  return 'shop_sale';
}

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function loadState() {
  ensureStateDir();
  if (!fs.existsSync(STATE_FILE)) {
    return { sequence: 0, publicHost: null, ipv6Prefix: null, proxies: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      sequence: Number(parsed.sequence || 0),
      publicHost: parsed.publicHost || null,
      ipv6Prefix: parsed.ipv6Prefix || null,
      proxies: Array.isArray(parsed.proxies) ? parsed.proxies : []
    };
  } catch {
    return { sequence: 0, publicHost: null, ipv6Prefix: null, proxies: [] };
  }
}

function saveState(state) {
  ensureStateDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function saveStateWithBackup(state) {
  ensureStateDir();
  if (fs.existsSync(STATE_FILE)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(STATE_FILE, path.join(STATE_DIR, `state.json.backup-${stamp}`));
  }
  saveState(state);
}

function renderConfig(state) {
  const usersLine = state.proxies.length
    ? `users ${state.proxies.map((proxy) => `${proxy.username}:CL:${proxy.password}`).join(' ')}`
    : '';

  const sections = state.proxies.map((proxy) => [
    `allow ${proxy.username}`,
    `socks -6 -n -a -p${proxy.port} -i0.0.0.0 -e${proxy.ipv6}`,
    'flush'
  ].join('\n'));

  return [
    'nserver 1.1.1.1',
    'nserver 8.8.8.8',
    'nscache 65536',
    'timeouts 1 5 30 60 180 1800 15 60',
    'auth strong',
    usersLine,
    ...sections
  ].filter(Boolean).join('\n') + '\n';
}

async function run(command, args = []) {
  await execFileAsync(command, args);
}

async function detectPublicHosts() {
  const { stdout } = await execFileAsync('bash', ['-lc', `ip -4 -brief addr show dev ${INTERFACE_NAME} | awk '{for (i=3; i<=NF; i++) print $i}' | cut -d/ -f1`]);
  return String(stdout || '')
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function detectPublicHost() {
  const hosts = await detectPublicHosts();
  if (hosts.length === 0) {
    throw new Error('Не удалось определить публичный IPv4 сервера для managed proxy.');
  }

  if (MANAGED_PROXY_PUBLIC_HOST) {
    if (!hosts.includes(MANAGED_PROXY_PUBLIC_HOST)) {
      throw new Error(`MANAGED_PROXY_PUBLIC_HOST=${MANAGED_PROXY_PUBLIC_HOST} не найден на интерфейсе ${INTERFACE_NAME}.`);
    }
    return MANAGED_PROXY_PUBLIC_HOST;
  }

  return hosts[0];
}

async function detectIpv6Prefix() {
  const { stdout } = await execFileAsync('bash', ['-lc', `ip -6 route show dev ${INTERFACE_NAME} | awk '/\\/64/ {print $1}' | head -n1`]);
  const cidr = String(stdout || '').trim();
  if (!cidr || !cidr.includes('/64')) {
    throw new Error('Не удалось определить IPv6 /64 на сервере. Managed proxy generator не может поднять отдельные IPv6-прокси.');
  }
  return cidr.split('/')[0];
}

function buildIpv6(prefix, sequence) {
  const normalizedPrefix = prefix.replace(/::.*$/, '');
  const suffix = (0x1000 + sequence).toString(16);
  return `${normalizedPrefix}::${suffix}`;
}

function randomSecret(length = 12) {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

async function ensureIpv6Address(ipv6) {
  const { stdout } = await execFileAsync('bash', ['-lc', `ip -6 addr show dev ${INTERFACE_NAME} | grep -F "${ipv6}/64" || true`]);
  if (String(stdout || '').trim()) return;
  await run('ip', ['-6', 'addr', 'add', `${ipv6}/64`, 'dev', INTERFACE_NAME]);
}

async function removeIpv6Address(ipv6) {
  try {
    await run('ip', ['-6', 'addr', 'del', `${ipv6}/64`, 'dev', INTERFACE_NAME]);
  } catch {
    // best effort
  }
}

async function ensureContainer(state) {
  ensureStateDir();
  fs.writeFileSync(CONFIG_FILE, renderConfig(state));

  if (state.proxies.length === 0) {
    await execFileAsync('bash', ['-lc', `docker rm -f ${CONTAINER_NAME} >/dev/null 2>&1 || true`]);
    return;
  }

  await execFileAsync('bash', ['-lc', `docker rm -f ${CONTAINER_NAME} >/dev/null 2>&1 || true`]);
  await run('docker', [
    'run',
    '-d',
    '--name',
    CONTAINER_NAME,
    '--restart',
    'unless-stopped',
    '--network',
    'host',
    '--entrypoint',
    '/bin/3proxy',
    '-v',
    `${STATE_DIR}:/etc/3proxy`,
    IMAGE_NAME,
    '/etc/3proxy/3proxy.cfg'
  ]);
}

async function ensureAllIpv6Addresses(state) {
  for (const proxy of state.proxies) {
    if (proxy?.ipv6) {
      await ensureIpv6Address(proxy.ipv6);
    }
  }
}

function buildManagedRecord(state, inventoryGroup) {
  const sequence = Number(state.sequence || 0) + 1;
  const port = PORT_START + sequence;
  const username = `mp_${sequence}`;
  const password = randomSecret(14);
  const ipv6 = buildIpv6(state.ipv6Prefix, sequence);
  return {
    sequence,
    port,
    username,
    password,
    ipv6,
    inventory_group: normalizeManagedInventoryGroup(inventoryGroup)
  };
}

function parseManagedSequence(username) {
  const match = String(username || '').trim().match(/^mp_(\d+)$/);
  if (!match) return null;
  const sequence = Number.parseInt(match[1], 10);
  return Number.isInteger(sequence) && sequence > 0 ? sequence : null;
}

function sanitizeManagedProxyRow(row) {
  const sequence = parseManagedSequence(row?.username);
  const port = Number.parseInt(row?.port, 10);
  if (!sequence || !Number.isInteger(port) || port <= 0 || port > 65535) {
    return null;
  }
  if (!String(row?.password || '').trim()) {
    return null;
  }
  return {
    ...row,
    sequence,
    port,
    username: String(row.username).trim(),
    password: String(row.password)
  };
}

function chooseManagedHost(rows, detectedHosts, fallbackHost) {
  if (MANAGED_PROXY_PUBLIC_HOST) return MANAGED_PROXY_PUBLIC_HOST;
  const hostCounts = new Map();
  const detectedSet = new Set(detectedHosts || []);

  for (const row of rows || []) {
    const host = String(row?.host || '').trim();
    if (!host || !detectedSet.has(host)) continue;
    hostCounts.set(host, Number(hostCounts.get(host) || 0) + 1);
  }

  if (hostCounts.size) {
    return Array.from(hostCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([host]) => host)[0];
  }

  return fallbackHost;
}

function buildComparableState(state) {
  return {
    sequence: Number(state?.sequence || 0),
    publicHost: state?.publicHost || null,
    ipv6Prefix: state?.ipv6Prefix || null,
    proxies: (state?.proxies || []).map((proxy) => ({
      sequence: Number(proxy.sequence || 0),
      port: Number(proxy.port || 0),
      username: proxy.username || null,
      password: proxy.password || null,
      ipv6: proxy.ipv6 || null,
      inventory_group: normalizeManagedInventoryGroup(proxy.inventory_group)
    })).sort((a, b) => a.port - b.port)
  };
}

function statesEqual(left, right) {
  return JSON.stringify(buildComparableState(left)) === JSON.stringify(buildComparableState(right));
}

async function listListeningTcpPorts() {
  try {
    const { stdout } = await execFileAsync('ss', ['-lnt']);
    const ports = new Set();
    for (const line of String(stdout || '').split('\n')) {
      const match = line.match(/:(\d+)\s+/);
      if (match) ports.add(Number.parseInt(match[1], 10));
    }
    return ports;
  } catch {
    return new Set();
  }
}

async function isContainerRunning() {
  try {
    const { stdout } = await execFileAsync('docker', ['inspect', '-f', '{{.State.Running}}', CONTAINER_NAME]);
    return String(stdout || '').trim() === 'true';
  } catch {
    return false;
  }
}

export class ManagedProxyService {
  getStateSummary() {
    const state = loadState();
    return {
      total: Array.isArray(state.proxies) ? state.proxies.length : 0,
      groups: (state.proxies || []).reduce((acc, proxy) => {
        const key = normalizeManagedInventoryGroup(proxy.inventory_group);
        acc[key] = Number(acc[key] || 0) + 1;
        return acc;
      }, {})
    };
  }

  async getSupport() {
    try {
      const publicHost = await detectPublicHost();
      const ipv6Prefix = await detectIpv6Prefix();
      return {
        supported: true,
        publicHost,
        ipv6Prefix,
        container: CONTAINER_NAME
      };
    } catch (error) {
      return {
        supported: false,
        reason: error.message
      };
    }
  }

  async provisionManagedProxy({ name, inventoryGroup }) {
    const state = loadState();
    state.publicHost = await detectPublicHost();
    state.ipv6Prefix = state.ipv6Prefix || await detectIpv6Prefix();

    const record = buildManagedRecord(state, inventoryGroup);
    await ensureIpv6Address(record.ipv6);

    state.sequence = record.sequence;
    state.proxies.push(record);
    saveState(state);

    try {
      await ensureContainer(state);
    } catch (error) {
      state.proxies = state.proxies.filter((proxy) => proxy.sequence !== record.sequence);
      saveState(state);
      await removeIpv6Address(record.ipv6);
      throw error;
    }

    return {
      name,
      host: state.publicHost,
      port: record.port,
      username: record.username,
      password: record.password,
      ipv6: record.ipv6,
      inventory_group: record.inventory_group
    };
  }

  async releaseManagedProxy({ host, port, username }) {
    const state = loadState();
    const index = state.proxies.findIndex((proxy) =>
      Number(proxy.port) === Number(port) &&
      (!username || proxy.username === username)
    );

    if (index === -1) {
      return false;
    }

    const [removed] = state.proxies.splice(index, 1);
    saveState(state);
    await ensureContainer(state);
    if (removed?.ipv6) {
      await removeIpv6Address(removed.ipv6);
    }
    return true;
  }

  async restoreRuntimeFromState() {
    const state = loadState();
    state.publicHost = await detectPublicHost();
    saveState(state);
    if (!state.publicHost || !state.ipv6Prefix) {
      return { restored: false, proxies: 0 };
    }
    await ensureAllIpv6Addresses(state);
    await ensureContainer(state);
    return { restored: true, proxies: state.proxies.length };
  }

  async loadManagedProxyRowsFromDatabase(supabase) {
    const { data, error } = await supabase
      .from('proxies')
      .select('*')
      .like('username', 'mp_%')
      .order('port', { ascending: true });

    if (error) throw error;

    return (data || [])
      .map(sanitizeManagedProxyRow)
      .filter(Boolean);
  }

  buildStateFromProxyRows(rows, { publicHost, ipv6Prefix }) {
    const filteredRows = (rows || [])
      .filter((row) => String(row.host || '').trim() === String(publicHost || '').trim())
      .sort((a, b) => a.port - b.port);
    const maxSequence = filteredRows.reduce((max, row) => Math.max(max, Number(row.sequence || 0)), 0);

    return {
      sequence: maxSequence,
      publicHost,
      ipv6Prefix,
      proxies: filteredRows.map((row) => ({
        sequence: Number(row.sequence),
        port: Number(row.port),
        username: row.username,
        password: row.password,
        ipv6: buildIpv6(ipv6Prefix, Number(row.sequence)),
        inventory_group: normalizeManagedInventoryGroup(row.inventory_group)
      }))
    };
  }

  async getRuntimeHealth(supabase) {
    const currentState = loadState();
    const detectedHosts = await detectPublicHosts();
    const fallbackHost = await detectPublicHost();
    const rows = supabase ? await this.loadManagedProxyRowsFromDatabase(supabase) : [];
    const publicHost = chooseManagedHost(rows, detectedHosts, currentState.publicHost || fallbackHost);
    const matchingRows = rows.filter((row) => String(row.host || '') === String(publicHost || ''));
    const listeningPorts = await listListeningTcpPorts();
    const expectedPorts = matchingRows.map((row) => Number(row.port));
    const statePorts = (currentState.proxies || []).map((proxy) => Number(proxy.port));
    const containerRunning = await isContainerRunning();

    return {
      publicHost,
      detectedHosts,
      dbCount: matchingRows.length,
      stateCount: statePorts.length,
      listeningCount: expectedPorts.filter((port) => listeningPorts.has(port)).length,
      expectedPorts,
      statePorts,
      listeningPorts: expectedPorts.filter((port) => listeningPorts.has(port)),
      missingPorts: expectedPorts.filter((port) => !listeningPorts.has(port)),
      extraStatePorts: statePorts.filter((port) => !expectedPorts.includes(port)),
      containerRunning
    };
  }

  async reconcileRuntimeFromDatabase(supabase, options = {}) {
    if (!supabase) {
      throw new Error('Supabase client is required for managed proxy reconciliation.');
    }

    const dryRun = options.dryRun === true;
    const currentState = loadState();
    const detectedHosts = await detectPublicHosts();
    if (detectedHosts.length === 0) {
      throw new Error('Не удалось определить публичные IPv4 сервера для managed proxy.');
    }
    const fallbackHost = MANAGED_PROXY_PUBLIC_HOST || currentState.publicHost || detectedHosts[0];
    if (MANAGED_PROXY_PUBLIC_HOST && !detectedHosts.includes(MANAGED_PROXY_PUBLIC_HOST)) {
      throw new Error(`MANAGED_PROXY_PUBLIC_HOST=${MANAGED_PROXY_PUBLIC_HOST} не найден на интерфейсе ${INTERFACE_NAME}.`);
    }

    const rows = await this.loadManagedProxyRowsFromDatabase(supabase);
    const publicHost = chooseManagedHost(rows, detectedHosts, fallbackHost);
    if (!detectedHosts.includes(publicHost)) {
      throw new Error(`Managed proxy host ${publicHost} не найден на интерфейсе ${INTERFACE_NAME}.`);
    }

    const ipv6Prefix = currentState.ipv6Prefix || await detectIpv6Prefix();
    const nextState = this.buildStateFromProxyRows(rows, { publicHost, ipv6Prefix });
    const stateChanged = !statesEqual(currentState, nextState);
    const listeningPorts = await listListeningTcpPorts();
    const expectedPorts = nextState.proxies.map((proxy) => Number(proxy.port));
    const missingPorts = expectedPorts.filter((port) => !listeningPorts.has(port));
    const containerRunning = await isContainerRunning();
    const shouldRestoreRuntime = stateChanged || missingPorts.length > 0 || !containerRunning;

    if (!dryRun && stateChanged) {
      saveStateWithBackup(nextState);
    }

    if (!dryRun && shouldRestoreRuntime) {
      await ensureAllIpv6Addresses(nextState);
      await ensureContainer(nextState);
    }

    return {
      restored: !dryRun && shouldRestoreRuntime,
      dryRun,
      publicHost,
      dbCount: nextState.proxies.length,
      stateCountBefore: Array.isArray(currentState.proxies) ? currentState.proxies.length : 0,
      stateCountAfter: nextState.proxies.length,
      stateChanged,
      missingPorts,
      extraStatePorts: (currentState.proxies || [])
        .map((proxy) => Number(proxy.port))
        .filter((port) => !expectedPorts.includes(port)),
      containerRunningBefore: containerRunning
    };
  }
}
