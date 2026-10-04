// OpenRouter chat client: retries, reasoning-model token handling, cost and daily budget, per-model circuit breaker.
export class ProviderError extends Error {
    constructor(message, { retryable = false, status } = {}) {
        super(message);
        this.name = 'ProviderError';
        this.retryable = retryable;
        this.status = status;
    }
}
export class BudgetExceededError extends Error {
    constructor(message) { super(message); this.name = 'BudgetExceededError'; }
}

export class OpenRouterClient {
    constructor({
        apiKey,
        baseUrl = 'https://openrouter.ai/api/v1',
        fetchImpl = globalThis.fetch,
        sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
        now = () => Date.now(),
        dailyBudgetUsd = Infinity,
        breakerFailures = 3,
        breakerMs = 5 * 60 * 1000,
        maxAttempts = 3,
    } = {}) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
        this.fetchImpl = fetchImpl;
        this.sleep = sleep;
        this.now = now;
        this.dailyBudgetUsd = dailyBudgetUsd;
        this.breakerFailures = breakerFailures;
        this.breakerMs = breakerMs;
        this.maxAttempts = maxAttempts;
        this.breakers = new Map();
        this.spentToday = 0;
        this.day = this.today();
    }

    today() { return new Date(this.now()).toISOString().slice(0, 10); }
    rollDay() { const d = this.today(); if (d !== this.day) { this.day = d; this.spentToday = 0; } }
    backoffMs(i) { return Math.min(60000, 5000 * 2 ** i); }

    isOpen(model) {
        const b = this.breakers.get(model);
        return !!b && b.openUntil > this.now();
    }
    recordSuccess(model) { this.breakers.set(model, { fails: 0, openUntil: 0 }); }
    recordFailure(model) {
        const b = this.breakers.get(model) || { fails: 0, openUntil: 0 };
        b.fails += 1;
        if (b.fails >= this.breakerFailures) { b.openUntil = this.now() + this.breakerMs; b.fails = 0; }
        this.breakers.set(model, b);
    }

    /** Returns { text, finish, costUsd, usage }. Throws ProviderError or BudgetExceededError. */
    async chat({ model, messages, maxTokens = 24000, temperature = 0.4, timeoutMs = 150000, deadline = Infinity }) {
        this.rollDay();
        if (this.spentToday > this.dailyBudgetUsd) throw new BudgetExceededError(`daily budget of $${this.dailyBudgetUsd} reached`);
        let tokens = maxTokens;
        let lastErr = new ProviderError('no attempt made', { retryable: true });
        for (let i = 0; i < this.maxAttempts; i++) {
            const last = i === this.maxAttempts - 1;
            // overall build deadline: never start (or keep waiting on) a call past it
            const remaining = deadline - this.now();
            if (remaining < 3000) { const e = new ProviderError('deadline exceeded', { retryable: false }); e.deadline = true; throw e; }
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), Math.min(timeoutMs, remaining));
            try {
                const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model, messages, max_tokens: tokens, temperature, usage: { include: true } }),
                    signal: ctrl.signal,
                });
                const raw = await res.text();
                if (!res.ok) {
                    const retryable = res.status === 429 || res.status >= 500;
                    lastErr = new ProviderError(`HTTP ${res.status}`, { retryable, status: res.status });
                    if (!retryable) { this.recordFailure(model); throw lastErr; }
                    if (!last) { await this.sleep(this.backoffMs(i)); continue; }
                    break;
                }
                const j = JSON.parse(raw);
                const cost = j.usage?.cost || 0;
                this.spentToday += cost;
                const c = j.choices?.[0];
                const text = c?.message?.content;
                if (!text) {
                    lastErr = new ProviderError('empty reply', { retryable: true });
                    // reasoning models can spend the whole budget thinking: retry with more room
                    if (c?.finish_reason === 'length') tokens = Math.min(tokens * 2, 48000);
                    if (!last) { await this.sleep(this.backoffMs(i)); continue; }
                    break;
                }
                this.recordSuccess(model);
                return { text, finish: c.finish_reason, costUsd: cost, usage: j.usage || {} };
            } catch (e) {
                if (e instanceof ProviderError && (!e.retryable || e.deadline)) throw e;
                lastErr = e instanceof ProviderError ? e : new ProviderError(e?.name === 'AbortError' ? 'timeout' : String(e?.message || e), { retryable: true });
                if (!last) { await this.sleep(this.backoffMs(i)); continue; }
            } finally {
                clearTimeout(timer);
            }
        }
        this.recordFailure(model);
        throw lastErr;
    }
}
