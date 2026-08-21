import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { LoadingState } from '../../ui/LoadingState.jsx';
import { ShoppingCart, Landmark } from 'lucide-react';
import { toast } from 'sonner';

import { apiRequest } from '../../api/client.js';
import { useShopData } from './useShopData.js';
import { useShopDerivedState } from './useShopDerivedState.js';
import { useShopMutations } from './useShopMutations.js';
import { useTreasuryData } from './useTreasuryData.js';
import { ShopOverviewCards } from './ShopOverviewCards.jsx';
import { OrdersTab } from './OrdersTab.jsx';
import { TreasuryTab } from './TreasuryTab.jsx';

const TABS = [
  { id: 'orders', label: 'Заказы', icon: ShoppingCart },
  { id: 'treasury', label: 'Казна', icon: Landmark }
];

export function ShopAdminPage() {
  const { accessToken, profilePlan, profileRole } = useAuth();
  const [activeTab, setActiveTab] = useState('orders');
  const [purchaseFilter, setPurchaseFilter] = useState('all');
  const [purchaseSearch, setPurchaseSearch] = useState('');

  const { state, loadShop } = useShopData({ accessToken });
  const treasury = useTreasuryData({ accessToken });
  const [withdrawing, setWithdrawing] = useState(false);

  const derived = useShopDerivedState({
    state,
    profilePlan,
    profileRole,
    purchaseFilter,
    purchaseSearch
  });

  const mutations = useShopMutations({
    accessToken,
    loadShop
  });

  const openWithdrawalsCount = useMemo(() => (
    (treasury.data?.withdrawals || []).filter((w) => ['requested', 'queued', 'sending'].includes(w.status)).length
  ), [treasury.data]);

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
            const count = tab.id === 'orders'
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
      </div>
    </section>
  );
}
