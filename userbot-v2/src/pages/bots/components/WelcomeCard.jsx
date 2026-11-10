import { ShoppingCart, UserPlus } from 'lucide-react';
import { Card } from '@/components/ui/card';

// Стартовый экран новичка: два пути рядом (DESIGN.md §Gradient Section Icons
// — плитка якорит путь). Текста — один короткий ярлык на путь.
export function WelcomeCard({ shopInlineSlot, onConnect }) {
  return (
    <Card className="p-0 gap-0">
      <div className="grid gap-4 p-5 sm:grid-cols-2 sm:items-stretch sm:p-6">
        {/* Путь 1 — быстрая покупка (TON-контур: sky) */}
        <div className="flex flex-col gap-3 rounded-2xl border border-border-default bg-surface-subtle p-4">
          <div className="flex items-center gap-3">
            <div className={/* ds-allow-hardcode: градиент-плитка — DESIGN.md §Gradient Section Icons, сознательно не токенизирован */ "w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-sky-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/20 shrink-0"}>
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div className="text-sm font-bold text-ink-strong">Купить готовый</div>
          </div>
          {shopInlineSlot || (
            <p className="text-sm font-medium text-ink-muted">Свободных лотов сейчас нет.</p>
          )}
        </div>

        {/* Путь 2 — подключить свой (продуктовый контур: indigo) */}
        <div className="flex flex-col gap-3 rounded-2xl border border-border-default bg-surface-subtle p-4">
          <div className="flex items-center gap-3">
            <div className={/* ds-allow-hardcode: градиент-плитка — DESIGN.md §Gradient Section Icons, сознательно не токенизирован */ "w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 shrink-0"}>
              <UserPlus className="w-5 h-5" />
            </div>
            <div className="text-sm font-bold text-ink-strong">Подключить свой</div>
          </div>
          <button
            type="button"
            onClick={onConnect}
            className="h-11 px-5 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-action-primary text-action-primary-text! text-sm font-bold hover:bg-action-primary-hover transition-all shadow-sm"
          >
            <UserPlus className="w-4 h-4" />
            Подключить аккаунт
          </button>
        </div>
      </div>
    </Card>
  );
}
