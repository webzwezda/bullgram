import { Loader2, Send, UserPlus } from 'lucide-react';

export function GroupsTab({ manualInviteLink, setManualInviteLink, joinInviteLink, actionState, manualTgUserId, setManualTgUserId, manualCommonChatId, setManualCommonChatId, manualDirectMessage, setManualDirectMessage, sendDirectMessage }) {
  return (
      <div className="p-5 sm:p-6 space-y-5 animate-fade-in">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
            <UserPlus className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900">Вступить в группу или чат</h3>
            <p className="text-xs font-medium text-slate-500 mt-0.5">
              Любая ссылка: t.me/groupname, @groupname, t.me/+hash, t.me/joinchat/hash или t.me/s/groupname.
            </p>
          </div>
        </div>

        <div className="bg-slate-50/60 rounded-xl border border-slate-100 p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              className="h-11 flex-1 px-4 rounded-xl border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
              type="text"
              value={manualInviteLink}
              onChange={(event) => setManualInviteLink(event.target.value)}
              placeholder="t.me/groupname, @groupname или t.me/+hash"
            />
            <button
              className="h-11 px-5 rounded-xl bg-indigo-600 text-[14px] font-bold text-white hover:bg-indigo-700 transition-all disabled:opacity-50 shadow-sm shadow-indigo-200/50 inline-flex items-center justify-center gap-2 whitespace-nowrap"
              onClick={joinInviteLink}
              disabled={actionState.joiningInvite}
            >
              {actionState.joiningInvite ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Заходим...
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  Вступить
                </>
              )}
            </button>
          </div>
          <div className="text-xs text-slate-500">
            Для приватного канала нужна пригласительная ссылка (t.me/+hash), не permalink (t.me/c/&lt;id&gt;).
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
            <Send className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900">Написать в ЛС клиенту</h3>
            <p className="text-xs font-medium text-slate-500 mt-0.5">
              Доставка сработает, если у юзербота есть общий чат с этим человеком
              (например, ваша админ-группа воронки) — холодные рассылки по ID Telegram не поддерживаются.
            </p>
          </div>
        </div>

        <div className="bg-slate-50/60 rounded-xl border border-slate-100 p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              className="h-11 flex-1 px-4 rounded-xl border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
              type="text"
              value={manualTgUserId}
              onChange={(event) => setManualTgUserId(event.target.value)}
              placeholder="TG ID клиента, например 8414225338"
            />
            <input
              className="h-11 flex-1 px-4 rounded-xl border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
              type="text"
              value={manualCommonChatId}
              onChange={(event) => setManualCommonChatId(event.target.value)}
              placeholder="ID общего чата, например -1001234567890"
            />
          </div>
          <textarea
            className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
            rows={3}
            value={manualDirectMessage}
            onChange={(event) => setManualDirectMessage(event.target.value)}
            placeholder="Текст сообщения клиенту"
          />
          <button
            className="h-11 px-5 rounded-xl bg-indigo-600 text-[14px] font-bold text-white hover:bg-indigo-700 transition-all disabled:opacity-50 shadow-sm shadow-indigo-200/50 inline-flex items-center justify-center gap-2"
            onClick={sendDirectMessage}
            disabled={actionState.sendingDirect}
          >
            {actionState.sendingDirect ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Отправляем...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Отправить ЛС
              </>
            )}
          </button>
        </div>
      </div>
  );
}
