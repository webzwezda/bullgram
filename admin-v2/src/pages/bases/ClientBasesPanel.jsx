import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Database, Plus, X, AlertCircle } from 'lucide-react';
import {
  fetchClientBases, createClientBase, addClientBaseMembers
} from '../../api/client-bases.js';
import { generateTempId } from './shared.js';
import { ClientBaseEditor } from './ClientBaseEditor.jsx';
import { ManualAddDialog } from './ManualAddDialog.jsx';

const BUFFER_STORAGE_KEY = 'bases_new_buffer_v1';

function loadBuffer() {
  try {
    const raw = window.sessionStorage.getItem(BUFFER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveBuffer(items) {
  try {
    window.sessionStorage.setItem(BUFFER_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // sessionStorage overflow — ignore, buffer is best-effort
  }
}

export function ClientBasesPanel({ accessToken, activeBaseId, onChangeActiveBaseId, addToBaseRequest, onConsumeAddRequest }) {
  const [bases, setBases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [mode, setMode] = useState('existing'); // 'existing' | 'new'
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [buffer, setBuffer] = useState(loadBuffer);
  const [saving, setSaving] = useState(false);

  // Bump to trigger editor refetch
  const [editorRefreshTick, setEditorRefreshTick] = useState(0);

  const [manualOpen, setManualOpen] = useState(false);
  const lastProcessedRequestRef = useRef(null);

  // Persist buffer to sessionStorage
  useEffect(() => {
    saveBuffer(buffer);
  }, [buffer]);

  // Initial load of bases
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const data = await fetchClientBases(accessToken);
        if (cancelled) return;
        const list = data.bases || [];
        setBases(list);
        if (!activeBaseId) {
          if (list.length > 0) {
            onChangeActiveBaseId(list[0].id);
            setMode('existing');
          } else {
            setMode('new');
          }
        } else {
          const stillExists = list.find((b) => String(b.id) === String(activeBaseId));
          if (!stillExists) {
            if (list.length > 0) {
              onChangeActiveBaseId(list[0].id);
              setMode('existing');
            } else {
              onChangeActiveBaseId(null);
              setMode('new');
            }
          } else {
            setMode('existing');
          }
        }
      } catch (err) {
        if (cancelled) return;
        setError(err.message || 'Ошибка загрузки баз клиентов');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  // Refresh bases list on window focus
  useEffect(() => {
    function handleFocus() {
      if (!accessToken) return;
      fetchClientBases(accessToken)
        .then((data) => setBases(data.bases || []))
        .catch(() => {});
    }
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [accessToken]);

  // Handle external add-to-base requests (from AudiencePanel [+] button)
  useEffect(() => {
    if (!addToBaseRequest) return;
    // Avoid processing same request twice
    if (lastProcessedRequestRef.current === addToBaseRequest) return;
    lastProcessedRequestRef.current = addToBaseRequest;

    const { source, member } = addToBaseRequest;
    if (source !== 'audience' || !member) {
      onConsumeAddRequest?.();
      return;
    }

    if (mode === 'existing' && activeBaseId) {
      addMemberToExisting(member).finally(() => onConsumeAddRequest?.());
    } else if (mode === 'new') {
      pushToBuffer(member);
      onConsumeAddRequest?.();
    } else {
      onConsumeAddRequest?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addToBaseRequest]);

  const activeBase = useMemo(
    () => bases.find((b) => String(b.id) === String(activeBaseId)) || null,
    [bases, activeBaseId]
  );

  function selectBase(id) {
    onChangeActiveBaseId(id);
    setMode(id ? 'existing' : 'new');
  }

  function startNew() {
    onChangeActiveBaseId(null);
    setMode('new');
    setDraftName('');
    setDraftDescription('');
  }

  function pushToBuffer(member) {
    const tgId = String(member.tg_user_id);
    setBuffer((prev) => {
      if (prev.some((entry) => String(entry.tg_user_id) === tgId)) {
        toast(`Уже в корзине`, { duration: 2000 });
        return prev;
      }
      return [
        ...prev,
        {
          tempId: generateTempId(),
          tg_user_id: tgId,
          username: member.username || '',
          display_name: member.display_name || '',
          source: 'copied'
        }
      ];
    });
    toast.success('Добавлен в корзину');
  }

  function removeFromBuffer(tempId) {
    setBuffer((prev) => prev.filter((entry) => entry.tempId !== tempId));
  }

  function addBufferFromCsv(entries) {
    setBuffer((prev) => {
      const existing = new Set(prev.map((e) => String(e.tg_user_id)));
      const additions = [];
      let duplicates = 0;
      for (const entry of entries) {
        const key = String(entry.tg_user_id);
        if (existing.has(key)) {
          duplicates += 1;
          continue;
        }
        existing.add(key);
        additions.push({
          tempId: generateTempId(),
          tg_user_id: key,
          username: entry.username || '',
          display_name: entry.display_name || '',
          source: 'manual'
        });
      }
      if (duplicates > 0) {
        toast(`Дубликатов в корзине пропущено: ${duplicates}`, { duration: 2500 });
      }
      toast.success(`Добавлено в корзину: ${additions.length}`);
      return [...prev, ...additions];
    });
  }

  async function addMemberToExisting(member) {
    if (!activeBaseId) return;
    try {
      const result = await addClientBaseMembers(accessToken, activeBaseId, [{
        tg_user_id: String(member.tg_user_id),
        username: member.username || '',
        display_name: member.display_name || '',
        source: 'copied'
      }]);
      setBases((prev) => prev.map((b) => {
        if (String(b.id) !== String(activeBaseId)) return b;
        const stats = { ...(b.stats || {}) };
        stats.total = (stats.total || 0) + (result?.inserted || 0);
        return { ...b, stats };
      }));
      setEditorRefreshTick((t) => t + 1);
      if ((result?.inserted || 0) > 0) {
        toast.success('Добавлен в базу');
      } else if ((result?.updated || 0) > 0) {
        toast(`Уже в базе — обновлено`, { duration: 2000 });
      }
    } catch (err) {
      toast.error(err.message || 'Не удалось добавить в базу');
    }
  }

  async function addMembersBulkToExisting(entries) {
    if (!activeBaseId || entries.length === 0) return;
    try {
      const result = await addClientBaseMembers(accessToken, activeBaseId, entries.map((e) => ({
        tg_user_id: e.tg_user_id,
        username: e.username || '',
        display_name: e.display_name || '',
        source: 'manual'
      })));
      setBases((prev) => prev.map((b) => {
        if (String(b.id) !== String(activeBaseId)) return b;
        const stats = { ...(b.stats || {}) };
        stats.total = (stats.total || 0) + (result?.inserted || 0);
        return { ...b, stats };
      }));
      setEditorRefreshTick((t) => t + 1);
      toast.success(`Добавлено: ${result?.inserted || 0} · обновлено: ${result?.updated || 0}`);
    } catch (err) {
      toast.error(err.message || 'Не удалось добавить людей');
    }
  }

  async function saveNewBase() {
    if (!draftName.trim()) {
      toast.error('Назови базу');
      return;
    }
    setSaving(true);
    let createdId = null;
    try {
      const created = await createClientBase(accessToken, {
        name: draftName.trim(),
        description: draftDescription.trim()
      });
      createdId = created?.id;
      if (!createdId) throw new Error('Не получили id базы');

      if (buffer.length === 0) {
        toast.success('База создана');
        finalizeNewBase(createdId);
        return;
      }

      try {
        const result = await addClientBaseMembers(accessToken, createdId, buffer.map((e) => ({
          tg_user_id: e.tg_user_id,
          username: e.username || '',
          display_name: e.display_name || '',
          source: e.source || 'manual'
        })));
        toast.success(`База создана, добавлено ${result?.inserted || 0} · обновлено ${result?.updated || 0}`);
        finalizeNewBase(createdId);
      } catch (memberErr) {
        toast.error(`База создана, но добавить людей не вышло: ${memberErr.message || ''}`);
        finalizeNewBase(createdId);
      }
    } catch (err) {
      toast.error(err.message || 'Не удалось создать базу');
    } finally {
      setSaving(false);
    }
  }

  function finalizeNewBase(createdId) {
    setBuffer([]);
    saveBuffer([]);
    setDraftName('');
    setDraftDescription('');
    fetchClientBases(accessToken).then((data) => {
      const list = data.bases || [];
      setBases(list);
      const created = list.find((b) => String(b.id) === String(createdId));
      if (created) {
        onChangeActiveBaseId(created.id);
        setMode('existing');
      }
    }).catch(() => {});
  }

  function handleBaseDeleted() {
    onChangeActiveBaseId(null);
    fetchClientBases(accessToken).then((data) => {
      const list = data.bases || [];
      setBases(list);
      if (list.length > 0) {
        onChangeActiveBaseId(list[0].id);
        setMode('existing');
      } else {
        setMode('new');
      }
    }).catch(() => {});
  }

  function handleBaseRenamed(id, patch) {
    setBases((prev) => prev.map((b) => String(b.id) === String(id) ? { ...b, ...patch } : b));
  }

  function pushToBroadcast(base) {
    if (!base) return;
    const url = `/app/broadcast?audience_type=client_base_members&base_id=${encodeURIComponent(base.id)}`;
    window.location.href = url;
  }

  if (loading && bases.length === 0) {
    return (
      <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="p-6 md:p-8">
          <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
            Грузим базы клиентов…
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="p-6 md:p-8">
          <div className="p-5 rounded-2xl bg-red-50 border border-red-100 text-red-600 font-bold text-sm flex items-center gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            {error}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
      <div className="p-6 md:p-8 border-b border-slate-100">
        <div className="flex items-center gap-2 mb-3">
          <Database className="w-5 h-5 text-slate-500" />
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-400">Базы клиентов</h2>
        </div>
        <p className="text-sm text-slate-600 max-w-2xl">
          Кураторские списки для точечных рассылок и дожима. Собирайте из аудитории бота кнопкой «В базу» сверху или вбивайте руки.
        </p>
      </div>

      <div className="p-6 md:p-8 border-b border-slate-100">
        {bases.length === 0 && mode === 'new' ? null : (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => {
                  if (mode === 'existing') return;
                  if (bases.length > 0) selectBase(bases[0].id);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  mode === 'existing' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                Существующая база
              </button>
              <button
                type="button"
                onClick={() => mode !== 'new' && startNew()}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  mode === 'new' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                + Новая база
              </button>
            </div>
          </div>
        )}

        {mode === 'existing' ? (
          <Fragment>
            {bases.length === 0 ? (
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm text-slate-600 font-medium flex flex-wrap items-center justify-between gap-3">
                <span>Пока нет баз. Создайте первую или перекиньте людей из аудитории бота.</span>
                <button
                  type="button"
                  onClick={startNew}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Создать базу
                </button>
              </div>
            ) : (
              <select
                value={activeBaseId || ''}
                onChange={(event) => selectBase(event.target.value)}
                className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-400 max-w-[420px]"
              >
                {bases.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}{b.stats?.total ? ` • ${b.stats.total} чел.` : ''}
                  </option>
                ))}
              </select>
            )}
          </Fragment>
        ) : (
          <div className="flex flex-col gap-3 max-w-xl">
            <input
              type="text"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="Название базы"
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-400"
            />
            <input
              type="text"
              value={draftDescription}
              onChange={(event) => setDraftDescription(event.target.value)}
              placeholder="Описание (необязательно)"
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-700 focus:outline-none focus:border-slate-400"
            />
            <div className="text-xs text-slate-500">
              В корзине: <span className="font-bold text-slate-700">{buffer.length}</span> · добавьте ещё через [В базу] в аудитории сверху или «+ ID руками».
            </div>
          </div>
        )}
      </div>

      {mode === 'existing' ? (
        activeBase ? (
          <ClientBaseEditor
            accessToken={accessToken}
            base={activeBase}
            refreshTick={editorRefreshTick}
            onDeleted={handleBaseDeleted}
            onRenamed={handleBaseRenamed}
            onPushToBroadcast={pushToBroadcast}
          />
        ) : null
      ) : (
        <div className="p-6 md:p-8 border-t border-slate-100">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-500">Корзина</h3>
            <span className="text-xs font-bold text-slate-500">{buffer.length} в корзине</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button
              type="button"
              onClick={() => setManualOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> + ID руками
            </button>
            <button
              type="button"
              onClick={saveNewBase}
              disabled={saving || !draftName.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ml-auto"
            >
              {saving ? 'Сохраняем…' : 'Сохранить базу'}
            </button>
          </div>

          {buffer.length === 0 ? (
            <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
              Корзина пустая. Добавьте людей кнопкой «В базу» в аудитории сверху или «+ ID руками».
            </div>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Кто</th>
                    <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Источник</th>
                    <th className="px-4 py-3 text-right text-[11px] font-black uppercase tracking-widest text-slate-400"></th>
                  </tr>
                </thead>
                <tbody>
                  {buffer.slice(0, 200).map((entry) => (
                    <tr key={entry.tempId} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="text-sm font-bold text-slate-900">
                          {entry.display_name || `TG ${entry.tg_user_id}`}
                        </div>
                        <div className="text-xs text-slate-500 font-mono">
                          {entry.username ? `@${entry.username}` : 'без username'} · {entry.tg_user_id}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-1 rounded-md text-[11px] font-bold ${
                          entry.source === 'manual' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'
                        }`}>
                          {entry.source === 'manual' ? 'Вбит' : 'Из аудитории'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => removeFromBuffer(entry.tempId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {buffer.length > 200 ? (
                <div className="px-4 py-3 text-xs font-medium text-slate-500">
                  Показываем первые 200 из {buffer.length}. Все попадут в базу при сохранении.
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      <ManualAddDialog
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onSubmit={mode === 'existing' ? addMembersBulkToExisting : addBufferFromCsv}
        mode={mode}
      />
    </div>
  );
}
