import { useMemo, useState } from 'react';
import {
  Landmark, Wallet, ArrowDownToLine, ShieldCheck, Clock, RefreshCw, Send
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { formatTon, formatWhen, TONE_COLORS } from './treasury.utils.js';

const NETWORK_FEE_TON = 0.05;

const WITHDRAWAL_STATUS = {
  requested: { label: 'Запрошена', tone: 'warning' },
  queued: { label: 'В очереди', tone: 'warning' },
  sending: { label: 'Отправляется', tone: 'warning' },
  sent: { label: 'Отправлена', tone: 'success' },
  confirmed: { label: 'Подтверждена', tone: 'success' },
  failed: { label: 'Ошибка', tone: 'error' },
  cancelled: { label: 'Отменена', tone: 'default' }
};

function StatusBadge({ tone, children }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold tracking-wide ${TONE_COLORS[tone] || TONE_COLORS.default}`}>
      {children}
    </span>
  );
}

function formatTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function TreasuryStatCard({ icon: Icon, iconClasses, title, value, hint, hintClasses = 'text-slate-400' }) {
  return (
    <div className="bg-white rounded-2xl ring-1 ring-slate-200/50 shadow-sm p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconClasses}`}>
          <Icon className="w-5 h-5" />
        </div>
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</span>
      </div>
      <div className="text-2xl font-bold text-slate-900">{formatTon(value)} TON</div>
      <div className={`text-xs mt-1 ${hintClasses}`}>{hint}</div>
    </div>
  );
}

export function TreasuryTab({ data, loading, error, onReload, onSubmitWithdrawal, withdrawing }) {
  const [form, setForm] = useState({ to_wallet: '', amount_ton: '', note: '' });

  const summary = data?.summary || {};
  const buckets = data?.buckets || {};
  const counters = data?.counters || {};
  const withdrawals = data?.withdrawals || [];
  const walletSynced = summary.walletStatus === 'synced';
  const availableTon = Number(summary.availableToWithdrawTon || 0);

  const afterWithdrawalTon = useMemo(() => (
    Math.max(0, availableTon - Number(form.amount_ton || 0) - NETWORK_FEE_TON)
  ), [availableTon, form.amount_ton]);

  const bucketRows = [
    { label: 'Доход сайта', value: buckets.platformRevenueTon },
    { label: 'Тарифы', value: buckets.tierRevenueTon },
    { label: 'Продажи — итого', value: buckets.shopRevenueTon },
    { label: 'Прокси', value: buckets.shopProxyTon },
    { label: 'Юзерботы', value: buckets.shopUserbotTon },
    { label: 'Комплекты (аккаунт+прокси)', value: buckets.shopBundleTon },
    { label: 'Прочие продажи', value: buckets.shopOtherTon },
    { label: 'Комиссия Bullgram', value: buckets.referralFeeTon },
    { label: 'Партнерам', value: buckets.partnerLiabilityTon },
    { label: 'Возвраты', value: buckets.adminReserveLiabilityTon },
    { label: 'Комиссии сети', value: buckets.networkFeeReserveTon },
    { label: 'Ожидают оплаты', value: buckets.pendingPaymentTon },
    { label: 'По учету доступно', value: summary.accountingAvailableTon },
    { label: 'По кошельку доступно', value: summary.walletAvailableTon }
  ];

  async function handleWithdrawalSubmit(event) {
    event.preventDefault();
    const ok = await onSubmitWithdrawal({
      to_wallet: form.to_wallet,
      amount_ton: Number(form.amount_ton || 0),
      note: form.note
    });
    if (ok) {
      setForm((prev) => ({ ...prev, amount_ton: '', note: '' }));
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 rounded-2xl bg-white overflow-hidden">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <Landmark className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                Казна проекта
                <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-0 text-xs rounded-full px-2">
                  {withdrawals.length}
                </Badge>
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Баланс кошелька, резервы и выводы TON. Обновлено: {formatTime(summary.walletCheckedAt)}
              </p>
            </div>
            <Button variant="outline" size="sm" className="text-xs h-9 rounded-xl shrink-0" onClick={onReload} disabled={loading || withdrawing}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Обновляем...' : 'Обновить'}
            </Button>
          </div>
        </div>

        <CardContent className="p-5 sm:p-6 space-y-4">
          {error ? (
            <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800 shadow-sm">
              {error}
            </div>
          ) : null}

          {loading && !data ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                <Landmark className="w-8 h-8 text-slate-300" />
              </div>
              <p className="text-sm text-slate-500">Считаем деньги проекта...</p>
            </div>
          ) : (
            <>
              <div className="grid grid--flush grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <TreasuryStatCard
                  icon={Wallet}
                  iconClasses="bg-indigo-100 text-indigo-600"
                  title="На кошельке"
                  value={summary.walletBalanceTon}
                  hint={walletSynced ? 'Реальный TON-баланс.' : 'Баланс недоступен.'}
                  hintClasses={walletSynced ? 'text-slate-400' : 'text-amber-600 font-medium'}
                />
                <TreasuryStatCard
                  icon={ArrowDownToLine}
                  iconClasses="bg-emerald-100 text-emerald-600"
                  title="Можно вывести"
                  value={summary.availableToWithdrawTon}
                  hint="Лимит по кошельку и учету."
                />
                <TreasuryStatCard
                  icon={ShieldCheck}
                  iconClasses="bg-amber-100 text-amber-600"
                  title="В резерве"
                  value={summary.protectedLiabilityTon}
                  hint="Партнеры, возвраты, комиссии."
                />
                <TreasuryStatCard
                  icon={Clock}
                  iconClasses="bg-slate-100 text-slate-500"
                  title="Заявки"
                  value={summary.pendingWithdrawalsTon}
                  hint="Ожидают закрытия."
                />
              </div>

              <div className="grid grid--flush grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-2xl ring-1 ring-slate-200/60 bg-white shadow-sm p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-slate-900">Деньги</h3>
                    <span className="text-xs text-slate-400">
                      Продавцов: {counters.adminOwners || 0} • Оплачено: {counters.paidShopPurchases || 0} • В ожидании: {counters.pendingShopPurchases || 0} • Тарифов: {counters.paidTierOrders || 0}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {bucketRows.map((row) => (
                      <div key={row.label} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50/50 transition-colors">
                        <span className="text-sm text-slate-600">{row.label}</span>
                        <span className="text-sm font-bold text-slate-900">{formatTon(row.value)} TON</span>
                      </div>
                    ))}
                  </div>
                </div>

                <form className="rounded-2xl ring-1 ring-slate-200/60 bg-white shadow-sm p-5" onSubmit={handleWithdrawalSubmit}>
                  <h3 className="font-bold text-slate-900 mb-4">Вывод</h3>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="treasury-wallet" className="text-sm font-medium text-slate-700 mb-1.5 block">
                        TON-кошелек
                      </label>
                      <Input
                        id="treasury-wallet"
                        className="h-11 rounded-xl bg-white border-slate-200 text-sm shadow-sm font-mono"
                        placeholder="UQ... или 0:..."
                        value={form.to_wallet}
                        onChange={(e) => setForm((prev) => ({ ...prev, to_wallet: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label htmlFor="treasury-amount" className="text-sm font-medium text-slate-700 mb-1.5 block">
                        Сумма
                      </label>
                      <Input
                        id="treasury-amount"
                        type="number"
                        min="0"
                        step="0.000001"
                        className="h-11 rounded-xl bg-white border-slate-200 text-sm shadow-sm"
                        placeholder="0"
                        value={form.amount_ton}
                        onChange={(e) => setForm((prev) => ({ ...prev, amount_ton: e.target.value }))}
                        aria-describedby="treasury-fee-hint"
                      />
                      <p id="treasury-fee-hint" className="text-xs text-slate-400 mt-1.5">
                        Комиссия сети: {formatTon(NETWORK_FEE_TON)} TON · Останется: {formatTon(afterWithdrawalTon)} TON
                      </p>
                    </div>
                    <div>
                      <label htmlFor="treasury-note" className="text-sm font-medium text-slate-700 mb-1.5 block">
                        Заметка
                      </label>
                      <Textarea
                        id="treasury-note"
                        className="rounded-xl bg-white border-slate-200 text-sm shadow-sm min-h-[80px]"
                        placeholder="Заметка"
                        rows={3}
                        value={form.note}
                        onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
                      disabled={withdrawing || availableTon <= 0 || !walletSynced}
                    >
                      <Send className="w-4 h-4 mr-1.5" />
                      {withdrawing ? 'Создаем...' : 'Запросить вывод'}
                    </Button>
                  </div>
                </form>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 rounded-2xl bg-white overflow-hidden">
        <CardContent className="p-5 sm:p-6 space-y-3">
          <h3 className="font-bold text-slate-900">Последние заявки на вывод</h3>
          {withdrawals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                <ArrowDownToLine className="w-8 h-8 text-slate-300" />
              </div>
              <p className="text-sm text-slate-500">Заявок на вывод пока нет.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {withdrawals.map((row) => {
                const status = WITHDRAWAL_STATUS[row.status] || { label: 'Запрошена', tone: 'warning' };
                return (
                  <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:bg-slate-50/50 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900 text-sm">{formatTon(row.amount_ton)} TON</span>
                        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                      </div>
                      <div className="text-xs text-slate-500 mt-1 font-mono truncate">{row.to_wallet}</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {formatWhen(row.requested_at)}
                        {row.chain_tx_hash ? ` • Tx: ${row.chain_tx_hash}` : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
