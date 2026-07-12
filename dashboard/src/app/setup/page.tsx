'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { createRole, createPolicy, inviteMember, createApiKey, ApiError } from '@/lib/api';
import type { Role } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { CopyButton } from '@/components/copy-button';
import { Plus, Trash2, ArrowRight, ShieldCheck, Mail, Key } from 'lucide-react';
import { PolicyForm } from '@/components/policy-form';

export default function SetupWizard() {
  const { user, currentOrg, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 2 State (Roles)
  const [roles, setRoles] = useState([
    { id: '1', name: 'cto', displayName: 'CTO', inheritsFromId: '' },
    { id: '2', name: 'lead', displayName: 'Lead', inheritsFromId: '1' },
    { id: '3', name: 'senior', displayName: 'Senior', inheritsFromId: '2' },
    { id: '4', name: 'junior', displayName: 'Junior', inheritsFromId: '2' },
  ]);
  const [createdRoles, setCreatedRoles] = useState<Role[]>([]);
  const [createdPolicyNames, setCreatedPolicyNames] = useState<string[]>([]);

  // Step 3 State (Policies)
  const [policies, setPolicies] = useState([
    {
      id: 'p1',
      name: 'no-hardcoded-secrets',
      rule: 'Never hardcode secrets, API keys, or credentials in source code.',
      skill: 'Always read secrets from process.env.',
      evaluatorType: 'regex' as const,
      evaluatorPattern: '(api_key|secret|password|token)\\s*=\\s*[\'"][^\'"]{8,}[\'"]',
      severity: 'ERROR' as const,
      roleIds: [] as string[],
    },
    {
      id: 'p2',
      name: 'approved-packages-only',
      rule: 'Only use libraries from the approved list.',
      skill: 'Check package.json or team docs before adding dependencies.',
      evaluatorType: 'command' as const,
      evaluatorPattern: 'npm (install|i|add)|yarn (add)',
      severity: 'ERROR' as const,
      roleIds: [] as string[],
    },
    {
      id: 'p3',
      name: 'jsdoc-required',
      rule: 'All public-facing functions must have JSDoc comments.',
      skill: 'Add a JSDoc comment block above exported functions.',
      evaluatorType: 'none' as const,
      severity: 'WARNING' as const,
      roleIds: [] as string[],
    }
  ]);

  // Step 4 State
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ORG_ADMIN' | 'POLICY_ADMIN' | 'MEMBER'>('MEMBER');
  const [inviteAssignedRoleId, setInviteAssignedRoleId] = useState<string>('');
  const [invites, setInvites] = useState<{email: string, role: string}[]>([]);
  const [apiKey, setApiKey] = useState<string | null>(null);

  // Redirect unauthenticated users from an effect, never during render.
  useEffect(() => {
    if (!authLoading && (!user || !currentOrg)) {
      router.push('/login');
    }
  }, [authLoading, user, currentOrg, router]);

  if (authLoading || !user || !currentOrg) {
    return <div className="flex h-screen items-center justify-center"><Spinner className="h-8 w-8" /></div>;
  }

  const handleNextStep1 = () => setStep(2);

  const handleNextStep2 = async () => {
    if (roles.length === 0) {
      toast({ title: 'Validation Error', description: 'At least one role is required.', variant: 'destructive' });
      return;
    }
    
    setIsSubmitting(true);
    try {
      // Resume from already-created roles so a retry after a partial failure
      // skips existing ones instead of creating duplicates. Match by slug (name).
      const created: Role[] = [...createdRoles];
      const idMap = new Map<string, string>(); // maps temp id -> real id
      for (const r of roles) {
        const existing = created.find(c => c.name === r.name);
        if (existing) idMap.set(r.id, existing.id);
      }

      // Create roots first, then children
      const toCreate = roles.filter(r => !idMap.has(r.id));
      let iterations = 0;

      while (toCreate.length > 0 && iterations < 100) {
        iterations++;
        for (let i = 0; i < toCreate.length; i++) {
          const role = toCreate[i];
          if (!role.inheritsFromId || idMap.has(role.inheritsFromId)) {
            const inheritsFromId = role.inheritsFromId ? idMap.get(role.inheritsFromId) : undefined;
            const res = await createRole(currentOrg.id, {
              name: role.name,
              displayName: role.displayName,
              inheritsFromId
            });
            idMap.set(role.id, res.role.id);
            created.push(res.role);
            setCreatedRoles([...created]); // persist progress for retry
            toCreate.splice(i, 1);
            i--;
          }
        }
      }

      setCreatedRoles(created);

      // Auto-assign CTO role to first policy as default
      if (created.length > 0) {
        setPolicies(policies.map(p => ({ ...p, roleIds: [created[0].id] })));
      }

      setStep(3);
    } catch (error) {
      toast({ title: 'Error creating roles', description: error instanceof ApiError ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNextStep3 = async () => {
    setIsSubmitting(true);
    // Track created policy names so a retry after a partial failure skips existing ones.
    const done = [...createdPolicyNames];
    try {
      for (const policy of policies) {
        if (done.includes(policy.name)) continue;
        await createPolicy(currentOrg.id, {
          name: policy.name,
          rule: policy.rule,
          skill: policy.skill,
          evaluatorType: policy.evaluatorType,
          evaluatorPattern: policy.evaluatorPattern,
          severity: policy.severity,
          roleIds: policy.roleIds,
        });
        done.push(policy.name);
        setCreatedPolicyNames([...done]);
      }
      setStep(4);
    } catch (error) {
      toast({ title: 'Error creating policies', description: error instanceof ApiError ? `${error.message} — created ${done.length}/${policies.length}. Fix and retry to continue.` : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail) return;
    setIsSubmitting(true);
    try {
      await inviteMember(currentOrg.id, {
        email: inviteEmail,
        membershipRole: inviteRole,
        assignedRoleId: inviteAssignedRoleId || undefined
      });
      setInvites([...invites, { email: inviteEmail, role: inviteRole }]);
      setInviteEmail('');
      toast({ title: 'Invite sent', description: `Invitation sent to ${inviteEmail}` });
    } catch (error) {
      toast({ title: 'Error', description: error instanceof ApiError ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGenerateKey = async () => {
    setIsSubmitting(true);
    try {
      const res = await createApiKey(currentOrg.id, {
        name: 'VS Code Extension',
        scopes: ['check', 'resolve']
      });
      setApiKey(res.key);
      toast({ title: 'API Key Generated' });
    } catch (error) {
      toast({ title: 'Error', description: error instanceof ApiError ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-3xl">
        <div className="mb-8 text-center">
          <p className="text-sm font-medium text-muted-foreground mb-2">Step {step} of 4</p>
          <div className="flex gap-2 justify-center max-w-xs mx-auto">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className={`h-2 flex-1 rounded-full ${i <= step ? 'bg-primary' : 'bg-secondary'}`} />
            ))}
          </div>
        </div>

        {step === 1 && (
          <Card className="animate-in fade-in-50 slide-in-from-bottom-4">
            <CardHeader className="text-center pb-8 pt-10">
              <div className="mx-auto bg-primary/10 w-16 h-16 rounded-full flex items-center justify-center mb-6">
                <ShieldCheck className="w-8 h-8 text-primary" />
              </div>
              <CardTitle className="text-3xl font-bold">Welcome to OrgAI, {user.firstName}</CardTitle>
              <CardDescription className="text-lg mt-4 max-w-md mx-auto">
                Let&apos;s set up your organization&apos;s compliance hierarchy. This takes about 2 minutes.
              </CardDescription>
            </CardHeader>
            <CardFooter className="flex justify-center pb-10">
              <Button size="lg" className="w-full max-w-sm" onClick={handleNextStep1}>
                Get Started <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </CardFooter>
          </Card>
        )}

        {step === 2 && (
          <Card className="animate-in fade-in-50 slide-in-from-right-4">
            <CardHeader>
              <CardTitle>Create your role hierarchy</CardTitle>
              <CardDescription>
                Roles define who inherits whose policies. A Junior Developer inherits everything from Lead, which inherits from CTO.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {roles.map((role, idx) => (
                <div key={role.id} className="flex items-center gap-3 bg-card border rounded-md p-3">
                  <div className="grid grid-cols-3 gap-3 flex-1">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Name (slug)</Label>
                      <Input aria-label={`Role ${idx + 1} name (slug)`} value={role.name} onChange={e => {
                        const newRoles = [...roles];
                        newRoles[idx].name = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                        setRoles(newRoles);
                      }} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Display Name</Label>
                      <Input aria-label={`Role ${idx + 1} display name`} value={role.displayName} onChange={e => {
                        const newRoles = [...roles];
                        newRoles[idx].displayName = e.target.value;
                        setRoles(newRoles);
                      }} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Inherits From</Label>
                      <Select value={role.inheritsFromId} onValueChange={val => {
                        const newRoles = [...roles];
                        newRoles[idx].inheritsFromId = val === 'none' ? '' : val;
                        setRoles(newRoles);
                      }}>
                        <SelectTrigger aria-label={`Role ${idx + 1} inherits from`}>
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {roles.filter(r => r.id !== role.id).map(r => (
                            <SelectItem key={r.id} value={r.id}>{r.displayName || r.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="text-destructive mt-5" onClick={() => setRoles(roles.filter(r => r.id !== role.id))}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" className="w-full border-dashed" onClick={() => setRoles([...roles, { id: Math.random().toString(), name: '', displayName: '', inheritsFromId: '' }])}>
                <Plus className="w-4 h-4 mr-2" /> Add another role
              </Button>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={handleNextStep2} disabled={isSubmitting}>
                {isSubmitting ? <Spinner className="mr-2" /> : null} Next: Add Policies
              </Button>
            </CardFooter>
          </Card>
        )}

        {step === 3 && (
          <Card className="animate-in fade-in-50 slide-in-from-right-4">
            <CardHeader>
              <CardTitle>Add your first policies</CardTitle>
              <CardDescription>
                Policies are rules the AI agent must follow. They&apos;re assigned to roles and inherited downward.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {policies.map((policy, idx) => (
                <div key={policy.id} className="bg-card border rounded-md p-4 space-y-4 relative">
                  <Button variant="ghost" size="icon" className="absolute top-2 right-2 text-destructive" onClick={() => setPolicies(policies.filter(p => p.id !== policy.id))}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                  <div className="grid grid-cols-2 gap-4 mr-8">
                    <div className="space-y-2">
                      <Label>Policy Name</Label>
                      <Input aria-label={`Policy ${idx + 1} name`} value={policy.name} onChange={e => {
                        const newPol = [...policies];
                        newPol[idx].name = e.target.value;
                        setPolicies(newPol);
                      }} />
                    </div>
                    <div className="space-y-2">
                      <Label>Bind to Role</Label>
                      <Select value={policy.roleIds[0] || 'none'} onValueChange={val => {
                        const newPol = [...policies];
                        newPol[idx].roleIds = val === 'none' ? [] : [val];
                        setPolicies(newPol);
                      }}>
                        <SelectTrigger aria-label={`Policy ${idx + 1} bound role`}><SelectValue placeholder="Select role" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {createdRoles.map(r => <SelectItem key={r.id} value={r.id}>{r.displayName}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Rule</Label>
                    <Input aria-label={`Policy ${idx + 1} rule`} value={policy.rule} onChange={e => {
                        const newPol = [...policies];
                        newPol[idx].rule = e.target.value;
                        setPolicies(newPol);
                      }} />
                  </div>
                </div>
              ))}
              <Button variant="outline" className="w-full border-dashed" onClick={() => setPolicies([...policies, { id: Math.random().toString(), name: '', rule: '', skill: '', evaluatorType: 'none', severity: 'WARNING', roleIds: [] } as any])}>
                <Plus className="w-4 h-4 mr-2" /> Add another policy
              </Button>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(4)}>Skip for now</Button>
              <Button onClick={handleNextStep3} disabled={isSubmitting}>
                {isSubmitting ? <Spinner className="mr-2" /> : null} Next: Connect Team
              </Button>
            </CardFooter>
          </Card>
        )}

        {step === 4 && (
          <div className="space-y-6 animate-in fade-in-50 slide-in-from-right-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Mail className="w-5 h-5" /> Invite your team</CardTitle>
                <CardDescription>Send invitations to join {currentOrg.name}.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {invites.length > 0 && (
                  <div className="space-y-2 mb-4">
                    <p className="text-sm font-medium">Pending Invites:</p>
                    {invites.map((inv, i) => (
                      <div key={i} className="flex justify-between items-center bg-muted/50 p-2 rounded text-sm">
                        <span>{inv.email}</span>
                        <span className="text-muted-foreground text-xs">{inv.role}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 items-end">
                  <div className="space-y-2 flex-1">
                    <Label htmlFor="inviteEmail">Email</Label>
                    <Input id="inviteEmail" placeholder="colleague@company.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
                  </div>
                  <div className="space-y-2 w-[150px]">
                    <Label htmlFor="inviteRole">Org Role</Label>
                    <Select value={inviteRole} onValueChange={(val: any) => setInviteRole(val)}>
                      <SelectTrigger id="inviteRole"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MEMBER">Member</SelectItem>
                        <SelectItem value="POLICY_ADMIN">Policy Admin</SelectItem>
                        <SelectItem value="ORG_ADMIN">Org Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button variant="secondary" onClick={handleInvite} disabled={!inviteEmail || isSubmitting}>
                    {isSubmitting ? <Spinner className="mr-2 h-4 w-4" /> : 'Invite'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Key className="w-5 h-5" /> Connect VS Code Extension</CardTitle>
                <CardDescription>Generate an API key to allow agents to fetch policies.</CardDescription>
              </CardHeader>
              <CardContent>
                {!apiKey ? (
                  <Button onClick={handleGenerateKey} disabled={isSubmitting}>
                    {isSubmitting ? <Spinner className="mr-2" /> : null} Generate API Key
                  </Button>
                ) : (
                  <div className="space-y-4">
                    <div className="p-3 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-md text-sm">
                      <strong>Warning:</strong> This key will only be shown once. Copy it now.
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-muted p-3 rounded-md text-sm font-mono overflow-x-auto">
                        {apiKey}
                      </code>
                      <CopyButton value={apiKey} />
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <p>1. Open VS Code</p>
                      <p>2. Go to OrgAI Extension Settings</p>
                      <p>3. Paste this key into &quot;Org API Key&quot;</p>
                      <p>4. Set API URL to <code className="bg-muted px-1 rounded text-xs">{process.env.NEXT_PUBLIC_API_URL}</code></p>
                    </div>
                  </div>
                )}
              </CardContent>
              <CardFooter className="flex justify-between border-t pt-6 bg-muted/20">
                <Button variant="ghost" onClick={() => router.push('/dashboard')}>Skip to Dashboard</Button>
                <Button onClick={() => router.push('/dashboard')}>
                  Go to Dashboard <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </CardFooter>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
