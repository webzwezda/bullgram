export function ChannelsGrid({ channelsForBot, bases, channelId, contourChipsByChannel, onSelectChannel }) {
  return (
    <section className="p-6 md:p-8 border-b border-slate-100">
      <h3 className="text-sm font-black uppercase tracking-widest text-slate-500 mb-4">Каналы и группы</h3>
      {channelsForBot.length === 0 ? (
        <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
          У этого бота пока нет каналов. Создайте канал на странице «Бот продаж».
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {channelsForBot.map((ch) => {
            const active = String(ch.id) === String(channelId);
            const base = bases.find((b) => b.id === ch.linked_base_id);
            const count = base?.stats?.humans || 0;
            const hasAudience = !!ch.linked_base_id;
            const rightsChips = hasAudience && contourChipsByChannel
              ? contourChipsByChannel.get(String(ch.id)) || null
              : null;
            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => onSelectChannel(ch)}
                className={`p-4 rounded-2xl border text-left transition-all ${
                  active ? 'border-slate-900 bg-slate-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="text-sm font-black text-slate-900 truncate mb-1">{ch.title}</div>
                <div className="text-xs text-slate-500 font-medium">
                  {hasAudience ? `${count} чел.` : 'База не создана'}
                </div>
                {rightsChips ? (
                  !rightsChips.anyOk ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <span className="inline-flex items-center rounded-md border border-border-default bg-feedback-warning-bg px-1.5 py-0.5 text-xs font-bold text-left text-feedback-warning-text">
                        админа нет — рассылка может не дотянуться
                      </span>
                    </div>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {rightsChips.chips.slice(0, 3).map((chip, chipIdx) => (
                        <span
                          key={`${chip.label}-${chipIdx}`}
                          className={`inline-flex items-center rounded-md border border-border-default px-1.5 py-0.5 text-xs font-bold ${
                            chip.ok
                              ? 'bg-feedback-success-bg text-feedback-success-text'
                              : 'bg-feedback-warning-bg text-feedback-warning-text'
                          }`}
                        >
                          {chip.ok ? `${chip.label}: админ ✓` : `${chip.label}: не админ`}
                        </span>
                      ))}
                      {rightsChips.chips.length > 3 ? (
                        <span className="inline-flex items-center rounded-md border border-border-default bg-surface-subtle px-1.5 py-0.5 text-xs font-bold text-ink-muted">
                          +{rightsChips.chips.length - 3}
                        </span>
                      ) : null}
                    </div>
                  )
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
