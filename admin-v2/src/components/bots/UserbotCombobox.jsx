import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const BASE_BUTTON_CLASSES = 'group inline-flex items-center gap-1.5 rounded-lg border border-input bg-transparent text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

function photoSrcFor(account) {
  if (account?.tg_photo_url) {
    const v = account.tg_photo_synced_at ? `?v=${encodeURIComponent(account.tg_photo_synced_at)}` : '';
    return `${account.tg_photo_url}${v}`;
  }
  return account?.tg_photo_data_url || '';
}

function initialFor(account) {
  const name = [account?.tg_first_name, account?.tg_last_name].filter(Boolean).join(' ').trim();
  const base = name || account?.tg_username || String(account?.tg_account_id || '?');
  return base.slice(0, 1).toUpperCase();
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
            <>
              <div className="size-7 rounded-full overflow-hidden bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                {photoSrcFor(selectedAccount) ? (
                  <img src={photoSrcFor(selectedAccount)} alt="" className="size-7 object-cover" />
                ) : (
                  initialFor(selectedAccount)
                )}
              </div>
              <span className="font-bold text-slate-900 truncate max-w-[160px] sm:max-w-[220px]">
                {selectedAccount.custom_label || (selectedAccount.tg_username ? `@${selectedAccount.tg_username}` : 'Без username')}
              </span>
            </>
          ) : (
            <span className={cn('truncate', selectedAccount ? 'text-slate-900 font-medium' : 'text-muted-foreground')}>
              {selectedAccount ? (selectedAccount.custom_label || labelFor(selectedAccount)) : placeholder}
            </span>
          )}
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
              {accounts.map((account) => (
                <CommandItem
                  key={account.id}
                  value={String(account.id)}
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
                  {account.custom_label ? (
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium text-slate-900 truncate">{account.custom_label}</span>
                      <span className="text-[12px] text-slate-500 truncate">
                        {account.tg_username ? `@${account.tg_username}` : `ID ${account.tg_account_id}`}
                      </span>
                    </div>
                  ) : (
                    <span className="font-medium text-slate-900 truncate">
                      {account.tg_username ? `@${account.tg_username}` : `ID ${account.tg_account_id}`}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
