const fs = require('fs');
const file = 'admin-v2/src/pages/bots/UserbotOnboardingSection.jsx';
let content = fs.readFileSync(file, 'utf8');

// There are probably other selects like fingerprint presets
content = content.replaceAll(
  'h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[15px] text-slate-950 outline-none transition focus:border-blue-300',
  'h-12 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-4 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 shadow-sm'
);

fs.writeFileSync(file, content);
console.log('done select fixes');
