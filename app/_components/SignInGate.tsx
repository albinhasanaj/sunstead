"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";

// A lightweight "you need an account for this" gate. Anyone can browse the app; the
// few actions that need an account (playing a game, viewing your stats) render this
// instead. One click signs in — and if there's no profile yet, it sends you straight
// to onboarding. Once you're fully signed in the parent re-renders its real content.
export function SignInGate({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  const { signedIn, hasProfile, signInWithGoogle, signInWithEmail } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Signed in but haven't set up a profile → finish onboarding first.
  useEffect(() => {
    if (signedIn && !hasProfile) router.replace("/onboarding");
  }, [signedIn, hasProfile, router]);

  const loginGoogle = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !emailValid) return;
    setBusy(true);
    setError(null);
    try {
      await signInWithEmail(email.trim());
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-1 flex-col items-center justify-center px-5 text-center">
      <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
        {title}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-white/55">{subtitle}</p>

      {sent ? (
        <p className="mt-7 rounded-md border border-[var(--hairline)] bg-stage px-5 py-4 text-sm text-white/70">
          Check <span className="text-white">{email.trim()}</span> for a sign-in
          link.
        </p>
      ) : (
        <div className="mt-7 w-full">
          <button
            type="button"
            onClick={loginGoogle}
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2.5 rounded-md bg-white px-5 py-3 text-sm font-semibold text-stage transition hover:bg-white/90 disabled:cursor-wait disabled:opacity-70"
          >
            {busy ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-400 border-t-stage" />
            ) : (
              <GoogleGlyph />
            )}
            {busy ? "Signing in…" : "Log in with Google"}
          </button>

          <div className="my-4 flex items-center gap-3 text-xs text-white/35">
            <span className="h-px flex-1 bg-[var(--hairline)]" />
            or
            <span className="h-px flex-1 bg-[var(--hairline)]" />
          </div>

          <form onSubmit={sendLink} className="flex flex-col gap-2.5">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              autoComplete="email"
              className="w-full rounded-md border border-[var(--hairline)] bg-stage px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-collision focus:ring-1 focus:ring-collision"
            />
            <button
              type="submit"
              disabled={busy || !emailValid}
              className="rounded-md border border-[var(--hairline)] bg-stage px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Email me a sign-in link
            </button>
          </form>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
