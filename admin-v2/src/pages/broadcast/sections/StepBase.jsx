import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import { memberDisplayName, paymentBadge, coverageLabel, coverageChannels } from '../../bases/shared.js';
import { PlanBanner } from '../../../ui/PlanBanner.jsx';
import { UpgradeCallout } from '../../../ui/UpgradeCallout.jsx';
import { MEMBERS_PAGE_SIZE } from '../utils/broadcastDraft.js';
import {
  Card, Section, SectionTitle, EmptyNote, ErrorNote,
  TableShell, Th, Td, Tr, inputCls, btnGhost
} from '../ui.jsx';

export function StepBase({
  step,
  form,
  setField,
  titleEmpty,
  baseOptions,
  baseSelected,
  state,
  manual,
  members,
  clientSelectionActive,
  selectedIds,
  setSelectedIds,
  visibleMemberIds,
  toggleAllVisibleRecipients,
  toggleRecipient,
  membersPage,
  setMembersPage,
  setMembersReloadKey,
  broadcastEnabled,
  planRules
}) {
  return (
    <>
      {step === 'base' ? (
        <Card>
          <Section>
            <SectionTitle icon={Users}>База</SectionTitle>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Название</div>
                <input
                  className={`${inputCls} ${titleEmpty ? '!border-rose-300 focus:!border-rose-400' : ''}`}
                  type="text"
                  value={form.title}
                  onChange={(e) => setField('title', e.target.value)}
                  placeholder="Название рассылки — обязательно"
                />
              </div>
              <div>
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-1.5">База</div>
                <select
                  className={`${inputCls} ${form.base === '' ? 'text-slate-400' : ''}`}
                  value={form.base}
                  onChange={(e) => setField('base', e.target.value)}
                >
                  <option value="" className="text-slate-400">Выбери базу</option>
                  {baseOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.name}{opt.count !== null ? ` • ${opt.count} чел.` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {!baseSelected ? (
              state.clientBases.length === 0 && (manual.tg_user_ids || []).length === 0 ? (
                <div className="mt-3">
                  <EmptyNote>
                    Пока нет ни одной базы.{' '}
                    <Link to="/bases" className="text-indigo-600 font-bold hover:text-indigo-700">Создать базу</Link>
                  </EmptyNote>
                </div>
              ) : (
                <div className="mt-3 text-sm text-slate-500 font-medium">
                  Базы создаются руками на странице «Базы». Ручная выборка передаётся из CRM и брошенных корзин.
                </div>
              )
            ) : null}
            {!baseSelected ? (
              <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50/60 p-5">
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-3">Что дальше</div>
                <ol className="space-y-2.5 text-sm text-slate-600 font-medium">
                  <li className="flex gap-2.5"><span className="text-slate-900 font-black">2.</span> Юзерботы — проверим готовность: кто может доставить сообщение (общий чат, права админа).</li>
                  <li className="flex gap-2.5"><span className="text-slate-900 font-black">3.</span> Шаблоны — что напишем: приветственное сообщение от имени юзербота.</li>
                  <li className="flex gap-2.5"><span className="text-slate-900 font-black">4.</span> Отправка — рассылка встанет в очередь и уйдёт по одному с паузами, чтобы не поймать бан.</li>
                </ol>
              </div>
            ) : null}
            {form.base.startsWith('client:') ? (
              members.loading ? (
                <div className="mt-4"><EmptyNote>Грузим состав базы...</EmptyNote></div>
              ) : members.error ? (
                <div className="mt-4">
                  <ErrorNote>Не удалось загрузить состав базы: {members.error}</ErrorNote>
                  <button
                    type="button"
                    className={`${btnGhost} mt-3`}
                    onClick={() => setMembersReloadKey((key) => key + 1)}
                  >
                    Повторить
                  </button>
                </div>
              ) : (
                <div className="mt-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm text-slate-600 font-medium">
                      {members.total === 0
                        ? 'База пустая.'
                        : clientSelectionActive
                          ? `Получат: ${selectedIds.length} из ${members.total} человек.`
                          : `В базе: ${members.total} человек — письмо пойдёт всем.`}
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      {clientSelectionActive ? (
                        <button
                          type="button"
                          className="text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors"
                          onClick={() => setSelectedIds([])}
                        >
                          Писать всей базе
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {members.rows.length > 0 ? (
                    <div className="mt-3">
                      <TableShell>
                    <thead>
                      <tr>
                        <Th>
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-indigo-600"
                            checked={visibleMemberIds.length > 0 && visibleMemberIds.every((id) => selectedIds.includes(id))}
                            onChange={toggleAllVisibleRecipients}
                            aria-label="Отметить всех видимых"
                          />
                        </Th>
                        <Th>Кто</Th>
                        <Th>Деньги</Th>
                        <Th>Где есть</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.rows.map((member) => {
                        const badge = paymentBadge(member.payment_status);
                        const cov = coverageChannels(member);
                        return (
                          <Tr key={member.id}>
                            <Td>
                              <input
                                type="checkbox"
                                className="w-4 h-4 accent-indigo-600"
                                checked={selectedIds.includes(String(member.tg_user_id))}
                                onChange={() => toggleRecipient(String(member.tg_user_id))}
                              />
                            </Td>
                            <Td>
                              <div className="text-sm font-bold text-slate-900">{memberDisplayName(member)}</div>
                              <div className="text-xs text-slate-500 font-mono">
                                {member.username ? `@${member.username}` : 'без username'} · {member.tg_user_id}
                              </div>
                            </Td>
                            <Td>
                              <span className={`inline-flex px-2 py-1 rounded-md text-[11px] font-black ${badge.cls}`}>
                                {badge.text}
                              </span>
                              <div className="text-xs text-slate-500 font-medium mt-1">
                                {member.active_subscription_count || 0} активн. · {member.expired_subscription_count || 0} истекш.
                              </div>
                            </Td>
                            <Td>
                              <div className="text-xs font-black uppercase tracking-wider text-slate-500 mb-1">
                                {coverageLabel(member)}
                              </div>
                              {cov.presentTotal > 0 ? (
                                <div className="text-xs text-slate-700">В: {cov.present.join(', ')}</div>
                              ) : (
                                <div className="text-xs text-slate-500">Нигде не найден</div>
                              )}
                            </Td>
                          </Tr>
                        );
                      })}
                    </tbody>
                  </TableShell>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs text-slate-500 font-medium">
                          Страница {membersPage + 1} из {Math.max(Math.ceil(members.total / MEMBERS_PAGE_SIZE), 1)} · всего {members.total}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className={btnGhost}
                            disabled={membersPage === 0 || members.loading}
                            onClick={() => setMembersPage((prev) => Math.max(prev - 1, 0))}
                          >
                            Назад
                          </button>
                          <button
                            type="button"
                            className={btnGhost}
                            disabled={(membersPage + 1) * MEMBERS_PAGE_SIZE >= members.total || members.loading}
                            onClick={() => setMembersPage((prev) => prev + 1)}
                          >
                            Вперёд
                          </button>
                        </div>
                      </div>
                  </div>
                    ) : null}
                </div>
              )
              ) : form.base === 'manual' ? (
              <div className="mt-3 text-sm text-slate-500 font-medium">
                Ручная выборка: {manual.tg_user_ids.length} человек.
              </div>
            ) : null}
          </Section>
        </Card>
      ) : null}

      {step === 'base' && !broadcastEnabled ? (
        <div className="p-5 rounded-2xl bg-amber-50 border border-amber-200">
          <div className="text-sm font-black text-amber-700">
            Рассылка через юзерботов выключена на сервере (USERBOT_BROADCAST_ENABLED).
          </div>
          <div className="mt-1 text-sm text-amber-700 font-medium">
            Попроси владельца включить флаг. Отправка не пройдёт, так что подготовку можно не гонять.
          </div>
        </div>
      ) : null}

      {!planRules.canSendBroadcasts ? (
        <>
          <PlanBanner
            tone="warning"
            title="Trial: отправка рассылок закрыта"
            text="На Trial можно собрать базу и прогнать подготовку. Отправка откроется на Pro."
          />
          <UpgradeCallout
            text="Переходи на Pro, чтобы отправлять рассылки по собранной базе."
          />
        </>
      ) : null}

      {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}

    </>
  );
}
