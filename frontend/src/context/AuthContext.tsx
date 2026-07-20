import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import type { Role, Tier } from '@policylens/shared';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';

/**
 * Current user's profile as returned by `GET /me`. Drives portal routing and
 * feature gating: `role` powers the `RoleRoute` guard (R17.2/R17.5) and `tier`
 * gates freemium features (R18).
 */
export interface Profile {
  userId: string;
  fullName: string | null;
  email: string;
  role: Role;
  tier: Tier;
  brokerId: string | null;
}

interface AuthContextValue {
  /** Supabase user, or null when signed out. */
  user: User | null;
  /** Active Supabase session, or null when signed out. */
  session: Session | null;
  /** Backend profile (role/tier), or null while unauthenticated/unloaded. */
  profile: Profile | null;
  /** True while the initial session and profile are being resolved. */
  loading: boolean;
  /** Sign in with email + password via Supabase Auth. */
  signIn: (email: string, password: string) => Promise<void>;
  /** Sign out and clear the local profile. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Loads and exposes the Supabase session plus the backend profile (R17.1).
 *
 * On mount it reads the current session, subscribes to auth-state changes
 * (sign in/out, token refresh), and fetches the `/me` profile whenever the
 * authenticated user changes. `loading` stays true until both the session and
 * (if authenticated) the profile have resolved.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessionResolved, setSessionResolved] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);

  // Resolve the initial session and keep it in sync with auth-state changes.
  useEffect(() => {
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) {
          return;
        }
        setSession(data.session);
        setUser(data.session?.user ?? null);
        setSessionResolved(true);
      })
      .catch(() => {
        if (active) {
          setSessionResolved(true);
        }
      });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        setSessionResolved(true);
      },
    );

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  // Fetch the backend profile whenever the authenticated user changes.
  useEffect(() => {
    if (!sessionResolved) {
      return;
    }

    if (!user) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    let active = true;
    setProfileLoading(true);

    // Fetch the profile with a couple of short retries. On a page refresh the
    // very first request can race the restored session/token; retrying avoids
    // spuriously dropping the user to "not authorized".
    async function loadProfile(attempt = 0): Promise<void> {
      try {
        const loadedProfile = await api.get<Profile>('/me');
        if (active) {
          setProfile(loadedProfile);
          setProfileLoading(false);
        }
      } catch {
        if (!active) return;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          if (active) await loadProfile(attempt + 1);
          return;
        }
        setProfile(null);
        setProfileLoading(false);
      }
    }

    void loadProfile();

    return () => {
      active = false;
    };
  }, [user, sessionResolved]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      throw error;
    }
    // Session/user update flows through onAuthStateChange, which triggers the
    // profile fetch above.
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const loading = !sessionResolved || profileLoading;

  const value = useMemo<AuthContextValue>(
    () => ({ user, session, profile, loading, signIn, signOut }),
    [user, session, profile, loading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Access the auth state and helpers. Must be used within an AuthProvider. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export { AuthContext };
