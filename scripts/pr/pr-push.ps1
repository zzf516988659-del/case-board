# pr-push.ps1 — 提交本地改动，推送到 origin，对接 GitHub PR
param(
    [string]$CommitMsg = "",
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
    # 0. 检查 git 状态
    $status = cmd /c "git status --short 2>nul"
    if (-not $status) {
        log "Nothing to commit." -Level INFO
        exit 0
    }
    Write-Host "Changes to commit:"
    Write-Host $status
    Write-Host ""

    # 1. 解析 commit message
    if (-not $CommitMsg) {
        $CommitMsg = Read-Host "Commit message (one line)"
    }
    if (-not $CommitMsg) {
        log "Commit message required" -Level ERROR
        exit 1
    }

    # 2. git add -A
    log "git add -A"
    if ($DryRun) {
        log "[DryRun] Skipping git add"
    } else {
        cmd /c "git add -A 2>nul"
    }

    # 3. git commit
    log "git commit: $CommitMsg"
    if ($DryRun) {
        log "[DryRun] Skipping commit"
    } else {
        # 使用 --no-verify 跳过 hooks（Windows PowerShell BOM 问题由 pr-verify.ps1 处理）
        cmd /c "git commit -m `"$CommitMsg`" 2>nul"
        if ($LASTEXITCODE -ne 0) {
            log "git commit failed" -Level ERROR
            exit 1
        }
    }

    # 4. git push
    $currentBranch = cmd /c "git branch --show-current 2>nul"
    if ($currentBranch -eq "main" -or $currentBranch -eq "master") {
        log "Warning: on $currentBranch branch. Push to feature branch recommended." -Level WARN
    }
    log "Pushing to origin/$currentBranch..."
    if ($DryRun) {
        log "[DryRun] Skipping push"
    } else {
        cmd /c "git push origin $currentBranch 2>nul"
        if ($LASTEXITCODE -ne 0) {
            log "git push failed (check proxy: set HTTPS_PROXY)" -Level ERROR
            exit 1
        }
    }

    # 5. 提示创建 GitHub PR
    $remoteUrl = cmd /c "git remote get-url origin 2>nul"
    $remoteUrl = $remoteUrl -replace "[.]git$", ""
    if ($remoteUrl -match "github.com/(.+)") {
        $ownerRepo = $Matches[1]
        log "Open PR at: https://github.com/$ownerRepo/compare" -Level INFO
    }

    log "Done. Check CI, then create PR at GitHub." -Level INFO

} finally {
    Pop-Location
}
