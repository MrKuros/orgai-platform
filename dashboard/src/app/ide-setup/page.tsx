'use client';
export const dynamic = 'force-dynamic';

import { useState } from 'react';
import useSWR from 'swr';
import { AlertTriangle, Plus } from 'lucide-react';

import { useAuth } from '@/lib/auth';
import { fetcher, createApiKey, ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { AppLayout } from '@/components/layout/app-layout';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { CopyButton } from '@/components/copy-button';
import { IdeSetupTabs } from '@/components/ide-setup-tabs';

const MCP_URL = process.env.NEXT_PUBLIC_MCP_URL || 'https://mcp.orgai.dev';

export default function IdeSetupPage() {
  const { currentOrg } = useAuth();
  const { toast } = useToast();

  const { data, mutate, isLoading } = useSWR<any>(
    currentOrg ? `/orgs/${currentOrg.id}/api-keys` : null,
    fetcher
  );

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);

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

  return (
    <AppLayout>
      <div className="container mx-auto p-6 max-w-4xl">
        <PageHeader
          title="IDE Setup"
          description="Connect your IDE or agent to OrgAI"
        />

        {/* API Key Section */}
        <div className="mb-8 p-6 bg-card border rounded-lg space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-lg">Your API Key</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Generate an API key to authenticate your IDE or agent with OrgAI.
              </p>
            </div>
            {!newlyCreatedKey && (
              <Button onClick={() => { setNewKeyName('IDE Setup'); setIsCreateOpen(true); }}>
                <Plus className="w-4 h-4 mr-2" /> Generate Key
              </Button>
            )}
          </div>

          {/* Newly Created Key */}
          {newlyCreatedKey && (
            <div className="p-4 border border-amber-500/30 rounded-lg bg-amber-500/10 space-y-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-amber-600 dark:text-amber-400">Save your API key</p>
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

          {/* Create Dialog */}
          {isCreateOpen && (
            <div className="border rounded-lg p-4 bg-muted/30 space-y-4">
              <form onSubmit={handleCreate} className="flex items-end gap-3">
                <div className="flex-1 space-y-1">
                  <label htmlFor="keyName" className="text-sm font-medium">Key Name</label>
                  <input
                    id="keyName"
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="e.g. Cursor, Windsurf, Claude Code"
                    className="w-full px-3 py-2 border rounded-md bg-background text-sm"
                    disabled={isCreating}
                  />
                </div>
                <Button type="submit" disabled={isCreating || !newKeyName.trim()}>
                  {isCreating && <Spinner className="mr-2 h-4 w-4" />}
                  Create
                </Button>
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isCreating}>
                  Cancel
                </Button>
              </form>
            </div>
          )}
        </div>

        {/* IDE Setup Tabs */}
        <IdeSetupTabs apiKey={newlyCreatedKey} />
      </div>
    </AppLayout>
  );
}
