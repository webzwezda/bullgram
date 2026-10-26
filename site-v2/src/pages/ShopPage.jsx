import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { SUPPORT_TELEGRAM } from '../contacts.js';

const ITEMS_ENDPOINT = '/api/shop/public/items';
const PURCHASE_ENDPOINT = '/api/shop/public/purchase-anon';

// Проверка здоровья считается свежей 6 часов; дальше — «Проверка устарела»
const FRESH_WINDOW_MS = 6 * 60 * 60 * 1000;
const FRESH_HEALTH_STATES = ['online', 'pending_activation'];

function formatCheckedAt(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'Проверен только что';
  if (minutes < 60) return `Проверен ${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `Проверен ${hours} ч назад`;
  return `Проверен ${Math.floor(hours / 24)} дн назад`;
}

function isCheckFresh(iso) {
  if (!iso) return false;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) && ms >= 0 && ms <= FRESH_WINDOW_MS;
}

function formatTon(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function HealthRow({ preview }) {
  if (!preview) return null;
  const healthy = FRESH_HEALTH_STATES.includes(preview.health_status);
  const fresh = isCheckFresh(preview.last_checked_at);
  const checkedAt = formatCheckedAt(preview.last_checked_at);

  if (healthy && fresh) {
    return (
      <div className="flex items-center gap-2 text-xs font-semibold text-feedback-success-text">
        <span className="h-2 w-2 shrink-0 rounded-full bg-feedback-success-text" aria-hidden="true" />
        <span className="tabular-nums">{checkedAt || 'Проверен'}</span>
      </div>
    );
  }
  if (!fresh && checkedAt) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-feedback-warning-bg px-2 py-0.5 text-xs font-bold text-feedback-warning-text">
          Проверка устарела
        </span>
        <span className="text-xs font-medium text-ink-muted tabular-nums">{checkedAt}</span>
      </div>
    );
  }
  return null;
}

function AccountCard({ item, buying, buyError, onBuy }) {
  const price = formatTon(item.price_ton);
  const preview = item.account_preview || null;
  const description = item.preview_text || item.description || '';

  return (
    <article className="relative flex flex-col rounded-2xl border border-border-default bg-surface-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-subtle-strong">
          <UserRound className="h-5 w-5 text-ink-muted" aria-hidden="true" />
        </div>
        <HealthRow preview={preview} />
      </div>

      <h3 className="mt-4 font-mono text-xl font-bold tracking-tight text-ink-strong">
        {preview?.label || item.title}
      </h3>
      {description ? (
        <p className="mt-2 text-pretty text-sm font-medium leading-6 text-ink-body">{description}</p>
      ) : null}

      <div className="mt-5 mb-5">
        <div className="text-3xl font-black tracking-tight text-ink-strong tabular-nums">
          {price}
          <span className="ml-1.5 text-sm font-bold text-ink-muted">TON</span>
        </div>
      </div>

      <div className="mt-auto space-y-2">
        <button
          type="button"
          onClick={() => onBuy(item)}
          disabled={buying}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-action-primary px-5 py-3.5 text-sm font-bold text-action-primary-text shadow-md transition-all hover:bg-action-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {buying ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Создаём счёт…
            </>
          ) : (
            <>Купить за {price} TON</>
          )}
        </button>
        {buyError ? (
          <div className="flex items-start gap-1.5 text-xs text-feedback-error-text">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{buyError}</span>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function EmptyState({ icon: Icon, title, hint }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-border-default bg-surface-subtle p-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-subtle-strong">
        <Icon className="h-6 w-6 text-ink-faint" aria-hidden="true" />
      </div>
      <p className="text-sm font-semibold text-ink-strong">{title}</p>
      <p className="mt-1 text-xs font-medium text-ink-muted">{hint}</p>
    </div>
  );
}

function SectionHeading({ title, subtitle }) {
  return (
    <div className="mb-5">
      <h2 className="text-balance text-xl font-bold tracking-tight text-ink-strong sm:text-2xl">{title}</h2>
      {subtitle ? <p className="mt-1 text-sm font-medium text-ink-muted">{subtitle}</p> : null}
    </div>
  );
}

// Публичная витрина: логин не нужен. Гость покупает анонимно (файлы),
// залогиненный — получает перепривязку аккаунта + скачивание архива.
export function ShopPage() {
  const navigate = useNavigate();
  const { accessToken } = useAuth();
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [buyingId, setBuyingId] = useState('');
  const [buyErrorId, setBuyErrorId] = useState('');
  const [buyError, setBuyError] = useState('');

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest(ITEMS_ENDPOINT);
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      setError(e.message || 'Не удалось загрузить витрину');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const accounts = useMemo(
    () => (items || []).filter((item) => item?.item_type === 'account'),
    [items]
  );

  const buy = useCallback(async (item) => {
    setBuyingId(item.id);
    setBuyErrorId('');
    setBuyError('');
    try {
      const data = await apiRequest(PURCHASE_ENDPOINT, {
        ...(accessToken ? { accessToken } : {}),
        method: 'POST',
        body: { item_id: item.id }
      });
      if (!data?.id) throw new Error('Не получили номер покупки от сервера');
      navigate(`/pay/${data.id}`);
    } catch (e) {
      setBuyErrorId(item.id);
      setBuyError(e.message || 'Не удалось создать счёт. Попробуй ещё раз.');
    } finally {
      setBuyingId('');
    }
  }, [accessToken, navigate]);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-balance text-2xl font-black tracking-tight text-ink-strong sm:text-3xl">
            Магазин аккаунтов
          </h1>
          <p className="mt-2 max-w-xl text-pretty text-sm font-medium leading-6 text-ink-muted">
            Оплата в TON, регистрация не нужна: купил — сразу скачал архив с данными.
            Если войти в свой аккаунт — покупка привяжется к тебе и останется в кабинете.
          </p>
        </div>
        <button
          type="button"
          onClick={loadItems}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-border-default bg-surface-card px-4 py-2.5 text-xs font-bold text-ink-body transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Обновить
        </button>
      </div>

      {loading && !items ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-action-primary" aria-hidden="true" />
          <p className="text-sm font-medium text-ink-muted">Загружаем витрину…</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex items-start gap-1.5 text-sm font-medium text-feedback-error-text">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={loadItems}
            className="inline-flex items-center gap-2 rounded-full bg-action-primary px-5 py-2.5 text-sm font-bold text-action-primary-text transition hover:bg-action-primary-hover"
          >
            <RefreshCw className="h-4 w-4" />
            Попробовать ещё раз
          </button>
        </div>
      ) : (
        <div className="space-y-10">
          <section>
            <SectionHeading
              title="Аккаунты"
              subtitle="Готовые Telegram-аккаунты: проверены на спамблок перед продажей."
            />
            {accounts.length ? (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {accounts.map((item) => (
                  <AccountCard
                    key={item.id}
                    item={item}
                    buying={buyingId === item.id}
                    buyError={buyErrorId === item.id ? buyError : ''}
                    onBuy={buy}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={UserRound}
                title="Аккаунтов пока нет"
                hint="Новые лоты появляются регулярно — загляни позже или нажми «Обновить»."
              />
            )}
          </section>

          {/* Прокси/паки скрыты (ревью P0): анонимная покупка не-аккаунтного
              лота не поддерживается выдачей — вернём разделом, когда появится. */}

          <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs font-medium text-ink-muted">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-feedback-success-text" aria-hidden="true" />
            <span>
              Оплата проходит напрямую через TON. Вопросы —{' '}
              <a
                href={SUPPORT_TELEGRAM}
                target="_blank"
                rel="noreferrer"
                className="font-bold text-action-primary underline decoration-2 underline-offset-2 hover:text-action-primary-hover"
              >
                поддержка в Telegram
              </a>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
