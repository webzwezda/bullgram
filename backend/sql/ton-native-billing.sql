-- TON-native tier pricing: new billing orders no longer carry a ruble amount.
alter table public.billing_orders
    alter column amount_rub drop not null;
