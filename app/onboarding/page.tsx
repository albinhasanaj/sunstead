"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "../_components/AuthProvider";
import { ProfileForm } from "../_components/ProfileForm";

export default function OnboardingPage() {
  const { ready, signedIn, hasProfile, user, saveProfile } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    if (!signedIn) {
      router.replace("/");
    } else if (hasProfile) {
      router.replace("/explore");
    }
  }, [ready, signedIn, hasProfile, router]);

  if (!ready || !signedIn || hasProfile) {
    return <Loading />;
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-stage text-foreground">
      <div className="relative mx-auto w-full max-w-xl flex-1 px-5 py-16 sm:px-8">
        <div className="mb-2 flex items-center gap-2.5">
          <span
            className="block h-3 w-3 rotate-45"
            style={{ background: "linear-gradient(135deg, var(--human-1), var(--ai-1))" }}
          />
          <span className="font-display text-lg font-bold tracking-tight">Adversary</span>
        </div>
        <h1 className="mt-8 font-display text-4xl font-bold leading-tight sm:text-5xl">
          Set up your seat at the table.
        </h1>
        <p className="mt-3 text-muted">
          Signed in as <span className="text-foreground">{user?.email}</span>. One screen and
          you&apos;re in.
        </p>

        <div className="mt-10 rounded-3xl border border-[var(--hairline)] bg-stage-raised p-6 sm:p-8">
          <ProfileForm
            defaultName={user?.name ?? ""}
            submitLabel="Enter the arena"
            onSubmit={(profile) => {
              saveProfile(profile);
              router.replace("/explore");
            }}
          />
        </div>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stage">
      <span className="h-7 w-7 animate-spin rounded-full border-2 border-white/20 border-t-collision" />
    </div>
  );
}
