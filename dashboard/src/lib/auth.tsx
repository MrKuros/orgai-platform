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
  login: (token: string, user: User, org?: Organization) => void;
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
  const [cachedOrg, setCachedOrg] = useState<Organization | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const initializeAuth = async () => {
      const storedToken = localStorage.getItem('orgai_token');
      const storedOrg = localStorage.getItem('orgai_org');
      
      if (storedOrg) {
        try {
          setCachedOrg(JSON.parse(storedOrg));
        } catch (e) {
          // invalid json
        }
      }

      if (storedToken) {
        setToken(storedToken);
        try {
          const { user: me } = await getMe();
          setUser(me);
        } catch (error) {
          // Token is invalid or expired
          localStorage.removeItem('orgai_token');
          localStorage.removeItem('orgai_org');
          document.cookie = 'orgai_has_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
          setToken(null);
          setCachedOrg(null);
        }
      }
      setIsLoading(false);
    };

    initializeAuth();
  }, []);

  const login = (newToken: string, newUser: User, newOrg?: Organization) => {
    localStorage.setItem('orgai_token', newToken);
    document.cookie = 'orgai_has_session=1; path=/; max-age=604800; samesite=lax'; // 7 days
    
    if (newOrg) {
      localStorage.setItem('orgai_org', JSON.stringify(newOrg));
      setCachedOrg(newOrg);
    } else if (newUser.memberships?.[0]?.org) {
      localStorage.setItem('orgai_org', JSON.stringify(newUser.memberships[0].org));
      setCachedOrg(newUser.memberships[0].org);
    }
    
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    localStorage.removeItem('orgai_token');
    localStorage.removeItem('orgai_org');
    document.cookie = 'orgai_has_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    setToken(null);
    setUser(null);
    setCachedOrg(null);
    router.push('/login');
  };

  const currentMembership = user?.memberships?.[0] || null;
  const currentOrg = user ? (currentMembership?.org || null) : cachedOrg;

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
