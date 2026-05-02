const fs = require('fs');

function updateLiveUserbots() {
  const file = 'admin-v2/src/pages/bots/LiveUserbotsSection.jsx';
  if (!fs.existsSync(file)) return;
  let content = fs.readFileSync(file, 'utf8');

  // Title uppercase
  content = content.replace(
    'text-[12px] font-medium uppercase tracking-[0.08em] text-slate-400">Боевые аккаунты',
    'text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Боевые аккаунты'
  );

  // Main Select
  content = content.replace(
    'className="h-12 w-full rounded-[16px] border border-slate-200 bg-white px-4 text-[15px] font-medium text-slate-900 outline-none transition focus:border-blue-500"',
    'className="h-12 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-4 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 shadow-sm"'
  );

  // Username
  content = content.replace(
    'text-[26px] font-semibold tracking-[-0.03em] text-slate-950',
    'text-[24px] font-black tracking-tight text-slate-900'
  );

  // Main box
  content = content.replace(
    'rounded-[20px] bg-slate-50/70 p-5',
    'rounded-[24px] bg-slate-50/50 p-6 border border-slate-100/80 shadow-inner'
  );

  // Proxies subbox
  content = content.replace(
    'rounded-[18px] border border-slate-200 bg-white p-4',
    'rounded-[20px] border border-slate-200/60 bg-white p-5 shadow-sm'
  );

  // Inner proxies select
  content = content.replace(
    'className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-900 outline-none transition focus:border-blue-500"',
    'className="h-11 w-full rounded-[12px] border border-slate-200 bg-slate-50 px-4 text-[13px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"'
  );

  // Alerts
  content = content.replace(
    'rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-800',
    'rounded-[16px] border border-amber-200/50 bg-amber-50/50 px-4 py-3 text-[13px] font-medium text-amber-800'
  );

  content = content.replace(
    'rounded-[14px] border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-700',
    'rounded-[16px] border border-rose-200/50 bg-rose-50/50 px-4 py-3 text-[13px] font-medium text-rose-800'
  );

  fs.writeFileSync(file, content);
}

function updateListedShop() {
  const file = 'admin-v2/src/pages/bots/ListedShopUserbotsSection.jsx';
  if (!fs.existsSync(file)) return;
  let content = fs.readFileSync(file, 'utf8');

  // Title
  content = content.replace(
    'text-[12px] font-medium uppercase tracking-[0.08em] text-slate-400">Выставлены в Shop',
    'text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Выставлены в Shop'
  );

  // Select
  content = content.replace(
    'className="h-12 w-full rounded-[16px] border border-slate-200 bg-white px-4 text-[15px] font-medium text-slate-900 outline-none transition focus:border-blue-500"',
    'className="h-12 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-4 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 shadow-sm"'
  );

  // Username
  content = content.replace(
    'text-[16px] font-semibold tracking-[-0.02em] text-slate-900',
    'text-[20px] font-black tracking-tight text-slate-900'
  );

  // Box
  content = content.replace(
    'rounded-[20px] border border-slate-200 bg-slate-50/70 p-4',
    'rounded-[24px] border border-slate-200/60 bg-slate-50/50 p-5 shadow-sm'
  );

  // Labels
  content = content.replace(
    'text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Лот',
    'text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Лот'
  );
  content = content.replace(
    'text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Состав',
    'text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Состав'
  );

  // White inner boxes
  content = content.replaceAll(
    'rounded-[16px] bg-white px-4 py-3',
    'rounded-[16px] bg-white px-4 py-3 border border-slate-100 shadow-sm'
  );

  // Alert
  content = content.replace(
    'rounded-[16px] border border-amber-200 bg-amber-50 px-4 py-3',
    'rounded-[16px] border border-amber-200/50 bg-amber-50/50 px-4 py-3'
  );

  fs.writeFileSync(file, content);
}

updateLiveUserbots();
updateListedShop();
console.log('updated sections');
