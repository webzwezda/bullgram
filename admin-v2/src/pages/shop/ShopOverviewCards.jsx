import { Package, ShoppingCart, FileCheck, Wallet } from 'lucide-react';

const CARDS = [
  { key: 'published', icon: Package, color: 'indigo', label: 'На витрине', getValue: (d) => d.itemSummary.published, getSub: () => 'Опубликованные товары' },
  { key: 'orders', icon: ShoppingCart, color: 'slate', label: 'Заказов', getValue: (d) => d.purchaseSummary.total, getSub: () => 'Всего за текущий период' },
  { key: 'receipt', icon: FileCheck, color: 'amber', label: 'К подтверждению', getValue: (d) => d.purchaseSummary.awaiting_receipt, getSub: () => 'Оплаты ждут решения' },
  { key: 'earned', icon: Wallet, color: 'emerald', label: 'Получено', getValue: (d) => `${d.sellerStats.paidTon} TON`, getSub: (d) => `${d.purchaseSummary.paid} оплат` }
];

const COLOR_MAP = {
  indigo: { bg: 'bg-indigo-100', icon: 'text-indigo-600', shadow: 'shadow-indigo-500/10' },
  slate: { bg: 'bg-slate-100', icon: 'text-slate-600', shadow: 'shadow-slate-500/10' },
  amber: { bg: 'bg-amber-100', icon: 'text-amber-600', shadow: 'shadow-amber-500/10' },
  emerald: { bg: 'bg-emerald-100', icon: 'text-emerald-600', shadow: 'shadow-emerald-500/10' }
};

export function ShopOverviewCards({ data }) {
  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      {CARDS.map((card) => {
        const Icon = card.icon;
        const colors = COLOR_MAP[card.color];
        const value = card.getValue(data);
        const sub = card.getSub(data);
        return (
          <div key={card.key} className={`bg-white rounded-2xl ring-1 ring-slate-200/50 shadow-sm p-5`}>
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-10 h-10 rounded-xl ${colors.bg} flex items-center justify-center`}>
                <Icon className={`w-5 h-5 ${colors.icon}`} />
              </div>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{card.label}</span>
            </div>
            <div className="text-2xl font-bold text-slate-900">{value}</div>
            <div className="text-xs text-slate-400 mt-1">{sub}</div>
          </div>
        );
      })}
    </div>
  );
}
