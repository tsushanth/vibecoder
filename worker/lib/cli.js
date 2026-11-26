// Settings for the command-line builder, the alternative to the direct generator.
// It stays off unless CLAUDE_CLI_BUILDS_ENABLED is exactly "true". When on, it gets file tools only, limited to the project
// folder, no external tool servers and a minimal environment.

export const CLI_DISABLED_ERROR = 'CLI build path disabled';

export const cliBuildsEnabled = (env = process.env) => env.CLAUDE_CLI_BUILDS_ENABLED === 'true';

// Everything else in the worker's environment stays with the worker.
const PASS_ENV = ['LANG', 'LC_ALL', 'TMPDIR', 'CLAUDE_BROKER_URL', 'CLAUDE_BROKER_SECRET_FILE', 'CLAUDE_MULTI_LOG'];

export function cliSpawnOptions({ prompt, maxTurns, home, env = process.env }) {
    const args = [
        '-p',
        '--tools', 'Read,Write,Edit,Glob,Grep',
        '--permission-mode', 'acceptEdits',
        '--setting-sources', 'user',
        '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        '--disable-slash-commands', '--no-chrome',
        '--output-format', 'stream-json', '--verbose',
        '--max-turns', String(maxTurns),
        '--model', 'claude-sonnet-4-5',
        '--', prompt, // after "--": --mcp-config takes several values and would swallow the prompt
    ];
    const childEnv = {};
    for (const k of PASS_ENV) if (env[k] !== undefined) childEnv[k] = env[k];
    childEnv.PATH = `${env.PATH || ''}:/usr/bin:/usr/local/bin`;
    childEnv.HOME = home;
    childEnv.ENABLE_CLAUDEAI_MCP_SERVERS = 'false';
    return { args, env: childEnv };
}
