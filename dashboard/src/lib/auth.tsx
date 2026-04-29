'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMe } from './api';
import type { User, Organization, Membership } from './types';

interface AuthContextType {
  token: string | null;
  user: User | null;
  currentOrg: Organization | null;
  currentMembership: Membership | null;
  isLoading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType>({
  token: null,
  user: null,
  currentOrg: null,
  currentMembership: null,
  isLoading: true,
  login: () => {},
  logout: () => {},
  isAuthenticated: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const initializeAuth = async () => {
      const storedToken = localStorage.getItem('orgai_token');
      if (storedToken) {
        setToken(storedToken);
        try {
          const { user: me } = await getMe();
          setUser(me);
        } catch (error) {
          // Token is invalid or expired
          localStorage.removeItem('orgai_token');
          document.cookie = 'orgai_has_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
          setToken(null);
        }
      }
      setIsLoading(false);
    };

    initializeAuth();
  }, []);

  const login = (newToken: string, newUser: User) => {
    localStorage.setItem('orgai_token', newToken);
    document.cookie = 'orgai_has_session=1; path=/; max-age=604800; samesite=lax'; // 7 days
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    localStorage.removeItem('orgai_token');
    document.cookie = 'orgai_has_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    setToken(null);
    setUser(null);
    router.push('/login');
  };

  const currentMembership = user?.memberships?.[0] || null;
  const currentOrg = currentMembership?.org || null;

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        currentOrg,
        currentMembership,
        isLoading,
        login,
        logout,
        isAuthenticated: !!token && !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
