import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getStoredHouseholdId, setSession, clearSession, getToken } from "../api/client";
import type { Household, HouseholdType } from "../types";

interface AuthState {
  household: Household | null;
  loading: boolean;
  login: (id: string, password: string) => Promise<void>;
  register: (input: {
    id?: string;
    name: string;
    type: HouseholdType;
    location: string;
    password: string;
    energyType?: string;
    initialTokenBalance?: number;
  }) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [household, setHousehold] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const id = getStoredHouseholdId();
    if (!id || !getToken()) {
      setHousehold(null);
      setLoading(false);
      return;
    }
    try {
      const h = await api.get<Household>(`/households/${id}`);
      setHousehold(h);
    } catch {
      clearSession();
      setHousehold(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (id: string, password: string) => {
    const result = await api.post<{ household: Household; token: string }>("/auth/login", { id, password });
    setSession(result.token, result.household.id);
    setHousehold(result.household);
  }, []);

  const register = useCallback(
    async (input: Parameters<AuthState["register"]>[0]) => {
      const result = await api.post<{ household: Household; token: string }>("/auth/register", input);
      setSession(result.token, result.household.id);
      setHousehold(result.household);
    },
    []
  );

  const logout = useCallback(() => {
    clearSession();
    setHousehold(null);
  }, []);

  return (
    <AuthContext.Provider value={{ household, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
