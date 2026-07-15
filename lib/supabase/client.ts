/**
 * Browser-side Supabase client. Reads the session from cookies (kept in sync by the
 * middleware + server helpers) so the same auth state is visible on server and client.
 * Safe to call in any Client Component; it memoizes a single instance per tab.
 */
import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowserClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "Supabase auth is not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  client = createBrowserClient(url, anon);
  return client;
}

/** True when the public Supabase env vars are present (used to guard auth UI). */
export function supabaseAuthConfigured(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
