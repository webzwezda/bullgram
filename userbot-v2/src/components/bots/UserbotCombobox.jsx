import { useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { QUARANTINE_STATUSES } from '../../pages/bots/bots-accounts.utils.js';

const BASE_BUTTON_CLASSES = 'group inline-flex items-center gap-1.5 rounded-lg border border-input bg-transparent px-3 py-2 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

const SAFE_MODE_RUNTIME_STATUS = 'pending_activation';

function isSafeModeAccount(account) {
  return String(account?.runtime_status || '').trim().toLowerCase() === SAFE_MODE_RUNTIME_STATUS;
}

function isQuarantinedAccount(account) {
  return QUARANTINE_STATUSES.includes(String(account?.runtime_status || '').trim().toLowerCase());
}

// Индикатор режима аккаунта: щит = боевой контур, круг-алерт = safe-mode,
// щит-алерт (красный) = отстойник — заморозка/бан/мёртвая сессия/упавшая проверка.
// Иконки lucide (единственный источник иконок на сайте), цвета — только
// семантические пары feedback-*, чтобы не растить hardcodes-ratchet файла.
function AccountModeIcon({ account, iconClassName }) {
  const safeMode = isSafeModeAccount(account);
  const quarantined = !safeMode && isQuarantinedAccount(account);
  const Icon = quarantined ? ShieldAlert : (safeMode ? AlertCircle : ShieldCheck);
  const tone = quarantined
    ? 'text-feedback-error-text'
    : (safeMode ? 'text-feedback-warning-text' : 'text-feedback-success-text');
  const title = quarantined
    ? 'В отстойнике — продажа закрыта'
    : (safeMode ? 'Safe mode — ждёт ручной активации' : 'Боевой режим');
  return (
    <span
      className={cn('inline-flex items-center shrink-0', tone)}
      title={title}
    >
      <Icon className={iconClassName || 'w-4 h-4'} aria-hidden="true" />
      <span className="sr-only">{title}</span>
    </span>
  );
}

function labelFor(account) {
  return account?.tg_username ? `@${account.tg_username}` : `ID ${account?.tg_account_id}`;
}

export function UserbotCombobox({
  accounts,
  value,
  onValueChange,
  triggerVariant = 'plain',
  placeholder = 'Выбрать аккаунт',
  className,
  align = 'start',
  sideOffset = 4,
  emptyText = 'Ничего не найдено',
  searchPlaceholder = 'Поиск аккаунта…'
}) {
  const [open, setOpen] = useState(false);

  const selectedAccount = useMemo(
    () => accounts.find((account) => String(account.id) === String(value)) || null,
    [accounts, value]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(BASE_BUTTON_CLASSES, className)}
        >
          {triggerVariant === 'avatar' && selectedAccount ? (
            <span className="min-w-0 font-bold text-slate-950 truncate max-w-[160px] sm:max-w-[220px]">
              {selectedAccount.custom_label || (selectedAccount.tg_username ? `@${selectedAccount.tg_username}` : 'Без username')}
            </span>
          ) : (
            <span className={cn('min-w-0 truncate', selectedAccount ? 'text-slate-950 font-semibold' : 'text-slate-400')}>
              {selectedAccount ? (selectedAccount.custom_label || labelFor(selectedAccount)) : placeholder}
            </span>
          )}
          {selectedAccount ? <AccountModeIcon account={selectedAccount} /> : null}
          <ChevronDown className="ml-auto w-4 h-4 text-slate-400 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[300px] max-w-[calc(100vw-16px)] p-0"
        align={align}
        sideOffset={sideOffset}
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {accounts.map((account) => {
                const isSelected = String(account.id) === String(value);
                return (
                  <CommandItem
                    key={account.id}
                    value={String(account.id)}
                    data-checked={isSelected ? 'true' : undefined}
                    onSelect={() => {
                      onValueChange(String(account.id));
                      setOpen(false);
                    }}
                    keywords={[
                      account.custom_label || '',
                      account.tg_username || '',
                      account.tg_first_name || '',
                      account.tg_last_name || '',
                      account.tg_phone || '',
                      String(account.tg_account_id || '')
                    ].filter(Boolean)}
                    className="rounded-lg"
                  >
                    <AccountModeIcon account={account} iconClassName="w-4 h-4" />
                    {account.custom_label ? (
                      <div className="flex flex-col min-w-0">
                        <span className="font-semibold text-slate-950 truncate">{account.custom_label}</span>
                        <span className="text-[12px] text-slate-600 truncate">
                          {account.tg_username ? `@${account.tg_username}` : `ID ${account.tg_account_id}`}
                        </span>
                      </div>
                    ) : (
                      <span className="font-semibold text-slate-950 truncate">
                        {account.tg_username ? `@${account.tg_username}` : `ID ${account.tg_account_id}`}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
