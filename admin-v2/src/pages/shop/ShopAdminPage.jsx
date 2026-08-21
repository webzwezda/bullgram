import { useEffect, useState } from 'react';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { LoadingState } from '../../ui/LoadingState.jsx';
import { toast } from 'sonner';

import { apiRequest } from '../../api/client.js';
import { useShopData } from './useShopData.js';
import { useShopDerivedState } from './useShopDerivedState.js';
import { useTreasuryData } from './useTreasuryData.js';
import { ShopOverviewCards } from './ShopOverviewCards.jsx';
import { TreasuryTab } from './TreasuryTab.jsx';

export function ShopAdminPage() {
  const { accessToken } = useAuth();
  const [withdrawing, setWithdrawing] = useState(false);

  const { state } = useShopData({ accessToken });
  const treasury = useTreasuryData({ accessToken });

  const derived = useShopDerivedState({ state });

  useEffect(() => {
    if (!treasury.data && !treasury.loading && !treasury.error) {
      treasury.reload();
    }
  }, [treasury.data, treasury.loading, treasury.error, treasury.reload]);

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
        <ShopOverviewCards data={{
          itemSummary: derived.itemSummary,
          purchaseSummary: derived.purchaseSummary,
          sellerStats: derived.sellerStats
        }} />

        <TreasuryTab
          data={treasury.data}
          loading={treasury.loading}
          error={treasury.error}
          onReload={treasury.reload}
          onSubmitWithdrawal={handleSubmitWithdrawal}
          withdrawing={withdrawing}
        />
      </div>
    </section>
  );
}
