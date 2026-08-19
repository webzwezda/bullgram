import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { LoadingState } from '../../ui/LoadingState.jsx';
import { Package, ShoppingCart, Landmark } from 'lucide-react';
import { toast } from 'sonner';

import { apiRequest } from '../../api/client.js';
import { INITIAL_FORM_STATE, INITIAL_PROXY_COMPOSER } from './shop.utils.js';
import { useShopData } from './useShopData.js';
import { useShopDerivedState } from './useShopDerivedState.js';
import { useShopMutations } from './useShopMutations.js';
import { useTreasuryData } from './useTreasuryData.js';
import { ShopOverviewCards } from './ShopOverviewCards.jsx';
import { ItemsTab } from './ItemsTab.jsx';
import { OrdersTab } from './OrdersTab.jsx';
import { TreasuryTab } from './TreasuryTab.jsx';
import { CreateItemDialog } from './CreateItemDialog.jsx';
import { ProxyComposerDialog } from './ProxyComposerDialog.jsx';

const TABS = [
  { id: 'items', label: 'Мои товары', icon: Package },
  { id: 'orders', label: 'Заказы', icon: ShoppingCart },
  { id: 'treasury', label: 'Казна', icon: Landmark }
];

export function ShopAdminPage() {
  const { accessToken, profilePlan, profileRole } = useAuth();
  const [activeTab, setActiveTab] = useState('items');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showProxyDialog, setShowProxyDialog] = useState(false);
  const [formState, setFormState] = useState({ ...INITIAL_FORM_STATE });
  const [proxyComposer, setProxyComposer] = useState({ ...INITIAL_PROXY_COMPOSER });
  const [itemFilter, setItemFilter] = useState('all');
  const [purchaseFilter, setPurchaseFilter] = useState('all');
  const [itemSearch, setItemSearch] = useState('');
  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [confirmState, setConfirmState] = useState({ open: false, title: '', onConfirm: null });

  const { state, setState, loadShop } = useShopData({ accessToken });
  const treasury = useTreasuryData({ accessToken });
  const [withdrawing, setWithdrawing] = useState(false);

  const derived = useShopDerivedState({
    state,
    profilePlan,
    profileRole,
    itemFilter,
    purchaseFilter,
    itemSearch,
    purchaseSearch
  });

  const mutations = useShopMutations({
    accessToken,
    state,
    setState,
    loadShop,
    formState,
    setFormState,
    proxyComposer,
    setProxyComposer,
    saleProxies: derived.saleProxies,
    canUseAssetSeller: derived.canUseAssetSeller
  });

  const openWithdrawalsCount = useMemo(() => (
    (treasury.data?.withdrawals || []).filter((w) => ['requested', 'queued', 'sending'].includes(w.status)).length
  ), [treasury.data]);

  // Prefill proxy composer from URL params
  useEffect(() => {
    if (!derived.canUseAssetSeller || !derived.saleProxies) return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('asset') !== 'proxy') return;
    const proxyId = params.get('proxyId');
    if (!proxyId) return;
    const proxy = derived.saleProxies.find((p) => String(p.id) === String(proxyId));
    if (proxy) {
      mutations.openProxyComposer(proxy);
      setShowProxyDialog(true);
      window.history.replaceState({}, '', '/app/shop');
    }
  }, [derived.canUseAssetSeller, derived.saleProxies]);

  // Deep link /app/shop?tab=treasury
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') !== 'treasury') return;
    setActiveTab('treasury');
    window.history.replaceState({}, '', '/app/shop');
  }, []);

  useEffect(() => {
    if (activeTab === 'treasury' && !treasury.data && !treasury.loading && !treasury.error) {
      treasury.reload();
    }
  }, [activeTab, treasury.data, treasury.loading, treasury.error, treasury.reload]);

  async function handleSubmitWithdrawal(payload) {
    setWithdrawing(true);
    try {
      const data = await apiRequest('/api/project-admin/treasury/withdrawals', {
        accessToken,
        method: 'POST',
        body: { ...payload, network_fee_ton: 0.05 }
      });
      if (data.treasury) treasury.setData(data.treasury);
      toast.success('Заявка на вывод создана');
      return true;
    } catch (error) {
      toast.error(error.message || 'Не удалось создать заявку на вывод.');
      return false;
    } finally {
      setWithdrawing(false);
    }
  }

  function handleOpenCreate() {
    setFormState({ ...INITIAL_FORM_STATE });
    setShowCreateDialog(true);
  }

  function handleOpenProxyComposer() {
    setProxyComposer({ ...INITIAL_PROXY_COMPOSER });
    setShowProxyDialog(true);
  }

  function handleDelete(itemId) {
    setConfirmState({
      open: true,
      title: 'Удалить товар?',
      description: 'Это сработает только если по нему нет живой или оплаченной покупки.',
      onConfirm: () => {
        setConfirmState({ open: false, title: '', onConfirm: null });
        mutations.deleteItem(itemId);
      }
    });
  }

  function handleSaveItem() {
    mutations.saveItem();
    setShowCreateDialog(false);
  }

  function handleSaveProxyComposer() {
    mutations.saveProxyComposer();
    setShowProxyDialog(false);
  }

  if (state.loading) {
    return <LoadingState text="Загружаем магазин..." />;
  }

  if (state.error && !state.items.length) {
    return (
      <section className="page">
        <div className="mb-6 space-y-6">
          <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800 shadow-sm">
            {state.error}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="mb-6 space-y-6">
        {/* Overview Cards */}
        <ShopOverviewCards data={{
          itemSummary: derived.itemSummary,
          purchaseSummary: derived.purchaseSummary,
          sellerStats: derived.sellerStats
        }} />

        {/* Tab Bar */}
        <div className="flex gap-1 overflow-x-auto border-b border-slate-100">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const count = tab.id === 'items'
              ? derived.itemSummary.total
              : tab.id === 'orders'
                ? derived.purchaseSummary.total
                : openWithdrawalsCount;
            return (
              <button
                key={tab.id}
                type="button"
                className={`flex items-center gap-2 px-4 py-3 text-sm font-bold whitespace-nowrap border-b-2 transition-all ${
                  isActive
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-md ${isActive ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        {activeTab === 'treasury' ? (
          <TreasuryTab
            data={treasury.data}
            loading={treasury.loading}
            error={treasury.error}
            onReload={treasury.reload}
            onSubmitWithdrawal={handleSubmitWithdrawal}
            withdrawing={withdrawing}
          />
        ) : activeTab === 'items' ? (
          <ItemsTab
            filteredItems={derived.filteredItems}
            itemSummary={derived.itemSummary}
            onUnpublish={mutations.unpublishItem}
            onDelete={handleDelete}
            onOpenCreate={handleOpenCreate}
            onOpenProxyComposer={handleOpenProxyComposer}
            itemFilter={itemFilter}
            setItemFilter={setItemFilter}
            itemSearch={itemSearch}
            setItemSearch={setItemSearch}
          />
        ) : (
          <OrdersTab
            filteredPurchases={derived.filteredPurchases}
            purchaseSummary={derived.purchaseSummary}
            receiptQueue={derived.receiptQueue}
            onCheck={mutations.checkPurchase}
            purchaseFilter={purchaseFilter}
            setPurchaseFilter={setPurchaseFilter}
            purchaseSearch={purchaseSearch}
            setPurchaseSearch={setPurchaseSearch}
          />
        )}

        {/* Create Item Dialog */}
        <CreateItemDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          formState={formState}
          setFormState={setFormState}
          onSave={handleSaveItem}
          saving={state.saving}
        />

        {/* Proxy Composer Dialog */}
        {derived.canUseAssetSeller && (
          <ProxyComposerDialog
            open={showProxyDialog}
            onOpenChange={setShowProxyDialog}
            composer={proxyComposer}
            setComposer={setProxyComposer}
            saleProxies={derived.saleProxies}
            onSave={handleSaveProxyComposer}
            onReset={mutations.resetProxyComposer}
          />
        )}

        {/* Confirm Dialog */}
        {confirmState.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-xs">
            <div className="bg-white rounded-2xl shadow-lg ring-1 ring-slate-200/50 p-6 max-w-sm w-full mx-4">
              <h3 className="font-bold text-slate-900 text-base mb-2">{confirmState.title}</h3>
              {confirmState.description && (
                <p className="text-sm text-slate-500 mb-5">{confirmState.description}</p>
              )}
              <div className="flex gap-2 justify-end">
                <button
                  className="px-4 py-2 rounded-xl text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                  onClick={() => setConfirmState({ open: false, title: '', onConfirm: null })}
                >
                  Отмена
                </button>
                <button
                  className="px-4 py-2 rounded-xl text-sm font-medium bg-rose-600 text-white hover:bg-rose-700 transition-colors"
                  onClick={confirmState.onConfirm}
                >
                  Удалить
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
