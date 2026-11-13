/**
 * Юнит-тесты выдачи аккаунт-лотов (account shop delivery, Wave 2).
 * Офлайн, детерминированные: гейты аккаунтов и файловая выдача — на моке
 * supabase в стиле test-shop-quarantine.js, архив собирается реальным
 * adm-zip, blob'ы шифруются реальным encrypt() (ENCRYPTION_KEY — тестовый).
 * Оплата в runShopPurchaseCheck инъекцией paymentCheckFn — сеть не трогаем.
 *
 * Покрывает: гейт аккаунт-лота (pending_activation свежий+online продаётся;
 * устаревший/frozen/без health — карантин), ослабленный guard трансфера,
 * batch-выставление (упавший аккаунт не мешает остальным), purchase-anon
 * (buyer null), kind-aware отстойник при брони, files-выдачу при оплате
 * (доставлен штамп + лот закрыт, трансфера нет), гибрид с покупателем
 * (трансфер + delivered), гибрид у анонима (files), ранний выход re-check
 * files-покупки, скачивание (состав zip, sha256/размер кэш, счётчик),
 * 409/410/429, public-view delivery, пурж files-выдач (restore source +
 * аккаунт + прокси + purged_at; гибрид не пуржится).
 *
 * Разрезка под лимит pre-commit (20КБ): хост остался на исходном пути и
 * запускает сценарии из test/shop-delivery/ в исходном порядке; общие
 * фикстуры — test/shop-delivery/shared.js. Порядок проверок и сообщения —
 * как в оригинале. Env-строки ниже стоят ПЕРЕД динамическими импортами, как
 * в оригинале: utils/crypto.js бросает на импорте без ENCRYPTION_KEY.
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-0123456789ab';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';
process.env.PLATFORM_TON_WALLET = process.env.PLATFORM_TON_WALLET || 'UQtestwalletforrunittests000';

const { failureCount } = await import('./shop-delivery/shared.js');

await (await import('./shop-delivery/account-lot-gate.js')).runAccountLotGate();
await (await import('./shop-delivery/transfer-softened-guard.js')).runTransferSoftenedGuard();
await (await import('./shop-delivery/batch-create-lots.js')).runBatchCreateLots();
await (await import('./shop-delivery/batch-auto-title.js')).runBatchAutoTitle();
await (await import('./shop-delivery/purchase-anon.js')).runPurchaseAnon();
await (await import('./shop-delivery/purchase-kind-aware-quarantine.js')).runPurchaseKindAwareQuarantine();
await (await import('./shop-delivery/purchase-check-delivery.js')).runPurchaseCheckDelivery();
await (await import('./shop-delivery/public-archive-download.js')).runPublicArchiveDownload();
await (await import('./shop-delivery/transfer-proxy-follows.js')).runTransferProxyFollows();
await (await import('./shop-delivery/public-delivery-view.js')).runPublicDeliveryView();
await (await import('./shop-delivery/sold-files-purge.js')).runSoldFilesPurgeScenario();

console.log(failureCount() === 0 ? '\nВсе проверки выдачи аккаунтов прошли' : `\nПровалено проверок: ${failureCount()}`);
process.exit(failureCount() === 0 ? 0 : 1);
