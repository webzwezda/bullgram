import { UserPlus } from 'lucide-react';
import { Card } from '@/components/ui/card';

// Стартовый экран новичка: два пути друг над другом, плоскими полосами между
// волосяными чертами (DESIGN.md §Flat Action Strip). Без заголовков и плиток.
export function WelcomeCard({ shopInlineSlot, onConnect }) {
  return (
    <Card className="p-0 gap-0">
      <div className="border-b border-border-default px-5 sm:px-6 py-3">
        {shopInlineSlot || (
          <p className="text-sm font-medium text-ink-muted">Свободных лотов сейчас нет.</p>
        )}
      </div>

      <div className="px-5 sm:px-6 py-3">
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
