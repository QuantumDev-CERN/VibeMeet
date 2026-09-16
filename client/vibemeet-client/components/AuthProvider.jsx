'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as api from '@/lib/api';

const AuthContext = createContext(null);

const TOKEN_KEY = 'vibemeet_token';
const USER_KEY = 'vibemeet_user';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  // Distinguishes "haven't checked localStorage yet" from "checked, no session" —
  // without this, pages briefly render a logged-out state on every hard refresh.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const storedToken = window.localStorage.getItem(TOKEN_KEY);
      const storedUser = window.localStorage.getItem(USER_KEY);
      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      }
    } catch {
      // localStorage unavailable (private mode, etc.) — fall through to logged-out.
    }
    setReady(true);
  }, []);

  const persist = (nextToken, nextUser) => {
    setToken(nextToken);
    setUser(nextUser);
    window.localStorage.setItem(TOKEN_KEY, nextToken);
    window.localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
  };

  const login = useCallback(async (email, password) => {
    const data = await api.login({ email, password });
    persist(data.token, data.user);
    return data.user;
  }, []);

  const register = useCallback(async (username, email, password) => {
    const data = await api.register({ username, email, password });
    persist(data.token, data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, ready, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
