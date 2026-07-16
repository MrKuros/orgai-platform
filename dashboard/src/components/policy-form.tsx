'use client';

import { useState } from 'react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth';
import { testPolicy, ApiError } from '@/lib/api';
import type { Role, TestPolicyResult } from '@/lib/types';

const policySchema = z.object({
  name: z.string().min(1, 'Name is required').regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers, and hyphens'),
  rule: z.string().min(1, 'Rule is required'),
  skill: z.string().optional(),
  evaluatorType: z.enum(['regex', 'command', 'none']),
  evaluatorPattern: z.string().optional(),
  evaluatorFlags: z.string().optional(),
  fixSuggestion: z.string().optional(),
  severity: z.enum(['ERROR', 'WARNING']),
  status: z.enum(['ENFORCED', 'SHADOW']).default('ENFORCED'),
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
      status: 'ENFORCED',
      roleIds: [],
      ...defaultValues,
    },
  });

  const evaluatorType = watch('evaluatorType');

  // Test pattern state
  const { currentOrg } = useAuth();
  const [isTestOpen, setIsTestOpen] = useState(false);
  const [testContent, setTestContent] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestPolicyResult | null>(null);

  const handleTest = async () => {
    if (!currentOrg) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testPolicy(currentOrg.id, {
        evaluatorType,
        evaluatorPattern: watch('evaluatorPattern') || '',
        evaluatorFlags: watch('evaluatorFlags') || undefined,
        content: testContent,
      });
      setTestResult(result);
    } catch (error) {
      setTestResult({ valid: false, matched: false, matchedText: null, line: null, error: error instanceof ApiError ? error.message : 'Unknown error' });
    } finally {
      setIsTesting(false);
    }
  };

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
                <SelectItem value="ERROR">ERROR — blocks the agent&apos;s action and the commit</SelectItem>
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

        <div className="space-y-2">
          <Label htmlFor="status">Enforcement</Label>
          <Select onValueChange={(val) => setValue('status', val as 'ENFORCED' | 'SHADOW')} defaultValue={defaultValues?.status || 'ENFORCED'}>
            <SelectTrigger>
              <SelectValue placeholder="Select enforcement" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ENFORCED">Enforced — violations block per severity</SelectItem>
              <SelectItem value="SHADOW">Shadow — log violations, never block (test before enforcing)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[0.8rem] text-muted-foreground">Start new policies in Shadow to measure how often they would block, then switch to Enforced.</p>
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

            <div className="col-span-full border-t pt-3">
              <button
                type="button"
                onClick={() => setIsTestOpen(!isTestOpen)}
                className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {isTestOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                Test pattern
              </button>

              {isTestOpen && (
                <div className="mt-3 space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="testContent">Sample code / command</Label>
                    <textarea
                      id="testContent"
                      className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      placeholder="Paste sample code or a command to test against the pattern..."
                      value={testContent}
                      onChange={(e) => { setTestContent(e.target.value); setTestResult(null); }}
                    />
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={handleTest} disabled={isTesting || !testContent}>
                    {isTesting && <Spinner className="mr-2 h-4 w-4" />} Test
                  </Button>

                  {testResult && (
                    !testResult.valid ? (
                      <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-sm text-destructive">
                        Invalid pattern{testResult.error ? `: ${testResult.error}` : ''}
                      </div>
                    ) : testResult.matched ? (
                      <div className="p-3 rounded-md border border-amber-500/30 bg-amber-500/10 text-sm text-amber-600 dark:text-amber-400">
                        Would flag: <code className="bg-background border px-1 rounded font-mono">{testResult.matchedText}</code>
                        {testResult.line !== null && <> on line {testResult.line}</>}
                      </div>
                    ) : (
                      <div className="p-3 rounded-md border border-green-500/30 bg-green-500/10 text-sm text-green-600 dark:text-green-400">
                        No violation detected in sample
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
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
                    className="rounded border-input accent-primary focus:ring-primary"
                    {...register('roleIds')}
                  />
                  <span className="text-sm font-medium">{role.displayName}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">If unselected, the policy will be created but won&apos;t be active until bound to a role.</p>
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
