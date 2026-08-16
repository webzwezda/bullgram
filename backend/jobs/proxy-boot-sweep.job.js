import { UserbotService } from '../services/userbot.service.js';

const START_DELAY_MS = Number(process.env.PROXY_BOOT_SWEEP_DELAY_MS || 60_000);
const FAIL_RETRY_DELAY_MS = Number(process.env.PROXY_BOOT_SWEEP_RETRY_DELAY_MS || 10_000);
const CONCURRENCY = Number(process.env.PROXY_BOOT_SWEEP_CONCURRENCY || 5);

function buildCheckInput(proxy) {
    return {
        host: proxy.host,
        port: proxy.port,
        username: proxy.username,
        password: proxy.password,
        provision_source: proxy.provision_source || null,
        is_working: proxy.is_working,
        last_check_ip: proxy.last_check_ip || null,
        last_check_country: proxy.last_check_country || null,
        last_check_city: proxy.last_check_city || null,
        force_ipv6: !proxy.last_check_ip || proxy.last_check_ip.includes(':')
    };
}

async function checkOnce(userbotService, proxy) {
    try {
        return await userbotService.checkProxy(buildCheckInput(proxy));
    } catch (error) {
        return { success: false, error: String(error?.message || error) };
    }
}

async function runWithConcurrency(items, limit, worker) {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const item = items[cursor];
            cursor += 1;
            await worker(item);
        }
    });
    await Promise.all(runners);
}

export async function runProxyBootSweep(supabase) {
    await new Promise((resolve) => setTimeout(resolve, START_DELAY_MS));

    const { data: proxies, error } = await supabase
        .from('proxies')
        .select('id, owner_id, host, port, username, password, is_working, provision_source, last_check_ip, last_check_country, last_check_city')
        .not('host', 'is', null)
        .not('port', 'is', null);
    if (error) throw error;

    const targets = (proxies || []).filter((proxy) => proxy.host && proxy.port);
    if (targets.length === 0) {
        console.log('[ProxyBootSweep] прокси для проверки нет');
        return { checked: 0, working: 0, dead: 0 };
    }

    const userbotService = new UserbotService();
    let working = 0;
    let dead = 0;

    await runWithConcurrency(targets, CONCURRENCY, async (proxy) => {
        let result = await checkOnce(userbotService, proxy);
        if (!result.success) {
            // одиночный ретрей: в момент старта сервера сеть/прокси могут ещё подниматься
            await new Promise((resolve) => setTimeout(resolve, FAIL_RETRY_DELAY_MS));
            result = await checkOnce(userbotService, proxy);
        }

        if (result.success) {
            working += 1;
            await supabase.from('proxies').update({
                is_working: true,
                last_checked_at: new Date().toISOString(),
                last_check_ip: result.ip,
                last_check_country: result.country,
                last_check_country_code: result.countryCode || null,
                last_check_city: result.city,
                last_check_isp: result.isp,
                last_check_error: null
            }).eq('id', proxy.id);
        } else {
            dead += 1;
            await supabase.from('proxies').update({
                is_working: false,
                last_checked_at: new Date().toISOString(),
                last_check_error: result.error,
                last_check_ip: null,
                last_check_country: null,
                last_check_country_code: null,
                last_check_city: null,
                last_check_isp: null
            }).eq('id', proxy.id);
        }
    });

    console.log(`[ProxyBootSweep] проверено ${targets.length}: живых ${working}, мёртвых ${dead}`);
    return { checked: targets.length, working, dead };
}
