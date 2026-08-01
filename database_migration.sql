-- VibeCoder Database Schema
-- Run this in your Supabase SQL editor

-- ============================================
-- Core Tables
-- ============================================

CREATE TABLE users (
    user_id VARCHAR(128) PRIMARY KEY,
    email VARCHAR(255),
    display_name VARCHAR(100),
    avatar_url TEXT,
    subscription_tier VARCHAR(50) DEFAULT 'free',
    daily_generation_count INTEGER DEFAULT 0,
    last_generation_date DATE,
    total_projects INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    bundle TEXT,                          -- base64 ZIP of project files
    creator_id VARCHAR(128) NOT NULL REFERENCES users(user_id),
    creator_name VARCHAR(100),
    project_type VARCHAR(50) DEFAULT 'web_app',
    is_public BOOLEAN DEFAULT true,
    is_featured BOOLEAN DEFAULT false,
    play_count INTEGER DEFAULT 0,
    fork_count INTEGER DEFAULT 0,
    rating NUMERIC(3,2) DEFAULT 0,
    initial_prompt TEXT,
    github_repo VARCHAR(200),
    free_tweaks_remaining INTEGER DEFAULT 5,
    published_url VARCHAR(500),
    published_commit VARCHAR(40),
    parent_project_id UUID REFERENCES projects(id),
    creation_method VARCHAR(50) DEFAULT 'ai_generated',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_coins (
    user_id VARCHAR(128) PRIMARY KEY REFERENCES users(user_id),
    balance INTEGER DEFAULT 0,
    total_purchased INTEGER DEFAULT 0,
    total_spent INTEGER DEFAULT 0,
    total_earned INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE coin_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(128) NOT NULL REFERENCES users(user_id),
    amount INTEGER NOT NULL,
    type VARCHAR(50) NOT NULL,
    reason VARCHAR(100) NOT NULL,
    project_id UUID REFERENCES projects(id),
    creator_id VARCHAR(128) REFERENCES users(user_id),
    iap_transaction_id VARCHAR(200),
    platform VARCHAR(20),
    balance_after INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE creator_earnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id VARCHAR(128) NOT NULL REFERENCES users(user_id),
    project_id UUID NOT NULL REFERENCES projects(id),
    coins_earned INTEGER NOT NULL,
    reason VARCHAR(100),
    spender_id VARCHAR(128) REFERENCES users(user_id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE project_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_path VARCHAR(500) NOT NULL,
    content TEXT,
    file_size INTEGER,
    mime_type VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, file_path)
);

CREATE TABLE project_chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id VARCHAR(128) NOT NULL REFERENCES users(user_id),
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id),
    user_id VARCHAR(128) NOT NULL REFERENCES users(user_id),
    subdomain VARCHAR(100) UNIQUE,
    bundle TEXT,
    status VARCHAR(20) DEFAULT 'active',
    deployed_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE project_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label VARCHAR(100) NOT NULL,
    prompt TEXT NOT NULL,
    category VARCHAR(50),
    status VARCHAR(20) DEFAULT 'active',
    source VARCHAR(50) DEFAULT 'ai_generated',
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE payout_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id VARCHAR(128) NOT NULL REFERENCES users(user_id),
    coins_amount INTEGER NOT NULL,
    usd_amount NUMERIC(10,2),
    status VARCHAR(20) DEFAULT 'pending',
    stripe_account_id VARCHAR(100),
    stripe_transfer_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE stripe_accounts (
    user_id VARCHAR(128) PRIMARY KEY REFERENCES users(user_id),
    stripe_account_id VARCHAR(100) NOT NULL,
    payouts_enabled BOOLEAN DEFAULT false,
    details_submitted BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================

CREATE INDEX idx_projects_creator ON projects(creator_id);
CREATE INDEX idx_projects_public ON projects(is_public, created_at DESC);
CREATE INDEX idx_projects_popular ON projects(is_public, play_count DESC);
CREATE INDEX idx_coin_transactions_user ON coin_transactions(user_id, created_at DESC);
CREATE INDEX idx_project_files_project ON project_files(project_id);
CREATE INDEX idx_project_chats_project ON project_chats(project_id, created_at);
CREATE INDEX idx_deployments_subdomain ON deployments(subdomain);
CREATE INDEX idx_creator_earnings_creator ON creator_earnings(creator_id, created_at DESC);

-- ============================================
-- Stored Procedures
-- ============================================

-- Spend coins with atomic balance check + creator earning
CREATE OR REPLACE FUNCTION spend_coins(
    p_user_id VARCHAR,
    p_amount INTEGER,
    p_reason VARCHAR,
    p_game_id UUID,
    p_creator_id VARCHAR,
    p_platform VARCHAR
) RETURNS JSON AS $$
DECLARE
    current_balance INTEGER;
    new_balance INTEGER;
    creator_share INTEGER;
BEGIN
    -- Get current balance
    SELECT COALESCE(balance, 0) INTO current_balance
    FROM user_coins
    WHERE user_id = p_user_id;

    -- Check sufficient balance
    IF current_balance < p_amount THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Insufficient coins',
            'balance', current_balance
        );
    END IF;

    -- Deduct coins
    new_balance := current_balance - p_amount;

    INSERT INTO user_coins (user_id, balance, total_spent, updated_at)
    VALUES (p_user_id, new_balance, p_amount, NOW())
    ON CONFLICT (user_id) DO UPDATE
    SET balance = user_coins.balance - p_amount,
        total_spent = user_coins.total_spent + p_amount,
        updated_at = NOW();

    -- Record transaction
    INSERT INTO coin_transactions (user_id, amount, type, reason, project_id, creator_id, platform, balance_after)
    VALUES (p_user_id, -p_amount, 'spend', p_reason, p_game_id, p_creator_id, p_platform, new_balance);

    -- Credit creator (55% share) if creator_id provided and not same as spender
    creator_share := 0;
    IF p_creator_id IS NOT NULL AND p_creator_id != p_user_id THEN
        creator_share := FLOOR(p_amount * 0.55);

        -- Credit creator's balance
        INSERT INTO user_coins (user_id, balance, total_earned, updated_at)
        VALUES (p_creator_id, creator_share, creator_share, NOW())
        ON CONFLICT (user_id) DO UPDATE
        SET balance = user_coins.balance + creator_share,
            total_earned = user_coins.total_earned + creator_share,
            updated_at = NOW();

        -- Record creator earning
        INSERT INTO creator_earnings (creator_id, project_id, coins_earned, reason, spender_id)
        VALUES (p_creator_id, p_game_id, creator_share, p_reason, p_user_id);

        -- Record creator transaction
        INSERT INTO coin_transactions (user_id, amount, type, reason, project_id, balance_after)
        VALUES (p_creator_id, creator_share, 'earn', p_reason, p_game_id,
                (SELECT balance FROM user_coins WHERE user_id = p_creator_id));
    END IF;

    RETURN json_build_object(
        'success', true,
        'new_balance', new_balance,
        'creator_share', creator_share
    );
END;
$$ LANGUAGE plpgsql;

-- Add purchased coins with duplicate detection
CREATE OR REPLACE FUNCTION add_purchased_coins(
    p_user_id VARCHAR,
    p_amount INTEGER,
    p_reason VARCHAR,
    p_platform VARCHAR,
    p_iap_transaction_id VARCHAR
) RETURNS JSON AS $$
DECLARE
    new_balance INTEGER;
    existing_tx UUID;
BEGIN
    -- Check for duplicate transaction
    SELECT id INTO existing_tx
    FROM coin_transactions
    WHERE user_id = p_user_id
      AND iap_transaction_id = p_iap_transaction_id
    LIMIT 1;

    IF existing_tx IS NOT NULL THEN
        SELECT balance INTO new_balance FROM user_coins WHERE user_id = p_user_id;
        RETURN json_build_object('duplicate', true, 'new_balance', COALESCE(new_balance, 0));
    END IF;

    -- Add coins
    INSERT INTO user_coins (user_id, balance, total_purchased, updated_at)
    VALUES (p_user_id, p_amount, p_amount, NOW())
    ON CONFLICT (user_id) DO UPDATE
    SET balance = user_coins.balance + p_amount,
        total_purchased = user_coins.total_purchased + p_amount,
        updated_at = NOW();

    SELECT balance INTO new_balance FROM user_coins WHERE user_id = p_user_id;

    -- Record transaction
    INSERT INTO coin_transactions (user_id, amount, type, reason, iap_transaction_id, platform, balance_after)
    VALUES (p_user_id, p_amount, 'purchase', p_reason, p_iap_transaction_id, p_platform, new_balance);

    RETURN json_build_object('duplicate', false, 'new_balance', new_balance);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Seed Data (Initial Project Suggestions)
-- ============================================

INSERT INTO project_suggestions (label, prompt, category, status) VALUES
('Todo App', 'Build a clean todo list app with add, complete, and delete functionality. Use local storage to persist tasks. Include filters for all/active/completed. Modern design with smooth animations.', 'productivity', 'active'),
('Weather Dashboard', 'Create a weather app that shows current conditions and 5-day forecast. Use geolocation API. Display temperature, humidity, wind speed with weather icons. Clean card-based layout.', 'utility', 'active'),
('Pomodoro Timer', 'Build a focus timer with 25-minute work sessions and 5-minute breaks. Include start/pause/reset buttons, session counter, and notification sounds. Minimalist design.', 'productivity', 'active'),
('Calculator', 'Create a scientific calculator with basic operations, square root, percentage, and memory functions. Responsive button grid layout with smooth transitions.', 'utility', 'active'),
('Color Palette Generator', 'Build a tool that generates harmonious color palettes. Show hex codes, allow copying to clipboard, and support different harmony rules (complementary, triadic, analogous).', 'tool', 'active'),
('Markdown Editor', 'Create a split-pane markdown editor with live preview. Support headings, lists, links, code blocks, and images. Export to HTML functionality.', 'productivity', 'active');

-- ============================================
-- Row Level Security (Optional - Enable if needed)
-- ============================================

-- ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE user_coins ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE coin_transactions ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "Users can view public projects" ON projects FOR SELECT USING (is_public = true);
-- CREATE POLICY "Users can view own projects" ON projects FOR SELECT USING (creator_id = current_setting('app.user_id'));
-- CREATE POLICY "Users can update own projects" ON projects FOR UPDATE USING (creator_id = current_setting('app.user_id'));

-- ============================================
-- Thumbnail support (added 2026-04-01)
-- ============================================
ALTER TABLE projects ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
