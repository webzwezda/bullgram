// Список администраторов бота — секция AutopostManagePage (behavior-preserving
// разрезка 2026-11-07). Владеет стейтом ручного добавления (newAdminTgId,
// addingAdmin) и его хендлерами; самих админов и инвайт-ссылку пишет
// loadAdmins на странице, поэтому они приходят пропсами. askConfirm — общий
// диалог подтверждения страницы (confirmState живёт в композиторе).
import { useState } from 'react';
import { Copy, Eye, EyeOff, Loader2, RefreshCcw, Shield, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button.jsx';
import { Card } from '../../../components/ui/card.jsx';
import { Input } from '../../../components/ui/input.jsx';
import { addAdmin, regenerateInvite, removeAdmin } from '../api.js';

function maskInvite(value) {
  const t = String(value || '');
  const idx = t.indexOf('?start=');
  if (idx === -1) return t;
  return `${t.slice(0, idx + 7)}${'•'.repeat(8)}`;
}

export default function AdminsPanel({
  admins,
  setAdmins,
  inviteLink,
  setInviteLink,
  inviteRevealed,
  setInviteRevealed,
  createdBot,
  accessToken,
  askConfirm
}) {
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [newAdminTgId, setNewAdminTgId] = useState('');

  // Добавить администратора вручную
  async function handleAddAdmin() {
    if (!newAdminTgId.trim() || addingAdmin || !createdBot?.id) return;
    setAddingAdmin(true);
    try {
      const data = await addAdmin(createdBot.id, newAdminTgId.trim(), accessToken);

      setAdmins(data.admin_tg_ids || []);
      setNewAdminTgId('');
      toast.success('Администратор добавлен');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAddingAdmin(false);
    }
  }

  // Удалить администратора
  function askRemoveAdmin(tgId) {
    askConfirm({
      title: 'Удалить администратора',
      description: `Администратор ${tgId} потеряет доступ к постам и модерации.`,
      actionLabel: 'Удалить',
      danger: true,
      onConfirm: () => doRemoveAdmin(tgId)
    });
  }

  async function doRemoveAdmin(tgId) {
    try {
      const data = await removeAdmin(createdBot.id, tgId, accessToken);

      setAdmins(data.admin_tg_ids || []);
      toast.success('Администратор удален из списка');
    } catch (err) {
      toast.error(err.message);
    }
  }

  // Копирование инвайт-ссылки в буфер обмена
  function handleCopyInvite() {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink)
      .then(() => toast.success('Ссылка скопирована в буфер обмена'))
      .catch(() => toast.error('Не удалось скопировать ссылку.'));
  }

  return (
    <>
          {/* Список Администраторов (В самом низу) */}
          <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
            <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Администраторы бота</h3>
                  <p className="text-xs font-semibold text-slate-500">Управляй правами доступа и генерируй приглашения</p>
                </div>
              </div>
            </div>
            
            <div className="p-5 sm:p-6 space-y-6">
              {/* Ссылка-приглашение */}
              {inviteLink && (
                <div className="space-y-2 max-w-xl">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block">Пригласить администратора</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        readOnly
                        value={inviteRevealed ? inviteLink : maskInvite(inviteLink)}
                          className="font-mono bg-slate-50 h-11 rounded-xl border-slate-200 shadow-sm pr-20"
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 transition-colors"
                        onClick={() => setInviteRevealed((v) => !v)}
                        aria-label={inviteRevealed ? 'Скрыть ссылку' : 'Показать ссылку'}
                        title={inviteRevealed ? 'Скрыть ссылку' : 'Показать ссылку'}
                      >
                        {inviteRevealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <Button
                      type="button"
                      onClick={handleCopyInvite}
                      aria-label="Скопировать инвайт-ссылку"
                      className="h-11 px-4 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border-0"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-slate-500 font-medium block">
                      Пользователь перейдет по ссылке в бота и автоматически получит доступ к администрированию.
                    </span>
                    {createdBot?.id ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded-lg text-xs text-slate-500 hover:text-slate-800"
                        type="button"
                        onClick={async () => {
                          try {
                            const data = await regenerateInvite(createdBot.id, accessToken);
                            if (data.invite_link) setInviteLink(data.invite_link);
                            setInviteRevealed(false);
                            toast.success('Ссылка перевыпущена. Старая больше не работает.');
                          } catch (err) {
                            toast.error(err.message || 'Не удалось перевыпустить ссылку.');
                          }
                        }}
                      >
                        <RefreshCcw className="w-3.5 h-3.5 mr-1 inline" /> Перевыпустить
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}

              {/* Список текущих админов */}
              <div className="space-y-3">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block">Список админов ({admins.length})</label>
                <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden max-w-md">
                  {admins.map((adminId) => {
                    return (
                      <div key={adminId} className="flex items-center justify-between p-3.5 bg-white text-sm font-semibold">
                        <span className="font-mono text-slate-700">{adminId}</span>
                        {(
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => askRemoveAdmin(adminId)}
                            className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 h-8 rounded-lg"
                          >
                            Удалить
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-500">Первый в списке — владелец бота: он добавляется автоматически при подключении.</p>
              </div>

              {/* Ручное добавление */}
              <div className="space-y-2 max-w-md">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block">Добавить вручную по Telegram ID</label>
                <div className="flex gap-2">
                  <Input
                    value={newAdminTgId}
                    onChange={(e) => setNewAdminTgId(e.target.value)}
                    placeholder="Пример: 123456789"
                    className="bg-white h-11 rounded-xl border-slate-200 shadow-sm"
                  />
                  <Button
                    onClick={handleAddAdmin}
                    disabled={!newAdminTgId.trim() || addingAdmin}
                    className="h-11 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-200"
                  >
                    {addingAdmin ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
                    Добавить
                  </Button>
                </div>
              </div>
            </div>
          </Card>
    </>
  );
}
