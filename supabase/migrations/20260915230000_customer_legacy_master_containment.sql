begin;

alter table public.customers enable row level security;
alter table public.customer_sites enable row level security;
alter table public.addresses enable row level security;
alter table public.external_customer_mappings enable row level security;

revoke all privileges on table public.customers from anon, authenticated;
revoke all privileges on table public.customer_sites from anon, authenticated;
revoke all privileges on table public.addresses from anon, authenticated;
revoke all privileges on table public.external_customer_mappings from anon, authenticated;

commit;
