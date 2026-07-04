import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bell, Check, Copy, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { apiRequest } from '../../api/client.js';
import { Button } from '../../components/ui/button.jsx';
import { Input } from '../../components/ui/input.jsx';

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function maskToken(value) {
  return value || 'token еще не выпускался';
}

function InlineCopy({ value, prefix = '' }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    if (!value) return;
    navigator.clipboard.writeText(`${prefix}${value}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  return (
    <button
      type="button"
      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
      onClick={handleCopy}
      title="Копировать"
    >
      {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

export function BillingWebhookSection({ accessToken, plain = false }) {
  const [state, setState] = useState({
    loading: true,
    saving: false,
    error: '',
    settings: null,
    webhookUrl: '',
    token: ''
  });

  async function loadSettings({ silent = false } = {}) {
    if (!accessToken) return;
    if (!silent) setState((prev) => ({ ...prev, loading: !prev.settings, error: '' }));
    try {
      const data = await apiRequest('/api/p2p-bank-events/settings', { accessToken });
      setState((prev) => ({
        ...prev,
        loading: false,
        error: '',
        settings: data.settings || {},
        webhookUrl: data.webhook_url || ''
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  useEffect(() => {
    loadSettings();
  }, [accessToken]);

  const setupReady = useMemo(() => Boolean(state.settings?.token_hint && state.settings?.enabled), [state.settings]);

  async function generateToken() {
    setState((prev) => ({ ...prev, saving: true, error: '', token: '' }));
    try {
      const data = await apiRequest('/api/p2p-bank-events/token', {
        accessToken,
        method: 'POST',
        body: { auto_confirm_enabled: state.settings?.auto_confirm_enabled !== false }
      });
      setState((prev) => ({
        ...prev,
        saving: false,
        token: data.token || '',
        settings: data.settings || prev.settings,
        webhookUrl: data.webhook_url || prev.webhookUrl
      }));
      toast.success('Token выпущен. Скопируй Bearer header в SMS/Push Forward.');
    } catch (error) {
      setState((prev) => ({ ...prev, saving: false, error: error.message }));
      toast.error(error.message);
    }
  }

  async function saveSettings(patch) {
    const nextSettings = { ...(state.settings || {}), ...patch };
    setState((prev) => ({ ...prev, saving: true, error: '', settings: nextSettings }));
    try {
      const data = await apiRequest('/api/p2p-bank-events/settings', {
        accessToken,
        method: 'POST',
        body: nextSettings
      });
      setState((prev) => ({ ...prev, saving: false, settings: data.settings || nextSettings }));
      toast.success('Настройки кассы сохранены.');
    } catch (error) {
      setState((prev) => ({ ...prev, saving: false, error: error.message }));
      toast.error(error.message);
    }
  }

  if (state.loading) {
    return (
      <div className={plain ? "py-10 text-center text-sm font-semibold text-slate-500" : "bg-white border border-slate-200/60 rounded-3xl p-10 text-center text-sm font-semibold text-slate-500"}>
        Загружаем подключение кассы...
      </div>
    );
  }

  return (
    <div className={plain ? "space-y-6" : "bg-white border border-slate-200/60 rounded-3xl p-6 md:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-6"}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 shrink-0">
          <Bell className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900">Банковские уведомления</h3>
          <p className="text-sm text-slate-500 mt-1">
            Подключи SMS/Push Forward. Bullgram сам закроет очевидное совпадение, а спорные оплат отправит в «Сверку оплат».
          </p>
        </div>
      </div>

      {state.error ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {state.error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1.5 md:col-span-2">
          <span className="text-xs font-semibold text-slate-500">Ссылка для SMS/Push Forward</span>
          <div className="relative">
            <Input className="h-9 bg-slate-50 font-mono text-xs pr-10" value={state.webhookUrl || ''} readOnly />
            <InlineCopy value={state.webhookUrl} />
          </div>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-slate-500">Authorization: Bearer</span>
          <div className="relative">
            <Input className="h-9 bg-slate-50 font-mono text-xs pr-10" value={state.token ? `Bearer ${state.token}` : `Bearer ${state.settings?.token_hint || '...'}`} readOnly />
            <InlineCopy value={state.token || state.settings?.token_hint} prefix="Bearer " />
          </div>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button className="h-9 rounded-xl" type="button" onClick={generateToken} disabled={state.saving}>
          <RotateCcw className="h-4 w-4" />
          {state.settings?.token_hint ? 'Перевыпустить token' : 'Сгенерировать token'}
        </Button>
      </div>

      <div className="border-t border-slate-100 pt-6">
        <label className="flex items-center justify-between cursor-pointer group">
          <div className="flex-1 pr-4">
            <span className="text-sm font-bold text-slate-900 group-hover:text-indigo-600 block transition-colors">
              Автосверка по PDF-чекам
            </span>
            <span className="text-xs text-slate-500 mt-1 block leading-relaxed">
              Автоматически парсить текстовые PDF-чеки из банковских приложений, извлекать сумму, дату и номер транзакции и подтверждать оплату при совпадении с СМС-уведомлением.
            </span>
          </div>
          <button
            type="button"
            className={`w-11 h-6 rounded-full transition-all duration-200 relative focus:outline-none shrink-0 ${
              state.settings?.pdf_auto_confirm_enabled !== false ? 'bg-indigo-600' : 'bg-slate-200'
            }`}
            onClick={() => saveSettings({ pdf_auto_confirm_enabled: state.settings?.pdf_auto_confirm_enabled === false })}
            disabled={state.saving}
            title={state.settings?.pdf_auto_confirm_enabled !== false ? 'Отключить' : 'Включить'}
          >
            <span
              className="w-5 h-5 rounded-full bg-white absolute top-0.5 shadow-sm transition-all duration-200"
              style={{
                left: state.settings?.pdf_auto_confirm_enabled !== false ? '22px' : '2px'
              }}
            />
          </button>
        </label>
      </div>

    </div>
  );
}
