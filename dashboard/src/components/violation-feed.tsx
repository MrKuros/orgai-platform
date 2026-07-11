'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { ShieldAlert, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface Violation {
  policyId: string;
  policyName: string;
  rule: string;
  severity: 'ERROR' | 'WARNING';
  fixSuggestion: string;
  setByDisplayName: string;
}

interface ViolationEvent {
  violations: Violation[];
  timestamp: string;
}

export function ViolationFeed() {
  const { currentOrg } = useAuth();
  const [violations, setViolations] = useState<ViolationEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    if (!currentOrg) return;

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
    const token = localStorage.getItem('orgai_token');
    const streamUrl = `${apiUrl}/v1/orgs/${currentOrg.id}/violations/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;

    const eventSource = new EventSource(streamUrl);
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    eventSource.onopen = () => {
      setIsConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ViolationEvent;
        setViolations(prev => [data, ...prev].slice(0, 50));
      } catch (e) {
        console.error('Failed to parse violation event:', e);
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      eventSource.close();
      // Reconnect after 5 seconds
      reconnectTimeout = setTimeout(() => {
        if (!currentOrg) return;
        const retryToken = localStorage.getItem('orgai_token');
        const retryUrl = `${apiUrl}/v1/orgs/${currentOrg.id}/violations/stream${retryToken ? `?token=${encodeURIComponent(retryToken)}` : ''}`;
        const retrySource = new EventSource(retryUrl);
        retrySource.onopen = () => setIsConnected(true);
        retrySource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as ViolationEvent;
            setViolations(prev => [data, ...prev].slice(0, 50));
          } catch (e) {
            console.error('Failed to parse violation event:', e);
          }
        };
        retrySource.onerror = () => {
          setIsConnected(false);
          retrySource.close();
        };
      }, 5000);
    };

    return () => {
      eventSource.close();
      clearTimeout(reconnectTimeout);
      setIsConnected(false);
    };
  }, [currentOrg]);

  const dismissViolation = (index: number) => {
    setViolations(prev => prev.filter((_, i) => i !== index));
  };

  if (!currentOrg || isMinimized) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 w-96 max-h-96 overflow-hidden rounded-lg border bg-card shadow-lg">
      <div className="flex items-center justify-between border-b px-4 py-2 bg-muted/50">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-destructive" />
          <span className="text-sm font-medium">Live Violations</span>
          <Badge variant={isConnected ? 'default' : 'destructive'} className="text-xs">
            {isConnected ? 'Live' : 'Disconnected'}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setIsMinimized(true)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="max-h-80 overflow-y-auto p-2 space-y-2">
        {violations.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No violations detected yet
          </p>
        ) : (
          violations.map((event, index) => (
            <div
              key={`${event.timestamp}-${index}`}
              className="p-3 rounded-lg border bg-destructive/5 border-destructive/20"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={event.violations[0]?.severity === 'ERROR' ? 'destructive' : 'secondary'}
                      className="text-xs"
                    >
                      {event.violations[0]?.severity}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-sm font-medium">{event.violations[0]?.policyName}</p>
                  <p className="text-xs text-muted-foreground">{event.violations[0]?.rule}</p>
                  {event.violations[0]?.fixSuggestion && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Fix: {event.violations[0].fixSuggestion}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => dismissViolation(index)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
