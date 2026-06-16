# pr-prepare.ps1 — 从 upstream/main 拉取最新代码，创建 feature 分支
param(
    [string]$BranchName = "",
    [string]$BranchPrefix = "pr/fix"
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
    if ($status) {
        log "Working tree has uncommitted changes. Commit or stash first:" -Level ERROR
        Write-Host $status
        exit 1
    }

    # 1. 确认 upstream remote 存在
    $remotes = cmd /c "git remote 2>nul"
    if ($remotes -notmatch "upstream") {
        log "No 'upstream' remote found. Run: git remote add upstream https://github.com/leo123-tto/case-board.git" -Level ERROR
        exit 1
    }

    # 2. Fetch upstream main
    log "Fetching upstream/main..."
    cmd /c "git fetch upstream main 2>nul"
    if ($LASTEXITCODE -ne 0) {
        log "git fetch upstream main failed" -Level ERROR
        exit 1
    }

    # 3. 检查 upstream/main 是否有更新
    $localHash = cmd /c "git rev-parse HEAD 2>nul"
    $upstreamHash = cmd /c "git rev-parse upstream/main 2>nul"
    if ($localHash -eq $upstreamHash) {
        log "Already at upstream/main ($localHash). Nothing to do."
        exit 0
    }

    # 4. 解析分支名
    if (-not $BranchName) {
        $BranchName = Read-Host "Branch name (e.g. fix/identifier-hardcoding)"
    }
    if (-not $BranchName) {
        log "Branch name required" -Level ERROR
        exit 1
    }
    $fullBranch = "$BranchPrefix/$BranchName"

    # 5. 创建分支（从 upstream/main）
    log "Creating branch: $fullBranch from upstream/main"
    cmd /c "git checkout -b $fullBranch upstream/main 2>nul"
    if ($LASTEXITCODE -ne 0) {
        log "git checkout -b failed" -Level ERROR
        exit 1
    }

    # 6. 设置 upstream tracking
    cmd /c "git push -u origin $fullBranch 2>nul"
    if ($LASTEXITCODE -ne 0) {
        log "git push -u origin failed (check network/proxy)" -Level WARN
    }

    log "Branch '$fullBranch' created and checked out." -Level INFO
    log "Next: Edit files, then run pr-verify.ps1"

} finally {
    Pop-Location
}
