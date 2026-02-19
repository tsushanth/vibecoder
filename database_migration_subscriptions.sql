-- VibeCoder Database Schema - Subscription Model
-- Run this in your Supabase SQL editor

-- Drop old coin-related tables if they exist
DROP TABLE IF EXISTS payout_requests CASCADE;
DROP TABLE IF EXISTS creator_earnings CASCADE;
DROP TABLE IF EXISTS coin_transactions CASCADE;
DROP TABLE IF EXISTS user_coins CASCADE;
DROP TABLE IF EXISTS stripe_accounts CASCADE;

-- ============================================
-- Core Tables
-- ============================================

CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(128) PRIMARY KEY,
    email VARCHAR(255),
    display_name VARCHAR(100),
    avatar_url TEXT,
    subscription_tier VARCHAR(50) DEFAULT 'free',
    subscription_status VARCHAR(50) DEFAULT 'active',
    subscription_expires_at TIMESTAMPTZ,
    daily_generation_count INTEGER DEFAULT 0,
    last_generation_date DATE,
    total_projects INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    bundle TEXT,                          -- base64 ZIP of project files
    creator_id VARCHAR(128) NOT NULL REFERENCES users(user_id),
    creator_name VARCHAR(100),
    project_type VARCHAR(50) DEFAULT 'web_app',
    is_public BOOLEAN DEFAULT true,
    is_featured BOOLEAN DEFAULT false,
    view_count INTEGER DEFAULT 0,
    fork_count INTEGER DEFAULT 0,
    rating NUMERIC(3,2) DEFAULT 0,
    initial_prompt TEXT,
    github_repo VARCHAR(200),
    tweak_count INTEGER DEFAULT 0,        -- Track number of tweaks used
    published_url VARCHAR(500),
    published_commit VARCHAR(40),
    parent_project_id UUID REFERENCES projects(id),
    creation_method VARCHAR(50) DEFAULT 'ai_generated',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Subscription Tables
-- ============================================

CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(128) NOT NULL REFERENCES users(user_id),
    tier VARCHAR(50) NOT NULL,            -- free, pro, team, enterprise
    status VARCHAR(50) NOT NULL,          -- active, cancelled, expired, trialing
    platform VARCHAR(50) NOT NULL,        -- ios, android, web, stripe
    transaction_id VARCHAR(255),          -- App Store/Play Store transaction ID
    original_transaction_id VARCHAR(255), -- For subscription management
    expires_at TIMESTAMPTZ,
    auto_renew BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usage_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(128) NOT NULL REFERENCES users(user_id),
    action_type VARCHAR(50) NOT NULL,    -- generation, tweak, fork, download
    project_id UUID REFERENCES projects(id),
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(128) NOT NULL REFERENCES users(user_id),
    subscription_id UUID REFERENCES subscriptions(id),
    tier VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL,         -- started, renewed, upgraded, downgraded, cancelled
    platform VARCHAR(50),
    transaction_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Supporting Tables
-- ============================================

CREATE TABLE IF NOT EXISTS project_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_path VARCHAR(500) NOT NULL,
    content TEXT,
    file_size INTEGER,
    mime_type VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id VARCHAR(128) NOT NULL REFERENCES users(user_id),
    role VARCHAR(20) NOT NULL,           -- user, assistant
    content TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id VARCHAR(128) NOT NULL REFERENCES users(user_id),
    subdomain VARCHAR(100) NOT NULL UNIQUE,
    bundle TEXT NOT NULL,
    custom_domain VARCHAR(255),
    status VARCHAR(50) DEFAULT 'active',  -- active, inactive
    deployed_at TIMESTAMPTZ DEFAULT NOW(),
    last_accessed TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS project_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label VARCHAR(200) NOT NULL,
    prompt TEXT NOT NULL,
    category VARCHAR(100),
    icon VARCHAR(50),
    difficulty VARCHAR(20),              -- beginner, intermediate, advanced
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    commit_sha VARCHAR(40),
    bundle TEXT,
    commit_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_users_subscription_tier ON users(subscription_tier);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_projects_creator ON projects(creator_id);
CREATE INDEX IF NOT EXISTS idx_projects_public ON projects(is_public);
CREATE INDEX IF NOT EXISTS idx_projects_featured ON projects(is_featured);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_usage_records_user ON usage_records(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_records_date ON usage_records(created_at);
CREATE INDEX IF NOT EXISTS idx_deployments_subdomain ON deployments(subdomain);
CREATE INDEX IF NOT EXISTS idx_project_chats_project ON project_chats(project_id);

-- ============================================
-- Functions
-- ============================================

-- Check if user can generate (respects daily limits for free tier)
CREATE OR REPLACE FUNCTION can_user_generate(p_user_id VARCHAR(128))
RETURNS BOOLEAN AS $$
DECLARE
    v_tier VARCHAR(50);
    v_daily_count INTEGER;
    v_last_date DATE;
    v_today DATE := CURRENT_DATE;
BEGIN
    -- Get user subscription tier and generation count
    SELECT subscription_tier, daily_generation_count, last_generation_date
    INTO v_tier, v_daily_count, v_last_date
    FROM users
    WHERE user_id = p_user_id;

    -- Pro/Team/Enterprise users have unlimited generations
    IF v_tier IN ('pro', 'team', 'enterprise') THEN
        RETURN TRUE;
    END IF;

    -- Free tier: check daily limit (3 per day)
    IF v_last_date < v_today THEN
        -- New day, reset count
        UPDATE users
        SET daily_generation_count = 0,
            last_generation_date = v_today
        WHERE user_id = p_user_id;
        RETURN TRUE;
    END IF;

    -- Check if under limit
    RETURN v_daily_count < 3;
END;
$$ LANGUAGE plpgsql;

-- Record a generation
CREATE OR REPLACE FUNCTION record_generation(
    p_user_id VARCHAR(128),
    p_project_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_tier VARCHAR(50);
    v_today DATE := CURRENT_DATE;
BEGIN
    -- Get user tier
    SELECT subscription_tier INTO v_tier
    FROM users WHERE user_id = p_user_id;

    -- Increment count for free users
    IF v_tier = 'free' THEN
        UPDATE users
        SET daily_generation_count = daily_generation_count + 1,
            last_generation_date = v_today,
            total_projects = total_projects + 1
        WHERE user_id = p_user_id;
    ELSE
        UPDATE users
        SET total_projects = total_projects + 1
        WHERE user_id = p_user_id;
    END IF;

    -- Record usage
    INSERT INTO usage_records (user_id, action_type, project_id)
    VALUES (p_user_id, 'generation', p_project_id);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Seed Data
-- ============================================

INSERT INTO project_suggestions (label, prompt, category, difficulty, display_order) VALUES
('Todo App', 'Build a beautiful todo list app with dark mode, drag-to-reorder tasks, and the ability to mark items as complete with satisfying animations', 'Productivity', 'beginner', 1),
('Weather Dashboard', 'Create a weather app that shows current conditions, 5-day forecast, and beautiful weather animations. Include temperature, humidity, wind speed, and UV index', 'Utility', 'beginner', 2),
('Calculator', 'Make a modern calculator with a sleek gradient design, smooth button animations, and support for basic operations plus scientific functions', 'Utility', 'beginner', 3),
('Recipe Finder', 'Build a recipe discovery app with search, filters for dietary restrictions, ingredient lists, and step-by-step cooking instructions with timers', 'Lifestyle', 'intermediate', 4),
('Expense Tracker', 'Create a personal finance tracker that categorizes expenses, shows spending trends with charts, and provides monthly budget insights', 'Finance', 'intermediate', 5),
('Meditation Timer', 'Build a calming meditation app with customizable session lengths, ambient sounds, breathing exercises, and progress tracking', 'Health', 'intermediate', 6)
ON CONFLICT DO NOTHING;

-- ============================================
-- Row Level Security (Optional but recommended)
-- ============================================

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can read their own data
CREATE POLICY users_select_own ON users
    FOR SELECT USING (auth.uid() = user_id);

-- Users can update their own data
CREATE POLICY users_update_own ON users
    FOR UPDATE USING (auth.uid() = user_id);

-- Anyone can read public projects
CREATE POLICY projects_select_public ON projects
    FOR SELECT USING (is_public = true OR creator_id = auth.uid());

-- Users can insert their own projects
CREATE POLICY projects_insert_own ON projects
    FOR INSERT WITH CHECK (creator_id = auth.uid());

-- Users can update their own projects
CREATE POLICY projects_update_own ON projects
    FOR UPDATE USING (creator_id = auth.uid());

-- Users can delete their own projects
CREATE POLICY projects_delete_own ON projects
    FOR DELETE USING (creator_id = auth.uid());

-- Users can read their own subscriptions
CREATE POLICY subscriptions_select_own ON subscriptions
    FOR SELECT USING (user_id = auth.uid());
