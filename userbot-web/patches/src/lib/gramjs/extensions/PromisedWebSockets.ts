// Bullgram-patched PromisedWebSockets.
//
// Upstream (Ajaxy/telegram-tt v10.9.51): browser-side WebSocket transport.
// Connects directly to wss://<dc-ip>:<port>/apiws — leaking admin IP to Telegram.
//
// Bullgram patch: routes the same MTProto bytes through the Bullgram backend
// MTProto bridge (WebSocket on /api/mtproto-bridge) which forwards them over
// SOCKS5 to the userbot's proxy. Source IP seen by Telegram = same SOCKS5
// proxy as backend's createAuthorizedClient — no account IP change risk.
//
// Handshake protocol (matches backend mtproto-bridge.service.js):
//   1) Connect to `${BRIDGE_WS_URL}?bridge_token=${BRIDGE_TOKEN}`
//      BRIDGE_WS_URL + BRIDGE_TOKEN read from window.__BULLRUN__ (set by
//      app entry before initializing GramJS).
//   2) On WS open, send text frame JSON.stringify({ ip, port, dcId,
//      isTestServer, isPremium }). Backend opens TCP to ip:port via SOCKS5.
//   3) Backend sends text "ok" on success or text "error:<msg>" + close.
//   4) After "ok", binary frames flow verbatim in both directions. Same
//      codec as upstream — bytes are MTProto-encrypted already.

import { Mutex } from 'async-mutex';
import { ensureFreshBridgeConfig } from '../../../util/bullrunBridge';

const mutex = new Mutex();

const closeError = new Error('WebSocket was closed');
const CONNECTION_TIMEOUT = 3000;
const MAX_TIMEOUT = 30000;
const HANDSHAKE_TIMEOUT = 10000;

export default class PromisedWebSockets {
    private closed: boolean;

    private timeout: number;

    private stream: Buffer;

    private canRead?: boolean | Promise<boolean>;

    private resolveRead: ((value?: any) => void) | undefined;

    private client: WebSocket | undefined;

    private handshakeDone: boolean;

    private disconnectedCallback: () => void;

    // Bound 'offline' handler — kept on the instance so we can remove it
    // in close(). Without this, every connect() would leak another
    // window listener (each reconnect calls addEventListener again).
    private offlineHandler: (() => void) | undefined;

    constructor(disconnectedCallback: () => void) {
        this.client = undefined;
        this.closed = true;
        this.stream = Buffer.alloc(0);
        this.disconnectedCallback = disconnectedCallback;
        this.timeout = CONNECTION_TIMEOUT;
        this.handshakeDone = false;
        this.offlineHandler = undefined;
    }

    async readExactly(number: number) {
        let readData = Buffer.alloc(0);
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const thisTime = await this.read(number);
            readData = Buffer.concat([readData, thisTime]);
            number -= thisTime.length;
            if (!number) {
                return readData;
            }
        }
    }

    async read(number: number) {
        if (this.closed) {
            throw closeError;
        }
        await this.canRead;
        if (this.closed) {
            throw closeError;
        }
        const toReturn = this.stream.slice(0, number);
        this.stream = this.stream.slice(number);
        if (this.stream.length === 0) {
            this.canRead = new Promise((resolve) => {
                this.resolveRead = resolve;
            });
        }

        return toReturn;
    }

    async readAll() {
        if (this.closed || !await this.canRead) {
            throw closeError;
        }
        const toReturn = this.stream;
        this.stream = Buffer.alloc(0);
        this.canRead = new Promise((resolve) => {
            this.resolveRead = resolve;
        });

        return toReturn;
    }

    // Kept for API compatibility with upstream — telegram-tt builds the
    // wss://... URL elsewhere, but with the bridge we don't use it.
    getWebSocketLink(ip: string, port: number, isTestServer?: boolean, isPremium?: boolean) {
        if (port === 443) {
            return `wss://${ip}:${port}/apiws${isTestServer ? '_test' : ''}${isPremium ? '_premium' : ''}`;
        } else {
            return `ws://${ip}:${port}/apiws${isTestServer ? '_test' : ''}${isPremium ? '_premium' : ''}`;
        }
    }

    async connect(port: number, ip: string, isTestServer = false, isPremium = false, dcId?: number) {
        this.stream = Buffer.alloc(0);
        this.canRead = new Promise((resolve) => {
            this.resolveRead = resolve;
        });
        this.closed = false;
        this.handshakeDone = false;

        // Bridge token has a 5-minute TTL on the backend. On reconnect
        // (after tab has been open >5 min), the cached token would be
        // rejected with 4401 INVALID_OR_EXPIRED_TOKEN — silent UI freeze.
        // Refresh first if we're within 60s of expiry. ensureFreshBridgeConfig
        // dedups parallel calls (GramJS opens main DC + file DC WS at once).
        const cfg = await ensureFreshBridgeConfig();
        const url = `${cfg.wsUrl}?bridge_token=${encodeURIComponent(cfg.bridgeToken)}`;
        this.client = new WebSocket(url, 'binary');

        return new Promise<this>((resolve, reject) => {
            if (!this.client) {
                reject(new Error('Bridge WebSocket not initialized'));
                return;
            }
            let hasResolved = false;
            let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
            let handshakeTimeout: ReturnType<typeof globalThis.setTimeout> | undefined;

            const failAll = (err: Error) => {
                if (timeout) clearTimeout(timeout);
                if (handshakeTimeout) clearTimeout(handshakeTimeout);
                this.closed = true;
                if (!hasResolved) {
                    reject(err);
                    hasResolved = true;
                }
            };

            this.client.onopen = () => {
                // Send JSON handshake with target DC info. Backend parses this
                // and opens TCP to ip:port through the userbot's SOCKS5 proxy.
                const handshake = JSON.stringify({
                    ip,
                    port,
                    dcId: dcId ?? null,
                    isTestServer,
                    isPremium
                });
                this.client!.send(handshake);
                this.receive();
                handshakeTimeout = setTimeout(() => {
                    if (!this.handshakeDone) {
                        failAll(new Error('Bridge handshake timeout'));
                    }
                }, HANDSHAKE_TIMEOUT);
            };

            this.client.onerror = (error) => {
                // eslint-disable-next-line no-console
                console.error('Bridge WebSocket error', error);
                failAll(error instanceof Error ? error : new Error(String(error)));
            };

            this.client.onclose = (event) => {
                const { code, reason, wasClean } = event;
                if (code !== 1000) {
                    // eslint-disable-next-line no-console
                    console.error(`Bridge closed. Code: ${code}, reason: ${reason}, was clean: ${wasClean}`);
                }
                this.resolveRead?.(false);
                this.closed = true;
                if (this.disconnectedCallback) {
                    this.disconnectedCallback();
                }
                if (!hasResolved) {
                    // If close happens before handshake ACK, treat as connect failure.
                    failAll(new Error(`Bridge closed before handshake (code=${code})`));
                }
            };

            timeout = setTimeout(() => {
                if (hasResolved) return;
                failAll(new Error('WebSocket connection timeout'));
                this.client?.close();
                this.timeout *= 2;
                this.timeout = Math.min(this.timeout, MAX_TIMEOUT);
                timeout = undefined;
            }, this.timeout);

            // eslint-disable-next-line no-restricted-globals
            // Bound handler so we can remove it on close (avoids leaking
            // one listener per reconnect across long sessions).
            if (!this.offlineHandler) {
                this.offlineHandler = async () => {
                    await this.close();
                    this.resolveRead?.(false);
                };
            }
            self.addEventListener('offline', this.offlineHandler);

            // Expose a handshake resolver so this.receive() can flip
            // handshakeDone + resolve the connect() promise.
            (this as any)._resolveConnect = () => {
                if (!hasResolved) {
                    this.handshakeDone = true;
                    resolve(this);
                    hasResolved = true;
                    if (timeout) clearTimeout(timeout);
                    if (handshakeTimeout) clearTimeout(handshakeTimeout);
                }
            };
            (this as any)._rejectConnect = (err: Error) => failAll(err);
        });
    }

    write(data: Buffer) {
        if (this.closed) {
            throw closeError;
        }
        this.client?.send(data);
    }

    async close() {
        if (this.offlineHandler) {
            // eslint-disable-next-line no-restricted-globals
            self.removeEventListener('offline', this.offlineHandler);
        }
        await this.client?.close();
        this.closed = true;
    }

    receive() {
        if (!this.client) return;
        this.client.onmessage = async (message) => {
            // Until handshake is done, expect text control frames.
            if (!this.handshakeDone) {
                if (typeof message.data === 'string') {
                    const text = message.data as string;
                    if (text === 'ok') {
                        (this as any)._resolveConnect?.();
                    } else if (text.startsWith('error:')) {
                        (this as any)._rejectConnect?.(new Error(text.slice(6)));
                    } else {
                        (this as any)._rejectConnect?.(new Error(`Unexpected bridge handshake: ${text}`));
                    }
                } else {
                    (this as any)._rejectConnect?.(new Error('Expected text handshake frame, got binary'));
                }
                return;
            }

            await mutex.runExclusive(async () => {
                const data = message.data instanceof ArrayBuffer
                    ? Buffer.from(message.data)
                    : Buffer.from(await new Response(message.data).arrayBuffer());
                this.stream = Buffer.concat([this.stream, data]);
                this.resolveRead?.(true);
            });
        };
    }
}
