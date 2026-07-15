/**
 * Middleware session refresh. Runs on every matched request to rotate the Supabase
 * auth token and keep the session cookie fresh on both server and client. Adapted from
 * the official @supabase/ssr Next.js pattern. If auth isn't configured it's a no-op.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return response;

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Touch the user so the token refreshes and the cookie is rewritten. Do not add
  // logic between client creation and this call (per Supabase guidance).
  await supabase.auth.getUser();

  return response;
}
