import { Globe } from 'lucide-react';
import { Card, Section, SectionTitle } from './ui.jsx';

export function ExternalTargetsField({ value, onChange, disabled }) {
  return (
    <Card>
      <Section>
        <SectionTitle icon={Globe}>Сторонние группы для вступления</SectionTitle>
        <textarea
          className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 text-sm font-medium text-slate-900 focus:outline-none focus:border-slate-400 shadow-sm transition resize-none min-h-[90px] disabled:opacity-50"
          rows="3"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={'@durov\nhttps://t.me/+AbCdEf...\nПо одной группе на строку'}
        />
        <div className="mt-3 p-4 rounded-2xl bg-amber-50/60 border border-amber-200 text-sm text-amber-800 font-medium">
          Юзерботы вступят в указанные группы, чтобы получить точки прикосновения к недостающим людям.
          Это агрессивное действие — Telegram может ограничить аккаунты. Продолжая, ты принимаешь риск.
        </div>
        <div className="mt-3 text-xs text-slate-400 font-medium">
          Вступления идут медленно и по очереди: лимит на аккаунт в час + паузы, чтобы не поймать flood wait.
        </div>
      </Section>
    </Card>
  );
}
