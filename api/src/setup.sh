#!/usr/bin/env bash
set -euo pipefail

# OrgAI developer setup — configures your AI agents (MCP) and installs the git
# pre-commit hook. Run from inside a git repo to get the hook too.
#   curl -fsSL https://<orgai-host>/setup.sh | bash -s -- --key oai_...
# Flags: --key <org api key> (required) · --url <orgai host> · --role <role, default junior>

# Parse args
API_KEY=""
API_URL="https://api.orgai.dev"
ROLE="junior"
while [[ $# -gt 0 ]]; do
  case $1 in
    --key) API_KEY="$2"; shift 2 ;;
    --url) API_URL="$2"; shift 2 ;;
    --role) ROLE="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [ -z "$API_KEY" ]; then
  echo "Usage: curl -fsSL $API_URL/setup.sh | bash -s -- --key YOUR_API_KEY [--url HOST] [--role ROLE]"
  exit 1
fi

# Streamable HTTP is the modern MCP transport; /mcp/sse remains for old agents.
MCP_URL="$API_URL/mcp"
CONFIGURED=()

# Helper: merge orgai server into an MCP config JSON file.
# Auth is the x-api-key HEADER — remote MCP servers never see client-side env.
configure_json() {
  local file="$1"
  local name="$2"
  mkdir -p "$(dirname "$file")"
  if command -v jq &>/dev/null; then
    if [ -f "$file" ]; then
      jq --arg url "$MCP_URL" --arg key "$API_KEY" \
        '.mcpServers.orgai = { url: $url, headers: { "x-api-key": $key } }' \
        "$file" > "$file.tmp" && mv "$file.tmp" "$file"
    else
      jq -n --arg url "$MCP_URL" --arg key "$API_KEY" \
        '{ mcpServers: { orgai: { url: $url, headers: { "x-api-key": $key } } } }' \
        > "$file"
    fi
  elif [ -f "$file" ]; then
    # No jq and the file exists — never clobber someone's other MCP servers.
    echo "warning: $name: $file exists and jq is not installed - add the orgai server manually (see docs)." >&2
    return
  else
    cat > "$file" <<EOF
{ "mcpServers": { "orgai": { "url": "$MCP_URL", "headers": { "x-api-key": "$API_KEY" } } } }
EOF
  fi
  CONFIGURED+=("$name")
}

# Cursor
[ -d "$HOME/.cursor" ] && configure_json "$HOME/.cursor/mcp.json" "Cursor"

# Windsurf
[ -d "$HOME/.codeium" ] && configure_json "$HOME/.codeium/windsurf/mcp_config.json" "Windsurf"

# Claude Code (prefer CLI if available)
if command -v claude &>/dev/null; then
  if claude mcp add orgai --transport http "$MCP_URL" --header "x-api-key: $API_KEY" --scope user >/dev/null 2>&1; then
    CONFIGURED+=("Claude Code")
  else
    echo "warning: Claude Code: 'claude mcp add' failed - add the server manually (see docs)." >&2
  fi
fi

# OpenCode
configure_opencode() {
  local file="$HOME/.config/opencode/opencode.json"
  if [ -d "$HOME/.config/opencode" ]; then
    if command -v jq &>/dev/null; then
      if [ -f "$file" ]; then
        jq --arg url "$MCP_URL" --arg key "$API_KEY" \
          '.mcp.orgai = { type: "remote", url: $url, headers: { "x-api-key": $key } }' \
          "$file" > "$file.tmp" && mv "$file.tmp" "$file"
      else
        jq -n --arg url "$MCP_URL" --arg key "$API_KEY" \
          '{ mcp: { orgai: { type: "remote", url: $url, headers: { "x-api-key": $key } } } }' \
          > "$file"
      fi
    elif [ -f "$file" ]; then
      echo "warning: OpenCode: $file exists and jq is not installed - add the orgai server manually (see docs)." >&2
      return
    else
      cat > "$file" <<EOF
{ "mcp": { "orgai": { "type": "remote", "url": "$MCP_URL", "headers": { "x-api-key": "$API_KEY" } } } }
EOF
    fi
    CONFIGURED+=("OpenCode")
  fi
}
configure_opencode

# Antigravity
[ -d "$HOME/.gemini" ] && configure_json "$HOME/.gemini/config/mcp_config.json" "Antigravity"

# VS Code / GitHub Copilot agent mode — .vscode/mcp.json in the current repo.
if git rev-parse --show-toplevel >/dev/null 2>&1; then
  REPO_ROOT="$(git rev-parse --show-toplevel)"
  VSCODE_MCP="$REPO_ROOT/.vscode/mcp.json"
  mkdir -p "$REPO_ROOT/.vscode"
  if command -v jq &>/dev/null; then
    if [ -f "$VSCODE_MCP" ]; then
      jq --arg url "$MCP_URL" --arg key "$API_KEY" \
        '.servers.orgai = { type: "http", url: $url, headers: { "x-api-key": $key } }' \
        "$VSCODE_MCP" > "$VSCODE_MCP.tmp" && mv "$VSCODE_MCP.tmp" "$VSCODE_MCP"
      CONFIGURED+=("VS Code/Copilot (agent mode)")
    else
      printf '{ "servers": { "orgai": { "type": "http", "url": "%s", "headers": { "x-api-key": "%s" } } } }\n' "$MCP_URL" "$API_KEY" > "$VSCODE_MCP"
      CONFIGURED+=("VS Code/Copilot (agent mode)")
    fi
  elif [ -f "$VSCODE_MCP" ]; then
    echo "warning: VS Code: $VSCODE_MCP exists and jq is not installed - add the orgai server manually (see docs)." >&2
  else
    printf '{ "servers": { "orgai": { "type": "http", "url": "%s", "headers": { "x-api-key": "%s" } } } }\n' "$MCP_URL" "$API_KEY" > "$VSCODE_MCP"
    CONFIGURED+=("VS Code/Copilot (agent mode)")
  fi
fi

# Git pre-commit hook — the commit backstop. Installs into the current repo.
HOOK_MSG="ℹ️  Not inside a git repo — rerun this script inside each repo to install the pre-commit hook."
if git rev-parse --git-dir >/dev/null 2>&1; then
  HOOK_DIR="$(git rev-parse --git-dir)/hooks"
  mkdir -p "$HOOK_DIR"
  if curl -fsSL "$API_URL/hook/pre-commit" -o "$HOOK_DIR/pre-commit"; then
    chmod +x "$HOOK_DIR/pre-commit"
    git config orgai.apiurl "$API_URL"
    git config orgai.apikey "$API_KEY"
    git config orgai.role "$ROLE"
    HOOK_MSG="🪝 pre-commit hook installed in this repo (role: $ROLE)"
  else
    HOOK_MSG="⚠️  Could not download the pre-commit hook from $API_URL/hook/pre-commit"
  fi
fi

# Summary
echo ""
echo "✅ OrgAI MCP configured for: ${CONFIGURED[*]:-none detected}"
echo "$HOOK_MSG"
echo ""
[ -d "$HOME/.vscode" ] && echo "📦 VS Code: Install the OrgAI extension manually → https://github.com/MrKuros/orgai-platform/releases/latest"
echo "🔗 MCP endpoint: $MCP_URL"
echo ""
echo "Done! Restart your IDE to activate."
