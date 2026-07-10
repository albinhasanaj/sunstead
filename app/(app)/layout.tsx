"use client";

import { AppHeader } from "../_components/AppHeader";

// Shared shell for the browse-able app pages (Explore, game detail, Stats). Anyone can
// look around without an account — the individual pages gate only the actions that
// actually need one (playing a game, viewing your own stats).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-stage text-foreground">
      <AppHeader />
      {children}
    </div>
  );
}
