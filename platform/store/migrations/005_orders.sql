-- Paid orders recorded from a creator's Stripe webhook (creator-keyed checkout). One row per Checkout Session.
-- Unique per (app_id, session_id) rather than session_id alone: each app verifies webhooks with its own creator's secret,
-- so a malicious creator could otherwise pre-claim another app's session id and make its real order insert a no-op.
-- Row level security is on and only the proxy's role may touch the table.
create table if not exists platform.orders (
    id                  uuid primary key default gen_random_uuid(),
    app_id              text not null references platform.apps(app_id) on delete cascade,
    session_id          text not null check (length(session_id) between 1 and 255),
    item_id             text not null check (length(item_id) between 1 and 64),
    quantity            integer not null check (quantity between 1 and 100),
    amount_cents        bigint not null check (amount_cents >= 0),
    currency            text not null check (currency ~ '^[a-z]{3}$'),
    status              text not null check (status in ('paid')),
    client_reference_id text check (length(client_reference_id) <= 200),
    customer_email      text check (length(customer_email) <= 254),
    created_at          timestamptz not null default now(),
    unique (app_id, session_id)
);
create index if not exists orders_app_user on platform.orders (app_id, client_reference_id, created_at desc);
alter table platform.orders enable row level security;
drop policy if exists proxy_all on platform.orders;
create policy proxy_all on platform.orders to vibe_proxy using (true) with check (true);
grant select, insert, update, delete on platform.orders to vibe_proxy;
