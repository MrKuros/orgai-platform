'use client';
export const dynamic = 'force-dynamic';

import { useState, useMemo, useCallback } from 'react';
import useSWR from 'swr';
import ReactFlow, { Background, Controls, Node, Edge, MarkerType } from 'reactflow';
import dagre from 'dagre';
import 'reactflow/dist/style.css';
import { Plus, X, GitBranch, AlertTriangle } from 'lucide-react';

import { useAuth, useRole } from '@/lib/auth';
import { fetcher, createRole, updateRole, deleteRole, ApiError } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { AppLayout } from '@/components/layout/app-layout';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { RoleNode } from '@/components/role-node';
import { CreateRoleDialog } from '@/components/create-role-dialog';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const nodeTypes = { customRole: RoleNode };

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 100 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 192, height: 90 }); // Match w-48 and approx height
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - 192 / 2,
        y: nodeWithPosition.y - 90 / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};

export default function RolesPage() {
  const { currentOrg } = useAuth();
  const { canManagePolicies, isOrgAdmin } = useRole();
  const { toast } = useToast();

  const { data, mutate, isLoading, error } = useSWR<any>(currentOrg ? `/orgs/${currentOrg.id}/roles` : null, fetcher);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  // Edit state
  const [editingRole, setEditingRole] = useState<any | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editInheritsFromId, setEditInheritsFromId] = useState<string>('none');
  const [isSaving, setIsSaving] = useState(false);

  // Delete confirm state
  const [roleToDelete, setRoleToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const roles = useMemo(() => data?.roles || [], [data?.roles]);
  const selectedRole = roles.find((r: any) => r.id === selectedRoleId);

  const { nodes, edges } = useMemo(() => {
    if (!roles.length) return { nodes: [], edges: [] };

    const initialNodes: Node[] = roles.map((role: any) => ({
      id: role.id,
      type: 'customRole',
      data: {
        id: role.id,
        name: role.name,
        displayName: role.displayName,
        policyCount: role.bindings?.length || 0,
        memberCount: role.memberships?.length || 0,
        isSelected: role.id === selectedRoleId,
      },
      position: { x: 0, y: 0 },
    }));

    const initialEdges: Edge[] = roles
      .filter((r: any) => r.inheritsFromId)
      .map((role: any) => ({
        id: `${role.inheritsFromId}-${role.id}`,
        source: role.inheritsFromId,
        target: role.id,
        type: 'smoothstep',
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--muted-foreground))' },
        style: { stroke: 'hsl(var(--muted-foreground))', strokeWidth: 2 },
      }));

    return getLayoutedElements(initialNodes, initialEdges);
  }, [roles, selectedRoleId]);

  const handleNodeClick = useCallback((_: any, node: Node) => {
    setSelectedRoleId(node.id);
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedRoleId(null);
  }, []);

  const handleCreateRole = async (formData: any) => {
    if (!currentOrg) return;
    try {
      await createRole(currentOrg.id, formData);
      mutate();
      toast({ title: 'Role created' });
    } catch (error) {
      toast({ title: 'Error', description: error instanceof ApiError ? error.message : 'Unknown error', variant: 'destructive' });
      throw error;
    }
  };

  const openEdit = (role: any) => {
    setEditingRole(role);
    setEditDisplayName(role.displayName);
    setEditInheritsFromId(role.inheritsFromId || 'none');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrg || !editingRole || !editDisplayName.trim()) return;
    setIsSaving(true);
    try {
      await updateRole(currentOrg.id, editingRole.id, {
        displayName: editDisplayName.trim(),
        inheritsFromId: editInheritsFromId === 'none' ? null : editInheritsFromId,
      });
      setEditingRole(null);
      mutate();
      toast({ title: 'Role updated' });
    } catch (error) {
      toast({ title: 'Error updating role', description: error instanceof ApiError ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!currentOrg || !roleToDelete) return;
    setIsDeleting(true);
    try {
      await deleteRole(currentOrg.id, roleToDelete);
      setSelectedRoleId(null);
      setRoleToDelete(null);
      mutate();
      toast({ title: 'Role deleted' });
    } catch (error) {
      toast({ title: 'Cannot delete role', description: error instanceof ApiError ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 pt-6 shrink-0">
          <PageHeader
            title="Roles"
            description="Manage your compliance hierarchy and policy inheritance."
            action={canManagePolicies ? <Button onClick={() => setIsCreateOpen(true)}><Plus className="w-4 h-4 mr-2" /> New Role</Button> : undefined}
          />
        </div>

        {error ? (
          <div className="px-6 pb-6">
            <EmptyState
              icon={<AlertTriangle className="w-10 h-10 text-destructive" />}
              title="Couldn't load roles"
              description="Something went wrong fetching your roles. Check your connection and try again."
              action={<Button onClick={() => mutate()}>Retry</Button>}
            />
          </div>
        ) : isLoading ? (
          <div className="flex-1 flex items-center justify-center"><Spinner className="w-8 h-8" /></div>
        ) : roles.length === 0 ? (
          <div className="px-6 pb-6">
            <EmptyState
              icon={<GitBranch className="w-10 h-10 text-muted-foreground" />}
              title="No roles yet"
              description="Create your first role to start building your compliance hierarchy."
              action={canManagePolicies ? <Button onClick={() => setIsCreateOpen(true)}><Plus className="w-4 h-4 mr-2" /> Create Role</Button> : undefined}
            />
          </div>
        ) : (
          <div className="flex-1 relative border-t bg-muted/10 overflow-auto">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={handleNodeClick}
              onPaneClick={handlePaneClick}
              fitView
              attributionPosition="bottom-left"
              minZoom={0.1}
              maxZoom={2}
            >
              <Background color="hsl(var(--muted-foreground))" gap={16} size={1} />
              <Controls />
            </ReactFlow>

            {/* Side Panel */}
            {/* z-30 keeps the panel's action buttons above the fixed z-20 Live Violations feed */}
            <div className={`absolute top-0 right-0 bottom-0 w-80 z-30 bg-background border-l shadow-2xl transition-transform duration-300 transform ${selectedRoleId ? 'translate-x-0' : 'translate-x-full'}`}>
              {selectedRole && (
                <div className="flex flex-col h-full">
                  <div className="flex items-center justify-between p-4 border-b">
                    <div>
                      <h3 className="font-semibold text-lg">{selectedRole.displayName}</h3>
                      <p className="text-xs text-muted-foreground font-mono">{selectedRole.name}</p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setSelectedRoleId(null)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  
                  <div className="p-4 flex-1 overflow-y-auto space-y-6">
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium">Inherits From</h4>
                      <div className="text-sm bg-muted p-2 rounded-md border">
                        {selectedRole.inheritsFromId ? roles.find((r: any) => r.id === selectedRole.inheritsFromId)?.displayName : 'None (Root)'}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-sm font-medium">Bound Policies ({selectedRole.bindings?.length || 0})</h4>
                      {selectedRole.bindings?.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No policies directly bound to this role.</p>
                      ) : (
                        <ul className="space-y-2">
                          {selectedRole.bindings?.map((b: any) => (
                            <li key={b.policy.id} className="text-sm bg-card border p-2 rounded-md shadow-sm">
                              <div className="font-medium">{b.policy.name}</div>
                              <div className="text-xs text-muted-foreground truncate">{b.policy.rule}</div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  {canManagePolicies && (
                    <div className="p-4 border-t bg-muted/20 space-y-2">
                      <Button variant="outline" className="w-full" onClick={() => openEdit(selectedRole)}>
                        Edit Role
                      </Button>
                      {/* delete is ORG_ADMIN-only server-side — don't show a button that 403s */}
                      {isOrgAdmin && (
                        <Button variant="destructive" className="w-full" onClick={() => setRoleToDelete(selectedRole.id)}>
                          Delete Role
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <CreateRoleDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        existingRoles={roles}
        onSubmit={handleCreateRole}
      />

      {/* Edit Role Dialog */}
      <Dialog open={!!editingRole} onOpenChange={(open) => !open && setEditingRole(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Role</DialogTitle>
            <DialogDescription>
              Rename {editingRole?.name} or change what it inherits from.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="editDisplayName">Display Name</Label>
              <Input id="editDisplayName" value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} disabled={isSaving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editInheritsFrom">Inherits From</Label>
              <Select value={editInheritsFromId} onValueChange={setEditInheritsFromId} disabled={isSaving}>
                <SelectTrigger id="editInheritsFrom">
                  <SelectValue placeholder="Select parent role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (Root Role)</SelectItem>
                  {roles.filter((r: any) => r.id !== editingRole?.id).map((r: any) => (
                    <SelectItem key={r.id} value={r.id}>{r.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingRole(null)} disabled={isSaving}>Cancel</Button>
              <Button type="submit" disabled={isSaving || !editDisplayName.trim()}>
                {isSaving && <Spinner className="mr-2" />} Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!roleToDelete}
        onOpenChange={(open) => !open && setRoleToDelete(null)}
        title="Delete Role"
        description="Members holding this role lose its policies; child roles keep their own chain. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
        isLoading={isDeleting}
        destructive
      />
    </AppLayout>
  );
}
