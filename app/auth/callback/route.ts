import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * OAuth / magic-link callback. Supabase redirects here with a `?code=` (PKCE) after
 * the user authenticates with Google or clicks their email link. We exchange the code
 * for a session (setting the auth cookies) and then send them into the app. The
 * client-side guards route to /onboarding if they haven't set up a profile yet.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/explore";
  const error = searchParams.get("error_description") ?? searchParams.get("error");

  // Only allow same-origin relative redirects to avoid an open-redirect.
  const dest = next.startsWith("/") ? next : "/explore";

  if (error) {
    return NextResponse.redirect(
      `${origin}/?auth_error=${encodeURIComponent(error)}`,
    );
  }

  if (code) {
    const supabase = await getSupabaseServerClient();
    const { error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);
    if (!exchangeError) {
      return NextResponse.redirect(`${origin}${dest}`);
    }
    return NextResponse.redirect(
      `${origin}/?auth_error=${encodeURIComponent(exchangeError.message)}`,
    );
  }

  return NextResponse.redirect(`${origin}/`);
}
