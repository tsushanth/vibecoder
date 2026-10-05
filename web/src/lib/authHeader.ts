import { createClient } from './supabase';
import { withAuth as withAuthWith } from './withAuth';

// The signed-in user's access token, or null when signed out or the lookup fails. Never throws: a request without a
// token still works on routes that do not require one, and the server answers 401 on those that do.
export async function currentAccessToken(): Promise<string | null> {
  try {
    const { data } = await createClient().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export const withAuth = (headers: Record<string, string>) => withAuthWith(headers, currentAccessToken);
