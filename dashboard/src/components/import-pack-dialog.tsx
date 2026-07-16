'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { PackageOpen } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { fetcher, importPolicyPack, ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { PolicyPack, Role } from '@/lib/types';

interface ImportPackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: Role[];
  onImported: () => void;
}

export function ImportPackDialog({ open, onOpenChange, roles, onImported }: ImportPackDialogProps) {
  const { currentOrg } = useAuth();
  const { toast } = useToast();
  const { data } = useSWR<{ packs: PolicyPack[] }>(open ? '/policy-packs' : null, fetcher as (url: string) => Promise<{ packs: PolicyPack[] }>);
  const packs = data?.packs || [];

  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  const handleImport = async () => {
    if (!currentOrg || !selectedPack) return;
    setIsImporting(true);
    try {
      const res = await importPolicyPack(currentOrg.id, {
        packId: selectedPack,
        roleIds: selectedRoleIds,
      });
      onImported();
      onOpenChange(false);
      setSelectedPack(null);
      setSelectedRoleIds([]);
      toast({
        title: `Imported ${res.imported.length} policies in shadow mode`,
        description:
          (res.skipped.length ? `Skipped (already exist): ${res.skipped.join(', ')}. ` : '') +
          'Shadow policies log would-block hits without blocking — enforce each one from its edit dialog when ready.',
      });
    } catch (error) {
      toast({ title: 'Import failed', description: error instanceof ApiError ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsImporting(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setSelectedPack(null);
      setSelectedRoleIds([]);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import a Policy Pack</DialogTitle>
          <DialogDescription>
            Starter rule sets for common compliance regimes. Packs import in <strong>shadow mode</strong> — they log would-have-blocked hits to the audit trail without blocking anyone, so you can measure noise before enforcing.
          </DialogDescription>
        </DialogHeader>

        {!data ? (
          <div className="flex justify-center p-8"><Spinner className="w-6 h-6" /></div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3">
              {packs.map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => setSelectedPack(pack.id)}
                  className={`text-left border rounded-lg p-4 transition-colors ${selectedPack === pack.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
                >
                  <div className="flex items-center gap-2">
                    <PackageOpen className="w-4 h-4 text-muted-foreground" />
                    <span className="font-semibold">{pack.name}</span>
                    <Badge variant="secondary" className="text-[10px]">{pack.policies.length} policies</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{pack.description}</p>
                  {selectedPack === pack.id && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {pack.policies.map((p) => (
                        <Badge key={p.name} variant={p.severity === 'ERROR' ? 'destructive' : 'secondary'} className="text-[10px] font-mono">
                          {p.name}
                        </Badge>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>

            {selectedPack && roles.length > 0 && (
              <div className="space-y-2 pt-2 border-t">
                <p className="text-sm font-medium">Bind to roles (optional)</p>
                <div className="grid grid-cols-2 gap-2">
                  {roles.map((role) => (
                    <label key={role.id} className="flex items-center space-x-2 border p-2 rounded-md cursor-pointer hover:bg-muted/50">
                      <input
                        type="checkbox"
                        checked={selectedRoleIds.includes(role.id)}
                        onChange={(e) =>
                          setSelectedRoleIds(e.target.checked
                            ? [...selectedRoleIds, role.id]
                            : selectedRoleIds.filter((id) => id !== role.id))
                        }
                        className="rounded border-input accent-primary"
                      />
                      <span className="text-sm font-medium">{role.displayName}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Unbound policies exist but are not active until bound to a role.</p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isImporting}>Cancel</Button>
              <Button onClick={handleImport} disabled={!selectedPack || isImporting}>
                {isImporting && <Spinner className="mr-2 h-4 w-4" />}
                Import as Shadow
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
