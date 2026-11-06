import { UserCog, Loader2, RefreshCw, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

function BotAdminsSection({
  selectedOfficialBot,
  botAdmins,
  botAdminsLoading,
  inviteLink,
  addingBotAdmin,
  newAdminTgId,
  setNewAdminTgId,
  handleAddBotAdmin,
  handleRemoveBotAdmin,
  handleRegenerateBotAdminInvite,
  regeneratingInvite
}) {
  if (!selectedOfficialBot) return null;

  const admins = Array.isArray(botAdmins) ? botAdmins : [];
  const loading = botAdminsLoading;
  const canCopy = typeof navigator !== 'undefined' && navigator.clipboard;

  async function copyInvite() {
    if (!inviteLink || !canCopy) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch (_) {
      toast.error('Не удалось скопировать');
    }
  }

  return (
    <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
      <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
            <UserCog className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              Администраторы бота
              {admins.length > 0 && (
                <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-0 text-xs rounded-full px-2">
                  {admins.length}
                </Badge>
              )}
            </h2>
            <p className="text-sm font-medium text-slate-500 mt-0.5">
              Управляйте доступом: ссылка-приглашение, ручное добавление, удаление.
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6 space-y-6 bg-white">
        {/* Ссылка-приглашение */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
            Ссылка-приглашение
          </label>
          {loading ? (
            <div className="h-11 rounded-xl bg-slate-50 border border-slate-100 flex items-center px-4 text-sm text-slate-500">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Загрузка…
            </div>
          ) : inviteLink ? (
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                readOnly
                value={inviteLink}
                onClick={copyInvite}
                className="font-mono bg-slate-50 h-11 rounded-xl border-slate-200 shadow-sm cursor-pointer text-xs sm:text-sm flex-1"
              />
              <div className="flex gap-2">
                <Button
                  onClick={copyInvite}
                  variant="outline"
                  className="h-11 px-4 rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm font-bold"
                >
                  Копировать
                </Button>
                <Button
                  onClick={handleRegenerateBotAdminInvite}
                  disabled={regeneratingInvite}
                  variant="outline"
                  className="h-11 px-4 rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm font-bold"
                >
                  {regeneratingInvite ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  Новая
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <Button
                onClick={handleRegenerateBotAdminInvite}
                disabled={regeneratingInvite}
                className="h-11 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-200"
              >
                {regeneratingInvite ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                Создать ссылку-приглашение
              </Button>
              <span className="text-xs font-medium text-slate-500 max-w-md">
                Пользователь перейдёт по ссылке в бота и автоматически получит доступ администратора.
              </span>
            </div>
          )}
        </div>

        {/* Список текущих админов */}
        <div className="space-y-3">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
            Администраторы
          </label>
          {loading ? (
            <div className="space-y-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-14 rounded-2xl bg-slate-50 border border-slate-100 animate-pulse" />
              ))}
            </div>
          ) : admins.length === 0 ? (
            <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-8 text-center">
              <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3 ring-1 ring-slate-100">
                <UserCog className="w-6 h-6 text-slate-300" />
              </div>
              <p className="text-sm text-slate-700 font-bold">Администраторов пока нет</p>
              <p className="mt-1 text-sm text-slate-500">Создайте ссылку-приглашение или добавьте TG ID вручную выше.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {admins.map((adminId, idx) => {
                const isOwner = idx === 0;
                return (
                  <div key={adminId} className="flex items-center justify-between p-4 bg-slate-50/50 hover:bg-slate-100 rounded-2xl border border-slate-100 transition-all gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-indigo-600">{isOwner ? '★' : '#'}</span>
                      </div>
                      <span className="font-mono text-sm font-bold text-slate-900 truncate">{String(adminId)}</span>
                    </div>
                    {isOwner ? (
                      <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 border-0 text-xs font-bold px-2.5 py-1 rounded-md shrink-0">
                        Владелец
                      </Badge>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveBotAdmin(adminId)}
                        className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 h-9 px-3 rounded-lg shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                        Удалить
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Ручное добавление */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
            Добавить вручную по Telegram ID
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={newAdminTgId}
              onChange={(e) => setNewAdminTgId(e.target.value)}
              placeholder="Пример: 123456789"
              className="h-11 bg-white rounded-xl border-slate-200 shadow-sm focus-visible:ring-indigo-500 font-mono flex-1"
            />
            <Button
              onClick={handleAddBotAdmin}
              disabled={!newAdminTgId.trim() || addingBotAdmin}
              variant="outline"
              className="h-11 px-5 rounded-xl text-slate-700 border-slate-200 bg-white hover:bg-slate-50 shadow-sm font-bold"
            >
              {addingBotAdmin ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Добавить
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export { BotAdminsSection };
