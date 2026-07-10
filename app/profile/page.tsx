"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../_components/AuthProvider";
import { Avatar } from "../_components/Avatar";
import { ProfileForm } from "../_components/ProfileForm";

export default function ProfilePage() {
  const { ready, signedIn, hasProfile, profile, user, saveProfile, signOut } =
    useAuth();
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!signedIn) {
      router.replace("/");
    } else if (!hasProfile) {
      router.replace("/onboarding");
    }
  }, [ready, signedIn, hasProfile, router]);

  if (!ready || !signedIn || !hasProfile || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stage">
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-white/15 border-t-collision" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-stage text-foreground">
      <header className="sticky top-0 z-40 border-b border-[var(--hairline)] bg-stage/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link href="/explore" className="flex items-center gap-2.5">
            <span
              className="h-3 w-3 rotate-45"
              style={{
                background:
                  "linear-gradient(135deg, var(--human-1), var(--ai-1))",
              }}
            />
            <span className="font-display text-lg font-bold tracking-tight">
              Adversary
            </span>
          </Link>
          <Link
            href="/explore"
            className="text-sm text-muted transition hover:text-foreground"
          >
            ← Back to explore
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-5 py-12 sm:px-8">
        <h1 className="font-display text-4xl font-bold tracking-tight">
          Your seat
        </h1>

        <div className="surface mt-8 !rounded-3xl p-6 sm:p-8">
          {editing ? (
            <ProfileForm
              initial={profile}
              submitLabel="Save changes"
              onSubmit={(next) => {
                saveProfile(next);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <div className="flex items-center gap-5">
                <Avatar profile={profile} size="lg" />
                <div className="min-w-0">
                  <p className="font-display text-3xl font-bold">
                    {profile.displayName}
                  </p>
                  <p className="truncate text-sm text-muted">{user?.email}</p>
                  {profile.tagline && (
                    <p className="mt-1 text-sm italic text-muted">
                      &ldquo;{profile.tagline}&rdquo;
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-8 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="cursor-pointer rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-stage transition hover:brightness-90"
                >
                  Edit profile
                </button>
                <button
                  type="button"
                  onClick={() => {
                    signOut();
                    router.replace("/");
                  }}
                  className="cursor-pointer rounded-full border border-[var(--hairline)] px-6 py-3 text-sm text-muted transition hover:border-white/30 hover:text-foreground"
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
