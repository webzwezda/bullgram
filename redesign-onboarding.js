const fs = require('fs');
const file = 'admin-v2/src/pages/bots/UserbotOnboardingSection.jsx';
let content = fs.readFileSync(file, 'utf8');

// Replace standard icons with lucide-react if possible
// Actually first let's see what icons we can use. I will just rewrite the wrapper first.
content = content.replace(
  '<div className="mb-6 rounded-[18px] border border-slate-200/80 bg-white/95 px-6 py-6 shadow-sm">',
  '<div className="mb-6 rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">'
);

// Title
content = content.replace(
  '<div className="text-[24px] leading-none font-semibold tracking-[-0.03em] text-slate-950">\\n            Подключить самому\\n          </div>',
  '<div className="text-[20px] font-semibold tracking-[-0.03em] text-slate-950 mb-6">\\n            Подключить самому\\n          </div>'
);

// Numbered circles
content = content.replaceAll(
  'className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[12px] font-semibold text-white"',
  'className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[12px] font-bold text-slate-600"'
);

// Step headers
content = content.replaceAll(
  'className="text-[16px] leading-none font-semibold tracking-[-0.03em] text-slate-950"',
  'className="text-[14px] font-bold uppercase tracking-[0.08em] text-slate-900"'
);

// Select box
content = content.replace(
  'className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[15px] text-slate-950 outline-none transition focus:border-blue-300"',
  'className="h-12 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-4 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 shadow-sm"'
);

// Switchers background
content = content.replaceAll(
  'rounded-[20px] bg-slate-100 p-2',
  'rounded-[16px] bg-slate-100/80 p-1.5 border border-slate-200/60'
);

// Active QR button
content = content.replace(
  "'bg-white text-blue-600 shadow-[0_8px_24px_rgba(15,23,42,0.10)]'",
  "'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/60'"
);
// Inactive QR button
content = content.replace(
  "'bg-transparent text-slate-600'",
  "'bg-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'"
);

// Active Files button
content = content.replace(
  "'bg-white text-slate-950 shadow-[0_8px_24px_rgba(15,23,42,0.10)]'",
  "'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/60'"
);
// Inactive Files button
content = content.replace(
  "'bg-transparent text-slate-500'",
  "'bg-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'"
);

// Decrease padding on switcher buttons
content = content.replaceAll(
  'rounded-[18px] px-5 py-4 text-[14px]',
  'rounded-[12px] px-4 py-2.5 text-[13px]'
);


fs.writeFileSync(file, content);
console.log('done redesign');
