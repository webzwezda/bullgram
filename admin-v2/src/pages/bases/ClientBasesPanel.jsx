import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Plus, AlertCircle, Users } from 'lucide-react';
import {
  fetchClientBases, createClientBase, addClientBaseMembers
} from '../../api/client-bases.js';
import { generateTempId, loadBuffer, loadPendingBaseId, saveBuffer, savePendingBaseId } from './shared.js';
import { ClientBaseEditor } from './ClientBaseEditor.jsx';
import { ManualAddDialog } from './ManualAddDialog.jsx';
import { BasesModeHeader } from './BasesModeHeader.jsx';
import { NewBaseBasket } from './NewBaseBasket.jsx';

export function ClientBasesPanel({ accessToken, activeBaseId, onChangeActiveBaseId, addToBaseRequest, onConsumeAddRequest, onTargetChange }) {
  const [bases, setBases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [mode, setMode] = useState('existing'); // 'existing' | 'new'
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [buffer, setBuffer] = useState(loadBuffer);
  const [saving, setSaving] = useState(false);
  // id базы, которая создалась, но залить в неё корзину не вышло.
  // Пока стоит — корзина сохраняется, кнопка «Сохранить базу» доливает в эту базу, а не создаёт дубль.
  const [pendingBaseId, setPendingBaseIdState] = useState(loadPendingBaseId);

  function setPendingBaseId(id) {
    setPendingBaseIdState(id);
    savePendingBaseId(id);
  }

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
        // Без ?base остаёмся без выбора — никакого телепорта в первую базу.
        // Владелец сам выбирает базу в списке или создаёт новую.
        if (!activeBaseId) {
          setMode('existing');
        } else {
          const stillExists = list.find((b) => String(b.id) === String(activeBaseId));
          if (!stillExists) {
            // Выбранная база исчезла (удалена) — нейтральное состояние, без автовыбора первой.
            onChangeActiveBaseId(null);
            setMode('existing');
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
      // mode 'existing', но база не выбрана (нейтральное состояние) — не молчим.
      toast('Сначала выберите базу в карточке «Базы клиентов» — или создайте новую');
      onConsumeAddRequest?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addToBaseRequest]);

  const activeBase = useMemo(
    () => bases.find((b) => String(b.id) === String(activeBaseId)) || null,
    [bases, activeBaseId]
  );

  // Куда сейчас попадёт кнопка «В базу» из таблицы аудитории — сообщаем наверх
  // для чипа «Куда попадёт», чтобы адресат кнопки был виден всегда.
  useEffect(() => {
    if (mode === 'new') {
      onTargetChange?.('Корзина новой базы');
      return;
    }
    if (mode === 'existing' && activeBaseId) {
      const base = bases.find((b) => String(b.id) === String(activeBaseId));
      onTargetChange?.(base ? `База «${base.name}»` : null);
      return;
    }
    onTargetChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, activeBaseId, bases]);

  function selectBase(id) {
    onChangeActiveBaseId(id);
    setMode(id ? 'existing' : 'new');
    setPendingBaseId(null);
  }

  function startNew() {
    onChangeActiveBaseId(null);
    setMode('new');
    setDraftName('');
    setDraftDescription('');
    setPendingBaseId(null);
  }

  function pushToBuffer(member) {
    const tgId = String(member.tg_user_id);
    // Дубликат проверяем по текущему стейту ВНЕ setState-апдейтера:
    // тост из апдейтера задваивается в StrictMode, а дубликат не должен получать success.
    if (buffer.some((entry) => String(entry.tg_user_id) === tgId)) {
      toast(`Уже в корзине`, { duration: 2000 });
      return;
    }
    setBuffer((prev) => {
      // тихая защита от гонки, тостов внутри апдейтера больше нет
      if (prev.some((entry) => String(entry.tg_user_id) === tgId)) return prev;
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
    // Тот же принцип: считаем добавления вне апдейтера, тосты — только снаружи.
    const existing = new Set(buffer.map((e) => String(e.tg_user_id)));
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
    if (additions.length > 0) {
      setBuffer((prev) => [...prev, ...additions]);
    }
    if (duplicates > 0) {
      toast(`Дубликатов в корзине пропущено: ${duplicates}`, { duration: 2500 });
    }
    if (additions.length > 0) {
      toast.success(`Добавлено в корзину: ${additions.length}`);
    }
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
        toast.success(`База создана, добавлено ${result?.inserted || 0} · обновлено ${result?.updated || 0}${result?.skipped ? ` · пропущено (мусорный id) ${result.skipped}` : ''}`);
        finalizeNewBase(createdId);
      } catch (memberErr) {
        // База уже создана — её оставляем. Корзину и sessionStorage НЕ чистим,
        // чтобы админ мог повторить заливку без потери собранного списка.
        toast.error(`Базу создали, но людей залить не вышло: ${memberErr.message || ''}. Список остался в корзине — жми «Дозалить в созданную базу».`);
        setPendingBaseId(createdId);
        fetchClientBases(accessToken).then((data) => setBases(data.bases || [])).catch(() => {});
      }
    } catch (err) {
      toast.error(err.message || 'Не удалось создать базу');
    } finally {
      setSaving(false);
    }
  }

  async function retryPendingBase() {
    if (!pendingBaseId || buffer.length === 0) return;
    setSaving(true);
    try {
      const result = await addClientBaseMembers(accessToken, pendingBaseId, buffer.map((e) => ({
        tg_user_id: e.tg_user_id,
        username: e.username || '',
        display_name: e.display_name || '',
        source: e.source || 'manual'
      })));
      toast.success(`Долили в базу: ${result?.inserted || 0} · обновлено ${result?.updated || 0}${result?.skipped ? ` · пропущено (мусорный id) ${result.skipped}` : ''}`);
      finalizeNewBase(pendingBaseId);
    } catch (err) {
      toast.error(err.message || 'Опять не вышло. Корзина на месте — попробуй ещё раз');
    } finally {
      setSaving(false);
    }
  }

  function finalizeNewBase(createdId) {
    setBuffer([]);
    saveBuffer([]);
    setDraftName('');
    setDraftDescription('');
    setPendingBaseId(null);
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
    // Базу удалили — уходим в нейтральное состояние, без автовыбора первой оставшейся.
    onChangeActiveBaseId(null);
    setMode('existing');
    setPendingBaseId(null);
    fetchClientBases(accessToken).then((data) => setBases(data.bases || [])).catch(() => {});
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
      <BasesModeHeader
        bases={bases}
        mode={mode}
        activeBaseId={activeBaseId}
        bufferCount={buffer.length}
        draftName={draftName}
        draftDescription={draftDescription}
        onSelectBase={selectBase}
        onStartNew={startNew}
        onDraftNameChange={setDraftName}
        onDraftDescriptionChange={setDraftDescription}
      />

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
        ) : (
          <div className="p-16 text-center space-y-3 flex flex-col items-center">
            <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center text-slate-300">
              <Users className="w-8 h-8" />
            </div>
            <p className="text-slate-500 font-bold tracking-tight">Выберите базу из списка или создайте новую</p>
            <button
              type="button"
              onClick={startNew}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Создать базу
            </button>
          </div>
        )
      ) : (
        <NewBaseBasket
          buffer={buffer}
          saving={saving}
          pendingBaseId={pendingBaseId}
          draftName={draftName}
          onRemoveFromBuffer={removeFromBuffer}
          onSaveOrRetry={pendingBaseId ? retryPendingBase : saveNewBase}
          onOpenManual={() => setManualOpen(true)}
        />
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
