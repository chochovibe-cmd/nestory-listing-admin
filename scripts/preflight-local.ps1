param(
  [int]$Port = 3000,
  [switch]$CheckUrl,
  [switch]$Full
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$BundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$BundledNodeDir = Split-Path -Parent $BundledNode
$Results = New-Object System.Collections.Generic.List[object]

function Add-Result {
  param(
    [string]$Name,
    [bool]$Pass,
    [string]$Detail = ""
  )

  $Results.Add([pscustomobject]@{
    Check = $Name
    Status = if ($Pass) { "PASS" } else { "FAIL" }
    Detail = $Detail
  }) | Out-Null
}

Set-Location -LiteralPath $ProjectRoot

$NodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $BundledNode) {
  $NodeExe = $BundledNode
  $env:Path = "$BundledNodeDir;$env:Path"
  Add-Result "Node runtime" $true "Using bundled Codex Node"
} elseif ($NodeCommand) {
  $NodeExe = $NodeCommand.Source
  Add-Result "Node runtime" $true "Using PATH node"
} else {
  $NodeExe = $null
  Add-Result "Node runtime" $false "Node.js not found"
}

$GitCommand = Get-Command git -ErrorAction SilentlyContinue
Add-Result "Git command" $true $(if ($GitCommand) { "git found" } else { "git not found on PATH; use full Git path if needed" })
Add-Result "Git repository" (Test-Path -LiteralPath ".git") $(if (Test-Path -LiteralPath ".git") { ".git exists" } else { "Current folder is not a git repository" })

$RequiredFiles = @(
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".env.example",
  "supabase/migrations/001_initial_schema.sql",
  "src/app/layout.tsx",
  "src/app/drafts/new/page.tsx",
  "src/app/drafts/page.tsx",
  "src/app/review/page.tsx"
)

foreach ($File in $RequiredFiles) {
  Add-Result "File: $File" (Test-Path -LiteralPath $File)
}

Add-Result "No committed env file" (-not (Test-Path -LiteralPath ".env")) ".env must never be committed"
Add-Result "Local env file" (Test-Path -LiteralPath ".env.local") $(if (Test-Path -LiteralPath ".env.local") { ".env.local exists; values are not printed" } else { ".env.local missing; Supabase runtime flow cannot be tested yet" })
Add-Result "Dependencies installed" (Test-Path -LiteralPath "node_modules/next/dist/bin/next")
Add-Result "Production build artifact" ((Test-Path -LiteralPath ".next/BUILD_ID") -or -not $Full) $(if (Test-Path -LiteralPath ".next/BUILD_ID") { ".next/BUILD_ID exists" } else { "Run with -Full to require a fresh build" })

if ($NodeExe) {
  & $NodeExe scripts/verify-all.mjs
  Add-Result "Static verifier" ($LASTEXITCODE -eq 0) "node scripts/verify-all.mjs"

  if ($Full) {
    & ".\node_modules\.bin\tsc.cmd" --noEmit
    Add-Result "TypeScript" ($LASTEXITCODE -eq 0) "tsc --noEmit"

    & ".\node_modules\.bin\next.cmd" build
    Add-Result "Next build" ($LASTEXITCODE -eq 0) "next build"
  }
}

if ($CheckUrl) {
  & $NodeExe scripts/verify-pwa-smoke.mjs "http://127.0.0.1:$Port"
  Add-Result "PWA route smoke" ($LASTEXITCODE -eq 0) "http://127.0.0.1:$Port"
}

$Results | Format-Table -AutoSize

if ($Results | Where-Object { $_.Status -eq "FAIL" }) {
  exit 1
}
