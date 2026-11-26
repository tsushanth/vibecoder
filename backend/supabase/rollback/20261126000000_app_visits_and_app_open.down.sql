-- Reverses 20261126000000_app_visits_and_app_open.sql. Roll the API and deploy server back first (they fail soft without these,
-- but would report the failure). Dropping the table loses the visit counts.
drop index if exists public.app_events_app_open_daily;
drop function if exists public.vibebuild_creator_visits(text);
drop function if exists public.vibebuild_record_app_visit(text);
drop table if exists public.vibebuild_app_visits;
