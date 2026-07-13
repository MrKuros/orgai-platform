'use client';
export const dynamic = 'force-dynamic';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { Shield, GitBranch, Users, ShieldAlert, Plus, Activity, Sparkles, Zap, Clock, Download, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { fetcher, seedDefaults, exportAuditCsv, ApiError } from '@/lib/api';
import type { OrgStats } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { AppLayout } from '@/components/layout/app-layout';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';

function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function DashboardPage() {
  const { currentOrg } = useAuth();
  const { toast } = useToast();

  const { data: policiesData, mutate: mutatePolicies, error: policiesError } = useSWR<any>(currentOrg ? `/orgs/${currentOrg.id}/policies` : null, fetcher);
  const { data: rolesData, mutate: mutateRoles, error: rolesError } = useSWR<any>(currentOrg ? `/orgs/${currentOrg.id}/roles` : null, fetcher);
  const { data: membersData, mutate: mutateMembers, error: membersError } = useSWR<any>(currentOrg ? `/orgs/${currentOrg.id}/members` : null, fetcher);
  const { data: stats, mutate: mutateStats, error: statsError } = useSWR<OrgStats>(currentOrg ? `/orgs/${currentOrg.id}/stats` : null, fetcher as any);

  const [isSeeding, setIsSeeding] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleSeed = async () => {
    if (!currentOrg) return;
    setIsSeeding(true);
    try {
      const res = await seedDefaults(currentOrg.id);
      mutateRoles();
      mutatePolicies();
      toast({ title: 'Starter pack seeded', description: `Created ${res.roles} roles and ${res.policies} policies.` });
    } catch (error) {
      toast({ title: 'Error seeding starter pack', description: error instanceof ApiError ? error.message : 'Unknown error', variant: 'destructive' });
      mutateRoles();
      mutatePolicies();
    } finally {
      setIsSeeding(false);
    }
  };

  const handleExportCsv = async () => {
    if (!currentOrg) return;
    setIsExporting(true);
    try {
      await exportAuditCsv(currentOrg.id);
    } catch (error) {
      toast({ title: 'Error exporting audit log', description: error instanceof ApiError ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };
  
  // Get general recent activity
  const { data: recentActivity, mutate: mutateActivity, error: activityError } = useSWR<any>(
    currentOrg ? `/orgs/${currentOrg.id}/audit?limit=5` : null,
    fetcher
  );

  const loadError = policiesError || rolesError || membersError || statsError || activityError;
  const handleRetry = () => {
    mutatePolicies();
    mutateRoles();
    mutateMembers();
    mutateStats();
    mutateActivity();
  };

  const policyCount = policiesData?.policies?.length;
  const roleCount = rolesData?.roles?.length;
  const memberCount = membersData?.members?.length;
  const violations14d = stats?.violationsByDay?.reduce((sum, d) => sum + d.count, 0);
  const maxDayCount = stats?.violationsByDay?.length ? Math.max(1, ...stats.violationsByDay.map(d => d.count)) : 1;

  return (
    <AppLayout>
      <div className="container mx-auto p-6 max-w-6xl">
        <PageHeader 
          title="Dashboard" 
          description="Overview of your organization's AI compliance status."
        />

        {loadError ? (
          <EmptyState
            icon={<AlertTriangle className="w-10 h-10 text-destructive" />}
            title="Couldn't load dashboard"
            description="Something went wrong fetching your organization's data. Check your connection and try again."
            action={<Button onClick={handleRetry}>Retry</Button>}
          />
        ) : (
        <div className="space-y-6">
          {roleCount === 0 && (
            <Card className="bg-primary/5 border-primary/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" /> Get started — seed starter roles &amp; policies
                </CardTitle>
                <CardDescription>
                  Set up your org in one click with a starter pack of common engineering roles and compliance policies. You can edit or delete them anytime.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={handleSeed} disabled={isSeeding}>
                  {isSeeding && <Spinner className="mr-2 h-4 w-4" />} Seed Starter Pack
                </Button>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Active Policies</CardTitle>
                <Shield className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{policyCount !== undefined ? policyCount : <Spinner className="w-6 h-6" />}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Roles</CardTitle>
                <GitBranch className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{roleCount !== undefined ? roleCount : <Spinner className="w-6 h-6" />}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Team Members</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{memberCount !== undefined ? memberCount : <Spinner className="w-6 h-6" />}</div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Evaluations This Month</CardTitle>
                <Zap className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats ? stats.evaluationsThisMonth : <Spinner className="w-6 h-6" />}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Violations</CardTitle>
                <ShieldAlert className={violations14d ? "h-4 w-4 text-destructive" : "h-4 w-4 text-muted-foreground"} />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${violations14d ? 'text-destructive' : ''}`}>
                  {violations14d !== undefined ? violations14d : <Spinner className="w-6 h-6" />}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Last 14 days</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Last Check Received</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {!stats ? (
                  <Spinner className="w-6 h-6" />
                ) : stats.lastCheckAt ? (
                  <>
                    <div className="text-2xl font-bold">{relativeTime(stats.lastCheckAt)}</div>
                    {stats.lastCheckKeyName && <p className="text-xs text-muted-foreground mt-1">via {stats.lastCheckKeyName}</p>}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No checks yet — <Link href="/ide-setup" className="text-primary hover:underline">connect an IDE</Link>
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Violations (14 days)</CardTitle>
              </CardHeader>
              <CardContent>
                {!stats ? (
                  <div className="flex justify-center p-8"><Spinner className="w-6 h-6" /></div>
                ) : (
                  <>
                    <div className="flex items-end gap-1 h-24">
                      {stats.violationsByDay.map((d) => (
                        <div
                          key={d.day}
                          title={`${new Date(d.day).toLocaleDateString()}: ${d.count} violation${d.count === 1 ? '' : 's'}`}
                          className={`flex-1 rounded-sm ${d.count > 0 ? 'bg-destructive/70' : 'bg-muted'}`}
                          style={{ height: `${Math.max((d.count / maxDayCount) * 100, 4)}%` }}
                        />
                      ))}
                    </div>
                    {stats.violationsByDay.length > 0 && (
                      <div className="flex justify-between text-xs text-muted-foreground mt-2">
                        <span>{new Date(stats.violationsByDay[0].day).toLocaleDateString()}</span>
                        <span>{new Date(stats.violationsByDay[stats.violationsByDay.length - 1].day).toLocaleDateString()}</span>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top Violated Policies (30d)</CardTitle>
              </CardHeader>
              <CardContent>
                {!stats ? (
                  <div className="flex justify-center p-8"><Spinner className="w-6 h-6" /></div>
                ) : stats.topPolicies.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No violations in the last 30 days.</p>
                ) : (
                  <div className="space-y-2">
                    {stats.topPolicies.map((p) => (
                      <div key={p.policyId} className="flex items-center justify-between text-sm">
                        <span className="font-medium truncate">{p.name}</span>
                        <span className="text-destructive font-semibold ml-4">{p.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {(policyCount === 0 || roleCount === 0 || memberCount === 1) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {roleCount === 0 && (
                <Card className="bg-primary/5 border-primary/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2"><GitBranch className="w-4 h-4 text-primary" /> Setup Roles</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">You have no roles defined yet.</p>
                    <Button size="sm" asChild className="w-full"><Link href="/roles"><Plus className="w-4 h-4 mr-2" /> Create Roles</Link></Button>
                  </CardContent>
                </Card>
              )}
              {policyCount === 0 && (
                <Card className="bg-primary/5 border-primary/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2"><Shield className="w-4 h-4 text-primary" /> Setup Policies</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">You have no policies defined yet.</p>
                    <Button size="sm" asChild className="w-full"><Link href="/policies"><Plus className="w-4 h-4 mr-2" /> Add Policies</Link></Button>
                  </CardContent>
                </Card>
              )}
              {memberCount === 1 && ( // Assuming 1 is just the current admin
                <Card className="bg-primary/5 border-primary/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4 text-primary" /> Invite Team</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">You are the only member in this org.</p>
                    <Button size="sm" asChild className="w-full"><Link href="/team"><Plus className="w-4 h-4 mr-2" /> Invite Team</Link></Button>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div className="space-y-1.5">
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Latest events and policy violations across your organization.</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={isExporting}>
                {isExporting ? <Spinner className="mr-2 h-4 w-4" /> : <Download className="w-4 h-4 mr-2" />} Export CSV
              </Button>
            </CardHeader>
            <CardContent>
              {!recentActivity ? (
                <div className="flex justify-center p-8"><Spinner className="w-8 h-8" /></div>
              ) : recentActivity?.data?.length === 0 ? (
                <EmptyState 
                  icon={<Activity className="w-10 h-10 text-muted-foreground" />}
                  title="No activity yet"
                  description="Connect the VS Code extension to start tracking policy checks and violations."
                  action={<Button variant="outline" asChild><Link href="/settings/api-keys">Get API Key</Link></Button>}
                />
              ) : (
                <div className="space-y-4">
                  {recentActivity?.data?.map((log: any) => (
                    <div key={log.id} className="flex items-start gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors">
                      <div className={`p-2 rounded-full ${log.action === 'policy.violated' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
                        {log.action === 'policy.violated' ? <ShieldAlert className="w-4 h-4" /> : <Activity className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 space-y-1">
                        <p className="text-sm font-medium">
                          {log.action === 'policy.violated' ? (
                            <span className="text-destructive">Policy Violation</span>
                          ) : log.action.replace(/\./g, ' ')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {log.actor ? `${log.actor.firstName || ''} ${log.actor.lastName || ''} (${log.actor.email})` : 'System / Agent'}
                        </p>
                      </div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        )}
      </div>
    </AppLayout>
  );
}
