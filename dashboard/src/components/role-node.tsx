import { Handle, Position } from 'reactflow';
import { Shield } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface RoleNodeData {
  id: string;
  name: string;
  displayName: string;
  policyCount: number;
  isSelected?: boolean;
}

export function RoleNode({ data }: { data: RoleNodeData }) {
  return (
    <div className={`px-4 py-3 shadow-md rounded-md bg-card border-2 ${data.isSelected ? 'border-primary' : 'border-border'} w-48 transition-all hover:border-primary/50`}>
      <Handle type="target" position={Position.Top} className="w-16 bg-muted-foreground/30 !border-0" />
      
      <div className="flex flex-col items-center text-center">
        <div className="font-bold text-sm">{data.displayName}</div>
        <div className="text-xs text-muted-foreground mt-1 font-mono">{data.name}</div>
        
        <div className="mt-3">
          <Badge variant={data.policyCount > 0 ? "default" : "secondary"} className="text-xs font-normal">
            <Shield className="w-3 h-3 mr-1" />
            {data.policyCount} {data.policyCount === 1 ? 'Policy' : 'Policies'}
          </Badge>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="w-16 bg-muted-foreground/30 !border-0" />
    </div>
  );
}
