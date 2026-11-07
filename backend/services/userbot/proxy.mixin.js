// Стадия 2 разрезки монстра userbot.service.js (план §7.3b): методы перенесены из
// класса ДОСЛОВНО (тела/JSDoc/комментарии без изменений); this.* зовётся через
// цепочку прототипов mixin-композиции в services/userbot.service.js.
import { TelegramClient, Api } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { FAILOVER_COOLDOWN_MS, TELEGRAM_DC_IPV6 } from './constants.js';

export const ProxyMixin = (Base) => class extends Base {
    normalizeFailoverProxyIds(value) {
        if (Array.isArray(value)) {
            return value.map(item => String(item)).filter(Boolean);
        }

        if (typeof value === 'string' && value.trim()) {
            try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) {
                    return parsed.map(item => String(item)).filter(Boolean);
                }
            } catch {
                return value.split(',').map(item => item.trim()).filter(Boolean);
            }
        }

        return [];
    }

    async tryAutoFailoverUserbot(userbot) {
        if (!userbot?.id || !userbot?.owner_id) return { switched: false, account: userbot, reason: 'no_account' };
        if (!userbot.proxy_id || userbot?.proxies?.is_working !== false) return { switched: false, account: userbot, reason: 'proxy_ok' };
        if (!userbot.allow_proxy_failover) return { switched: false, account: userbot, reason: 'disabled' };

        const lastFailoverAt = userbot.last_failover_at ? new Date(userbot.last_failover_at) : null;
        if (lastFailoverAt && !Number.isNaN(lastFailoverAt.getTime())) {
            const diff = Date.now() - lastFailoverAt.getTime();
            if (diff < FAILOVER_COOLDOWN_MS) {
                return {
                    switched: false,
                    account: userbot,
                    reason: 'cooldown',
                    retry_after_ms: FAILOVER_COOLDOWN_MS - diff
                };
            }
        }

        const allowedIds = this.normalizeFailoverProxyIds(userbot.failover_proxy_ids)
            .filter(id => id !== String(userbot.proxy_id));

        if (!allowedIds.length) {
            return { switched: false, account: userbot, reason: 'empty_pool' };
        }

        const { data: candidateProxies, error } = await this.supabase
            .from('proxies')
            .select('id, host, port, username, password, is_working, name, last_check_country, last_check_country_code')
            .eq('owner_id', userbot.owner_id)
            .eq('is_working', true)
            .in('id', allowedIds);

        if (error) throw error;

        const { data: occupiedProxyRows, error: occupiedProxyError } = await this.supabase
            .from('tg_accounts')
            .select('proxy_id')
            .eq('owner_id', userbot.owner_id)
            .eq('account_type', 'userbot')
            .neq('id', userbot.id)
            .in('proxy_id', allowedIds);

        if (occupiedProxyError) throw occupiedProxyError;

        const occupiedProxyIds = new Set(
            (occupiedProxyRows || [])
                .map((row) => String(row.proxy_id || ''))
                .filter(Boolean)
        );

        const nextProxy = (candidateProxies || []).find((proxy) =>
            allowedIds.includes(String(proxy.id)) && !occupiedProxyIds.has(String(proxy.id))
        );
        if (!nextProxy) {
            return { switched: false, account: userbot, reason: 'no_live_proxy' };
        }

        const { data: updatedAccount, error: updateError } = await this.supabase
            .from('tg_accounts')
            .update({
                proxy_id: nextProxy.id,
                last_failover_at: new Date().toISOString(),
                last_failover_from_proxy_id: userbot.proxy_id
            })
            .eq('id', userbot.id)
            .eq('owner_id', userbot.owner_id)
            .select('*, proxies(id, name, host, port, username, password, is_working, provision_source, inventory_group, last_check_country, last_check_country_code)')
            .single();

        if (updateError) throw updateError;

        return {
            switched: true,
            account: updatedAccount,
            reason: 'switched',
            from_proxy_id: userbot.proxy_id,
            to_proxy_id: nextProxy.id
        };
    }

    _normalizeProxyInput(proxyData = null) {
        if (!proxyData || typeof proxyData !== 'object') return null;

        const nested = proxyData.proxies && typeof proxyData.proxies === 'object'
            ? proxyData.proxies
            : null;

        const host = proxyData.proxy_host || proxyData.host || nested?.host || null;
        const port = proxyData.proxy_port || proxyData.port || nested?.port || null;
        const username = proxyData.proxy_username || proxyData.username || nested?.username || null;
        const password = proxyData.proxy_password || proxyData.password || nested?.password || null;

        if (!host || !port) return null;

        return {
            host: String(host),
            port: Number(port),
            username: username || null,
            password: password || null
        };
    }

    /**
     * Вспомогательная функция для сборки конфига прокси (для GramJS)
     * GramJS принимает плоский объект, пакет socks подключается автоматически
     */
    _buildProxy(proxyData) {
        const normalized = this._normalizeProxyInput(proxyData);
        if (!normalized) return undefined;

        const proxy = {
            ip: normalized.host,
            port: parseInt(normalized.port),
            socksType: 5
        };

        // Добавляем авторизацию только если есть
        if (normalized.username && normalized.password) {
            proxy.username = normalized.username;
            proxy.password = normalized.password;
        }

        console.log('[BUILD-PROXY] Собран конфиг прокси:', {
            ip: proxy.ip,
            port: proxy.port,
            socksType: proxy.socksType,
            hasAuth: !!(proxy.username && proxy.password)
        });

        return proxy;
    }

    _shouldUseIpv6TelegramDc(proxyData = null) {
        if (!proxyData || typeof proxyData !== 'object') return false;

        const nested = proxyData.proxies && typeof proxyData.proxies === 'object'
            ? proxyData.proxies
            : null;

        const provisionSource = String(
            proxyData.provision_source ||
            proxyData.proxy_provision_source ||
            nested?.provision_source ||
            ''
        );

        const username = String(
            proxyData.proxy_username ||
            proxyData.username ||
            nested?.username ||
            ''
        );

        if (proxyData.force_ipv6 === true || nested?.force_ipv6 === true) {
            return true;
        }

        const healthSuggestsIpv6Only = (
            (proxyData.is_working === true || nested?.is_working === true) &&
            !(
                proxyData.last_check_ip ||
                nested?.last_check_ip ||
                proxyData.last_check_country ||
                nested?.last_check_country ||
                proxyData.last_check_city ||
                nested?.last_check_city
            )
        );

        // Слот `mp_<seq>` генерирует только наш managed-провижинер (IPv6-only):
        // юзернейм опознаёт его даже там, где прокси-джойн не передал
        // provision_source (ручная проверка, QR, telegram-web) — иначе сессия
        // с IPv4-адресом из .session уходит в чёрную дыру и getMe висит.
        const managedSlotUsername = /^mp_\d+$/.test(username);

        return (
            (provisionSource === 'manual_admin' && managedSlotUsername) ||
            managedSlotUsername ||
            healthSuggestsIpv6Only
        );
    }

    /**
     * АНТИ-БАН: Генерация отпечатка реального Android-устройства (Филиппины)
     */
    _getClientConfig(proxyConfig, retries = 1, fingerprint = null, proxyData = null) {
        const normalized = this._normalizeFingerprint(fingerprint);
        const useIPV6 = this._shouldUseIpv6TelegramDc(proxyData);

        return {
            connectionRetries: retries,
            deviceModel: normalized.deviceModel,
            systemVersion: normalized.systemVersion,
            appVersion: normalized.appVersion,
            systemLangCode: normalized.systemLangCode,
            langCode: normalized.langCode,
            useIPV6,
            useWSS: false,
            proxy: proxyConfig
        };
    }

    _forceManagedIpv6Dc(client, proxyData = null) {
        if (!this._shouldUseIpv6TelegramDc(proxyData) || !client?.session) {
            return;
        }

        this._forceIpv6Dc(client);
    }

    _forceIpv6Dc(client) {
        if (!client?.session) {
            return;
        }

        const currentDcId = Number(client.session.dcId || 0) || 4;
        const ipv6Address = TELEGRAM_DC_IPV6[currentDcId];
        if (!ipv6Address) {
            return;
        }

        client._useIPV6 = true;
        client.session.setDC(currentDcId, ipv6Address, client.useWSS ? 443 : 80);
    }

    _isTelegramIpv6RetryableProxyError(error) {
        const raw = String(error?.errorMessage || error?.message || '');
        return (
            raw.includes('Socks5 proxy rejected connection - NotAllowed') ||
            raw.includes('Socks5 proxy rejected connection - ConnectionRefused')
        );
    }

    _clientUsesIpv6Dc(client) {
        const serverAddress = String(client?.session?.serverAddress || '');
        return serverAddress.includes(':');
    }

    async connectWithProxyFallback(client, proxyData = null) {
        try {
            await client.connect();
            return { usedIpv6Fallback: false };
        } catch (error) {
            const hasProxy = !!this._normalizeProxyInput(proxyData);
            const alreadyIpv6 = this._clientUsesIpv6Dc(client);

            if (!hasProxy || alreadyIpv6 || !this._isTelegramIpv6RetryableProxyError(error)) {
                throw error;
            }

            console.warn('[TELEGRAM-CONNECT] IPv4 DC через прокси не прошел, повторяем через IPv6 DC:', error.message);

            try { await client.disconnect(); } catch {}
            this._forceIpv6Dc(client);
            await client.connect();
            return { usedIpv6Fallback: true };
        }
    }

    /**
     * ПРОВЕРКА ПРОКСИ: Тестовый запрос через SOCKS5
     */
    async checkProxy(proxyData) {
        try {
            const normalized = this._normalizeProxyInput(proxyData);
            if (!normalized) {
                throw new Error("Неверные данные прокси");
            }

            let proxyUrl = `socks5://`;
            if (normalized.username && normalized.password) {
                // Кодируем логин и пароль, чтобы спецсимволы не сломали URL
                proxyUrl += `${encodeURIComponent(normalized.username)}:${encodeURIComponent(normalized.password)}@`;
            }
            proxyUrl += `${normalized.host}:${normalized.port}`;

            const agent = new SocksProxyAgent(proxyUrl);

            const ipEndpoints = [
                'https://api64.ipify.org?format=json',
                'https://api.ipify.org?format=json',
                'https://ifconfig.co/json'
            ];

            let exitIp = '';
            let lastIpError = null;

            for (const endpoint of ipEndpoints) {
                try {
                    const ipResponse = await axios.get(endpoint, {
                        httpAgent: agent,
                        httpsAgent: agent,
                        timeout: 10000
                    });
                    exitIp = String(ipResponse?.data?.ip || ipResponse?.data?.ip_addr || '').trim();
                    if (exitIp) break;
                } catch (error) {
                    lastIpError = error;
                }
            }

            // Если IP-чек показал IPv6 exit — прокси форсит IPv6 исходящие
            if (exitIp && exitIp.includes(':')) {
                proxyData.force_ipv6 = true;
            }

            const telegramCheck = await this._checkTelegramConnectivity(proxyData);

            if (!exitIp) {
                if (telegramCheck.success) {
                    return {
                        success: true,
                        ip: '',
                        country: '',
                        countryCode: '',
                        city: '',
                        isp: '',
                        mode: 'telegram_only'
                    };
                }

                throw new Error(lastIpError?.message || telegramCheck.error || 'Прокси поднялся, но не удалось определить внешний IP');
            }

            if (!telegramCheck.success) {
                const rawTelegramError = String(telegramCheck.error || 'Telegram connect failed');
                const isExplicitTelegramBlock = (
                    rawTelegramError.includes('Socks5 proxy rejected connection - NotAllowed') ||
                    rawTelegramError.includes('Socks5 proxy rejected connection - ConnectionRefused')
                );

                if (isExplicitTelegramBlock) {
                    throw new Error('Прокси живой для web/IP, но Telegram через него не идет. Такой прокси не подходит для QR, импорта .session и работы юзерботов.');
                }

                throw new Error(`Прокси живой для web/IP, но Telegram через него не идет: ${rawTelegramError}`);
            }

            // Гео и провайдера можно безопасно получить уже обычным запросом по определенному IP.
            const geoResponse = await axios.get(`https://ipwho.is/${encodeURIComponent(exitIp)}`, {
                timeout: 10000
            });

            const geo = geoResponse?.data || {};
            if (geo.success === false) {
                throw new Error(geo.message || "Не удалось получить геоданные по IP");
            }

            return {
                success: true,
                ip: exitIp,
                country: geo.country || '',
                countryCode: geo.country_code || '',
                city: geo.city || '',
                isp: geo.connection?.isp || geo.connection?.org || ''
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async _checkTelegramConnectivity(normalizedProxy) {
        const proxyConfig = this._buildProxy(normalizedProxy);
        const clientConfig = this._getClientConfig(proxyConfig, 1, undefined, normalizedProxy);
        const client = new TelegramClient(
            new StringSession(''),
            this.apiId,
            this.apiHash,
            clientConfig
        );
        this.prepareServiceClient(client, { ignoreAuthKeyErrors: true });
        this._forceManagedIpv6Dc(client, normalizedProxy);

        try {
            await this.connectWithProxyFallback(client, normalizedProxy);
            try {
                await this._verifyTelegramRpc(client);
            } catch (error) {
                const raw = String(error?.message || '');
                if (raw.includes('Telegram RPC check timed out') && this._shouldUseIpv6TelegramDc(normalizedProxy)) {
                    return { success: true, mode: 'telegram_tcp_only' };
                }
                throw error;
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error?.message || 'Telegram connect failed' };
        } finally {
            try { await client.disconnect(); } catch {}
        }
    }

    async _verifyTelegramRpc(client) {
        const rpcPromise = client.invoke(new Api.help.GetNearestDc({}));
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Telegram RPC check timed out')), 12000);
        });

        await Promise.race([rpcPromise, timeoutPromise]);
    }
};
