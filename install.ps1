# opencode-live-compaction installer for Windows
#
# Usage:
#   irm https://raw.githubusercontent.com/nahuelcio/opencode-live-compaction/master/install.ps1 | iex
#   # or from a local clone:
#   .\install.ps1
#   .\install.ps1 C:\path\to\project
#
param(
    [string]$TargetDir = "."
)

$ErrorActionPreference = "Stop"

# Resolve target
$TargetDir = (Resolve-Path $TargetDir).Path
$PluginDir = Join-Path $TargetDir ".opencode\plugins\live-compaction"

Write-Host "[info]  Installing opencode-live-compaction into $TargetDir" -ForegroundColor Cyan

# Locate source files
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SrcDir = ""

if (Test-Path (Join-Path $ScriptDir "src\index.ts")) {
    $SrcDir = Join-Path $ScriptDir "src"
} else {
    Write-Host "[info]  Downloading from GitHub..." -ForegroundColor Cyan
    $TmpDir = Join-Path $env:TEMP "opencode-live-compaction-$(Get-Random)"
    git clone --depth 1 https://github.com/nahuelcio/opencode-live-compaction.git "$TmpDir" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[error] Failed to clone repository" -ForegroundColor Red
        exit 1
    }
    $SrcDir = Join-Path $TmpDir "src"
}

if (-not (Test-Path $SrcDir)) {
    Write-Host "[error] Source directory not found" -ForegroundColor Red
    exit 1
}

# Create plugin directory
New-Item -ItemType Directory -Path $PluginDir -Force | Out-Null

# Copy source files
$files = @("index.ts", "prompt.ts", "files-touched.ts")
foreach ($file in $files) {
    $src = Join-Path $SrcDir $file
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $PluginDir $file) -Force
    } else {
        Write-Host "[error] Missing source file: $file" -ForegroundColor Red
        exit 1
    }
}

Write-Host "[ok]    Plugin installed to $PluginDir\" -ForegroundColor Green
Write-Host "[ok]      +-- index.ts" -ForegroundColor Green
Write-Host "[ok]      +-- prompt.ts" -ForegroundColor Green
Write-Host "[ok]      +-- files-touched.ts" -ForegroundColor Green

# Check opencode.json
$ConfigFile = Join-Path $TargetDir "opencode.json"
if (Test-Path $ConfigFile) {
    $content = Get-Content $ConfigFile -Raw
    if ($content -match "opencode-live-compaction") {
        Write-Host "[ok]    opencode.json already references the plugin" -ForegroundColor Green
    } else {
        Write-Host "[warn]  For npm-style loading, add to opencode.json:" -ForegroundColor Yellow
        Write-Host ""
        Write-Host '  { "plugin": ["opencode-live-compaction"] }'
        Write-Host ""
        Write-Host "[info]  Local plugin is already active - no config change needed." -ForegroundColor Cyan
    }
} else {
    Write-Host "[info]  No opencode.json found. The local plugin will be auto-loaded from .opencode\plugins\" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "[ok]    Done! OpenCode will use enhanced 11-section compaction on next session." -ForegroundColor Green
