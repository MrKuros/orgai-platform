'use client';
export const dynamic = 'force-dynamic';

import useSWR from 'swr';
import Link from 'next/link';
import { Shield, GitBranch, Users, AlertTriangle, ArrowRight, ShieldAlert, Plus, Activity } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { fetcher } from '@/lib/api';
import { AppLayout } from '@/components/layout/app-layout';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';

export default function DashboardPage() {
  const { currentOrg } = useAuth();
  
  const { data: policiesData } = useSWR<any>(currentOrg ? `/orgs/${currentOrg.id}/policies` : null, fetcher);
  const { data: rolesData } = useSWR<any>(currentOrg ? `/orgs/${currentOrg.id}/roles` : null, fetcher);
  const { data: membersData } = useSWR<any>(currentOrg ? `/orgs/${currentOrg.id}/members` : null, fetcher);
  
  // Get recent violations (last 7 days)
  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);
  const { data: auditData } = useSWR<any>(
    currentOrg ? `/orgs/${currentOrg.id}/audit?action=policy.violated&from=${lastWeek.toISOString()}` : null,
    fetcher
  );

  // Get general recent activity
  const { data: recentActivity } = useSWR<any>(
    currentOrg ? `/orgs/${currentOrg.id}/audit?limit=5` : null,
    fetcher
  );

  const policyCount = policiesData?.policies?.length;
  const roleCount = rolesData?.roles?.length;
  const memberCount = membersData?.members?.length;
  const violationCount = auditData?.total;

  return (
    <AppLayout>
      <div className="container mx-auto p-6 max-w-6xl">
        <PageHeader 
          title="Dashboard" 
          description="Overview of your organization's AI compliance status."
        />

        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Recent Violations</CardTitle>
                <AlertTriangle className={violationCount > 0 ? "h-4 w-4 text-destructive" : "h-4 w-4 text-muted-foreground"} />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${violationCount > 0 ? 'text-destructive' : ''}`}>
                  {violationCount !== undefined ? violationCount : <Spinner className="w-6 h-6" />}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Last 7 days</p>
              </CardContent>
            </Card>
          </div>

          {(policyCount === 0 || roleCount === 0 || memberCount === 0) && (
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
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest events and policy violations across your organization.</CardDescription>
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
      </div>
    </AppLayout>
  );
}
