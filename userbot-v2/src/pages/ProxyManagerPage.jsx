import { useEffect, useState } from 'react';
import { Loader2, Network, RefreshCw } from 'lucide-react';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { apiRequest } from '../api/client.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { Button } from '../components/ui/button.jsx';
import { ProxyStorefrontSection } from '../features/shop-storefront/ProxyStorefrontSection.jsx';
import { AdminLotsSection } from '../components/shop/AdminLotsSection.jsx';
import { useProxyInventory } from './hooks/useProxyInventory.js';
import { useProxyActions } from './hooks/useProxyActions.js';
import { useProxySale } from './hooks/useProxySale.js';
import { ProxyTableSection } from './sections/ProxyTableSection.jsx';
import { OwnProxyCard } from './sections/ProxyOwnForm.jsx';
import { ServerProxyCard } from './sections/ProxyServerForm.jsx';
import { MyProxiesList } from './sections/MyProxiesList.jsx';

// Дашборд платформенного пула managed-прокси (BACKLOG §32): сколько поднято /
// используется / свободно / в резерве. Виден только платформенному админу,
// числа живые из /proxy-pool/stats. Гайдлайны — DESIGN.md: Card из кита,
// micro-labels, tabular-nums, действие — indigo (action.primary).
function ProxyPoolDashboard({ accessToken }) {
  const [stats, setStats] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiRequest('/api/userbot/proxy-pool/stats', { accessToken })
      .then((data) => { if (!cancelled) setStats(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [accessToken]);

  async function refresh() {
    setRefreshing(true);
    try {
      const data = await apiRequest('/api/userbot/proxy-pool/stats', { accessToken });
      setStats(data);
    } catch {
      // Тихо: старые числа остаются на экране, следующий рефреш поправит.
    } finally {
      setRefreshing(false);
    }
  }

  if (!stats) return null;

  const tiles = [
    { label: 'Поднято', value: stats.total, hint: 'всего mp_* слотов' },
    { label: 'Используется', value: stats.used, hint: 'привязаны к юзерботам', dimmedZero: true },
    { label: 'Свободно', value: stats.free, hint: 'доступно выдаче' },
    { label: 'Резерв', value: stats.reserved, hint: 'у владельца без привязки', dimmedZero: true }
  ];
  const usedShare = stats.total > 0 ? Math.min(100, Math.round((stats.used / stats.total) * 100)) : 0;

  return (
    <Card className="border-border-default/60 shadow-sm mb-6">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-4">
          {/* градиент-иконка секции: два шага одной рампы + тень в цвет (DESIGN.md §4) */}
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 shrink-0">
            <Network className="w-6 h-6" />
          </div>
          <div>
            <CardTitle className="text-base">Платформенный пул прокси</CardTitle>
            <CardDescription>Managed-слоты: выдаются автоматически при подключении юзерботов</CardDescription>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing} className="gap-2">
          {refreshing
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <RefreshCw className="w-4 h-4" />}
          Обновить
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {tiles.map((tile) => (
            <div key={tile.label} className="rounded-xl border border-border-default bg-surface-subtle px-4 py-3">
              <div className="text-[11px] uppercase tracking-widest text-ink-muted font-semibold">{tile.label}</div>
              <div className={`mt-1 text-2xl font-bold tabular-nums ${tile.dimmedZero && tile.value === 0 ? 'text-ink-muted' : 'text-ink-strong'}`}>{tile.value}</div>
              <div className="text-xs text-ink-muted mt-0.5">{tile.hint}</div>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>Заполненность пула</span>
            <span className="tabular-nums">{usedShare}%</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-surface-subtle overflow-hidden">
            <div className="h-full rounded-full bg-action-primary" style={{ width: `${usedShare}%` }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ProxyManagerPage() {
  const { accessToken, profilePlan } = useAuth();

  const inventory = useProxyInventory({ accessToken, profilePlan });
  const {
    filter,
    setFilter,
    selectedLane,
    setSelectedLane,
    formState,
    setFormState,
    checkingIds,
    setCheckingIds,
    armedDeleteId,
    setArmedDeleteId,
    state,
    reloadProxies,
    bulkCount,
    setBulkCount,
    externalProxyMode,
    setExternalProxyMode,
    raisePriceTon,
    setRaisePriceTon,
    isAdmin,
    loadSellerItems,
    getVisibleProxies,
    filteredProxies,
    sellerProxyItemMap,
    manualQuotaText,
    showQuotaLock,
    isAdminCreate,
    serverProxyMode,
    serverBatchCount,
    proxyBuyLimit,
    suggestedServerProxyName,
    buyQuantities,
    cancelCheckout,
    checkPurchase,
    checkoutState,
    createBatchCheckout,
    openCheckout,
    refreshPurchases,
    setBuyQuantities,
    setCheckoutState,
    setSelectedOpenPurchaseId,
    showPurchaseInline,
    storefrontState,
  } = inventory;

  const { checkProxy, saveProxy, deleteProxy, moveProxyToGroup } = useProxyActions({
    accessToken,
    state,
    setState: inventory.setState,
    proxiesReqIdRef: inventory.proxiesReqIdRef,
    checkingIds,
    setCheckingIds: inventory.setCheckingIds,
    armedDeleteId,
    setArmedDeleteId: inventory.setArmedDeleteId,
    formState,
    setFormState: inventory.setFormState,
    bulkCount,
    setBulkCount: inventory.setBulkCount,
    externalProxyMode,
    setExternalProxyMode: inventory.setExternalProxyMode,
    raisePriceTon,
    setRaisePriceTon: inventory.setRaisePriceTon,
    serverBatchCount,
    isAdminCreate,
    canEditProxy: inventory.canEditProxy,
    loadSellerItems,
  });

  const {
    saleSelection,
    salePriceTon,
    setSalePriceTon,
    listingSale,
    proxyPage,
    setProxyPage,
    saleStatusFilter,
    setSaleStatusFilter,
    saleProxies,
    toggleAllSaleSelection,
    toggleSaleSelection,
    listSelectedForSale,
  } = useProxySale({ accessToken, saleProxies: inventory.saleProxies, loadSellerItems });

  if (state.loading) {
    return <LoadingState text="Загружаем прокси..." />;
  }

  return (
    <section className="page proxy-page">

      {state.error ? <div className="error-card" style={{ marginTop: 20 }}>{state.error}</div> : null}

      {state.support?.profile_role === 'admin' ? <ProxyPoolDashboard accessToken={accessToken} /> : null}

      {manualQuotaText && state.support?.profile_role === 'admin' ? (
        <div className="toolbar-card proxy-surface-card">
          <div className="proxy-surface-card__head">
            <div className="toolbar-card__title">Правило по прокси</div>
          </div>
          <p style={{ margin: 0 }}>{manualQuotaText}</p>
          {state.support?.profile_role === 'admin' ? (
            <p className="table-subtext" style={{ marginTop: 8 }}>
              Следующее имя для выбранной группы: <strong>{suggestedServerProxyName}</strong>
            </p>
          ) : null}
        </div>
      ) : null}

      {state.support?.profile_role !== 'admin' ? (
        <ProxyStorefrontSection
          buyLimit={proxyBuyLimit}
          buyQuantities={buyQuantities}
          cancelCheckout={cancelCheckout}
          checkPurchase={checkPurchase}
          checkoutState={checkoutState}
          createBatchCheckout={createBatchCheckout}
          openCheckout={openCheckout}
          refreshPurchases={refreshPurchases}
          reloadProxies={reloadProxies}
          setBuyQuantities={setBuyQuantities}
          setCheckoutState={setCheckoutState}
          setSelectedOpenPurchaseId={setSelectedOpenPurchaseId}
          showPurchaseInline={showPurchaseInline}
          storefrontState={storefrontState}
        />
      ) : null}

      {state.support?.profile_role !== 'admin' ? (
        <OwnProxyCard
          state={state}
          formState={formState}
          setFormState={setFormState}
          showQuotaLock={showQuotaLock}
          saveProxy={saveProxy}
        />
      ) : null}

      {state.proxies.length > 0 && state.support?.profile_role !== 'admin' ? (
        <MyProxiesList
          filter={filter}
          setFilter={setFilter}
          filteredProxies={filteredProxies}
          checkingIds={checkingIds}
          armedDeleteId={armedDeleteId}
          setArmedDeleteId={setArmedDeleteId}
          checkProxy={checkProxy}
          deleteProxy={deleteProxy}
        />
      ) : null}

      {state.support?.profile_role === 'admin' ? (
        <ServerProxyCard
          state={state}
          formState={formState}
          setFormState={setFormState}
          suggestedServerProxyName={suggestedServerProxyName}
          showQuotaLock={showQuotaLock}
          serverProxyMode={serverProxyMode}
          raisePriceTon={raisePriceTon}
          setRaisePriceTon={setRaisePriceTon}
          bulkCount={bulkCount}
          setBulkCount={setBulkCount}
          serverBatchCount={serverBatchCount}
          setExternalProxyMode={setExternalProxyMode}
          isAdminCreate={isAdminCreate}
          externalProxyMode={externalProxyMode}
          saveProxy={saveProxy}
        />
      ) : null}


      {state.support?.profile_role === 'admin' ? (
        <ProxyTableSection
          armedDeleteId={armedDeleteId}
          checkProxy={checkProxy}
          checkingIds={checkingIds}
          deleteProxy={deleteProxy}
          getVisibleProxies={getVisibleProxies}
          isAdmin={isAdmin}
          listingSale={listingSale}
          listSelectedForSale={listSelectedForSale}
          moveProxyToGroup={moveProxyToGroup}
          movingProxyId={state.movingProxyId}
          proxyPage={proxyPage}
          salePriceTon={salePriceTon}
          saleProxies={saleProxies}
          saleSelection={saleSelection}
          saleStatusFilter={saleStatusFilter}
          selectedLane={selectedLane}
          sellerProxyItemMap={sellerProxyItemMap}
          setArmedDeleteId={setArmedDeleteId}
          setProxyPage={setProxyPage}
          setSalePriceTon={setSalePriceTon}
          setSaleStatusFilter={setSaleStatusFilter}
          setSelectedLane={setSelectedLane}
          toggleAllSaleSelection={toggleAllSaleSelection}
          toggleSaleSelection={toggleSaleSelection}
        />
      ) : null}

      {isAdmin ? (
        <AdminLotsSection
          accessToken={accessToken}
          types="proxy"
          title="Прокси на витрине"
          onChanged={loadSellerItems}
        />
      ) : null}

    </section>
  );
}
