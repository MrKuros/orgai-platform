'use client';
export const dynamic = 'force-dynamic';

import { useState } from 'react';
import useSWR from 'swr';
import { Mail, Plus, Trash2, MoreHorizontal, AlertTriangle } from 'lucide-react';
import { useAuth, useRole } from '@/lib/auth';
import { fetcher, inviteMember, deleteMember, updateMember, getInviteLink, ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { AppLayout } from '@/components/layout/app-layout';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { InitialsAvatar } from '@/components/initials-avatar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

// Checkbox list of org roles — a member can hold several (multiple superiors).
// Hoisted above the page component so toggles don't remount the list
// (which loses scroll position and focus inside the scroll area).
function RolePicker({ roles, selected, onToggle, disabled, idPrefix }: {
  roles: any[]; selected: string[]; onToggle: (id: string) => void; disabled: boolean; idPrefix: string;
}) {
  return (
    <div className="border rounded-md divide-y max-h-44 overflow-y-auto">
      {roles.length === 0 && <p className="text-xs text-muted-foreground p-3">No org roles defined yet.</p>}
      {roles.map((r: any) => (
        <label key={r.id} htmlFor={`${idPrefix}-${r.id}`} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50">
          <input
            id={`${idPrefix}-${r.id}`}
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={selected.includes(r.id)}
            onChange={() => onToggle(r.id)}
            disabled={disabled}
          />
          {r.displayName}
        </label>
      ))}
    </div>
  );
}

export default function TeamPage() {
  const { currentOrg, user: currentUser } = useAuth();
  const { canManageOrg } = useRole();
  const { toast } = useToast();

  const { data: membersData, mutate: mutateMembers, isLoading: membersLoading, error: membersError } = useSWR<any>(currentOrg ? `/orgs/${currentOrg.id}/members` : null, fetcher);
  const { data: rolesData } = useSWR<any>(currentOrg ? `/orgs/${currentOrg.id}/roles` : null, fetcher);
  
  const members = membersData?.members || [];
  const roles = rolesData?.roles || [];

  // Invite state
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ORG_ADMIN' | 'POLICY_ADMIN' | 'MEMBER'>('MEMBER');
  const [inviteAssignedRoleIds, setInviteAssignedRoleIds] = useState<string[]>([]);
  const [isInviting, setIsInviting] = useState(false);

  // Delete state
  const [memberToDelete, setMemberToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Change Role state
  const [memberToChange, setMemberToChange] = useState<any | null>(null);
  const [isChanging, setIsChanging] = useState(false);
  const [newPlatformRole, setNewPlatformRole] = useState<'ORG_ADMIN' | 'POLICY_ADMIN' | 'MEMBER'>('MEMBER');
  const [newAssignedRoleIds, setNewAssignedRoleIds] = useState<string[]>([]);

  const toggleId = (ids: string[], id: string) =>
    ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrg || !inviteEmail) return;
    
    setIsInviting(true);
    try {
      await inviteMember(currentOrg.id, {
        email: inviteEmail,
        membershipRole: inviteRole,
        assignedRoleIds: inviteAssignedRoleIds
      });
      mutateMembers();
      setIsInviteOpen(false);
      setInviteEmail('');
      setInviteRole('MEMBER');
      setInviteAssignedRoleIds([]);
      toast({ title: 'Invitation sent', description: `Added ${inviteEmail} to the team.` });
    } catch (error) {
      toast({ title: 'Error inviting member', description: error instanceof ApiError ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsInviting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!currentOrg || !memberToDelete) return;
    setIsDeleting(true);
    try {
      await deleteMember(currentOrg.id, memberToDelete);
      mutateMembers();
      setMemberToDelete(null);
      toast({ title: 'Member removed' });
    } catch (error) {
      toast({ title: 'Error removing member', description: error instanceof ApiError ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleChangeRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrg || !memberToChange) return;
    
    setIsChanging(true);
    try {
      await updateMember(currentOrg.id, memberToChange.userId, {
        membershipRole: newPlatformRole,
        assignedRoleIds: newAssignedRoleIds
      });
      mutateMembers();
      setMemberToChange(null);
      toast({ title: 'Role updated successfully' });
    } catch (error) {
      toast({ title: 'Error updating role', description: error instanceof ApiError ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsChanging(false);
    }
  };

  const handleCopyInviteLink = async (membershipId: string) => {
    if (!currentOrg) return;
    try {
      const { link } = await getInviteLink(currentOrg.id, membershipId);
      await navigator.clipboard.writeText(link);
      toast({ title: 'Invite link copied — send it to them' });
    } catch (error) {
      toast({ title: 'Error copying invite link', description: error instanceof ApiError ? error.message : 'Unknown error', variant: 'destructive' });
    }
  };

  const openChangeRoleDialog = (member: any) => {
    setMemberToChange(member);
    setNewPlatformRole(member.role);
    setNewAssignedRoleIds((member.assignedRoles || []).map((r: any) => r.id));
  };

  const handleToggleActive = async (member: any) => {
    if (!currentOrg) return;
    const deactivating = member.active !== false;
    try {
      await updateMember(currentOrg.id, member.userId, { active: !deactivating });
      mutateMembers();
      toast({ title: deactivating ? 'Member deactivated — their access and bound API keys stop working' : 'Member reactivated' });
    } catch (error) {
      toast({ title: 'Error updating member', description: error instanceof ApiError ? error.message : 'Unknown error', variant: 'destructive' });
    }
  };

  return (
    <AppLayout>
      <div className="container mx-auto p-6 max-w-5xl">
        <PageHeader 
          title="Team"
          description="Manage who has access to your organization and their roles."
          action={canManageOrg ? <Button onClick={() => setIsInviteOpen(true)}><Mail className="w-4 h-4 mr-2" /> Invite Member</Button> : undefined}
        />

        {membersError ? (
          <EmptyState
            icon={<AlertTriangle className="w-10 h-10 text-destructive" />}
            title="Couldn't load team"
            description="Something went wrong fetching your team members. Check your connection and try again."
            action={<Button onClick={() => mutateMembers()}>Retry</Button>}
          />
        ) : membersLoading ? (
          <div className="flex justify-center p-12"><Spinner className="w-8 h-8" /></div>
        ) : (
          <div className="bg-card border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
                  <tr>
                    <th className="px-6 py-4 font-medium">Member</th>
                    <th className="px-6 py-4 font-medium">Access Level</th>
                    <th className="px-6 py-4 font-medium">Assigned Org Role</th>
                    <th className="px-6 py-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {members.map((member: any) => {
                    const isSelf = member.userId === currentUser?.id;
                    const email = member.user?.email || 'Unknown Email';
                    // Invited-but-not-signed-up users have a user row with no
                    // name — fall back to email, never a blank line.
                    const displayName = (member.user ? `${member.user.firstName || ''} ${member.user.lastName || ''}`.trim() : '') || email;
                    
                    return (
                      <tr key={member.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <InitialsAvatar name={displayName} email={email} className="w-10 h-10" />
                            <div>
                              <div className="font-medium text-foreground flex items-center gap-2">
                                {displayName}
                                {isSelf && <span className="bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 rounded-sm uppercase font-bold tracking-wider">You</span>}
                                {member.pending && <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10">Pending</Badge>}
                                {member.active === false && <Badge variant="outline" className="text-[10px] text-muted-foreground border-muted-foreground/40">Deactivated</Badge>}
                              </div>
                              <div className="text-muted-foreground text-xs">{email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground border">
                            {member.role.replace('_', ' ')}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {member.assignedRoles?.length ? (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {member.assignedRoles.map((r: any) => (
                                <Badge key={r.id} variant="secondary" className="font-medium">{r.displayName}</Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground italic">None</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          {canManageOrg && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0">
                                <span className="sr-only">Open menu</span>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => openChangeRoleDialog(member)}>
                                Edit Roles
                              </DropdownMenuItem>
                              {member.pending && (
                                <DropdownMenuItem onClick={() => handleCopyInviteLink(member.id)}>
                                  Copy invite link
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                disabled={isSelf}
                                onClick={() => handleToggleActive(member)}
                              >
                                {member.active === false ? 'Reactivate' : 'Deactivate'}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                                disabled={isSelf} // Can't delete yourself
                                onClick={() => setMemberToDelete(member.userId)}
                              >
                                Remove from Org
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Invite Dialog */}
      <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Invite to Organization</DialogTitle>
            <DialogDescription>
              Send an email invitation. If they don&apos;t have an account, they&apos;ll be prompted to create one.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInvite} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input 
                id="email" 
                type="email" 
                placeholder="colleague@company.com" 
                value={inviteEmail} 
                onChange={e => setInviteEmail(e.target.value)}
                required
                disabled={isInviting} 
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Access Level</Label>
              <Select value={inviteRole} onValueChange={(val: any) => setInviteRole(val)} disabled={isInviting}>
                <SelectTrigger id="role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MEMBER">Member (View Only)</SelectItem>
                  <SelectItem value="POLICY_ADMIN">Policy Admin (Edit Policies)</SelectItem>
                  <SelectItem value="ORG_ADMIN">Org Admin (Full Access)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Organization Roles (for Policies)</Label>
              <RolePicker
                roles={roles}
                selected={inviteAssignedRoleIds}
                onToggle={(id) => setInviteAssignedRoleIds(ids => toggleId(ids, id))}
                disabled={isInviting}
                idPrefix="invite-role"
              />
              <p className="text-xs text-muted-foreground mt-1">Pick one or more — policies from every selected role&apos;s chain apply.</p>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsInviteOpen(false)} disabled={isInviting}>Cancel</Button>
              <Button type="submit" disabled={isInviting || !inviteEmail}>
                {isInviting && <Spinner className="mr-2 h-4 w-4" />} Send Invite
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Change Role Dialog */}
      <Dialog open={!!memberToChange} onOpenChange={(open) => !open && setMemberToChange(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Member Roles</DialogTitle>
            <DialogDescription>
              Update access levels and policy inheritance for {memberToChange?.user?.email}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleChangeRole} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="editRole">Access Level</Label>
              <Select value={newPlatformRole} onValueChange={(val: any) => setNewPlatformRole(val)} disabled={isChanging}>
                <SelectTrigger id="editRole">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MEMBER">Member (View Only)</SelectItem>
                  <SelectItem value="POLICY_ADMIN">Policy Admin (Edit Policies)</SelectItem>
                  <SelectItem value="ORG_ADMIN">Org Admin (Full Access)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Organization Roles (for Policies)</Label>
              <RolePicker
                roles={roles}
                selected={newAssignedRoleIds}
                onToggle={(id) => setNewAssignedRoleIds(ids => toggleId(ids, id))}
                disabled={isChanging}
                idPrefix="edit-role"
              />
              <p className="text-xs text-muted-foreground mt-1">Pick one or more — policies from every selected role&apos;s chain apply.</p>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setMemberToChange(null)} disabled={isChanging}>Cancel</Button>
              <Button type="submit" disabled={isChanging}>
                {isChanging && <Spinner className="mr-2 h-4 w-4" />} Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!memberToDelete}
        onOpenChange={(open) => !open && setMemberToDelete(null)}
        title="Remove Member"
        description="Are you sure you want to remove this user from the organization? They will lose all access."
        confirmLabel="Remove"
        onConfirm={handleDeleteConfirm}
        isLoading={isDeleting}
        destructive
      />
    </AppLayout>
  );
}
