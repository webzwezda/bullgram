import { useEffect, useState } from 'react';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { LoadingState } from '../../ui/LoadingState.jsx';
import { toast } from 'sonner';

import { apiRequest } from '../../api/client.js';
import { useTreasuryData } from './useTreasuryData.js';
import { TreasuryTab } from './TreasuryTab.jsx';

export function TreasuryPage() {
  const { accessToken } = useAuth();
  const [withdrawing, setWithdrawing] = useState(false);

  const treasury = useTreasuryData({ accessToken });

  useEffect(() => {
    if (!treasury.data && !treasury.loading && !treasury.error) {
      treasury.reload();
    }
  }, [treasury.data, treasury.loading, treasury.error, treasury.reload]);

  async function handleSubmitWithdrawal(payload) {
    setWithdrawing(true);
    try {
      // Комиссию сети считает сервер (NETWORK_FEE_TON), клиентом не передаётся
      const data = await apiRequest('/api/project-admin/treasury/withdrawals', {
        accessToken,
        method: 'POST',
        body: payload
      });
      // POST отвечает pre-call summary — берём авторитетный GET
      // (reqId-гард в useTreasuryData защищает от гонки)
      await treasury.reload();
      toast.success('Заявка на вывод создана');
      return true;
    } catch (error) {
      toast.error(error.message || 'Не удалось создать заявку на вывод.');
      return false;
    } finally {
      setWithdrawing(false);
    }
  }

  if (!treasury.data && treasury.loading) {
    return <LoadingState text="Загружаем казну..." />;
  }

  return (
    <section className="page">
      <div className="mb-6 space-y-6">
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
