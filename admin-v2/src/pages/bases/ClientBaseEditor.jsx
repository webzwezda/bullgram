import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { X, Send, Edit3, Trash2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '../../components/ui/dialog.jsx';
import {
  fetchClientBaseMembers, addClientBaseMembers, deleteClientBaseMember,
  updateClientBase, deleteClientBase
} from '../../api/client-bases.js';
import { generateTempId, memberDisplayName, paymentBadge, coverageLabel, coverageChannels } from './shared.js';

function makeOptimisticEntry(fromMember) {
  return {
    id: generateTempId(),
    tg_user_id: String(fromMember.tg_user_id),
    username: fromMember.username || null,
    display_name: fromMember.display_name || null,
    source: 'copied',
    added_at: new Date().toISOString(),
    _pending: true,
    _pendingRemoval: false
  };
}

export function ClientBaseEditor({ accessToken, base, refreshTick = 0, onDeleted, onRenamed, onPushToBroadcast }) {
  const [members, setMembers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [error, setError] = useState('');

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameForm, setRenameForm] = useState({ name: '', description: '' });
  const [renameSaving, setRenameSaving] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteSaving, setDeleteSaving] = useState(false);

  const reqRef = useRef(0);
  const debounceRef = useRef(null);

  // Debounce search 300ms
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [search]);

  // Reset search on base switch
  useEffect(() => {
    setSearch('');
    setDebouncedSearch('');
    setError('');
  }, [base?.id]);

  // Load members
  useEffect(() => {
    if (!accessToken || !base?.id) return;
    let cancelled = false;
    async function load() {
      const reqId = ++reqRef.current;
      setLoading(true);
      setError('');
      try {
        const data = await fetchClientBaseMembers(accessToken, base.id, { limit: 500, offset: 0, search: debouncedSearch });
        if (cancelled || reqId !== reqRef.current) return;
        setMembers(data.members || []);
        setTotal(data.summary?.total || 0);
      } catch (err) {
        if (cancelled || reqId !== reqRef.current) return;
        setError(err.message || 'Ошибка загрузки членов базы');
      } finally {
        if (!cancelled && reqId === reqRef.current) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [accessToken, base?.id, debouncedSearch, refreshTick]);

  useEffect(() => {
    if (base) {
      setRenameForm({ name: base.name || '', description: base.description || '' });
    }
  }, [base?.id, base?.name, base?.description]);

  const visibleMembers = useMemo(() => {
    const items = [...members];
    items.sort((a, b) => {
      // Pending first, then by added_at desc
      if (a._pending && !b._pending) return -1;
      if (!a._pending && b._pending) return 1;
      return new Date(b.added_at || 0).getTime() - new Date(a.added_at || 0).getTime();
    });
    return items.slice(0, 200);
  }, [members]);

  async function addMember(member) {
    const optimistic = makeOptimisticEntry(member);
    setMembers((prev) => [...prev, optimistic]);

    try {
      const result = await addClientBaseMembers(accessToken, base.id, [{
        tg_user_id: optimistic.tg_user_id,
        username: optimistic.username || '',
        display_name: optimistic.display_name || '',
        source: 'copied'
      }]);

      const inserted = result?.inserted || 0;
      const updated = result?.updated || 0;

      // Replace optimistic entry with server response (or remove if user clicked [-] meanwhile)
      setMembers((prev) => {
        if (optimistic._pendingRemoval) {
          return prev.filter((m) => m.id !== optimistic.id);
        }
        return prev.map((m) => {
          if (m.id !== optimistic.id) return m;
          return { ...m, _pending: false };
        });
      });

      // Refresh total
      setTotal((prev) => Math.max(prev, prev + (inserted > 0 ? 1 : 0)));

      if (updated > 0) {
        toast(`Уже в базе — обновлено`, { duration: 2000 });
      } else if (inserted > 0) {
        toast.success('Добавлен в базу');
      }
    } catch (err) {
      // Rollback optimistic insert
      setMembers((prev) => prev.filter((m) => m.id !== optimistic.id));
      if (optimistic._pendingRemoval) {
        // user already removed; nothing more to do
        return;
      }
      toast.error(err.message || 'Не удалось добавить в базу');
    }
  }

  async function removeMember(member) {
    // Optimistic: if pending insert, just drop it without server call
    if (member._pending) {
      Object.assign(member, { _pendingRemoval: true });
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      return;
    }

    const snapshot = member;
    setMembers((prev) => prev.filter((m) => m.id !== member.id));

    try {
      await deleteClientBaseMember(accessToken, base.id, member.id);
      setTotal((prev) => Math.max(0, prev - 1));
      toast.success('Удалён из базы');
    } catch (err) {
      // Rollback
      setMembers((prev) => [...prev, snapshot]);
      if (String(err?.message || '').includes('404') || String(err?.message || '').includes('не найден')) {
        toast.error('База или член были удалены');
        onDeleted?.();
      } else {
        toast.error(err.message || 'Не удалось удалить из базы');
      }
    }
  }

  async function saveRename() {
    if (!renameForm.name.trim()) {
      toast.error('Название не может быть пустым');
      return;
    }
    setRenameSaving(true);
    try {
      await updateClientBase(accessToken, base.id, {
        name: renameForm.name.trim(),
        description: renameForm.description.trim() || null
      });
      onRenamed?.(base.id, {
        name: renameForm.name.trim(),
        description: renameForm.description.trim() || null
      });
      setRenameOpen(false);
      toast.success('База переименована');
    } catch (err) {
      toast.error(err.message || 'Не удалось переименовать базу');
    } finally {
      setRenameSaving(false);
    }
  }

  async function confirmDelete() {
    setDeleteSaving(true);
    try {
      await deleteClientBase(accessToken, base.id);
      setDeleteOpen(false);
      toast.success('База удалена');
      onDeleted?.();
    } catch (err) {
      toast.error(err.message || 'Не удалось удалить базу');
    } finally {
      setDeleteSaving(false);
    }
  }

  if (!base) return null;

  return (
    <div className="p-6 md:p-8 border-t border-slate-100">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h3 className="text-sm font-black uppercase tracking-widest text-slate-500">
          {base.name}
        </h3>
        <span className="text-xs font-bold text-slate-500">
          {members.length} показываем · {total} всего
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Поиск по имени, @username или TG ID"
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-slate-400"
        />
        <button
          type="button"
          onClick={() => onPushToBroadcast?.(base)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Send className="w-3.5 h-3.5" />
          В рассылку
        </button>
        <button
          type="button"
          onClick={() => setRenameOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <Edit3 className="w-3.5 h-3.5" />
          Переименовать
        </button>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Удалить базу
        </button>
      </div>

      {error ? (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-100 text-red-600 font-bold text-sm">
          {error}
        </div>
      ) : loading && members.length === 0 ? (
        <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
          Грузим участников...
        </div>
      ) : visibleMembers.length === 0 ? (
        <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
          {debouncedSearch ? 'Ничего не найдено.' : 'База пустая. Добавьте людей кнопкой «В базу» в аудитории сверху или «+ ID руками».'}
        </div>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Кто</th>
                <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Деньги</th>
                <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Где есть</th>
                <th className="px-4 py-3 text-right text-[11px] font-black uppercase tracking-widest text-slate-400"></th>
              </tr>
            </thead>
            <tbody>
              {visibleMembers.map((member) => {
                const badge = paymentBadge(member.payment_status);
                const cov = coverageChannels(member);
                return (
                  <tr
                    key={member.id}
                    className={`border-b border-slate-50 last:border-0 hover:bg-slate-50/30 transition-colors ${member._pending ? 'opacity-60' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm font-bold text-slate-900">
                        {memberDisplayName(member)}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">
                        {member.username ? `@${member.username}` : 'без username'} · {member.tg_user_id}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-md text-[11px] font-black ${badge.cls}`}>
                        {badge.text}
                      </span>
                      <div className="text-xs text-slate-500 font-medium mt-1">
                        {member.active_subscription_count || 0} активн. · {member.expired_subscription_count || 0} истекш.
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-black uppercase tracking-wider text-slate-500 mb-1">
                        {coverageLabel(member)}
                      </div>
                      {cov.presentTotal > 0 ? (
                        <div className="text-xs text-slate-700">
                          В: {cov.present.join(', ')}
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400">Нигде не найден</div>
                      )}
                      {cov.missingTotal > 0 ? (
                        <div className="text-xs text-slate-400">
                          Нет в: {cov.missing.join(', ')}
                        </div>
                      ) : null}
                      {!member.present_now && cov.presentTotal > 0 ? (
                        <div className="text-[10px] text-amber-600 font-bold uppercase tracking-wider mt-0.5">
                          сейчас не синкается
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => removeMember(member)}
                        disabled={member._pending && member._pendingRemoval}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Удалить из базы"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {members.length > 200 ? (
            <div className="px-4 py-3 text-xs font-medium text-slate-500">
              Показываем первые 200 из {members.length}. Уточните поиск, чтобы увидеть остальных.
            </div>
          ) : null}
        </div>
      )}

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Переименовать базу</DialogTitle>
            <DialogDescription>Название и описание видны только вам.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <input
              type="text"
              value={renameForm.name}
              onChange={(event) => setRenameForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Название базы"
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-400"
            />
            <input
              type="text"
              value={renameForm.description}
              onChange={(event) => setRenameForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Описание (необязательно)"
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-700 focus:outline-none focus:border-slate-400"
            />
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setRenameOpen(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Отменить
            </button>
            <button
              type="button"
              onClick={saveRename}
              disabled={renameSaving || !renameForm.name.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {renameSaving ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Удалить базу «{base.name}»?</DialogTitle>
            <DialogDescription>
              База и все её члены ({total}) будут удалены безвозвратно. Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteSaving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              Отменить
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleteSaving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {deleteSaving ? 'Удаляем…' : 'Удалить безвозвратно'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
