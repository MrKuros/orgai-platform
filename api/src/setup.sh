#!/usr/bin/env bash
set -euo pipefail

# Parse args
API_KEY=""
API_URL="https://api.orgai.dev"
while [[ $# -gt 0 ]]; do
  case $1 in
    --key) API_KEY="$2"; shift 2 ;;
    --url) API_URL="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [ -z "$API_KEY" ]; then
  echo "Usage: curl -fsSL $API_URL/setup.sh | bash -s -- --key YOUR_API_KEY"
  exit 1
fi

MCP_URL="$API_URL/mcp/sse"
CONFIGURED=()

# Helper: merge orgai server into an MCP config JSON file
configure_json() {
  local file="$1"
  local name="$2"
  mkdir -p "$(dirname "$file")"
  # Use node/python/jq to merge — with jq fallback to simple write
  if command -v jq &>/dev/null; then
    if [ -f "$file" ]; then
      jq --arg url "$MCP_URL" --arg key "$API_KEY" \
        '.mcpServers.orgai = { url: $url, env: { ORGAI_API_KEY: $key } }' \
        "$file" > "$file.tmp" && mv "$file.tmp" "$file"
    else
      jq -n --arg url "$MCP_URL" --arg key "$API_KEY" \
        '{ mcpServers: { orgai: { url: $url, env: { ORGAI_API_KEY: $key } } } }' \
        > "$file"
    fi
  else
    # No jq — write fresh (safe for first-time setup)
    cat > "$file" <<EOF
{ "mcpServers": { "orgai": { "url": "$MCP_URL", "env": { "ORGAI_API_KEY": "$API_KEY" } } } }
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
  claude mcp add orgai --transport sse "$MCP_URL" --header "x-api-key: $API_KEY" --scope user 2>/dev/null || true
  CONFIGURED+=("Claude Code")
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

# Summary
echo ""
echo "✅ OrgAI MCP configured for: ${CONFIGURED[*]:-none detected}"
echo ""
[ -d "$HOME/.vscode" ] && echo "📦 VS Code: Install the OrgAI extension manually → https://github.com/MrKuros/orgai-platform/releases/latest"
echo "🔗 MCP endpoint: $MCP_URL"
echo ""
echo "Done! Restart your IDE to activate."