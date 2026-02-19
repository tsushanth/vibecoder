-- VibeCoder Database Schema - Custom Domains
-- Run this in your Supabase SQL editor

-- ============================================
-- Custom Domains Table
-- ============================================

CREATE TABLE IF NOT EXISTS custom_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    user_id VARCHAR(128) NOT NULL REFERENCES users(user_id),
    domain VARCHAR(255) NOT NULL UNIQUE,
    verification_status VARCHAR(50) DEFAULT 'pending',  -- pending, dns_verified, ssl_provisioning, active, failed
    verification_token VARCHAR(100) NOT NULL,
    ssl_certificate_id VARCHAR(200),                     -- Fly.io cert ID
    last_checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_custom_domains_domain ON custom_domains(domain);
CREATE INDEX IF NOT EXISTS idx_custom_domains_deployment ON custom_domains(deployment_id);
CREATE INDEX IF NOT EXISTS idx_custom_domains_user ON custom_domains(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_domains_status ON custom_domains(verification_status);

-- ============================================
-- RLS Policies
-- ============================================

ALTER TABLE custom_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY custom_domains_select_own ON custom_domains
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY custom_domains_insert_own ON custom_domains
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY custom_domains_update_own ON custom_domains
    FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY custom_domains_delete_own ON custom_domains
    FOR DELETE USING (user_id = auth.uid());
