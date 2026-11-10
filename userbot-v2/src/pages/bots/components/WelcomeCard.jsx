import { UserPlus } from 'lucide-react';
import { Card } from '@/components/ui/card';

// Стартовый экран новичка: строка магазина + кнопка подключения. Без текстов —
// решение владельца 2026-11-11 («простая строка и кнопка»).
export function WelcomeCard({ shopInlineSlot, onConnect }) {
  return (
    <Card className="p-0 gap-0">
      <div className="p-5 sm:p-6 space-y-4">
        {shopInlineSlot || (
          <p className="text-sm font-medium text-ink-muted">Свободных лотов в магазине сейчас нет.</p>
        )}
        <button
          type="button"
          onClick={onConnect}
          className="h-11 px-5 inline-flex items-center gap-2 rounded-xl bg-action-primary text-action-primary-text! text-sm font-bold hover:bg-action-primary-hover transition-all shadow-sm"
        >
          <UserPlus className="w-4 h-4" />
          Подключить аккаунт
        </button>
      </div>
    </Card>
  );
}
