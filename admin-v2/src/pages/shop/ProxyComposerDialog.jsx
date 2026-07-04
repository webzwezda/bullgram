import { Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { INITIAL_PROXY_COMPOSER } from './shop.utils.js';

export function ProxyComposerDialog({ open, onOpenChange, composer, setComposer, saleProxies, onSave, onReset }) {
  function handleClose() {
    onReset();
    onOpenChange(false);
  }

  function handleProxySelect(proxyId) {
    const proxy = saleProxies.find((p) => String(p.id) === String(proxyId));
    if (proxy) {
      setComposer({
        ...INITIAL_PROXY_COMPOSER,
        proxyId: String(proxy.id),
        title: proxy.name || `Прокси ${proxy.host}:${proxy.port}`,
        preview_text: 'Готовый серверный SOCKS5-прокси для одного Telegram-аккаунта.',
        description: `Прокси ${proxy.host}:${proxy.port}${proxy.last_check_country ? ` • ${proxy.last_check_country}` : ''}.`
      });
    } else {
      onReset();
    }
  }

  const inputCls = 'h-11 rounded-xl bg-white border-slate-200 text-sm shadow-sm';

  return (
    <Dialog open={open} onOpenChange={(v) => !v ? handleClose() : onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Продать прокси</DialogTitle>
          <DialogDescription>Создайте лот из прокси в группе продажи.</DialogDescription>
        </DialogHeader>

        {composer.error && (
          <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
            {composer.error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">Прокси</label>
            <Select value={composer.proxyId} onValueChange={handleProxySelect}>
              <SelectTrigger className="h-11 rounded-xl bg-white border-slate-200 text-sm">
                <SelectValue placeholder="Выберите прокси" />
              </SelectTrigger>
              <SelectContent>
                {saleProxies.map((proxy) => (
                  <SelectItem key={proxy.id} value={String(proxy.id)}>
                    {proxy.name || `${proxy.host}:${proxy.port}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">Название лота</label>
            <Input
              className={inputCls}
              placeholder="Название"
              value={composer.title}
              onChange={(e) => setComposer((p) => ({ ...p, title: e.target.value }))}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">Цена TON</label>
            <Input
              className={inputCls}
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              value={composer.price_ton}
              onChange={(e) => setComposer((p) => ({ ...p, price_ton: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Статус</label>
              <Select value={composer.status} onValueChange={(v) => setComposer((p) => ({ ...p, status: v }))}>
                <SelectTrigger className="h-11 rounded-xl bg-white border-slate-200 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Черновик</SelectItem>
                  <SelectItem value="published">Опубликовать</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Канал</label>
              <Select value={composer.sales_channel} onValueChange={(v) => setComposer((p) => ({ ...p, sales_channel: v }))}>
                <SelectTrigger className="h-11 rounded-xl bg-white border-slate-200 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin_only">Только админка</SelectItem>
                  <SelectItem value="both">Сайт + админка</SelectItem>
                  <SelectItem value="site">Публичный сайт</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">Способы оплаты</label>
            <div className="flex gap-2">
              {[
                ['ton', 'TON']
              ].map(([method, label]) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setComposer((p) => {
                    const next = p.payment_methods.includes(method)
                      ? p.payment_methods.filter((m) => m !== method)
                      : [...p.payment_methods, method];
                    return { ...p, payment_methods: next.length ? next : ['ton'] };
                  })}
                  className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                    composer.payment_methods.includes(method)
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                      : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">Превью</label>
            <Textarea
              className="rounded-xl bg-white border-slate-200 text-sm min-h-[72px]"
              rows={3}
              placeholder="Короткий текст, видный на витрине"
              value={composer.preview_text}
              onChange={(e) => setComposer((p) => ({ ...p, preview_text: e.target.value }))}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">Описание</label>
            <Textarea
              className="rounded-xl bg-white border-slate-200 text-sm min-h-[88px]"
              rows={4}
              placeholder="Что получает покупатель"
              value={composer.description}
              onChange={(e) => setComposer((p) => ({ ...p, description: e.target.value }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} className="rounded-xl">Отмена</Button>
          <Button
            onClick={onSave}
            disabled={composer.saving || !composer.proxyId}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {composer.saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {composer.saving ? 'Сохраняем...' : 'Опубликовать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
