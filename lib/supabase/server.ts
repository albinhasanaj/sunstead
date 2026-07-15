/**
 * Server-side Supabase client (Route Handlers, Server Components, Server Actions).
 * Reads/writes the auth session through Next's cookie store so `getUser()` reflects
 * the signed-in user for the current request. Always verify identity with
 * `supabase.auth.getUser()` (which validates the JWT with the auth server) — never
 * trust `getSession()` alone on the server.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "Supabase auth is not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `set` throws when called from a Server Component (read-only cookies).
          // The middleware refreshes the session cookie, so this is safe to ignore.
        }
      },
    },
  });
}

/**
 * Resolve the authenticated user id for the current request, or null when signed out
 * or when Supabase auth isn't configured. Verifies the JWT via the auth server.
 */
export async function getRequestUserId(): Promise<string | null> {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return null;
  }
  try {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}
