import { ShoppingCart, UserPlus } from 'lucide-react';
import { Card } from '@/components/ui/card';

// Стартовый экран новичка на /userbot (решение владельца 2026-11-11): вместо
// технической ошибки «Подключите юзербота» — выбор из двух путей: быстрая
// покупка готового аккаунта (строка магазина, оплата на /pay) или подключение
// своего через онбординг (UserbotConnectPanel).
export function WelcomeCard({ shopInlineSlot, onConnect }) {
  return (
    <Card className="p-0 gap-0">
      <div className="p-5 sm:p-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-ink-strong">Подключите первого юзербота</h2>
          <p className="mt-1 text-sm font-medium text-ink-muted">
            Два способа начать: купить готовый аккаунт или подключить свой Telegram.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-ink-muted">
            <ShoppingCart className="w-3.5 h-3.5 text-action-ton" aria-hidden="true" />
            Способ 1 — Быстрая покупка
          </div>
          <p className="text-sm font-medium text-ink-body">
            Готовый аккаунт с прокси: оплатил — аккаунт появился в кабинете.
          </p>
          {shopInlineSlot || (
            <p className="text-sm font-medium text-ink-muted">Свободных лотов в магазине сейчас нет.</p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-ink-muted">
            <UserPlus className="w-3.5 h-3.5 text-action-primary" aria-hidden="true" />
            Способ 2 — Подключить свой
          </div>
          <p className="text-sm font-medium text-ink-body">
            Живой онбординг: прокси → QR-логин или импорт .session/.json → авторизация.
          </p>
          <button
            type="button"
            onClick={onConnect}
            className="h-11 px-5 inline-flex items-center gap-2 rounded-xl bg-action-primary text-action-primary-text! text-sm font-bold hover:bg-action-primary-hover transition-all shadow-sm"
          >
            <UserPlus className="w-4 h-4" />
            Подключить аккаунт
          </button>
        </div>
      </div>
    </Card>
  );
}
