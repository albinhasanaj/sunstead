"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "../_components/AuthProvider";
import { AppHeader } from "../_components/AppHeader";

// Shared shell for the signed-in app pages (Explore, Stats, …). Holds the auth
// guard + the app navbar so individual pages only render their own content.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { ready, signedIn, hasProfile } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    if (!signedIn) router.replace("/");
    else if (!hasProfile) router.replace("/onboarding");
  }, [ready, signedIn, hasProfile, router]);

  if (!ready || !signedIn || !hasProfile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stage">
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-white/15 border-t-white" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-stage text-foreground">
      <AppHeader />
      {children}
    </div>
  );
}
