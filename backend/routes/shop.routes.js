// Фасад после финальной стадии 2 разрезки: фабрика и все роут-зоны shop
// живут в ./shop/ (index.js — агрегатор, registerXxx — зоны роутов,
// helpers/purchase-core/purchase-check/lots-batch — stage-1 модули).
// server.js и тесты продолжают импортировать этот файл без изменений.
export { default } from './shop/index.js';
export { createOrRefreshBuyerPurchase } from './shop/purchase-core.js';
export { runShopPurchaseCheck } from './shop/purchase-check.js';
export { createAccountLotsBatch } from './shop/lots-batch.js';
