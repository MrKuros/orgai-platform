'use client';
export const dynamic = 'force-dynamic';

import { useState } from 'react';
import useSWR from 'swr';
import { format } from 'date-fns';
import { Key, Plus, Trash2, AlertTriangle } from 'lucide-react';

import { useAuth } from '@/lib/auth';
import { fetcher, createApiKey, deleteApiKey, ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { AppLayout } from '@/components/layout/app-layout';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { CopyButton } from '@/components/copy-button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

function formatDate(dateStr: string | null) {
  if (!dateStr) return 'Never';
  return format(new Date(dateStr), 'MMM d, yyyy');
}

export default function ApiKeysPage() {
  const { currentOrg } = useAuth();
  const { toast } = useToast();
  
  const { data, mutate, isLoading } = useSWR<any>(
    currentOrg ? `/orgs/${currentOrg.id}/api-keys` : null,
    fetcher
  );
  
  const apiKeys = data?.apiKeys || [];

  // Create state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);

  // Delete state
  const [keyToDelete, setKeyToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrg || !newKeyName.trim()) return;
    
    setIsCreating(true);
    try {
      const res = await createApiKey(currentOrg.id, {
        name: newKeyName.trim(),
        scopes: ['check', 'resolve'],
      });
      mutate();
      setNewlyCreatedKey(res.key);
      setNewKeyName('');
      setIsCreateOpen(false);
    } catch (error) {
      toast({
        title: 'Error creating API key',
        description: error instanceof ApiError ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!currentOrg || !keyToDelete) return;
    setIsDeleting(true);
    try {
      await deleteApiKey(currentOrg.id, keyToDelete);
      mutate();
      setKeyToDelete(null);
      toast({ title: 'API key revoked' });
    } catch (error) {
      toast({
        title: 'Error revoking key',
        description: error instanceof ApiError ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AppLayout>
      <div className="container mx-auto p-6 max-w-4xl">
        <PageHeader
          title="API Keys"
          description="Manage keys for the VS Code extension and other API consumers."
          action={
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> New API Key
            </Button>
          }
        />

        {/* Newly Created Key Banner */}
        {newlyCreatedKey && (
          <div className="mb-6 p-4 border border-amber-500/30 rounded-lg bg-amber-500/10 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-amber-600 dark:text-amber-400">Save your new API key</p>
                <p className="text-sm text-amber-600/80 dark:text-amber-400/80">
                  This key will not be shown again. Copy it and store it somewhere safe.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-background rounded-md p-3 border">
              <code className="flex-1 text-sm font-mono break-all">{newlyCreatedKey}</code>
              <CopyButton value={newlyCreatedKey} />
            </div>
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setNewlyCreatedKey(null)}>
              I&apos;ve saved my key, dismiss
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center p-12"><Spinner className="w-8 h-8" /></div>
        ) : apiKeys.length === 0 ? (
          <EmptyState
            icon={<Key className="w-10 h-10 text-muted-foreground" />}
            title="No API keys yet"
            description="Create an API key to connect the VS Code extension or other integrations."
            action={
              <Button onClick={() => setIsCreateOpen(true)}>
                <Plus className="w-4 h-4 mr-2" /> Create API Key
              </Button>
            }
          />
        ) : (
          <div className="bg-card border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
                  <tr>
                    <th className="px-6 py-4 font-medium">Name</th>
                    <th className="px-6 py-4 font-medium">Key Prefix</th>
                    <th className="px-6 py-4 font-medium">Scopes</th>
                    <th className="px-6 py-4 font-medium">Last Used</th>
                    <th className="px-6 py-4 font-medium">Created</th>
                    <th className="px-6 py-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {apiKeys.map((key: any) => (
                    <tr key={key.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Key className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{key.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <code className="bg-muted px-2 py-0.5 rounded text-xs font-mono">{key.keyPrefix}...</code>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {key.scopes.map((scope: string) => (
                            <Badge key={scope} variant="secondary" className="text-[10px] font-mono">
                              {scope}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {formatDate(key.lastUsedAt)}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {formatDate(key.createdAt)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setKeyToDelete(key.id)}
                          title="Revoke key"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Usage Guide */}
        <div className="mt-8 p-6 bg-card border rounded-lg space-y-4">
          <h3 className="font-semibold text-lg">Usage Guide</h3>
          <div className="space-y-3 text-sm text-muted-foreground">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="font-medium text-foreground">VS Code Extension</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Open VS Code Settings</li>
                  <li>Search for &quot;OrgAI&quot;</li>
                  <li>Paste your API key in <code className="bg-muted px-1 rounded text-xs">orgai.apiKey</code></li>
                  <li>Set API URL to <code className="bg-muted px-1 rounded text-xs">{process.env.NEXT_PUBLIC_API_URL}</code></li>
                </ol>
              </div>
              <div className="space-y-2">
                <p className="font-medium text-foreground">Direct API Access</p>
                <pre className="bg-muted p-3 rounded text-xs font-mono whitespace-pre-wrap break-all">
{`curl -H "Authorization: Bearer <your-key>" \\
  ${process.env.NEXT_PUBLIC_API_URL}/v1/check`}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>
              Give your key a descriptive name so you can identify it later.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="keyName">Key Name</Label>
              <Input
                id="keyName"
                placeholder="e.g. VS Code - MacBook Pro"
                value={newKeyName}
                onChange={e => setNewKeyName(e.target.value)}
                disabled={isCreating}
                required
              />
              <p className="text-xs text-muted-foreground">Scopes: check, resolve (read-only access)</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isCreating}>
                Cancel
              </Button>
              <Button type="submit" disabled={isCreating || !newKeyName.trim()}>
                {isCreating && <Spinner className="mr-2 h-4 w-4" />}
                Create Key
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!keyToDelete}
        onOpenChange={(open) => !open && setKeyToDelete(null)}
        title="Revoke API Key"
        description="This will permanently revoke the key. Any integration using it will stop working immediately."
        confirmLabel="Revoke Key"
        onConfirm={handleDeleteConfirm}
        isLoading={isDeleting}
        destructive
      />
    </AppLayout>
  );
}
