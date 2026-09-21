import http from 'node:http';

/** Starts an express app on an ephemeral port. Returns {base, close}. */
export async function listen(app) {
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    return {
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
    };
}

export const json = (r) => r.json();
