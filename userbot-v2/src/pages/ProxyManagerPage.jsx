import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { ProxyStorefrontSection } from '../features/shop-storefront/ProxyStorefrontSection.jsx';
import { AdminLotsSection } from '../components/shop/AdminLotsSection.jsx';
import { useProxyInventory } from './hooks/useProxyInventory.js';
import { useProxyActions } from './hooks/useProxyActions.js';
import { useProxySale } from './hooks/useProxySale.js';
import { ProxyTableSection } from './sections/ProxyTableSection.jsx';
import { OwnProxyCard } from './sections/ProxyOwnForm.jsx';
import { ServerProxyCard } from './sections/ProxyServerForm.jsx';
import { MyProxiesList } from './sections/MyProxiesList.jsx';

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
