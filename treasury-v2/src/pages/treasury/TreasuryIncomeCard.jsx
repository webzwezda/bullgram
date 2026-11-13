import { TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatTon, formatWhen } from './treasury.utils.js';
import { StatusBadge } from './StatusBadge.jsx';

// Лента «Последние поступления»: оплаченные лоты платформы и тарифы Pro —
// ответ на вопрос владельца «деньги пришли?» без сверки с блокчейном.
export function TreasuryIncomeCard({ rows = [] }) {
  return (
    <Card className="border-0 shadow-lg shadow-border-default/40 ring-1 ring-border-default/50 rounded-2xl bg-surface-card overflow-hidden">
      <CardContent className="p-5 sm:p-6 space-y-3">
        <div>
          <h3 className="font-bold text-ink-strong">Последние поступления</h3>
          <p className="text-xs text-ink-muted mt-0.5">
            Оплаченные лоты платформы и тарифы Pro — то, чем пополняется казна.
          </p>
        </div>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 bg-surface-subtle-strong rounded-full flex items-center justify-center mb-4">
              <TrendingUp className="w-8 h-8 text-ink-faint" />
            </div>
            <p className="text-sm text-ink-muted">Пока пусто — появятся после первой оплаты.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((row, index) => (
              <div key={`${row.source}-${row.when}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-border-default bg-surface-card px-4 py-3 hover:bg-surface-subtle transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-ink-strong truncate">{row.title}</span>
                    <StatusBadge tone={row.source === 'tier' ? 'default' : 'success'}>
                      {row.source === 'tier' ? 'Тариф' : 'Магазин'}
                    </StatusBadge>
                  </div>
                  <div className="text-xs text-ink-muted mt-0.5">
                    {formatWhen(row.when)}
                    {row.memo ? ` • Мемо: ${row.memo}` : ''}
                  </div>
                </div>
                <span className="text-sm font-bold text-feedback-success-text tabular-nums whitespace-nowrap">
                  +{formatTon(row.amount_ton)} TON
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
