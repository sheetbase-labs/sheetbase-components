#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for command_name in herdr bun curl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
done

if ! herdr status server >/dev/null 2>&1; then
  echo "Herdr is not running. Start or attach to Herdr, then rerun: bun run dev:herdr" >&2
  exit 1
fi

for port in 5173 8787; do
  if curl --silent --fail --max-time 1 "http://127.0.0.1:${port}/" >/dev/null 2>&1; then
    echo "Port ${port} is already serving HTTP. Stop the existing process before starting the Herdr workspace." >&2
    exit 1
  fi
done

json_get() {
  local path="$1"
  bun -e 'const data = JSON.parse(await Bun.stdin.text()); let value = data; for (const key of process.argv.at(-1).split(".")) value = value[key]; process.stdout.write(String(value));' "$path"
}

workspace_json="$(herdr workspace create --cwd "$repo_dir" --label "Sheetbase Table" --no-focus)"
workspace_id="$(printf '%s' "$workspace_json" | json_get result.workspace.workspace_id)"
api_pane_id="$(printf '%s' "$workspace_json" | json_get result.root_pane.pane_id)"

web_tab_json="$(herdr tab create --workspace "$workspace_id" --cwd "$repo_dir" --label "Table" --no-focus)"
web_pane_id="$(printf '%s' "$web_tab_json" | json_get result.root_pane.pane_id)"

herdr pane rename "$api_pane_id" "API · :8787" >/dev/null
herdr pane rename "$web_pane_id" "Table · :5173" >/dev/null

herdr pane run "$api_pane_id" "exec bun run dev:api" >/dev/null
herdr pane run "$web_pane_id" "exec bun run dev -- --force" >/dev/null
herdr workspace focus "$workspace_id" >/dev/null

cat <<EOF
Sheetbase development workspace started in Herdr.

  Workspace: $workspace_id
  Table:     http://localhost:5173/million (home: http://localhost:5173/)
  API proxy: http://localhost:5173/api/table

The API and Vite processes are persistent Herdr panes. Close the workspace to stop both.
EOF
