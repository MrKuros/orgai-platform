'use client';

import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import type { Role } from '@/lib/types';

const policySchema = z.object({
  name: z.string().min(1, 'Name is required').regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers, and hyphens'),
  rule: z.string().min(1, 'Rule is required'),
  skill: z.string().optional(),
  evaluatorType: z.enum(['regex', 'command', 'none']),
  evaluatorPattern: z.string().optional(),
  evaluatorFlags: z.string().optional(),
  fixSuggestion: z.string().optional(),
  severity: z.enum(['ERROR', 'WARNING']),
  roleIds: z.array(z.string()).default([]),
});

export type PolicyFormValues = z.infer<typeof policySchema>;

interface PolicyFormProps {
  defaultValues?: Partial<PolicyFormValues>;
  roles: Role[];
  onSubmit: (data: PolicyFormValues) => void;
  isLoading?: boolean;
}

export function PolicyForm({ defaultValues, roles, onSubmit, isLoading }: PolicyFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PolicyFormValues>({
    resolver: zodResolver(policySchema),
    defaultValues: {
      name: '',
      rule: '',
      skill: '',
      evaluatorType: 'none',
      evaluatorPattern: '',
      evaluatorFlags: '',
      fixSuggestion: '',
      severity: 'ERROR',
      roleIds: [],
      ...defaultValues,
    },
  });

  const evaluatorType = watch('evaluatorType');

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Policy Name</Label>
          <Input id="name" placeholder="e.g. no-console-log" {...register('name')} />
          {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="rule">Rule Description (Plain English)</Label>
          <textarea
            id="rule"
            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="The plain English rule the agent must follow..."
            {...register('rule')}
          />
          {errors.rule && <p className="text-sm text-destructive">{errors.rule.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="skill">Agent Skill Guidance (Optional)</Label>
          <textarea
            id="skill"
            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="How the agent should comply proactively..."
            {...register('skill')}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="severity">Severity</Label>
            <Select onValueChange={(val) => setValue('severity', val as 'ERROR' | 'WARNING')} defaultValue={defaultValues?.severity || 'ERROR'}>
              <SelectTrigger>
                <SelectValue placeholder="Select severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ERROR">ERROR - Blocks merging</SelectItem>
                <SelectItem value="WARNING">WARNING - Flagged only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="evaluatorType">Evaluator Type</Label>
            <Select onValueChange={(val) => setValue('evaluatorType', val as any)} defaultValue={defaultValues?.evaluatorType || 'none'}>
              <SelectTrigger>
                <SelectValue placeholder="Select evaluator" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (AI Evaluation Only)</SelectItem>
                <SelectItem value="regex">Regular Expression</SelectItem>
                <SelectItem value="command">Terminal Command</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[0.8rem] text-muted-foreground mt-2">If this policy uses a Regex evaluator, provide the pattern that indicates what&apos;s allowed or disallowed.</p>
          </div>
        </div>

        {evaluatorType !== 'none' && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 border rounded-md bg-muted/20">
            <div className="col-span-3 space-y-2">
              <Label htmlFor="evaluatorPattern">Pattern (Regex or Command)</Label>
              <Input id="evaluatorPattern" placeholder="e.g. console\.(log|warn)" {...register('evaluatorPattern')} />
            </div>
            {evaluatorType === 'regex' && (
              <div className="col-span-1 space-y-2">
                <Label htmlFor="evaluatorFlags">Flags</Label>
                <Input id="evaluatorFlags" placeholder="e.g. gmi" {...register('evaluatorFlags')} />
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="fixSuggestion">Fix Suggestion (Optional)</Label>
          <Input id="fixSuggestion" placeholder="What to tell the developer when blocked" {...register('fixSuggestion')} />
        </div>
        
        {roles && roles.length > 0 && (
          <div className="space-y-2 pt-2 border-t">
            <Label>Bind to Roles (Optional)</Label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {roles.map(role => (
                <label key={role.id} className="flex items-center space-x-2 border p-2 rounded-md cursor-pointer hover:bg-muted/50">
                  <input
                    type="checkbox"
                    value={role.id}
                    className="rounded border-gray-300 text-primary focus:ring-primary"
                    {...register('roleIds')}
                  />
                  <span className="text-sm font-medium">{role.displayName}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">If unselected, the policy will be created but won't be active until bound to a role.</p>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? <Spinner className="mr-2" /> : null}
          Save Policy
        </Button>
      </div>
    </form>
  );
}
