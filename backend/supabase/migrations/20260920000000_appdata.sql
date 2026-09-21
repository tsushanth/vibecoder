-- Per-app key-value/document storage for generated (static) apps.
-- NOT applied automatically. Review, then run in the Supabase SQL editor.
-- app_id = deployments.subdomain. Only the backend (service role) touches this table.

CREATE TABLE IF NOT EXISTS app_data (
    app_id      TEXT        NOT NULL,
    collection  TEXT        NOT NULL,
    key         TEXT        NOT NULL,
    value       JSONB       NOT NULL,
    size_bytes  INTEGER     NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (app_id, collection, key),
    CONSTRAINT app_data_size_chk CHECK (size_bytes >= 0 AND size_bytes <= 65536)
);

-- RLS on with no policies: anon/authenticated get nothing; service role bypasses.
ALTER TABLE app_data ENABLE ROW LEVEL SECURITY;

-- Atomic quota-enforcing upsert (serialised per app via advisory lock).
-- Returns 'ok' | 'max_keys' | 'max_total'.
CREATE OR REPLACE FUNCTION app_data_put(
    p_app TEXT, p_collection TEXT, p_key TEXT, p_value JSONB, p_size INTEGER,
    p_max_keys INTEGER, p_max_total BIGINT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_old INTEGER;
    v_count INTEGER;
    v_total BIGINT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('app_data:' || p_app));
    SELECT size_bytes INTO v_old FROM app_data
        WHERE app_id = p_app AND collection = p_collection AND key = p_key;
    SELECT COUNT(*), COALESCE(SUM(size_bytes), 0) INTO v_count, v_total
        FROM app_data WHERE app_id = p_app;
    IF v_old IS NULL AND v_count >= p_max_keys THEN RETURN 'max_keys'; END IF;
    IF v_total - COALESCE(v_old, 0) + p_size > p_max_total THEN RETURN 'max_total'; END IF;
    INSERT INTO app_data (app_id, collection, key, value, size_bytes)
        VALUES (p_app, p_collection, p_key, p_value, p_size)
    ON CONFLICT (app_id, collection, key)
        DO UPDATE SET value = EXCLUDED.value, size_bytes = EXCLUDED.size_bytes, updated_at = NOW();
    RETURN 'ok';
END $$;

REVOKE ALL ON FUNCTION app_data_put(TEXT,TEXT,TEXT,JSONB,INTEGER,INTEGER,BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_data_put(TEXT,TEXT,TEXT,JSONB,INTEGER,INTEGER,BIGINT) TO service_role;
