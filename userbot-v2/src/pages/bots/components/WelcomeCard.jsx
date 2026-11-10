import { ChevronRight, UserPlus } from 'lucide-react';
import { Card } from '@/components/ui/card';

// Стартовый экран новичка (sketch 2026-11-11, направление «Кнопка-полоса» с
// надписью из «Покупка в фокусе»): строка покупки + полоса-кнопка подключения
// на всю ширину. Без заголовков — решение владельца.
export function WelcomeCard({ shopInlineSlot, onConnect }) {
  return (
    <Card className="p-0 gap-0 overflow-hidden">
      <div className="border-b border-border-default px-5 sm:px-6 py-3">
        {shopInlineSlot || (
          <p className="text-sm font-medium text-ink-muted">Свободных лотов сейчас нет.</p>
        )}
      </div>

      <button
        type="button"
        onClick={onConnect}
        className="w-full flex items-center gap-2.5 px-5 sm:px-6 py-3.5 text-left bg-transparent hover:bg-surface-subtle transition-colors text-sm font-bold text-ink-body"
      >
        <UserPlus className="w-4 h-4 shrink-0 text-action-primary" aria-hidden="true" />
        Или подключить свой Telegram
        <ChevronRight className="w-4 h-4 ml-auto shrink-0 text-ink-muted" aria-hidden="true" />
      </button>
    </Card>
  );
}
