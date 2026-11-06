// Сценарий из test/test-shop-delivery.js (разрезка под лимит pre-commit; хост — test/test-shop-delivery.js).
import { ARCHIVE_EXPIRED_MESSAGE, buildAccountDeliveryView } from '../../services/shop-delivery.service.js';
import { assert, filesDelivery } from './shared.js';

export async function runPublicDeliveryView() {
console.log('— Публичное представление выдачи (public-view delivery) —');

{
    const view = buildAccountDeliveryView({
        status: 'pending',
        deliveredAt: null,
        itemDeliveryMode: 'hybrid',
        payloadDelivery: null,
        label: '+13…642'
    });
    assert(view.available === false && view.mode === 'hybrid' && view.label === '+13…642', 'view: pending → недоступно, режим из лота');
    assert(view.reason === 'Оплата ещё не подтверждена', 'view: pending → причина «не оплачено»');
}
{
    const nowIso = new Date().toISOString();
    const view = buildAccountDeliveryView({
        status: 'paid',
        deliveredAt: nowIso,
        itemDeliveryMode: 'files',
        payloadDelivery: filesDelivery(nowIso),
        label: '+13…642'
    });
    assert(view.available === true && Boolean(view.window_ends_at), 'view: files в окне → доступно с окном');
    assert(view.downloads_used === 0 && view.downloads_max === 10, 'view: счётчики квоты видны');
}
{
    const nowIso = new Date().toISOString();
    const view = buildAccountDeliveryView({
        status: 'paid',
        deliveredAt: nowIso,
        itemDeliveryMode: 'hybrid',
        payloadDelivery: { mode: 'hybrid', transferred: true, downloads: [] },
        label: '+13…642'
    });
    assert(view.available === true && view.window_ends_at === null, 'view: гибрид с трансфером → бессрочно');
}
{
    const nowIso = new Date().toISOString();
    const view = buildAccountDeliveryView({
        status: 'paid',
        deliveredAt: nowIso,
        itemDeliveryMode: 'files',
        payloadDelivery: filesDelivery(nowIso, { purged_at: nowIso }),
        label: '+13…642'
    });
    assert(view.available === false && view.reason === ARCHIVE_EXPIRED_MESSAGE, 'view: пуржнутое → «срок истёк»');
}
}
