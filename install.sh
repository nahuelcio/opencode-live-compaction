#!/usr/bin/env bash
#
# opencode-live-compaction installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/nahuelcio/opencode-live-compaction/master/install.sh | bash
#   # or from a local clone:
#   ./install.sh
#   ./install.sh /path/to/project
#
set -euo pipefail

# --- Colors ---
GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${CYAN}[info]${NC}  $*"; }
ok() { echo -e "${GREEN}[ok]${NC}    $*"; }
warn() { echo -e "${YELLOW}[warn]${NC}  $*"; }
error() {
	echo -e "${RED}[error]${NC} $*" >&2
	exit 1
}

# --- Resolve target project directory ---
TARGET_DIR="${1:-.}"
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

PLUGIN_BASE="${TARGET_DIR}/.opencode/plugins"
PLUGIN_DIR="${PLUGIN_BASE}/live-compaction"
ENTRY_FILE="${PLUGIN_BASE}/live-compaction.ts"
TMP_DIR=""

cleanup() {
	if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
		rm -rf "$TMP_DIR"
	fi
}
trap cleanup EXIT

info "Installing opencode-live-compaction into ${TARGET_DIR}"

# --- Locate source files ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR=""

# Check if we're running from the repo
if [[ -f "${SCRIPT_DIR}/src/index.ts" ]]; then
	SRC_DIR="${SCRIPT_DIR}/src"
else
	# Download from GitHub
	info "Downloading from GitHub..."
	TMP_DIR="$(mktemp -d)"
	git clone --depth 1 https://github.com/nahuelcio/opencode-live-compaction.git "$TMP_DIR/repo" 2>/dev/null ||
		error "Failed to clone repository"
	SRC_DIR="${TMP_DIR}/repo/src"
fi

[[ -d "$SRC_DIR" ]] || error "Source directory not found"

# --- Create plugin directory ---
mkdir -p "$PLUGIN_DIR"

# --- Copy source files ---
for file in index.ts prompt.ts files-touched.ts; do
	if [[ -f "${SRC_DIR}/${file}" ]]; then
		cp "${SRC_DIR}/${file}" "${PLUGIN_DIR}/${file}"
	else
		error "Missing source file: ${file}"
	fi
done

# --- Create entry point barrel file ---
# OpenCode scans .opencode/plugins/*.ts (not subdirs)
# so we need a barrel file at the root that re-exports
cat >"$ENTRY_FILE" <<'BARREL'
/** opencode-live-compaction entry point */
export { LiveCompactionPlugin, default } from "./live-compaction/index.ts"
BARREL

# --- Verify ---
FILES_COUNT="$(find "$PLUGIN_DIR" -name '*.ts' | wc -l)"
if [[ "$FILES_COUNT" -lt 3 ]]; then
	error "Expected 3 files, found ${FILES_COUNT}"
fi

if [[ ! -f "$ENTRY_FILE" ]]; then
	error "Entry point barrel file was not created"
fi

ok "Plugin installed:"
ok "  ${PLUGIN_DIR}/"
ok "    ├── index.ts"
ok "    ├── prompt.ts"
ok "    └── files-touched.ts"
ok "  ${ENTRY_FILE} (entry point)"

# --- Check if opencode.json exists and suggest plugin entry ---
if [[ -f "${TARGET_DIR}/opencode.json" ]]; then
	if grep -q "opencode-live-compaction" "${TARGET_DIR}/opencode.json" 2>/dev/null; then
		ok "opencode.json already references the plugin"
	else
		warn "For npm-style loading, add to opencode.json:"
		echo ''
		echo '  {'
		echo '    "plugin": ["opencode-live-compaction"]'
		echo '  }'
		echo ''
		info "Local plugin is already active — no config change needed."
	fi
else
	info "No opencode.json found. The local plugin will be auto-loaded from .opencode/plugins/live-compaction.ts"
fi

echo ''
ok "Done! OpenCode will use enhanced 11-section compaction on next session."
