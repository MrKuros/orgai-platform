'use client';
export const dynamic = 'force-dynamic';

import { useState } from 'react';
import useSWR from 'swr';
import { Plus, Trash2, Pencil, Shield, ArrowRight, ShieldCheck, Search, Play, AlertTriangle } from 'lucide-react';

import { useAuth, useRole } from '@/lib/auth';
import { fetcher, createPolicy, updatePolicy, deletePolicy, ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { AppLayout } from '@/components/layout/app-layout';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { PolicyForm, PolicyFormValues } from '@/components/policy-form';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { LiveEvaluatorPreview } from '@/components/live-evaluator-preview';

export default function PoliciesPage() {
  const { currentOrg } = useAuth();
  const { canManagePolicies } = useRole();
  const { toast } = useToast();
  
  const { data: policiesData, mutate: mutatePolicies, isLoading: policiesLoading, error: policiesError } = useSWR<any>(currentOrg ? `/orgs/${currentOrg.id}/policies` : null, fetcher);
  const { data: rolesData, isLoading: rolesLoading, error: rolesError, mutate: mutateRoles } = useSWR<any>(currentOrg ? `/orgs/${currentOrg.id}/roles` : null, fetcher);

  const policies = policiesData?.policies || [];
  const roles = rolesData?.roles || [];

  const isLoading = policiesLoading || rolesLoading;
  const loadError = policiesError || rolesError;

  const [searchQuery, setSearchQuery] = useState('');
  
  // Dialog states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<any | null>(null);
  
  // Delete state
  const [policyToDelete, setPolicyToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Live Evaluator Preview
  const [isEvaluatorOpen, setIsEvaluatorOpen] = useState(false);

  const filteredPolicies = policies.filter((p: any) => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    p.rule.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreatePolicy = async (data: PolicyFormValues) => {
    if (!currentOrg) return;
    setIsSubmitting(true);
    try {
      await createPolicy(currentOrg.id, data);
      mutatePolicies();
      setIsCreateOpen(false);
      toast({ title: 'Policy created successfully' });
    } catch (error) {
      toast({ title: 'Error creating policy', description: error instanceof ApiError ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdatePolicy = async (data: PolicyFormValues) => {
    if (!currentOrg || !editingPolicy) return;
    setIsSubmitting(true);
    try {
      await updatePolicy(currentOrg.id, editingPolicy.id, data);
      mutatePolicies();
      setEditingPolicy(null);
      toast({ title: 'Policy updated successfully' });
    } catch (error) {
      toast({ title: 'Error updating policy', description: error instanceof ApiError ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!currentOrg || !policyToDelete) return;
    setIsDeleting(true);
    try {
      await deletePolicy(currentOrg.id, policyToDelete);
      setPolicyToDelete(null);
      mutatePolicies();
      toast({ title: 'Policy deleted' });
    } catch (error) {
      toast({ title: 'Error deleting policy', description: error instanceof ApiError ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AppLayout>
      <div className="container mx-auto p-6 max-w-6xl">
        <PageHeader
          title="Policies"
          description="Define rules for AI agents and bind them to specific roles."
          action={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsEvaluatorOpen(true)}>
                <Play className="w-4 h-4 mr-2" /> Evaluate
              </Button>
              {canManagePolicies && (
                <Button onClick={() => setIsCreateOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" /> New Policy
                </Button>
              )}
            </div>
          }
        />

        {loadError ? (
          <EmptyState
            icon={<AlertTriangle className="w-10 h-10 text-destructive" />}
            title="Couldn't load policies"
            description="Something went wrong fetching your policies. Check your connection and try again."
            action={<Button onClick={() => { mutatePolicies(); mutateRoles(); }}>Retry</Button>}
          />
        ) : isLoading ? (
          <div className="flex justify-center p-12"><Spinner className="w-8 h-8" /></div>
        ) : policies.length === 0 ? (
          <EmptyState
            icon={<Shield className="w-10 h-10 text-muted-foreground" />}
            title="No policies defined"
            description="Create your first policy to establish guidelines for your AI agents."
            action={canManagePolicies ? <Button onClick={() => setIsCreateOpen(true)}><Plus className="w-4 h-4 mr-2" /> Create Policy</Button> : undefined}
          />
        ) : (
          <div className="space-y-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search policies..."
                aria-label="Search policies"
                className="pl-9 max-w-md"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="grid gap-4">
              {filteredPolicies.map((policy: any) => (
                <div key={policy.id} className="bg-card border rounded-lg p-5 transition-shadow hover:shadow-md flex flex-col sm:flex-row gap-4">
                  <div className="flex-1 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-lg">{policy.name}</h3>
                          <Badge variant={policy.severity === 'ERROR' ? 'destructive' : 'secondary'} className="text-[10px]">
                            {policy.severity}
                          </Badge>
                          {policy.status === 'SHADOW' && (
                            <Badge variant="outline" className="text-[10px] border-primary/40 text-primary" title="Evaluated and logged, never blocks">
                              SHADOW
                            </Badge>
                          )}
                          {policy.evaluatorType !== 'none' && (
                            <Badge variant="outline" className="text-[10px] bg-muted">
                              {policy.evaluatorType}
                            </Badge>
                          )}
                        </div>
                        <p className="text-muted-foreground mt-1">{policy.rule}</p>
                      </div>
                      
                      {canManagePolicies && (
                        <div className="flex gap-2">
                          <Button variant="ghost" size="icon" aria-label="Edit policy" onClick={() => setEditingPolicy(policy)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="text-destructive" aria-label="Delete policy" onClick={() => setPolicyToDelete(policy.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm bg-muted/50 p-3 rounded-md">
                      {policy.skill && (
                        <div>
                          <span className="font-medium text-xs text-muted-foreground uppercase tracking-wider">Skill Guidance</span>
                          <p className="mt-1">{policy.skill}</p>
                        </div>
                      )}
                      
                      {policy.evaluatorType !== 'none' && (
                        <div>
                          <span className="font-medium text-xs text-muted-foreground uppercase tracking-wider">Evaluator Pattern</span>
                          <code className="block mt-1 bg-background border px-2 py-1 rounded text-xs font-mono break-all">
                            {policy.evaluatorPattern}
                          </code>
                        </div>
                      )}

                      {policy.fixSuggestion && (
                        <div className="md:col-span-2">
                          <span className="font-medium text-xs text-muted-foreground uppercase tracking-wider">Fix Suggestion</span>
                          <p className="mt-1">{policy.fixSuggestion}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="sm:w-48 shrink-0 border-t sm:border-t-0 sm:border-l pt-4 sm:pt-0 sm:pl-4">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Bound Roles</h4>
                    {policy.bindings && policy.bindings.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {policy.bindings.map((b: any) => (
                          <Badge key={b.id} variant="secondary" className="font-normal text-xs">
                            {b.role?.displayName || b.roleId}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground italic">No roles bound</span>
                    )}
                  </div>
                </div>
              ))}

              {filteredPolicies.length === 0 && (
                <div className="text-center py-12 text-muted-foreground border border-dashed rounded-lg">
                  No policies match your search.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Policy</DialogTitle>
            <DialogDescription>
              Define rules for your AI agents and how to enforce them.
            </DialogDescription>
          </DialogHeader>
          <PolicyForm roles={roles} onSubmit={handleCreatePolicy} isLoading={isSubmitting} />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editingPolicy} onOpenChange={(open) => !open && setEditingPolicy(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Policy</DialogTitle>
            <DialogDescription>
              Update the rules and enforcement for {editingPolicy?.name}.
            </DialogDescription>
          </DialogHeader>
          {editingPolicy && (
            <PolicyForm 
              roles={roles} 
              defaultValues={{
                ...editingPolicy,
                roleIds: editingPolicy.bindings?.map((b: any) => b.roleId) || []
              }} 
              onSubmit={handleUpdatePolicy} 
              isLoading={isSubmitting} 
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!policyToDelete}
        onOpenChange={(open) => !open && setPolicyToDelete(null)}
        title="Delete Policy"
        description="Are you sure you want to delete this policy? Agents will no longer be checked against it."
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
        isLoading={isDeleting}
        destructive
      />

      {/* Live Evaluator Preview */}
      <LiveEvaluatorPreview
        open={isEvaluatorOpen}
        onOpenChange={setIsEvaluatorOpen}
      />
    </AppLayout>
  );
}
