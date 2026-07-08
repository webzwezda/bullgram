import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { TariffsSection } from '../payment-settings/TariffsSection.jsx';
import { useBotTariffs } from './useBotTariffs.js';
import { useTariffsController } from '../payment-settings/useTariffsController.js';
import { DEFAULT_NEW_TARIFF } from '../payment-settings/payment-settings.constants.js';

export function BotTariffsSection({ selectedBot, ownerId, channels }) {
  const { tariffs, bundleItems, bundleSupport, loading } = useBotTariffs({
    ownerId,
    botId: selectedBot?.id
  });

  const {
    createTariff,
    deleteTariff,
    getTariffBundleItems,
    newTariff,
    setNewTariff
  } = useTariffsController({
    bundleItems,
    bundleSupport,
    tariffs,
    userId: ownerId
  });

  useEffect(() => {
    if (!selectedBot?.id) return;
    setNewTariff({ ...DEFAULT_NEW_TARIFF, bot_id: String(selectedBot.id) });
  }, [selectedBot?.id, setNewTariff]);

  if (loading) {
    return (
      <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="p-10 flex items-center justify-center gap-3 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm font-medium">Тянем тарифы бота...</span>
        </div>
      </Card>
    );
  }

  return (
    <TariffsSection
      bundleSupport={bundleSupport}
      channels={channels}
      createTariff={createTariff}
      deleteTariff={deleteTariff}
      getTariffBundleItems={getTariffBundleItems}
      newTariff={newTariff}
      officialBots={[selectedBot]}
      setNewTariff={setNewTariff}
      tariffs={tariffs}
    />
  );
}
