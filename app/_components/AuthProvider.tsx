"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const STORAGE_KEY = "sunstead.auth";

export type GoogleUser = {
  name: string;
  email: string;
  /** Seed used to render a deterministic generated avatar. */
  avatarSeed: string;
};

export type Profile = {
  displayName: string;
  /** Hex color for the avatar background (used when there is no photo). */
  color: string;
  /** Single emoji or initial shown inside the avatar (used when there is no photo). */
  emoji: string;
  /** Optional camera photo stored as a data URL. Takes precedence over emoji/color. */
  photo?: string | null;
  tagline: string;
};

type Stored = {
  user: GoogleUser | null;
  profile: Profile | null;
};

type AuthValue = Stored & {
  /** False until localStorage has been read on the client. */
  ready: boolean;
  signedIn: boolean;
  hasProfile: boolean;
  signInWithGoogle: () => GoogleUser;
  saveProfile: (profile: Profile) => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthValue | null>(null);

const FIRST = ["Alex", "Sam", "Jordan", "Casey", "Riley", "Morgan", "Taylor", "Jamie"];
const LAST = ["Carter", "Nguyen", "Patel", "Rivera", "Kim", "Schmidt", "Lopez", "Okafor"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fabricateGoogleUser(): GoogleUser {
  const first = pick(FIRST);
  const last = pick(LAST);
  const handle = `${first}.${last}`.toLowerCase();
  const suffix = Math.floor(100 + Math.random() * 900);
  return {
    name: `${first} ${last}`,
    email: `${handle}${suffix}@gmail.com`,
    avatarSeed: `${handle}${suffix}`,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Stored>({ user: null, profile: null });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Stored;
        setState({ user: parsed.user ?? null, profile: parsed.profile ?? null });
      }
    } catch {
      // Ignore malformed storage; treat as signed out.
    }
    setReady(true);
  }, []);

  const persist = useCallback((next: Stored) => {
    setState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage may be unavailable (private mode); state stays in memory.
    }
  }, []);

  const signInWithGoogle = useCallback(() => {
    const user = fabricateGoogleUser();
    setState((prev) => {
      const next = { user, profile: prev.profile };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    return user;
  }, []);

  const saveProfile = useCallback(
    (profile: Profile) => {
      setState((prev) => {
        const next = { user: prev.user, profile };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [],
  );

  const signOut = useCallback(() => {
    persist({ user: null, profile: null });
  }, [persist]);

  const value = useMemo<AuthValue>(
    () => ({
      ...state,
      ready,
      signedIn: state.user !== null,
      hasProfile: state.profile !== null,
      signInWithGoogle,
      saveProfile,
      signOut,
    }),
    [state, ready, signInWithGoogle, saveProfile, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
