import * as React from 'react';
import { cva } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const TabsContext = React.createContext({ value: '', onValueChange: () => {} });

const tabsListVariants = cva('inline-flex h-11 items-center gap-1 rounded-xl bg-slate-100 p-1');

const tabsTriggerVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg px-4 h-9 text-sm font-bold transition-all',
  {
    variants: {
      active: {
        true: 'bg-white text-slate-900 shadow-sm',
        false: 'text-slate-500 hover:text-slate-700',
      },
    },
    defaultVariants: {
      active: false,
    },
  }
);

function Tabs({ value, onValueChange, className = '', children, ...props }) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div data-slot="tabs" className={className} {...props}>{children}</div>
    </TabsContext.Provider>
  );
}

function TabsList({ className = '', children, ...props }) {
  return (
    <div
      role="tablist"
      data-slot="tabs-list"
      className={cn(tabsListVariants(), className)}
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
      data-slot="tabs-trigger"
      data-state={active ? 'active' : 'inactive'}
      className={cn(tabsTriggerVariants({ active }), className)}
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
    <div role="tabpanel" data-slot="tabs-content" className={className} {...props}>
      {children}
    </div>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
