import { useState } from 'react';
import { Plus, CheckSquare } from 'lucide-react';
import { Button } from '../components/ui/button.jsx';
import { Card } from '../components/ui/card.jsx';
import { BotRegisterForm } from './checklist/BotRegisterForm.jsx';
import { BotDetail } from './checklist/BotDetail.jsx';
import { BotList } from './checklist/BotList.jsx';

/**
 * /app/checklist — главный экран семейных чеклистов.
 *
 * Три режима:
 *   - list (default): список ботов семьи + CTA "добавить бота"
 *   - register: форма создания нового бота
 *   - detail: детали конкретного бота
 *
 * Состояние управляется локально, BotList сам подтягивает ботов.
 */
export function ChecklistPage({ accessToken }) {
  const [view, setView] = useState({ mode: 'list' });

  if (view.mode === 'detail') {
    return (
      <BotDetail
        accessToken={accessToken}
        botId={view.botId}
        onBack={() => setView({ mode: 'list' })}
        onDeleted={() => setView({ mode: 'list' })}
      />
    );
  }

  if (view.mode === 'register') {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-2xl font-black text-slate-900">Новый бот</h1>
          <Button variant="ghost" onClick={() => setView({ mode: 'list' })}>← Назад</Button>
        </div>
        <BotRegisterForm
          accessToken={accessToken}
          onCreated={(bot) => setView({ mode: 'detail', botId: bot.id })}
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <CheckSquare className="w-6 h-6 text-blue-600" />
            Семейные чеклисты
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Создавай списки покупок, дел и покупок прямо в семейной группе Telegram.
            Каждый член семьи может отмечать пункты галочками.
          </p>
        </div>
        <Button onClick={() => setView({ mode: 'register' })}>
          <Plus className="w-4 h-4" />
          Создать бота
        </Button>
      </div>

      <BotList
        accessToken={accessToken}
        onOpen={(botId) => setView({ mode: 'detail', botId })}
        onCreate={() => setView({ mode: 'register' })}
      />
    </div>
  );
}
