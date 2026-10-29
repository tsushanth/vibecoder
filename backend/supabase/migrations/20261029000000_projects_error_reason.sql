-- Why a build failed: reason class (DISPATCH_ERROR, WORKER_ERROR, NO_RESULT, TIMEOUT_STUCK, RETRY_EXHAUSTED, UNKNOWN),
-- optionally followed by ": " and a short sanitized message. Written best-effort by the backend after status = 'failed'.
-- Additive and nullable; the backend works with or without it.
alter table projects add column if not exists error_reason text;
