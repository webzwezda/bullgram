import { Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TEXT_OFFER_TEMPLATES, INITIAL_FORM_STATE } from './shop.utils.js';

export function CreateItemDialog({ open, onOpenChange, formState, setFormState, onSave, saving }) {
  function applyTemplate(template) {
    setFormState((prev) => ({
      ...prev,
      item_type: 'text_offer',
      title: template.title,
      price_ton: template.priceTon,
      price_rub: prev.price_rub || '',
      preview_text: template.preview,
      description: template.description,
      post_purchase_message: template.postPurchaseMessage,
      offer_code: template.offerCode,
      sales_channel: 'site'
    }));
  }

  function handleClose() {
    setFormState({ ...INITIAL_FORM_STATE });
    onOpenChange(false);
  }

  const inputCls = 'h-11 rounded-xl bg-white border-slate-200 text-sm shadow-sm';

  return (
    <Dialog open={open} onOpenChange={(v) => !v ? handleClose() : onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Новый оффер</DialogTitle>
          <DialogDescription>Создайте товар с текстом, который покупатель увидит после оплаты.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">Название</label>
            <Input
              className={inputCls}
              placeholder="Название товара"
              value={formState.title}
              onChange={(e) => setFormState((p) => ({ ...p, title: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Цена TON</label>
              <Input
                className={inputCls}
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
                value={formState.price_ton}
                onChange={(e) => setFormState((p) => ({ ...p, price_ton: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Цена RUB</label>
              <Input
                className={inputCls}
                type="number"
                min="0"
                step="1"
                placeholder="Для СБП"
                value={formState.price_rub}
                onChange={(e) => setFormState((p) => ({ ...p, price_rub: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Статус</label>
              <Select value={formState.status} onValueChange={(v) => setFormState((p) => ({ ...p, status: v }))}>
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
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Видимость</label>
              <Select value={formState.visibility} onValueChange={(v) => setFormState((p) => ({ ...p, visibility: v }))}>
                <SelectTrigger className="h-11 rounded-xl bg-white border-slate-200 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Публичный</SelectItem>
                  <SelectItem value="unlisted">По ссылке</SelectItem>
                  <SelectItem value="private">Private</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Канал</label>
              <Select value={formState.sales_channel} onValueChange={(v) => setFormState((p) => ({ ...p, sales_channel: v }))}>
                <SelectTrigger className="h-11 rounded-xl bg-white border-slate-200 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="site">Публичный сайт</SelectItem>
                  <SelectItem value="both">Сайт + админка</SelectItem>
                  <SelectItem value="admin_only">Только админка</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">Способы оплаты</label>
            <div className="flex gap-2">
              {[
                ['ton', 'TON'],
                ['p2p', 'СБП']
              ].map(([method, label]) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setFormState((p) => {
                    const next = p.payment_methods.includes(method)
                      ? p.payment_methods.filter((m) => m !== method)
                      : [...p.payment_methods, method];
                    return { ...p, payment_methods: next.length ? next : ['ton'] };
                  })}
                  className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                    formState.payment_methods.includes(method)
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
              value={formState.preview_text}
              onChange={(e) => setFormState((p) => ({ ...p, preview_text: e.target.value }))}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">Описание</label>
            <Textarea
              className="rounded-xl bg-white border-slate-200 text-sm min-h-[88px]"
              rows={4}
              placeholder="Что получает покупатель"
              value={formState.description}
              onChange={(e) => setFormState((p) => ({ ...p, description: e.target.value }))}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">Сообщение после оплаты</label>
            <Textarea
              className="rounded-xl bg-white border-slate-200 text-sm min-h-[88px]"
              rows={4}
              placeholder="Текст, который увидит покупатель после подтверждения оплаты"
              value={formState.post_purchase_message}
              onChange={(e) => setFormState((p) => ({ ...p, post_purchase_message: e.target.value }))}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">Шаблоны</label>
            <div className="flex flex-wrap gap-2">
              {TEXT_OFFER_TEMPLATES.map((template) => (
                <Button
                  key={template.id}
                  variant="outline"
                  size="sm"
                  className="rounded-xl text-xs"
                  onClick={() => applyTemplate(template)}
                >
                  {template.title}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} className="rounded-xl">Отмена</Button>
          <Button
            onClick={onSave}
            disabled={saving || !formState.title.trim()}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {saving ? 'Сохраняем...' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
