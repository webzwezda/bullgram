import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Bot, Plus } from 'lucide-react';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { fetchBots } from './autopost/api.js';

// Хаб «Ботов» (план 2026-09-27-bots-app-split, Фаза 3). Данные —
// GET /api/autopost/bots (autopost/api.js). Диалект — дашборд «Юзербота»:
// карточка-кнопка кликабельна целым пятном (stat-card-bg + ring), чип-иконка,
// uppercase-лейбл в шапке, крупное значение, подсказка под значением, тонкая
// иконка-стрелка в углу. Hover-эффектов нет (решение владельца), короткие
// подписи без объясняющей прозы, обращение на «ты». Цвета — semantic-токены
// (ink/surface/border/action/feedback), сырые шаги палитры не используем.

function CardShell({ to, children }) {
  const className = 'stat-card-bg block rounded-2xl ring-1 ring-border-default/50 shadow-sm p-5';
  if (!to) {
    return <div className={className}>{children}</div>;
  }
  return <Link to={to} className={className}>{children}</Link>;
}

// Карточка подключённого бота-автопостера. Числа каналов в ответе
// GET /bots нет — показываем username и статус (активен / на паузе).
function BotCard({ username, paused }) {
  return (
    <CardShell to="/autopost">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-action-primary/10 text-action-primary flex items-center justify-center shrink-0">
          <Bot className="w-5 h-5" />
        </div>
        <span className="text-xs font-semibold text-ink-muted uppercase tracking-wide">Автопостер</span>
        <ArrowUpRight className="ml-auto w-4 h-4 text-ink-faint" />
      </div>
      <div className="text-2xl font-bold mt-3 text-ink-strong truncate">@{username || 'бот'}</div>
      <div className={`text-xs mt-1 font-medium ${paused ? 'text-feedback-warning-text' : 'text-feedback-success-text'}`}>
        {paused ? 'На паузе' : 'Активен'}
      </div>
    </CardShell>
  );
}

// CTA онбординга: ведёт на тот же экран управления — там подключение по токену.
function ConnectCard() {
  return (
    <CardShell to="/autopost">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-action-primary/10 text-action-primary flex items-center justify-center shrink-0">
          <Plus className="w-5 h-5" />
        </div>
        <span className="text-xs font-semibold text-ink-muted uppercase tracking-wide">Новый бот</span>
        <ArrowUpRight className="ml-auto w-4 h-4 text-ink-faint" />
      </div>
      <div className="text-2xl font-bold mt-3 text-ink-strong">Подключить бота</div>
      <div className="text-xs mt-1 text-ink-muted">Токен из @BotFather</div>
    </CardShell>
  );
}

// Плейсхолдер следующего модуля хаба — не кликабелен, без стрелки.
function SoonCard() {
  return (
    <CardShell>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-surface-subtle-strong text-ink-muted flex items-center justify-center shrink-0">
          <Bot className="w-5 h-5" />
        </div>
        <span className="text-xs font-semibold text-ink-muted uppercase tracking-wide">Скоро</span>
      </div>
      <div className="text-2xl font-bold mt-3 text-ink-muted">Следующий мелкий бот</div>
    </CardShell>
  );
}

export default function HubPage() {
  const { accessToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bots, setBots] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!accessToken) return;
      try {
        const data = await fetchBots(accessToken);
        if (!cancelled) setBots(Array.isArray(data?.bots) ? data.bots : []);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Не удалось загрузить ботов.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [accessToken]);

  if (loading) {
    return <LoadingState text="Собираем твоих ботов..." />;
  }

  if (error) {
    return (
      <section className="page page--flush">
        <h1 className="sr-only">Боты</h1>
        <div className="section">
          <div className="error-card">{error}</div>
        </div>
      </section>
    );
  }

  return (
    <section className="page page--flush">
      <h1 className="sr-only">Боты</h1>
      <div className="section">
        <div className="grid grid--flush grid-cols-1 sm:grid-cols-2 gap-4">
          {bots.map((bot) => (
            <BotCard key={bot.id} username={bot.username} paused={bot.is_active === false} />
          ))}
          <ConnectCard />
          <SoonCard />
        </div>
      </div>
    </section>
  );
}
