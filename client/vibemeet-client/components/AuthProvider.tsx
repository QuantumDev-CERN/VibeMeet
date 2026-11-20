'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as api from '@/lib/api';
import type { User } from '@/lib/api';

interface AuthContextValue {
  token: string | null;
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<User>;
  requestRegister: (username: string, email: string, password: string) => Promise<{ email: string }>;
  verifyRegister: (email: string, code: string) => Promise<User>;
  resendOtp: (email: string) => Promise<{ email: string; message?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'vibemeet_token';
const USER_KEY = 'vibemeet_user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const storedToken = window.localStorage.getItem(TOKEN_KEY);
      const storedUser = window.localStorage.getItem(USER_KEY);
      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser) as User);
      }
    } catch {
    }
    setReady(true);
  }, []);

  const persist = (nextToken: string, nextUser: User) => {
    setToken(nextToken);
    setUser(nextUser);
    try {
      window.localStorage.setItem(TOKEN_KEY, nextToken);
      window.localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    } catch {
    }
  };

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.login({ email, password });
    persist(data.token, data.user);
    return data.user;
  }, []);

  const requestRegister = useCallback(
    async (username: string, email: string, password: string) => {
      return api.requestRegisterOtp({ username, email, password });
    },
    []
  );

  const verifyRegister = useCallback(async (email: string, code: string) => {
    const data = await api.verifyRegisterOtp({ email, code });
    persist(data.token, data.user);
    return data.user;
  }, []);

  const resendOtp = useCallback(async (email: string) => {
    return api.resendRegisterOtp({ email });
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    try {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(USER_KEY);
    } catch {
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{ token, user, ready, login, requestRegister, verifyRegister, resendOtp, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
