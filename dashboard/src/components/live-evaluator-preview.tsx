'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Play, X, AlertTriangle, CheckCircle2, Code, Terminal } from 'lucide-react';

import { useAuth } from '@/lib/auth';
import { fetcher, checkPolicy, ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface LiveEvaluatorPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LiveEvaluatorPreview({ open, onOpenChange }: LiveEvaluatorPreviewProps) {
  const { currentOrg } = useAuth();
  const { toast } = useToast();

  const { data: rolesData } = useSWR<any>(
    currentOrg ? `/orgs/${currentOrg.id}/roles` : null,
    fetcher
  );
  const roles = rolesData?.roles || [];

  const [selectedRole, setSelectedRole] = useState<string>('');
  const [checkType, setCheckType] = useState<'code' | 'command'>('code');
  const [content, setContent] = useState('');
  const [filePath, setFilePath] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [result, setResult] = useState<{ passed: boolean; violations: any[] } | null>(null);

  const handleCheck = async () => {
    if (!currentOrg || !selectedRole || !content.trim()) return;

    setIsChecking(true);
    setResult(null);
    try {
      const res = await checkPolicy(currentOrg.id, {
        type: checkType,
        content: content.trim(),
        roleName: selectedRole,
        filePath: filePath.trim() || undefined,
      });
      setResult(res);
    } catch (error) {
      toast({
        title: 'Check failed',
        description: error instanceof ApiError ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsChecking(false);
    }
  };

  const handleClose = () => {
    setResult(null);
    setContent('');
    setFilePath('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            Live Policy Evaluator
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select value={selectedRole} onValueChange={setSelectedRole}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((role: any) => (
                      <SelectItem key={role.id} value={role.name}>
                        {role.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Check Type</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={checkType === 'code' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setCheckType('code')}
                  >
                    <Code className="h-4 w-4 mr-1" /> Code
                  </Button>
                  <Button
                    type="button"
                    variant={checkType === 'command' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setCheckType('command')}
                  >
                    <Terminal className="h-4 w-4 mr-1" /> Command
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="content">{checkType === 'code' ? 'Code' : 'Command'}</Label>
              <textarea
                id="content"
                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
                placeholder={checkType === 'code' ? 'Paste your code here...' : 'Enter command (e.g., git push --force)'}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="filePath">File Path (optional)</Label>
              <Input
                id="filePath"
                placeholder="src/utils/logger.ts"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Used for path-based exceptions (e.g., logger files exempt from no-console-log)
              </p>
            </div>

            <Button
              onClick={handleCheck}
              disabled={isChecking || !selectedRole || !content.trim()}
              className="w-full"
            >
              {isChecking ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Checking...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Evaluate
                </>
              )}
            </Button>
          </div>

          {result !== null && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  {result.passed ? (
                    <>
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                      <span className="text-green-600 dark:text-green-400">All Checks Passed</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                      <span className="text-destructive">Violations Found</span>
                    </>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.violations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No policy violations detected for the selected role.
                  </p>
                ) : (
                  result.violations.map((violation, index) => (
                    <div
                      key={index}
                      className="p-3 rounded-lg border bg-destructive/5 border-destructive/20"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{violation.policyName}</span>
                            <Badge
                              variant={violation.severity === 'ERROR' ? 'destructive' : 'secondary'}
                              className="text-[10px]"
                            >
                              {violation.severity}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{violation.rule}</p>
                          {violation.fixSuggestion && (
                            <p className="text-sm text-primary mt-1">
                              <span className="font-medium">Fix: </span>
                              {violation.fixSuggestion}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
