# upstream-watch.ps1 — 检查 upstream 最新 tag，对比本地 commit
param(
    [string]$Proxy = "http://127.0.0.1:7897",
    [string]$UpstreamRemote = "upstream",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

function log {
    param([string]$Msg, [string]$Level = "INFO")
    $ts = Get-Date -Format "HH:mm:ss"
    "[$ts][$Level] $Msg"
}

Push-Location $RepoRoot

try {
    $env:HTTPS_PROXY = $Proxy
    $env:HTTP_PROXY = $Proxy

    # 1. Fetch upstream
    log "Fetching upstream..."
    if (-not $DryRun) {
        cmd /c "git fetch $UpstreamRemote 2>nul"
    } else {
        log "[DryRun] Skipping git fetch"
    }

    # 2. 获取当前分支 + upstream/main commit
    $localBranch = cmd /c "git branch --show-current 2>nul"
    if (-not $localBranch) { $localBranch = "(detached)" }
    $localHash = cmd /c "git rev-parse HEAD 2>nul"
    $upstreamMainHash = cmd /c "git rev-parse $UpstreamRemote/main 2>nul"
    $upstreamTag = cmd /c "git describe $UpstreamRemote/main --tags --abbrev=0 2>nul"

    log "Local branch: $localBranch"
    log "Local commit:  $localHash"
    log "Upstream main: $upstreamMainHash"
    log "Upstream tag:  $upstreamTag"

    # 3. 检查是否落后 upstream
    $ahead = cmd /c "git log HEAD..$UpstreamRemote/main --oneline 2>nul"
    $behind = cmd /c "git log $UpstreamRemote/main..HEAD --oneline 2>nul"

    if (-not $ahead -and -not $behind) {
        log "In sync with upstream/main"
    } else {
        if ($ahead) {
            $count = ($ahead -split "`n").Count
            log "Behind upstream/main by $count commits:" -Level WARN
            Write-Host $ahead
        }
        if ($behind) {
            $count = ($behind -split "`n").Count
            log "Ahead of upstream/main by $count commits:"
            Write-Host $behind
        }
    }

    # 4. 最新 upstream tags（最近 5 个）
    log "Recent upstream tags:"
    $tags = cmd /c "git tag --list --sort=-creatordate 2>nul"
    $upstreamTags = ($tags -split "`n" | Where-Object { $_ -match "^[0-9]" } | Select-Object -First 5) -join "`n"
    Write-Host $upstreamTags

} finally {
    Pop-Location
}
