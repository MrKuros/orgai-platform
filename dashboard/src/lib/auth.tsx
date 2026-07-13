'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, logout as apiLogout } from './api';
import type { User, Organization, Membership } from './types';

interface AuthContextType {
  token: string | null;
  user: User | null;
  currentOrg: Organization | null;
  currentMembership: Membership | null;
  isLoading: boolean;
  login: (token: string, user: User, org?: Organization) => void;
  logout: () => void;
  updateCurrentOrg: (org: Organization) => void;
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
  updateCurrentOrg: () => {},
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
        } catch (error: any) {
          // Only a 401 means the token is actually invalid. A 429/5xx/network
          // blip must NOT wipe the session — the next page load retries.
          if (error?.status === 401) {
            localStorage.removeItem('orgai_token');
            localStorage.removeItem('orgai_org');
            document.cookie = 'orgai_has_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
            setToken(null);
            setCachedOrg(null);
          }
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
    // Best-effort server revoke; don't block local teardown on it.
    apiLogout().catch(() => {});
    localStorage.removeItem('orgai_token');
    localStorage.removeItem('orgai_org');
    document.cookie = 'orgai_has_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    setToken(null);
    setUser(null);
    setCachedOrg(null);
    router.push('/login');
  };

  // Patch the org shown across the app (sidebar, settings) after a rename etc.
  const updateCurrentOrg = (org: Organization) => {
    localStorage.setItem('orgai_org', JSON.stringify(org));
    setCachedOrg(org);
    setUser((prev) => {
      if (!prev?.memberships?.length) return prev;
      return {
        ...prev,
        memberships: prev.memberships.map((m) =>
          m.orgId === org.id ? { ...m, org } : m
        ),
      };
    });
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
        updateCurrentOrg,
        isAuthenticated: !!token && !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

// Role gating for mutating UI. ORG_ADMIN can do everything; POLICY_ADMIN manages
// policies/roles; MEMBER is view-only. ponytail: coarse buckets, split further if
// the backend ever gets finer permissions.
export function useRole() {
  const { currentMembership } = useAuth();
  const role = currentMembership?.role ?? null;
  return {
    role,
    isOrgAdmin: role === 'ORG_ADMIN',
    // policies & roles editable by both admin tiers
    canManagePolicies: role === 'ORG_ADMIN' || role === 'POLICY_ADMIN',
    // team, api keys, org/SSO settings are org-admin only
    canManageOrg: role === 'ORG_ADMIN',
  };
}
