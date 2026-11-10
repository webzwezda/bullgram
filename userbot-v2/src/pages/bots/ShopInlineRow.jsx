import { useState } from 'react';
import { Clock, ExternalLink, Minus, Plus, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

// Компактная витрина магазина в шапке CenterAccountCard (решение владельца
// 2026-11-11, план docs/plans/2026-11-11-userbot-shop-inline-row.md):
// одна строка — лот · цена · [− qty +] · «Купить». Оплата — страница счёта
// /pay/:id (site-v2 PayPage), как на публичной витрине /shop.
export function ShopInlineRow({ lot, lots, openCheckout, createBatchCheckout }) {
  const [quantity, setQuantity] = useState(1);
  const [buying, setBuying] = useState(false);

  const items = Array.isArray(lots) && lots.length ? lots : (lot ? [lot] : []);
  const maxQty = Math.max(items.length, 1);
  const safeQuantity = Math.min(Math.max(quantity, 1), maxQty);
  const selectedItems = items.slice(0, safeQuantity);
  const totalTon = selectedItems.reduce((sum, item) => sum + Number(item?.price_ton || 0), 0);

  async function handleBuy() {
    if (buying || !selectedItems.length) return;
    setBuying(true);
    try {
      const result = safeQuantity > 1
        ? await createBatchCheckout(selectedItems, 'ton')
        : await openCheckout(selectedItems[0], 'ton');
      if (result?.id) {
        window.location.assign(`/pay/${result.id}`);
        return;
      }
      if (result?.error) toast.error(result.error);
    } finally {
      setBuying(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface-card border border-border-default p-2.5 pl-3 shadow-sm">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-action-primary/10" aria-hidden="true">
        <ShoppingCart className="w-4 h-4 text-action-primary" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-ink-strong truncate">{lot?.title}</div>
        <div className="text-xs font-medium text-ink-muted">
          {Number(lot?.price_ton || 0)} TON/шт · Доступно: {items.length} шт.
        </div>
      </div>

      <div className="flex items-center gap-0.5 rounded-xl bg-surface-subtle border border-border-default p-0.5 shrink-0">
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-body transition hover:bg-surface-card disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => setQuantity((prev) => Math.max(Number(prev || 1) - 1, 1))}
          disabled={safeQuantity <= 1}
          aria-label="Уменьшить количество"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className="min-w-6 text-center text-sm font-bold text-ink-strong tabular-nums px-0.5">{safeQuantity}</span>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-body transition hover:bg-surface-card disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => setQuantity((prev) => Math.min(Number(prev || 1) + 1, maxQty))}
          disabled={safeQuantity >= maxQty}
          aria-label="Увеличить количество"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      <Button
        className="h-9 px-4 shrink-0 text-xs font-bold"
        onClick={handleBuy}
        disabled={buying || !selectedItems.length}
      >
        {buying ? 'Счёт…' : `Купить ${totalTon} TON`}
      </Button>
    </div>
  );
}

// Неоплаченные покупки кабинета одной строкой: ссылка на счёт /pay —
// оплата и отмена брони живут там (кнопка «Отменить покупку» на /pay).
export function OpenPurchasesSlimRow({ groups }) {
  if (!Array.isArray(groups) || !groups.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {groups.map((group) => (
        <div
          key={group.id}
          className="flex items-center gap-2 rounded-xl bg-surface-subtle border border-border-default px-3 py-2 text-xs font-medium text-ink-body"
        >
          <Clock className="w-3.5 h-3.5 text-ink-muted shrink-0" aria-hidden="true" />
          <span className="truncate">Покупка на {Number(group.amount_ton || 0)} TON</span>
          {group.status === 'pending' ? (
            <a
              href={`/pay/${group.id}`}
              className="ml-auto shrink-0 inline-flex items-center gap-1 font-bold text-action-primary hover:text-action-primary-hover"
            >
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
              Открыть счёт
            </a>
          ) : (
            <span className="ml-auto shrink-0 text-ink-muted">
              {group.status === 'awaiting_receipt' ? 'Ждёт чек' : 'Оплата есть'}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
