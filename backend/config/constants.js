export const WORKER_URL = process.env.WORKER_URL || 'http://localhost:3456';
export const WORKER_SECRET = process.env.WORKER_SECRET || 'vibecoder-worker-secret';

// Monetization
export const COIN_PACKS = {
    'com.vibecoder.coins.100': { coins: 100, price: '$0.99' },
    'com.vibecoder.coins.500': { coins: 500, price: '$3.99' },
    'com.vibecoder.coins.1200': { coins: 1200, price: '$7.99' },
};

export const GENERATION_COST = 20;
export const TWEAK_COST = 10;
export const FORK_COST = 10;
export const CREATOR_SHARE_PCT = 55;
export const FREE_TWEAKS_DEFAULT = 5;
export const FREE_GENERATIONS_PER_DAY = 3;

// Rate limits
export const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
export const MAX_GENERATIONS_PER_HOUR = 5;

// Cache
export const CACHE_REFRESH_INTERVAL = 60 * 1000; // 60 seconds
export const SUGGESTIONS_CACHE_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
