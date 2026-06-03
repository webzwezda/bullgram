import { ArrowRight, Bot, KeyRound, Smartphone, Workflow } from 'lucide-react';
import { APP_CONFIG } from '../config.js';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.jsx';

const apiLinks = [
  {
    title: 'MCP',
    text: 'Агентский вход в BullRun tools. Подходит для клешни и других MCP-клиентов.',
    href: '/app/api/mcp',
    icon: Bot,
    action: 'Открыть MCP'
  },
  {
    title: 'Касса',
    text: 'Webhook для банковских уведомлений живет в кассе, рядом со сверкой P2P оплат.',
    href: '/app/billing',
    icon: Smartphone,
    action: 'Открыть кассу'
  },
  {
    title: 'API-ключи',
    text: 'Единое место, где можно скопировать, перевыпустить или отозвать ключ интеграции.',
    href: '/app/integrations',
    icon: KeyRound,
    action: 'Открыть ключи'
  }
];

export function ApiN8nPage() {
  return (
    <section className="page">
      <div className="space-y-6">
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardHeader className="px-6 pt-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-white shadow-lg shadow-amber-500/20 shrink-0">
                  <Workflow className="w-6 h-6" />
                </div>
                <div>
                  <CardTitle className="text-lg font-bold tracking-tight text-slate-900">n8n сценарии</CardTitle>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                    Контур для автоматизаций: дернуть BullRun по API, принять webhook из внешнего сценария и связать с кассой, MCP или операционными экранами.
                  </p>
                </div>
              </div>
              <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-200">Скоро</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-400">Входящие события</div>
                <div className="mt-1 text-sm font-medium text-slate-900">webhook → BullRun</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-400">Исходящие команды</div>
                <div className="mt-1 text-sm font-medium text-slate-900">n8n → API</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-400">Ключ</div>
                <div className="mt-1 text-sm font-medium text-slate-900">Bearer token</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 shrink-0">
                <ArrowRight className="w-6 h-6" />
              </div>
              <div>
                <CardTitle className="text-lg font-bold tracking-tight text-slate-900">Ближайший рабочий путь</CardTitle>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                  Сначала используем готовые части, потом добавляем отдельные n8n actions.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6">
            <div className="flex flex-wrap gap-2">
              {apiLinks.map((link) => {
                const Icon = link.icon;
                return (
                  <Button key={link.href} asChild variant="outline" size="sm" className="h-9 rounded-xl">
                    <a href={link.href}>
                      <Icon className="h-4 w-4" />
                      {link.action}
                    </a>
                  </Button>
                );
              })}
            </div>
            <p className="text-sm text-slate-500">
              Сейчас n8n не выпускает отдельный ключ. Используем общий экран API-ключей и не открываем лишние права до появления конкретных сценариев.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
