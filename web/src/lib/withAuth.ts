export type TokenSource = () => Promise<string | null>;

// Adds the bearer token when there is one. A failing token lookup behaves like being signed out.
export async function withAuth(headers: Record<string, string>, getToken: TokenSource): Promise<Record<string, string>> {
  const token = await getToken().catch(() => null);
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
}
