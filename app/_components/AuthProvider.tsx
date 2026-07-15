"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import {
  getSupabaseBrowserClient,
  supabaseAuthConfigured,
} from "@/lib/supabase/client";

export type GoogleUser = {
  /** Supabase auth user id (uuid). Stable per account, sent to the server as the owner. */
  id: string;
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

type AuthValue = {
  user: GoogleUser | null;
  profile: Profile | null;
  /** False until the initial session has been read on the client. */
  ready: boolean;
  /** Owning-user id sent to the server (null when signed out). */
  userId: string | null;
  signedIn: boolean;
  hasProfile: boolean;
  /** Redirects to Google's OAuth consent screen; resolves as the page navigates away. */
  signInWithGoogle: () => Promise<void>;
  /** Sends a passwordless magic-link / OTP email. Resolves once the email is queued. */
  signInWithEmail: (email: string) => Promise<void>;
  /** Persists the profile to the user's Supabase metadata. */
  saveProfile: (profile: Profile) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

function readProfile(user: User | null): Profile | null {
  const raw = user?.user_metadata?.profile;
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<Profile>;
  if (typeof p.displayName !== "string" || !p.displayName) return null;
  return {
    displayName: p.displayName,
    color: typeof p.color === "string" ? p.color : "#6366f1",
    emoji: typeof p.emoji === "string" ? p.emoji : (p.displayName[0] ?? "?"),
    photo: typeof p.photo === "string" ? p.photo : null,
    tagline: typeof p.tagline === "string" ? p.tagline : "",
  };
}

function readUser(user: User | null): GoogleUser | null {
  if (!user) return null;
  const meta = user.user_metadata ?? {};
  const email = user.email ?? (typeof meta.email === "string" ? meta.email : "");
  const name =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    (email ? email.split("@")[0] : "Player");
  const avatarSeed =
    (typeof meta.avatarSeed === "string" && meta.avatarSeed) || email || user.id;
  return { id: user.id, name, email, avatarSeed };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!supabaseAuthConfigured()) {
      setReady(true);
      return;
    }
    const supabase = getSupabaseBrowserClient();
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data }: { data: { session: Session | null } }) => {
        if (!active) return;
        setSession(data.session);
        setReady(true);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, next: Session | null) => {
        setSession(next);
        setReady(true);
      },
    );

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }, []);

  const signInWithEmail = useCallback(async (email: string) => {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        shouldCreateUser: true,
      },
    });
    if (error) throw error;
  }, []);

  const saveProfile = useCallback(async (profile: Profile) => {
    const supabase = getSupabaseBrowserClient();
    // The photo is a (potentially large) data URL — keep it OUT of user_metadata so it
    // never bloats the auth JWT / session cookie. The lightweight fields sync server-side.
    const { photo, ...rest } = profile;
    const { data, error } = await supabase.auth.updateUser({
      data: { profile: rest, full_name: rest.displayName },
    });
    if (error) throw error;
    if (data.user) {
      if (typeof window !== "undefined") {
        const key = `sunstead.photo.${data.user.id}`;
        try {
          if (photo) localStorage.setItem(key, photo);
          else localStorage.removeItem(key);
        } catch {
          // storage unavailable (private mode) — photo stays in memory this session
        }
      }
      setSession((prev) => (prev ? { ...prev, user: data.user } : prev));
    }
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  const value = useMemo<AuthValue>(() => {
    const currentUser = session?.user ?? null;
    const user = readUser(currentUser);
    let profile = readProfile(currentUser);
    // Overlay the locally-stored camera photo (kept out of the JWT — see saveProfile).
    if (profile && user && typeof window !== "undefined") {
      try {
        const photo = localStorage.getItem(`sunstead.photo.${user.id}`);
        if (photo) profile = { ...profile, photo };
      } catch {
        // storage unavailable — fall back to the photo-less profile
      }
    }
    return {
      user,
      profile,
      ready,
      userId: user?.id ?? null,
      signedIn: user !== null,
      hasProfile: profile !== null,
      signInWithGoogle,
      signInWithEmail,
      saveProfile,
      signOut,
    };
  }, [session, ready, signInWithGoogle, signInWithEmail, saveProfile, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
