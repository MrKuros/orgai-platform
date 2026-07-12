'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, GitBranch, Shield, Users, Settings, Key, LogOut, Code2, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'IDE Setup', href: '/ide-setup', icon: Code2 },
  { name: 'Roles', href: '/roles', icon: GitBranch },
  { name: 'Policies', href: '/policies', icon: Shield },
  { name: 'Team', href: '/team', icon: Users },
  { name: 'API Keys', href: '/settings/api-keys', icon: Key },
  { name: 'Settings', href: '/settings', icon: Settings },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { currentOrg, user, logout } = useAuth();

  return (
    <div className="flex h-full w-64 flex-col border-r bg-card px-4 py-6">
      <div className="flex items-center gap-3 px-2 mb-8">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-primary">
          <Code2 className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="flex flex-col">
          <span className="font-bold text-lg leading-tight">OrgAI</span>
          <span className="text-xs text-muted-foreground truncate max-w-[140px]">
            {currentOrg?.name || 'Loading...'}
          </span>
        </div>
      </div>

      <nav className="flex-1 space-y-1">
        {navigation.map((item) => {
          // exact-match /settings so it doesn't stay active on /settings/api-keys
          const isActive = item.href === '/settings'
            ? pathname === '/settings'
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
              )}
            >
              <item.icon
                className={cn(
                  'h-5 w-5 flex-shrink-0',
                  isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
                )}
              />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t pt-4">
        <div className="flex items-center justify-between px-2">
          <div className="flex flex-col truncate">
            <span className="text-sm font-medium">{user?.firstName} {user?.lastName}</span>
            <span className="text-xs text-muted-foreground truncate w-40">{user?.email}</span>
          </div>
          <button
            onClick={logout}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors"
            title="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile hamburger */}
      <button
        className="md:hidden fixed top-3 left-3 z-30 p-2 rounded-md border bg-card shadow-sm"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Desktop: static sidebar */}
      <div className="hidden md:flex h-full shrink-0">
        <SidebarContent />
      </div>

      {/* Mobile: drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 h-full">
            <button
              className="absolute top-3 right-3 z-50 p-2 text-muted-foreground"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
