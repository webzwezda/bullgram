const fs = require('fs');
const file = 'admin-v2/src/pages/bots/LiveUserbotsSection.jsx';
let content = fs.readFileSync(file, 'utf8');

// Update imports
if (!content.includes('lucide-react')) {
  content = content.replace("import { UserbotSaleComposer } from './UserbotSaleComposer.jsx';", "import { Trash2, ShieldCheck, AlertCircle } from 'lucide-react';\nimport { UserbotSaleComposer } from './UserbotSaleComposer.jsx';");
}

// Update the wrapper
const oldWrapperStart = `<div className="section">
      <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        {liveUserbots.length === 0 || !selectedLiveUserbot ? (
          <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50/60 px-5 py-6">
            <div className="text-[16px] font-semibold text-slate-900">Боевых юзерботов пока нет</div>
            <div className="mt-1 text-[14px] text-slate-500">Сначала подключи аккаунт выше.</div>
          </div>
        ) : (`;

const newWrapperStart = `<div className="mb-6 rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        {liveUserbots.length === 0 || !selectedLiveUserbot ? (
          <div className="rounded-[16px] border border-dashed border-slate-200 bg-slate-50/60 px-5 py-8 text-center">
            <div className="text-[14px] font-medium text-slate-500">Боевых юзерботов пока нет.<br/>Сначала подключи аккаунт выше.</div>
          </div>
        ) : (`;

content = content.replace(oldWrapperStart, newWrapperStart);

// At the very end, we need to remove the extra closing div
// because we removed `<div className="section">` wrapper
const oldEnd = `        )}
      </div>
    </div>
  );
}`;

const newEnd = `        )}
    </div>
  );
}`;
content = content.replace(oldEnd, newEnd);

// Header and delete button
const oldHeader = `<div className="flex items-center justify-between gap-3">
                      <div className="flex items-center">
                        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Боевые аккаунты</span>
                        <span className="ml-2 inline-flex min-w-6 items-center justify-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                          {liveUserbots.length}
                        </span>
                      </div>
                      <button
                        className="inline-flex h-9 items-center justify-center rounded-[12px] border border-rose-200 bg-rose-50 px-3 text-[13px] font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => deleteAccount(account)}
                        disabled={state.deletingAccountId === String(account.id)}
                      >
                        {state.deletingAccountId === String(account.id) ? 'Удаляем...' : 'Удалить'}
                      </button>
                    </div>`;

const newHeader = `<div className="mb-6 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="text-[20px] font-semibold tracking-[-0.03em] text-slate-950">
                          Боевые аккаунты
                        </div>
                        <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-slate-100 px-2 py-0.5 text-[12px] font-bold text-slate-600">
                          {liveUserbots.length}
                        </span>
                      </div>
                      <button
                        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[12px] border border-rose-200 bg-rose-50 px-3 text-[13px] font-semibold text-rose-700 transition hover:bg-rose-100 hover:text-rose-800 disabled:cursor-not-allowed disabled:opacity-50 shadow-sm"
                        onClick={() => deleteAccount(account)}
                        disabled={state.deletingAccountId === String(account.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {state.deletingAccountId === String(account.id) ? 'Удаляем...' : 'Удалить'}
                      </button>
                    </div>`;

content = content.replace(oldHeader, newHeader);


// The gap wrappers 
content = content.replace(
  '<div className="space-y-5">',
  '<div className="space-y-6">'
);

content = content.replace(
  '<div className="flex flex-col gap-2">',
  '<div>' // simplify
);

// The proxy header
content = content.replace(
  '<div className="text-[15px] font-semibold text-slate-900">Прокси сейчас</div>',
  `<div className="flex items-center gap-2 mb-3">
                        <ShieldCheck className="w-4 h-4 text-slate-400" />
                        <div className="text-[14px] font-bold text-slate-900">Прокси сейчас</div>
                      </div>`
);

// Warnings 
content = content.replace(
  '<div className="mt-4 rounded-[16px] border border-amber-200/50 bg-amber-50/50 px-4 py-3 text-[13px] font-medium text-amber-800">\n                          Сейчас это safe-mode. В работу зайдет только после живой активации.\n                        </div>',
  `<div className="mt-4 flex items-start gap-2.5 rounded-[16px] border border-amber-200/50 bg-amber-50/50 px-4 py-3">
                        <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                        <div className="text-[13px] font-medium text-amber-800">
                          Сейчас это safe-mode. В работу зайдет только после живой активации.
                        </div>
                      </div>`
);

content = content.replace(
  '<div className="mt-4 rounded-[16px] border border-rose-200/50 bg-rose-50/50 px-4 py-3 text-[13px] font-medium text-rose-800">\n                          {account.runtime_error}\n                        </div>',
  `<div className="mt-4 flex items-start gap-2.5 rounded-[16px] border border-rose-200/50 bg-rose-50/50 px-4 py-3">
                        <AlertCircle className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
                        <div className="text-[13px] font-medium text-rose-800">
                          {account.runtime_error}
                        </div>
                      </div>`
);

content = content.replace(
  '<div className="mt-3 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-800">\n                            <div className="font-medium">Прокси не назначен</div>\n                            <div className="mt-1">Без него этот аккаунт в работу не пускай.</div>\n                          </div>',
  `<div className="flex items-start gap-2.5 rounded-[12px] border border-amber-200/50 bg-amber-50/50 px-3.5 py-3">
                          <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                          <div>
                            <div className="text-[13px] font-bold text-amber-900">Прокси не назначен</div>
                            <div className="text-[12px] font-medium text-amber-700/80">Без него этот аккаунт в работу не пускай.</div>
                          </div>
                        </div>`
);


fs.writeFileSync(file, content);
console.log('rewrote LiveUserbotsSection');
