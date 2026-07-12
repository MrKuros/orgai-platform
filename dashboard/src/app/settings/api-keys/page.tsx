'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { format } from 'date-fns';
import { Key, Plus, Trash2, AlertTriangle, ChevronDown } from 'lucide-react';

import { useAuth, useRole } from '@/lib/auth';
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

type CreatePreset = 'vscode' | 'mcp' | null;

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const AGENTS = [
  'Claude Code',
  'Cursor',
  'Antigravity',
  'Windsurf',
  'Cline',
  'Continue.dev',
  'OpenCode',
  'Any MCP-compatible agent',
];

function formatDate(dateStr: string | null) {
  if (!dateStr) return 'Never';
  return format(new Date(dateStr), 'MMM d, yyyy');
}

export default function ApiKeysPage() {
  const { currentOrg } = useAuth();
  const { canManageOrg } = useRole();
  const { toast } = useToast();

  // Self-host MCP endpoint: same-origin /mcp/sse. Resolve on client to avoid hydration mismatch.
  const [mcpUrl, setMcpUrl] = useState(
    process.env.NEXT_PUBLIC_API_URL ? `${process.env.NEXT_PUBLIC_API_URL}/mcp/sse` : ''
  );
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_API_URL) setMcpUrl(`${window.location.origin}/mcp/sse`);
  }, []);

  const { data, mutate, isLoading, error } = useSWR<any>(
    currentOrg ? `/orgs/${currentOrg.id}/api-keys` : null,
    fetcher
  );

  const apiKeys = data?.apiKeys || [];

  // Tab state
  const [activeTab, setActiveTab] = useState<'vscode' | 'mcp'>('vscode');

  // Create state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createPreset, setCreatePreset] = useState<CreatePreset>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(['check', 'resolve']);
  const [isCreating, setIsCreating] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);

  // Delete state
  const [keyToDelete, setKeyToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Open create dialog with preset
  const openCreateDialog = (preset: CreatePreset) => {
    if (preset === 'vscode') {
      setNewKeyName('VS Code Extension');
      setNewKeyScopes(['check', 'resolve', 'admin']);
    } else if (preset === 'mcp') {
      setNewKeyName('MCP Agent');
      setNewKeyScopes(['check', 'resolve']);
    } else {
      setNewKeyName('');
      setNewKeyScopes(['check', 'resolve']);
    }
    setCreatePreset(preset);
    setIsCreateOpen(true);
  };

  // Reset key after it's been shown
  useEffect(() => {
    if (newlyCreatedKey && activeTab === 'mcp') {
      // Auto-focus on the newly created key scenario - user will see it in the config
    }
  }, [newlyCreatedKey, activeTab]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrg || !newKeyName.trim()) return;

    setIsCreating(true);
    try {
      const res = await createApiKey(currentOrg.id, {
        name: newKeyName.trim(),
        scopes: newKeyScopes,
      });
      mutate();
      setNewlyCreatedKey(res.key);
      setNewKeyName('');
      setNewKeyScopes(['check', 'resolve']);
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
            canManageOrg ? (
              <Button onClick={() => openCreateDialog(null)}>
                <Plus className="w-4 h-4 mr-2" /> New API Key
              </Button>
            ) : undefined
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

        {error ? (
          <EmptyState
            icon={<AlertTriangle className="w-10 h-10 text-destructive" />}
            title="Couldn't load API keys"
            description="Something went wrong fetching your API keys. Check your connection and try again."
            action={<Button onClick={() => mutate()}>Retry</Button>}
          />
        ) : isLoading ? (
          <div className="flex justify-center p-12"><Spinner className="w-8 h-8" /></div>
        ) : apiKeys.length === 0 ? (
          <EmptyState
            icon={<Key className="w-10 h-10 text-muted-foreground" />}
            title="No API keys yet"
            description="Create an API key to connect the VS Code extension or other integrations."
            action={
              canManageOrg ? (
                <Button onClick={() => openCreateDialog(null)}>
                  <Plus className="w-4 h-4 mr-2" /> Create API Key
                </Button>
              ) : undefined
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
                        {canManageOrg && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setKeyToDelete(key.id)}
                            title="Revoke key"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

{/* Connection Instructions */}
        <div className="mt-8 p-6 bg-card border rounded-lg space-y-6">
          {/* Tabs */}
          <div className="space-y-4">
            <div className="flex gap-1 border-b">
              <button
                onClick={() => setActiveTab('vscode')}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === 'vscode'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                VS Code Extension
              </button>
              <button
                onClick={() => setActiveTab('mcp')}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === 'mcp'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                MCP Agent
              </button>
            </div>

            {/* VS Code Tab */}
            {activeTab === 'vscode' && (
              <div className="space-y-4">
                <div className="p-4 bg-muted/50 rounded-lg">
                  <p className="text-sm font-medium mb-3">Connection Instructions</p>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                    <li>Open VS Code Settings</li>
                    <li>Search for &quot;OrgAI&quot;</li>
                    <li>Paste your API key in <code className="bg-muted px-1 rounded text-xs">orgai.apiKey</code></li>
                    <li>Set API URL to <code className="bg-muted px-1 rounded text-xs">{API_URL}</code></li>
                  </ol>
                </div>
                {canManageOrg && (
                  <div className="flex justify-end">
                    <Button variant="outline" size="sm" onClick={() => openCreateDialog('vscode')}>
                      <Plus className="w-4 h-4 mr-2" /> New VS Code Key
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* MCP Tab */}
            {activeTab === 'mcp' && (
              <div className="space-y-6">
                {/* Step 1 */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">Step 1 — Generate an API key</h4>
                  <p className="text-sm text-muted-foreground">
                    Create a key with <code className="bg-muted px-1 rounded text-xs">check</code> and{' '}
                    <code className="bg-muted px-1 rounded text-xs">resolve</code> scopes.
                  </p>
                  {canManageOrg && (
                    <Button variant="outline" size="sm" onClick={() => openCreateDialog('mcp')}>
                      <Plus className="w-4 h-4 mr-2" /> New MCP Agent Key
                    </Button>
                  )}
                </div>

                {/* Step 2 */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">Step 2 — Add to your agent config</h4>
                  <p className="text-sm text-muted-foreground">
                    Copy this into your MCP agent&apos;s configuration file:
                  </p>
                  <div className="bg-muted/50 rounded-lg p-4 overflow-x-auto">
                    <div className="flex items-start gap-3">
                      <pre className="flex-1 text-sm font-mono text-left whitespace-pre">{`{
  "mcpServers": {
    "orgai": {
      "url": "${mcpUrl}",
      "env": {
        "COMPLY_API_KEY": "${newlyCreatedKey || 'your-api-key-here'}"
      }
    }
  }
}`}</pre>
                      <CopyButton
                        value={`{
  "mcpServers": {
    "orgai": {
      "url": "${mcpUrl}",
      "env": {
        "COMPLY_API_KEY": "${newlyCreatedKey || 'your-api-key-here'}"
      }
    }
  }
}`}
                      />
                    </div>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">Step 3 — Supported agents</h4>
                  <div className="flex flex-wrap gap-2">
                    {AGENTS.map((agent) => (
                      <span
                        key={agent}
                        className="px-3 py-1 bg-muted rounded-full text-xs font-medium"
                      >
                        {agent}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Step 4 - Advanced */}
                <details className="group">
                  <summary className="flex items-center gap-2 cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground list-none">
                    <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                    Step 4 — Self-hosted MCP
                  </summary>
                  <div className="mt-3 pl-6 space-y-2 text-sm text-muted-foreground">
                    <p>The MCP server is served from this deployment. Agents that support streamable HTTP can point directly at:</p>
                    <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <code className="bg-muted px-1 rounded text-xs">{mcpUrl.replace('/mcp/sse', '/mcp')}</code>
                        <span className="text-xs text-muted-foreground">(streamable HTTP)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="bg-muted px-1 rounded text-xs">{mcpUrl}</code>
                        <span className="text-xs text-muted-foreground">(SSE)</span>
                      </div>
                    </div>
                  </div>
                </details>
              </div>
            )}
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
            </div>
            <div className="space-y-2">
              <Label>Scopes</Label>
              <div className="flex flex-wrap gap-2">
                {['check', 'resolve', 'admin'].map((scope) => (
                  <label key={scope} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={newKeyScopes.includes(scope)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setNewKeyScopes([...newKeyScopes, scope]);
                        } else {
                          setNewKeyScopes(newKeyScopes.filter(s => s !== scope));
                        }
                      }}
                      disabled={isCreating || scope === 'check'}
                      className="rounded border-input"
                    />
                    <code className="bg-muted px-1 rounded text-xs">{scope}</code>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {newKeyScopes.includes('admin')
                  ? 'Full access including admin operations'
                  : 'Read-only access (check and resolve)'}
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isCreating}>
                Cancel
              </Button>
              <Button type="submit" disabled={isCreating || !newKeyName.trim() || newKeyScopes.length === 0}>
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
