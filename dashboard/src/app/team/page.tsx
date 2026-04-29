'use client';
export const dynamic = 'force-dynamic';

import { useState } from 'react';
import useSWR from 'swr';
import { Mail, Plus, Trash2, MoreHorizontal } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { fetcher, inviteMember, deleteMember, updateMember, ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { AppLayout } from '@/components/layout/app-layout';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { InitialsAvatar } from '@/components/initials-avatar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export default function TeamPage() {
  const { currentOrg, user: currentUser } = useAuth();
  const { toast } = useToast();
  
  const { data: membersData, mutate: mutateMembers, isLoading: membersLoading } = useSWR<any>(currentOrg ? `/orgs/${currentOrg.id}/members` : null, fetcher);
  const { data: rolesData } = useSWR<any>(currentOrg ? `/orgs/${currentOrg.id}/roles` : null, fetcher);
  
  const members = membersData?.members || [];
  const roles = rolesData?.roles || [];

  // Invite state
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ORG_ADMIN' | 'POLICY_ADMIN' | 'MEMBER'>('MEMBER');
  const [inviteAssignedRoleId, setInviteAssignedRoleId] = useState<string>('none');
  const [isInviting, setIsInviting] = useState(false);

  // Delete state
  const [memberToDelete, setMemberToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Change Role state
  const [memberToChange, setMemberToChange] = useState<any | null>(null);
  const [isChanging, setIsChanging] = useState(false);
  const [newPlatformRole, setNewPlatformRole] = useState<'ORG_ADMIN' | 'POLICY_ADMIN' | 'MEMBER'>('MEMBER');
  const [newAssignedRole, setNewAssignedRole] = useState<string>('none');

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrg || !inviteEmail) return;
    
    setIsInviting(true);
    try {
      await inviteMember(currentOrg.id, {
        email: inviteEmail,
        membershipRole: inviteRole,
        assignedRoleId: inviteAssignedRoleId === 'none' ? undefined : inviteAssignedRoleId
      });
      mutateMembers();
      setIsInviteOpen(false);
      setInviteEmail('');
      setInviteRole('MEMBER');
      setInviteAssignedRoleId('none');
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
        assignedRoleId: newAssignedRole === 'none' ? null : newAssignedRole
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

  const openChangeRoleDialog = (member: any) => {
    setMemberToChange(member);
    setNewPlatformRole(member.role);
    setNewAssignedRole(member.assignedRoleId || 'none');
  };

  return (
    <AppLayout>
      <div className="container mx-auto p-6 max-w-5xl">
        <PageHeader 
          title="Team" 
          description="Manage who has access to your organization and their roles."
          action={<Button onClick={() => setIsInviteOpen(true)}><Mail className="w-4 h-4 mr-2" /> Invite Member</Button>}
        />

        {membersLoading ? (
          <div className="flex justify-center p-12"><Spinner className="w-8 h-8" /></div>
        ) : (
          <div className="bg-card border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
                  <tr>
                    <th className="px-6 py-4 font-medium">Member</th>
                    <th className="px-6 py-4 font-medium">Platform Role</th>
                    <th className="px-6 py-4 font-medium">Assigned Org Role</th>
                    <th className="px-6 py-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {members.map((member: any) => {
                    const isSelf = member.userId === currentUser?.id;
                    const displayName = member.user ? `${member.user.firstName || ''} ${member.user.lastName || ''}`.trim() : 'Unknown User';
                    const email = member.user?.email || 'Unknown Email';
                    
                    return (
                      <tr key={member.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <InitialsAvatar name={displayName} email={email} className="w-10 h-10" />
                            <div>
                              <div className="font-medium text-foreground flex items-center gap-2">
                                {displayName}
                                {isSelf && <span className="bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 rounded-sm uppercase font-bold tracking-wider">You</span>}
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
                          {member.assignedRole ? (
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-green-500" />
                              <span className="font-medium">{member.assignedRole.displayName}</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground italic">None</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
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
              <Label htmlFor="role">Platform Access Level</Label>
              <Select value={inviteRole} onValueChange={(val: any) => setInviteRole(val)} disabled={isInviting}>
                <SelectTrigger>
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
              <Label htmlFor="assignedRole">Organization Role (for Policies)</Label>
              <Select value={inviteAssignedRoleId} onValueChange={setInviteAssignedRoleId} disabled={isInviting}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an org role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {roles.map((r: any) => (
                    <SelectItem key={r.id} value={r.id}>{r.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">This determines which compliance rules apply to them.</p>
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
              <Label htmlFor="editRole">Platform Access Level</Label>
              <Select value={newPlatformRole} onValueChange={(val: any) => setNewPlatformRole(val)} disabled={isChanging}>
                <SelectTrigger>
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
              <Label htmlFor="editAssignedRole">Organization Role (for Policies)</Label>
              <Select value={newAssignedRole} onValueChange={setNewAssignedRole} disabled={isChanging}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an org role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {roles.map((r: any) => (
                    <SelectItem key={r.id} value={r.id}>{r.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
