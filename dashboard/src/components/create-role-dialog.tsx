'use client';

import { useState } from 'react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { Role } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';

const roleSchema = z.object({
  name: z.string().min(1, 'Name is required').regex(/^[a-z0-9-]+$/, 'Lowercase, numbers, and hyphens only'),
  displayName: z.string().min(1, 'Display name is required'),
  inheritsFromId: z.string().optional(),
});

type RoleFormValues = z.infer<typeof roleSchema>;

interface CreateRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingRoles: Role[];
  onSubmit: (data: RoleFormValues) => Promise<void>;
}

export function CreateRoleDialog({ open, onOpenChange, existingRoles, onSubmit }: CreateRoleDialogProps) {
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<RoleFormValues>({
    resolver: zodResolver(roleSchema),
    // inheritsFromId must be undefined (not '') when untouched — the API treats
    // an empty string as a real FK and the create 500s on a root role.
    defaultValues: { name: '', displayName: '', inheritsFromId: undefined },
  });

  const handleFormSubmit = async (data: RoleFormValues) => {
    setIsLoading(true);
    try {
      await onSubmit(data);
      reset();
      onOpenChange(false);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => {
      if (!o) reset();
      onOpenChange(o);
    }}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Role</DialogTitle>
          <DialogDescription>
            Add a new role to your organization&apos;s hierarchy.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input id="displayName" placeholder="e.g. Senior Developer" {...register('displayName')} disabled={isLoading} />
            {errors.displayName && <p className="text-sm text-destructive">{errors.displayName.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">System Name (slug)</Label>
            <Input id="name" placeholder="e.g. senior-dev" {...register('name')} disabled={isLoading} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="inheritsFromId">Inherits From (Optional)</Label>
            <Select onValueChange={(val) => setValue('inheritsFromId', val === 'none' ? undefined : val)} disabled={isLoading}>
              <SelectTrigger>
                <SelectValue placeholder="Select parent role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (Root Role)</SelectItem>
                {existingRoles.map(role => (
                  <SelectItem key={role.id} value={role.id}>{role.displayName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>Cancel</Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Spinner className="mr-2" />} Create Role
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
