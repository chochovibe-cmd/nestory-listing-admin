param(
  [int]$Port = 3000,
  [switch]$Build
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$BundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$BundledNodeDir = Split-Path -Parent $BundledNode
$NodeCommand = Get-Command node -ErrorAction SilentlyContinue

if (Test-Path -LiteralPath $BundledNode) {
  $NodeExe = $BundledNode
  $env:Path = "$BundledNodeDir;$env:Path"
} elseif ($NodeCommand) {
  $NodeExe = $NodeCommand.Source
} else {
  throw "Node.js was not found. Install Node or run inside Codex with the bundled runtime available."
}

$NextBin = Join-Path $ProjectRoot "node_modules\next\dist\bin\next"
$BuildId = Join-Path $ProjectRoot ".next\BUILD_ID"

if (-not (Test-Path -LiteralPath $NextBin)) {
  throw "Dependencies are missing. Run pnpm install or npm install before starting the local preview."
}

Set-Location -LiteralPath $ProjectRoot

if ($Build -or -not (Test-Path -LiteralPath $BuildId)) {
  Write-Host "Building Nestory Listing Admin..."
  & $NodeExe $NextBin build
}

Write-Host "Starting Nestory Listing Admin at http://127.0.0.1:$Port/login"
Write-Host "Press Ctrl+C to stop the server."
& $NodeExe $NextBin start -H 127.0.0.1 -p $Port
