-- Custom domains (bring-your-own-domain) for published apps.
-- Replaces database_migration_custom_domains.sql, whose RLS policies compared the
-- varchar user_id to auth.uid() (uuid) and fail to create. Only the backend
-- (service role, which bypasses RLS) touches this table, so RLS stays on with no policies.

CREATE TABLE IF NOT EXISTS custom_domains (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deployment_id        UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    user_id              VARCHAR(128) NOT NULL REFERENCES users(user_id),
    domain               VARCHAR(255) NOT NULL UNIQUE,
    verification_status  VARCHAR(50) NOT NULL DEFAULT 'pending',  -- pending, ssl_provisioning, active, failed
    verification_token   VARCHAR(100) NOT NULL,
    ssl_certificate_id   VARCHAR(200),
    last_checked_at      TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One custom domain per deployment (the service and clients assume this).
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_domains_one_per_deployment ON custom_domains(deployment_id);
CREATE INDEX IF NOT EXISTS idx_custom_domains_user ON custom_domains(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_domains_status ON custom_domains(verification_status);

ALTER TABLE custom_domains ENABLE ROW LEVEL SECURITY;
