import * as React from 'react';

const TabsContext = React.createContext({ value: '', onValueChange: () => {} });

function Tabs({ value, onValueChange, className = '', children, ...props }) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div className={className} {...props}>{children}</div>
    </TabsContext.Provider>
  );
}

function TabsList({ className = '', children, ...props }) {
  return (
    <div
      role="tablist"
      className={`inline-flex h-11 items-center gap-1 rounded-xl bg-slate-100 p-1 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

function TabsTrigger({ value, className = '', children, ...props }) {
  const ctx = React.useContext(TabsContext);
  const active = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 h-9 text-sm font-bold transition-all ${
        active
          ? 'bg-white text-slate-900 shadow-sm'
          : 'text-slate-500 hover:text-slate-700'
      } ${className}`}
      onClick={() => ctx.onValueChange(value)}
      {...props}
    >
      {children}
    </button>
  );
}

function TabsContent({ value, className = '', children, ...props }) {
  const ctx = React.useContext(TabsContext);
  if (ctx.value !== value) return null;
  return (
    <div role="tabpanel" className={className} {...props}>
      {children}
    </div>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
