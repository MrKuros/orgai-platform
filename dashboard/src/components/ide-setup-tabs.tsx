'use client';

import { useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';

const MCP_URL = process.env.NEXT_PUBLIC_MCP_URL || 'https://mcp.orgai.dev';

type Ide = 'cursor' | 'windsurf' | 'claude' | 'opencode' | 'antigravity' | 'vscode';

const IDES: { id: Ide; name: string }[] = [
  { id: 'cursor', name: 'Cursor' },
  { id: 'windsurf', name: 'Windsurf' },
  { id: 'claude', name: 'Claude Code' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'antigravity', name: 'Antigravity' },
  { id: 'vscode', name: 'VS Code' },
];

function getConfigSnippet(apiKey: string | null, ide: Ide): string {
  const key = apiKey || 'your-api-key';
  const url = `${MCP_URL}/sse`;

  switch (ide) {
    case 'cursor':
      return JSON.stringify({
        mcpServers: {
          orgai: {
            url,
            env: {
              ORGAI_API_KEY: key,
            },
          },
        },
      }, null, 2);

    case 'windsurf':
      return JSON.stringify({
        mcpServers: {
          orgai: {
            url,
            env: {
              ORGAI_API_KEY: key,
            },
          },
        },
      }, null, 2);

    case 'claude':
      return JSON.stringify({
        mcpServers: {
          orgai: {
            url,
            env: {
              ORGAI_API_KEY: key,
            },
          },
        },
      }, null, 2);

    case 'opencode':
      return JSON.stringify({
        mcpServers: {
          orgai: {
            url,
            env: {
              ORGAI_API_KEY: key,
            },
          },
        },
      }, null, 2);

    case 'antigravity':
      return JSON.stringify({
        mcpServers: {
          orgai: {
            url,
            env: {
              ORGAI_API_KEY: key,
            },
          },
        },
      }, null, 2);

    case 'vscode':
      return `# OrgAI Extension for VS Code
# Download from: https://github.com/MrKuros/orgai-platform/releases/latest
# After installation, add to your VS Code settings:
{
  "orgai.apiKey": "${key}",
  "orgai.apiUrl": "${url.replace('/sse', '')}"
}`;
  }
}

function getInstructions(ide: Ide): string {
  switch (ide) {
    case 'cursor':
      return 'Add the MCP server configuration to Cursor settings (Settings → MCP → Add new server).';
    case 'windsurf':
      return 'Add the MCP server to your Windsurf configuration at ~/.codeium/windsurf/mcp_config.json.';
    case 'claude':
      return 'Add the MCP server to your Claude Code configuration file (~/.claude/mcp_config.json).';
    case 'opencode':
      return 'Add the MCP server to your OpenCode MCP configuration file.';
    case 'antigravity':
      return 'Add the MCP server to your Antigravity MCP configuration.';
    case 'vscode':
      return 'Download and install the OrgAI VS Code extension from GitHub releases.';
  }
}

interface IdeSetupTabsProps {
  apiKey: string | null;
}

export function IdeSetupTabs({ apiKey }: IdeSetupTabsProps) {
  const [activeTab, setActiveTab] = useState<Ide>('cursor');

  const currentConfig = getConfigSnippet(apiKey, activeTab);
  const instructions = getInstructions(activeTab);

  return (
    <div className="bg-card border rounded-lg overflow-hidden">
      {/* Tab Header */}
      <div className="border-b px-4 py-3 bg-muted/30">
        <div className="flex gap-1 overflow-x-auto">
          {IDES.map((ide) => (
            <button
              key={ide.id}
              onClick={() => setActiveTab(ide.id)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                activeTab === ide.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              {ide.name}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="p-6 space-y-6">
        {/* Instructions */}
        <div>
          <h3 className="font-semibold mb-2">Instructions</h3>
          <p className="text-sm text-muted-foreground">{instructions}</p>
        </div>

        {/* Configuration */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Configuration</h3>
            <CopyButton value={currentConfig} />
          </div>
          <pre className="bg-muted/50 rounded-lg p-4 overflow-x-auto text-sm font-mono">
            {currentConfig}
          </pre>
          {activeTab === 'vscode' && (
            <div className="flex items-center gap-2 text-sm">
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
              <a
                href="https://github.com/MrKuros/orgai-platform/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Download VS Code Extension
              </a>
              <span className="text-xs text-muted-foreground">(Coming soon if no release exists)</span>
            </div>
          )}
        </div>

        {/* Note about MCP URL */}
        {activeTab !== 'vscode' && (
          <p className="text-xs text-muted-foreground">
            Note: This configuration uses the hosted MCP server at <code className="bg-muted px-1 rounded">{MCP_URL}/sse</code>.
            Once the @orgai/mcp package is published to npm, you can use <code className="bg-muted px-1 rounded">npx @orgai/mcp</code> instead.
          </p>
        )}
      </div>
    </div>
  );
}
