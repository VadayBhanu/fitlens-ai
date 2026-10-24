import type { MeDTO } from "@fitlens/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "./api";

interface AuthState {
  user: MeDTO | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: MeDTO) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeDTO | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await api.me());
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      refresh,
      setUser,
      signIn: async (email, password) => {
        const res = await api.login({ email, password });
        setToken(res.token);
        setUser(res.user);
      },
      signUp: async (email, password, displayName) => {
        const res = await api.signup({ email, password, displayName, acceptTerms: true, confirmAdult: true });
        setToken(res.token);
        setUser(res.user);
      },
      signOut: async () => {
        try {
          await api.logout();
        } catch {
          /* token may already be invalid */
        }
        setToken(null);
        setUser(null);
      }
    }),
    [user, loading, refresh]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
