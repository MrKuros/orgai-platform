'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { Settings, Shield, AlertCircle, CheckCircle2, Wand2, Lock } from 'lucide-react';

import { useAuth, useRole } from '@/lib/auth';
import { fetcher, updateOrg, getSsoConfig, saveSsoConfig, testSsoConnection, ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { AppLayout } from '@/components/layout/app-layout';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

export default function SettingsPage() {
  const { currentOrg, updateCurrentOrg } = useAuth();
  const { canManageOrg } = useRole();
  const { toast } = useToast();

  const { data: ssoData, mutate: mutateSso } = useSWR<any>(
    currentOrg ? `/orgs/${currentOrg.id}/sso` : null,
    fetcher
  );

  const { data: orgData, mutate: mutateOrgData } = useSWR<any>(
    currentOrg ? `/orgs/${currentOrg.id}` : null,
    fetcher
  );

  const [orgName, setOrgName] = useState(currentOrg?.name || '');
  const [isUpdatingOrg, setIsUpdatingOrg] = useState(false);

  const [ssoProvider, setSsoProvider] = useState('workos');
  const [workosOrgId, setWorkosOrgId] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const [isSavingSso, setIsSavingSso] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);

  // Prefill org name once it loads (empty on hard reload before context hydrates)
  useEffect(() => {
    if (orgData?.org?.name) setOrgName(orgData.org.name);
  }, [orgData?.org?.name]);

  // Prefill SSO inputs from saved config when it arrives
  useEffect(() => {
    const cfg = ssoData?.ssoConfig;
    if (cfg) {
      setSsoProvider(cfg.provider || 'workos');
      setWorkosOrgId(cfg.workosOrgId || '');
      setConnectionId(cfg.connectionId || '');
    }
  }, [ssoData?.ssoConfig]);

  const handleUpdateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrg || !orgName.trim()) return;

    setIsUpdatingOrg(true);
    try {
      const { org } = await updateOrg(currentOrg.id, { name: orgName.trim() });
      updateCurrentOrg(org); // sync context + localStorage so sidebar updates immediately
      mutateOrgData();
      toast({ title: 'Organization name updated' });
    } catch (error) {
      toast({
        title: 'Error updating organization',
        description: error instanceof ApiError ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsUpdatingOrg(false);
    }
  };

  const handleToggleAutoFix = async () => {
    if (!currentOrg || !orgData?.org) return;
    const next = !orgData.org.autoFix;
    try {
      await updateOrg(currentOrg.id, { autoFix: next });
      mutateOrgData();
      toast({
        title: next ? 'Autofix enabled' : 'Autofix disabled',
        description: next
          ? 'AI agents will self-correct blocked code using policy fix suggestions.'
          : 'AI agents will always ask the developer before changing blocked code.',
      });
    } catch (error) {
      toast({
        title: 'Error updating autofix',
        description: error instanceof ApiError ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleSaveSso = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrg) return;

    setIsSavingSso(true);
    try {
      await saveSsoConfig(currentOrg.id, {
        provider: ssoProvider,
        workosOrgId,
        connectionId,
      });
      mutateSso();
      toast({ title: 'SSO configuration saved' });
    } catch (error) {
      toast({
        title: 'Error saving SSO configuration',
        description: error instanceof ApiError ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsSavingSso(false);
    }
  };

  const handleTestConnection = async () => {
    if (!currentOrg) return;

    setIsTestingConnection(true);
    try {
      const result = await testSsoConnection(currentOrg.id);
      if (result.success) {
        toast({
          title: 'Connection Successful',
          description: 'SSO connection is working correctly.',
        });
      } else {
        toast({
          title: 'Connection Failed',
          description: result.error || 'Failed to connect to SSO provider.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Connection Test Error',
        description: error instanceof ApiError ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  return (
    <AppLayout>
      <div className="container mx-auto p-6 max-w-4xl">
        <PageHeader
          title="Settings"
          description="Manage your organization settings and integrations."
        />

        {!canManageOrg ? (
          <Card>
            <CardContent className="flex items-center gap-3 py-8">
              <Lock className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Only organization admins can change these settings. Contact an admin for access.
              </p>
            </CardContent>
          </Card>
        ) : (
        <div className="space-y-8">
          {/* Organization Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Organization
              </CardTitle>
              <CardDescription>
                Update your organization details.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdateOrg} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="orgName">Organization Name</Label>
                  <Input
                    id="orgName"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    disabled={isUpdatingOrg}
                  />
                </div>
                <Button type="submit" disabled={isUpdatingOrg || !orgName.trim()}>
                  {isUpdatingOrg && <Spinner className="mr-2 h-4 w-4" />}
                  Save Changes
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* AI Agent Enforcement */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wand2 className="h-5 w-5" />
                AI Agent Enforcement
              </CardTitle>
              <CardDescription>
                How AI agents handle code that violates a blocking policy.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-primary cursor-pointer"
                  checked={orgData?.org?.autoFix ?? true}
                  onChange={handleToggleAutoFix}
                  disabled={!orgData?.org}
                />
                <span>
                  <span className="font-medium block">Autofix blocked code</span>
                  <span className="text-sm text-muted-foreground block">
                    On: agents self-correct violations using each policy&apos;s fix suggestion, then re-check.
                    Off: agents always show violations to the developer and wait before changing anything.
                    Developers can override this per session from their editor.
                  </span>
                </span>
              </label>
            </CardContent>
          </Card>

          {/* SSO Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Single Sign-On (SSO)
              </CardTitle>
              <CardDescription>
                Configure SAML or OIDC single sign-on for your organization.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {ssoData?.ssoConfig ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <div>
                      <p className="font-medium text-green-600 dark:text-green-400">SSO Configured</p>
                      <p className="text-sm text-muted-foreground">
                        Provider: {ssoData.ssoConfig.provider}
                      </p>
                    </div>
                  </div>
                  <form onSubmit={handleSaveSso} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="provider">Provider</Label>
                        <Select value={ssoProvider} onValueChange={setSsoProvider}>
                          <SelectTrigger id="provider">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="workos">WorkOS</SelectItem>
                            <SelectItem value="saml">SAML</SelectItem>
                            <SelectItem value="oidc">OIDC</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="workosOrgId">Organization ID / Domain</Label>
                        <Input
                          id="workosOrgId"
                          value={workosOrgId}
                          onChange={(e) => setWorkosOrgId(e.target.value)}
                          placeholder="e.g. acme-corp"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="connectionId">Connection ID</Label>
                        <Input
                          id="connectionId"
                          value={connectionId}
                          onChange={(e) => setConnectionId(e.target.value)}
                          placeholder="e.g. conn_xxx"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" disabled={isSavingSso || !workosOrgId || !connectionId}>
                        {isSavingSso && <Spinner className="mr-2 h-4 w-4" />}
                        Save SSO Config
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleTestConnection}
                        disabled={isTestingConnection || !workosOrgId || !connectionId}
                      >
                        {isTestingConnection ? (
                          <>
                            <Spinner className="mr-2 h-4 w-4" />
                            Testing...
                          </>
                        ) : (
                          'Test Connection'
                        )}
                      </Button>
                    </div>
                  </form>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                    <AlertCircle className="h-5 w-5 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      No SSO configured yet. Set up single sign-on to allow team members to sign in with their identity provider.
                    </p>
                  </div>
                  <form onSubmit={handleSaveSso} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="provider">Provider</Label>
                        <Select value={ssoProvider} onValueChange={setSsoProvider}>
                          <SelectTrigger id="provider">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="workos">WorkOS</SelectItem>
                            <SelectItem value="saml">SAML</SelectItem>
                            <SelectItem value="oidc">OIDC</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="workosOrgId">Organization ID / Domain</Label>
                        <Input
                          id="workosOrgId"
                          value={workosOrgId}
                          onChange={(e) => setWorkosOrgId(e.target.value)}
                          placeholder="e.g. acme-corp"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="connectionId">Connection ID</Label>
                        <Input
                          id="connectionId"
                          value={connectionId}
                          onChange={(e) => setConnectionId(e.target.value)}
                          placeholder="e.g. conn_xxx"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" disabled={isSavingSso || !workosOrgId || !connectionId}>
                        {isSavingSso && <Spinner className="mr-2 h-4 w-4" />}
                        Save SSO Config
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleTestConnection}
                        disabled={isTestingConnection || !workosOrgId || !connectionId}
                      >
                        {isTestingConnection ? (
                          <>
                            <Spinner className="mr-2 h-4 w-4" />
                            Testing...
                          </>
                        ) : (
                          'Test Connection'
                        )}
                      </Button>
                    </div>
                  </form>
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
