import { SocksClient } from 'socks';
import { randomBytes } from 'crypto';
import net from 'net';
import { StringSession } from 'telegram/sessions/index.js';
import { decrypt } from '../utils/crypto.js';

const TOKEN_TTL_MS = 5 * 60 * 1000;
const TTL_CLEAN_INTERVAL_MS = 60 * 1000;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const TCP_CONNECT_TIMEOUT_MS = 10_000;
const ALLOWED_ORIGIN_SUFFIXES = ['bullgram.xyz', 'bullrun.ru', 'localhost'];

function decodeStringSessionToApiForm(stringSession) {
    if (!stringSession || typeof stringSession !== 'string') return null;
    try {
        const ss = new StringSession(stringSession);
        const dcId = Number(ss._dcId);
        const keyHex = ss._key ? Buffer.from(ss._key).toString('hex') : null;
        if (!dcId || !keyHex) return null;
        return {
            mainDcId: dcId,
            keys: { [dcId]: keyHex },
            isTest: false
        };
    } catch (err) {
        console.error('[mtproto-bridge] decode StringSession failed:', err.message);
        return null;
    }
}

export class MtprotoBridgeService {
    constructor(supabase, userbotService) {
        this.supabase = supabase;
        this.userbotService = userbotService;
        this.tokens = new Map();
        this._ttlTimer = null;
    }

    start() {
        if (this._ttlTimer) return;
        this._ttlTimer = setInterval(() => this._evictExpired(), TTL_CLEAN_INTERVAL_MS);
        if (this._ttlTimer.unref) this._ttlTimer.unref();
    }

    stop() {
        if (this._ttlTimer) {
            clearInterval(this._ttlTimer);
            this._ttlTimer = null;
        }
        this.tokens.clear();
    }

    isEnabled() {
        return String(process.env.TELEGRAM_WEB_ENABLED || 'false').trim().toLowerCase() === 'true';
    }

    /**
     * Count currently-issued (non-expired) bridge tokens. Optional filter
     * by adminId / userbotId. Used by the audit UI to show "live bridges"
     * count alongside historical entries.
     */
    countActiveBridges({ adminId = null, userbotId = null } = {}) {
        const now = Date.now();
        let count = 0;
        for (const entry of this.tokens.values()) {
            if (entry.expiresAt <= now) continue;
            if (adminId && String(entry.adminId) !== String(adminId)) continue;
            if (userbotId && String(entry.userbotId) !== String(userbotId)) continue;
            count++;
        }
        return count;
    }

    _evictExpired() {
        const now = Date.now();
        for (const [token, entry] of this.tokens) {
            if (entry.expiresAt <= now) {
                this.tokens.delete(token);
                this._audit({
                    admin_id: entry.adminId,
                    userbot_id: entry.userbotId,
                    action: 'token_expired',
                    admin_ip: entry.adminIp,
                    user_agent: entry.userAgent,
                    proxy_used: entry.proxyConfig
                        ? `${entry.proxyConfig.ip}:${entry.proxyConfig.port}`
                        : null
                }).catch(() => {});
            }
        }
    }

    async _audit({
        admin_id, userbot_id, action,
        dc_id = null, bytes_in = 0, bytes_out = 0,
        duration_ms = null, error_code = null, error_message = null,
        admin_ip = null, user_agent = null,
        proxy_used = null
    }) {
        try {
            await this.supabase.from('telegram_web_audit').insert({
                admin_id, userbot_id, action,
                dc_id, bytes_in, bytes_out,
                duration_ms, error_code, error_message,
                admin_ip, user_agent, proxy_used
            });
        } catch (err) {
            console.error('[mtproto-bridge] audit insert failed:', err.message);
        }
    }

    async issueBridgeToken({ userbotId, adminId, adminIp, userAgent }) {
        if (!this.isEnabled()) {
            const err = new Error('TELEGRAM_WEB_DISABLED');
            err.code = 'TELEGRAM_WEB_DISABLED';
            throw err;
        }

        const { data: userbot, error } = await this.supabase
            .from('tg_accounts')
            .select('*, proxies(*)')
            .eq('id', userbotId)
            .eq('account_type', 'userbot')
            .single();

        if (error || !userbot) throw new Error('USERBOT_NOT_FOUND');
        if (String(userbot.owner_id) !== String(adminId)) throw new Error('FORBIDDEN');

        const decrypted = decrypt(userbot.session_data);
        const { token, fingerprint } = this.userbotService.parseSessionData(decrypted);
        if (!token) throw new Error('SESSION_INVALID');

        const sessionData = decodeStringSessionToApiForm(token);
        if (!sessionData) throw new Error('SESSION_DECODE_FAILED');

        const proxyConfig = this.userbotService._buildProxy(userbot) || null;
        const bridgeToken = randomBytes(32).toString('hex');
        const sessionToken = randomBytes(16).toString('hex');
        const now = Date.now();

        this.tokens.set(bridgeToken, {
            userbotId,
            adminId,
            ownerId: userbot.owner_id,
            proxyConfig,
            fingerprint,
            sessionToken,
            adminIp,
            userAgent,
            createdAt: now,
            expiresAt: now + TOKEN_TTL_MS
        });

        const proxyUsedAtIssue = proxyConfig
            ? `${proxyConfig.ip}:${proxyConfig.port}`
            : null;

        await this._audit({
            admin_id: adminId,
            userbot_id: userbotId,
            action: 'session_issued',
            admin_ip: adminIp,
            user_agent: userAgent,
            proxy_used: proxyUsedAtIssue
        });

        return {
            bridgeToken,
            sessionToken,
            wsUrl: process.env.TELEGRAM_WEB_WS_URL || '/api/mtproto-bridge',
            fingerprint,
            sessionData,
            expiresAt: now + TOKEN_TTL_MS
        };
    }

    _findToken(bridgeToken) {
        if (!bridgeToken) return null;
        const entry = this.tokens.get(bridgeToken);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
            this.tokens.delete(bridgeToken);
            this._audit({
                admin_id: entry.adminId,
                userbot_id: entry.userbotId,
                action: 'token_expired',
                admin_ip: entry.adminIp,
                user_agent: entry.userAgent,
                proxy_used: entry.proxyConfig
                    ? `${entry.proxyConfig.ip}:${entry.proxyConfig.port}`
                    : null
            }).catch(() => {});
            return null;
        }
        return entry;
    }

    _isOriginAllowed(origin) {
        if (!origin) return true;
        try {
            const host = new URL(origin).hostname;
            return ALLOWED_ORIGIN_SUFFIXES.some((suffix) => host === suffix || host.endsWith('.' + suffix));
        } catch {
            return false;
        }
    }

    handleConnection(ws, req) {
        if (!this.isEnabled()) {
            ws.close(1008, 'TELEGRAM_WEB_DISABLED');
            return;
        }

        const url = new URL(req.url, 'http://localhost');
        const entry = this._findToken(url.searchParams.get('bridge_token'));
        if (!entry) {
            ws.close(4401, 'INVALID_OR_EXPIRED_TOKEN');
            return;
        }
        if (!this._isOriginAllowed(req.headers.origin)) {
            ws.close(4403, 'ORIGIN_NOT_ALLOWED');
            return;
        }

        const state = {
            tcpSocket: null,
            bytesIn: 0,
            bytesOut: 0,
            handshakeDone: false,
            handshakeTimer: null,
            openedAt: Date.now(),
            dcId: null,
            closed: false
        };

        const finishWith = ({ code = 1000, reason = 'NORMAL', errorCode = null, errorMessage = null } = {}) => {
            if (state.closed) return;
            state.closed = true;
            if (state.handshakeTimer) {
                clearTimeout(state.handshakeTimer);
                state.handshakeTimer = null;
            }
            if (state.tcpSocket && !state.tcpSocket.destroyed) state.tcpSocket.destroy();
            const duration_ms = Date.now() - state.openedAt;
            const action = state.handshakeDone && code === 1000 ? 'bridge_closed' : (state.handshakeDone ? 'bridge_error' : 'bridge_error');
            const proxyUsed = entry.proxyConfig
                ? `${entry.proxyConfig.ip}:${entry.proxyConfig.port}`
                : null;
            this._audit({
                admin_id: entry.adminId,
                userbot_id: entry.userbotId,
                action,
                dc_id: state.dcId,
                bytes_in: state.bytesIn,
                bytes_out: state.bytesOut,
                duration_ms,
                error_code: errorCode,
                error_message: errorMessage,
                admin_ip: entry.adminIp,
                user_agent: entry.userAgent,
                proxy_used: proxyUsed
            }).catch(() => {});
            try {
                if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
                    ws.close(code, reason);
                }
            } catch {}
        };

        state.handshakeTimer = setTimeout(() => {
            if (!state.handshakeDone) {
                finishWith({ code: 4408, reason: 'HANDSHAKE_TIMEOUT', errorMessage: 'handshake_timeout' });
            }
        }, HANDSHAKE_TIMEOUT_MS);

        const openTcp = async ({ ip, port }) => {
            try {
                let socket;
                if (entry.proxyConfig) {
                    const info = await SocksClient.createConnection({
                        proxy: {
                            host: entry.proxyConfig.ip,
                            port: entry.proxyConfig.port,
                            type: entry.proxyConfig.socksType || 5,
                            userId: entry.proxyConfig.username,
                            password: entry.proxyConfig.password
                        },
                        command: 'connect',
                        timeout: TCP_CONNECT_TIMEOUT_MS,
                        destination: { host: ip, port }
                    });
                    socket = info.socket;
                } else {
                    socket = new net.Socket();
                    await new Promise((resolve, reject) => {
                        const onError = (err) => reject(err);
                        socket.once('error', onError);
                        socket.connect(port, ip, () => {
                            socket.removeListener('error', onError);
                            resolve();
                        });
                    });
                }

                socket.on('data', (chunk) => {
                    state.bytesOut += chunk.length;
                    if (ws.readyState === ws.OPEN) ws.send(chunk);
                });

                socket.on('close', () => {
                    if (state.handshakeDone) {
                        finishWith({ code: 1000, reason: 'TCP_CLOSED' });
                    }
                });

                socket.on('error', (err) => {
                    if (!state.handshakeDone) {
                        finishWith({ code: 1011, reason: 'TCP_CONNECT_FAILED', errorMessage: String(err.message || err) });
                    } else {
                        finishWith({ code: 1011, reason: 'TCP_ERROR', errorMessage: String(err.message || err) });
                    }
                });

                state.tcpSocket = socket;
                state.handshakeDone = true;
                if (state.handshakeTimer) {
                    clearTimeout(state.handshakeTimer);
                    state.handshakeTimer = null;
                }

                const proxyUsed = entry.proxyConfig
                    ? `${entry.proxyConfig.ip}:${entry.proxyConfig.port}`
                    : null;

                console.log('[mtproto-bridge] OPENED', JSON.stringify({
                    userbot_id: entry.userbotId,
                    admin_id: entry.adminId,
                    dc_id: state.dcId,
                    admin_ip: entry.adminIp,
                    proxy_used: proxyUsed,
                    direct: !entry.proxyConfig
                }));

                this._audit({
                    admin_id: entry.adminId,
                    userbot_id: entry.userbotId,
                    action: 'bridge_opened',
                    dc_id: state.dcId,
                    admin_ip: entry.adminIp,
                    user_agent: entry.userAgent,
                    proxy_used: proxyUsed
                }).catch(() => {});

                ws.send('ok');
            } catch (err) {
                finishWith({ code: 1011, reason: 'TCP_CONNECT_FAILED', errorMessage: String(err.message || err) });
            }
        };

        ws.on('message', (data, isBinary) => {
            if (state.closed) return;

            if (!state.handshakeDone) {
                if (isBinary) {
                    finishWith({ code: 1040, reason: 'BAD_HANDSHAKE', errorMessage: 'expected_text_handshake' });
                    return;
                }
                let parsed = null;
                try {
                    parsed = JSON.parse(data.toString('utf8'));
                } catch {
                    const text = data.toString('utf8');
                    if (text.includes(':')) {
                        const sep = text.lastIndexOf(':');
                        parsed = { ip: text.slice(0, sep), port: parseInt(text.slice(sep + 1), 10) };
                    }
                }
                if (!parsed || !parsed.ip || !Number.isFinite(parsed.port)) {
                    finishWith({ code: 1040, reason: 'BAD_HANDSHAKE', errorMessage: 'bad_handshake_format' });
                    return;
                }
                if (Number.isFinite(parsed.dcId)) state.dcId = parsed.dcId;
                openTcp(parsed);
                return;
            }

            if (data && data.length) {
                state.bytesIn += data.length;
                if (state.tcpSocket && !state.tcpSocket.destroyed) {
                    state.tcpSocket.write(data);
                }
            }
        });

        ws.on('close', () => finishWith({ code: 1000, reason: 'NORMAL' }));
        ws.on('error', (err) => finishWith({ code: 1011, reason: 'WS_ERROR', errorMessage: String(err.message || err) }));
    }
}

export function createMtprotoBridgeService(supabase, userbotService) {
    return new MtprotoBridgeService(supabase, userbotService);
}
