import { Bot, Trash2, ExternalLink, Loader2, KeyRound, AlertTriangle, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { UserbotsSection } from './SalesPlaces.jsx';
import { SalesContourBlock } from './SalesContour.jsx';

function botTitle(account) {
  return `@${account?.tg_username || `bot-${String(account?.tg_account_id || account?.id || '')}`}`;
}

function normalizeWebhookMode(value) {
  return String(value || 'polling').trim().toLowerCase() === 'webhook' ? 'webhook' : 'polling';
}

function webhookConnectionError(account) {
  const mode = normalizeWebhookMode(account?.webhook_mode);
  const status = String(account?.webhook_status || '').trim().toLowerCase();
  if (mode === 'webhook' && (status === 'error' || account?.runtime_error)) {
    return {
      title: 'Ошибка подключения',
      text: account?.runtime_error || 'Telegram не смог подключить бота.'
    };
  }
  return null;
}

function ConnectBotForm({ botForm, setBotForm, state, addOfficialBot }) {
  return (
    <div className="flex flex-col sm:flex-row items-end gap-4 max-w-4xl">
      <div className="flex-1 w-full">
        <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">Токен бота</label>
        <Input
          value={botForm.botToken}
          onChange={(e) => setBotForm((prev) => ({ ...prev, botToken: e.target.value }))}
          placeholder="8123456789:AAE_x7v9Kq2Lm..."
          spellCheck="false"
          className="font-mono bg-white h-11 rounded-xl border-slate-200 shadow-sm focus-visible:ring-indigo-500"
        />
      </div>

      <div className="flex gap-3 w-full sm:w-auto">
        <Button
          onClick={addOfficialBot}
          disabled={state.savingBot || !botForm.botToken.trim()}
          className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200 w-full sm:w-auto font-bold"
        >
          {state.savingBot ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          {state.savingBot ? 'Подключение...' : 'Подключить'}
        </Button>
        <Button variant="outline" asChild className="h-11 rounded-xl w-full sm:w-auto text-slate-700 border-slate-200 shadow-sm">
          <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="flex items-center gap-2 font-bold">
            @BotFather <ExternalLink className="w-4 h-4" />
          </a>
        </Button>
      </div>
    </div>
  );
}

function ReplaceTokenForm({ account, value, setValue, state, replaceOfficialBotToken, onClose }) {
  const saving = state?.replacingTokenId === String(account?.id || '');

  async function saveToken() {
    const ok = await replaceOfficialBotToken?.(account, value);
    if (ok) {
      setValue('');
      onClose();
    }
  }

  return (
    <div className="p-5 sm:p-6 bg-surface-card border-b border-border-default">
      <div className="max-w-2xl space-y-3">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-ink-muted block">
            Новый токен для {botTitle(account)}
          </label>
          <p className="text-sm font-medium text-ink-muted">
            Выпусти новый токен в BotFather: /mybots → API Token → Revoke current token. Вставь сюда — контур, права, каналы и тарифы останутся на месте.
          </p>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="8123456789:AAE_x7v9Kq2Lm..."
            spellCheck="false"
            className="font-mono bg-surface-card h-11 rounded-xl border-border-default shadow-sm"
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            onClick={saveToken}
            disabled={saving || !value.trim()}
            className="h-11 px-6 rounded-xl bg-action-primary hover:bg-action-primary-hover !text-action-primary-text shadow-sm w-full sm:w-auto font-bold"
          >
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {saving ? 'Сохранение...' : 'Сохранить токен'}
          </Button>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={saving}
            className="h-11 px-5 rounded-xl text-ink-body border-border-default bg-surface-card hover:bg-surface-subtle shadow-sm w-full sm:w-auto font-bold"
          >
            Отмена
          </Button>
        </div>
      </div>
    </div>
  );
}

function BotConfigSection({
  selectedOfficialBot,
  selectedOfficialBotId,
  setSelectedOfficialBotId,
  officialBots,
  botForm,
  setBotForm,
  addOfficialBot,
  replaceOfficialBotToken,
  deleteOfficialBot,
  state,
  salesContourSectionProps,
  channelsByBotId,
  deleteTelegramPlace,
  refreshTelegramPlaceInfo,
  refreshingTelegramPlaceId
}) {
  const isNew = selectedOfficialBotId === 'new';

  // Панель замены токена — одна на карточку, закрывается и чистится при смене бота.
  const [replaceTokenOpen, setReplaceTokenOpen] = useState(false);
  const [replaceTokenValue, setReplaceTokenValue] = useState('');

  useEffect(() => {
    setReplaceTokenOpen(false);
    setReplaceTokenValue('');
  }, [selectedOfficialBotId]);

  const contourDraftWithProps = salesContourSectionProps?.draft
    ? { ...salesContourSectionProps.draft, _props: salesContourSectionProps }
    : null;

  const selectedBotId = String(selectedOfficialBot?.id || '');
  const targets = channelsByBotId?.[selectedBotId] || [];

  return (
    <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
      <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                {isNew ? 'Подключение бота' : 'Бот продаж'}
              </h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">
                {isNew
                  ? 'Получите токен у @BotFather и вставьте сюда.'
                  : 'Тарифы, площадки и уведомления о продажах.'}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-2">
            <Select value={selectedOfficialBotId || 'new'} onValueChange={setSelectedOfficialBotId}>
              <SelectTrigger className="h-10 w-[220px] bg-white rounded-xl border-slate-200 shadow-sm text-sm font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="new" className="rounded-lg">➕ Новый бот</SelectItem>
                {officialBots.map((account) => (
                  <SelectItem key={account.id} value={account.id} className="rounded-lg py-2.5">
                    <span className="font-medium text-slate-900">{botTitle(account)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {!isNew && selectedOfficialBot ? (
              <Button
                variant="ghost"
                onClick={() => setReplaceTokenOpen((open) => !open)}
                aria-expanded={replaceTokenOpen}
                className="h-10 px-3 rounded-xl text-ink-body hover:bg-surface-subtle hover:text-ink-strong font-bold border border-border-default shadow-sm"
              >
                <KeyRound className="w-4 h-4 mr-1.5" />
                <span className="text-sm">Заменить токен</span>
              </Button>
            ) : null}

            {!isNew && selectedOfficialBot ? (
              <Button
                variant="ghost"
                onClick={() => deleteOfficialBot?.(selectedOfficialBot)}
                disabled={state?.deletingBotId === selectedOfficialBot.id}
                title="Удалить бота"
                className="h-10 px-3 rounded-xl text-rose-600 hover:bg-rose-50 hover:text-rose-700 font-bold border border-rose-100 shadow-sm"
              >
                {state?.deletingBotId === selectedOfficialBot.id ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4 mr-1.5" />
                )}
                <span className="text-sm">Удалить</span>
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {!isNew && selectedOfficialBot && replaceTokenOpen ? (
        <ReplaceTokenForm
          account={selectedOfficialBot}
          value={replaceTokenValue}
          setValue={setReplaceTokenValue}
          state={state}
          replaceOfficialBotToken={replaceOfficialBotToken}
          onClose={() => {
            setReplaceTokenOpen(false);
            setReplaceTokenValue('');
          }}
        />
      ) : null}

      {isNew ? (
        <div className="p-5 sm:p-6 bg-white">
          <ConnectBotForm
            botForm={botForm}
            setBotForm={setBotForm}
            state={state}
            addOfficialBot={addOfficialBot}
          />
        </div>
      ) : (
        <>
          {salesContourSectionProps?.isVisible ? (
            <div className="border-t border-slate-100 bg-slate-50/50">
              <UserbotsSection
                salesContourSectionProps={salesContourSectionProps}
              />
              <SalesContourBlock
                draft={contourDraftWithProps || {}}
                setFieldValue={salesContourSectionProps?.setFieldValue}
                savingContour={salesContourSectionProps?.savingContour}
                botRightsByTarget={salesContourSectionProps?.botRightsByTarget}
                contourError={salesContourSectionProps?.contourError}
                ensureAdminRights={salesContourSectionProps?.ensureAdminRights}
                ensureAdminPending={salesContourSectionProps?.ensureAdminPending}
                refreshContourInfo={salesContourSectionProps?.refreshContourInfo}
                contourInfoPending={salesContourSectionProps?.contourInfoPending}
                targets={targets}
                deleteTelegramPlace={deleteTelegramPlace}
              />
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

function BotRuntimeSection({
  selectedOfficialBot,
  refreshOfficialBotWebhookStatus,
  reregisterWebhook,
  state
}) {
  if (!selectedOfficialBot) return null;

  const accountId = String(selectedOfficialBot.id || '');
  const isBusy = state.webhookRuntimeActionId === accountId;
  const errorMeta = webhookConnectionError(selectedOfficialBot);
  if (!errorMeta) return null;

  return (
    <Card className="border-0 shadow-sm ring-1 ring-rose-200/50 bg-rose-50 rounded-2xl overflow-hidden mb-6">
      <div className="p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-rose-500" />
            </div>
            <div>
              <div className="text-base font-bold text-rose-900">{errorMeta.title}</div>
              <div className="text-sm font-medium text-rose-700 mt-0.5">{errorMeta.text}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              className="h-11 rounded-xl font-bold shadow-sm w-full sm:w-auto border-rose-200 text-rose-700 bg-white hover:bg-rose-100 hover:text-rose-800"
              onClick={() => refreshOfficialBotWebhookStatus(selectedOfficialBot)}
              disabled={isBusy}
            >
              {isBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Проверить webhook
            </Button>
            <Button
              className="h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-sm shadow-indigo-200 w-full sm:w-auto"
              onClick={() => reregisterWebhook?.(selectedOfficialBot)}
              disabled={isBusy || !reregisterWebhook}
            >
              {isBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Переподключить webhook
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export { BotConfigSection, BotRuntimeSection };
