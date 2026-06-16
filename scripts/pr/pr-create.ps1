# pr-create.ps1 — 在 upstream 主仓库创建 PR（跨 fork → upstream）
param(
    [Parameter(Mandatory=$true)]
    [string]$BranchName,

    [Parameter(Mandatory=$true)]
    [string]$Title,

    [Parameter(Mandatory=$true)]
    [string]$BodyFile,

    [string]$UpstreamOwner = "leo123-tto",
    [string]$UpstreamRepo = "case-board",
    [string]$ForkOwner = "zzf516988659-del",
    [string]$BaseBranch = "main",
    [switch]$Draft
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
    # 0. 检查 BodyFile 存在
    if (-not (Test-Path $BodyFile)) {
        log "BodyFile not found: $BodyFile" -Level ERROR
        exit 1
    }

    # 1. 检查 gh CLI
    $ghPath = & cmd /c "where gh 2>nul"
    if (-not $ghPath) {
        # 尝试常见安装路径
        $guesses = @(
            "$env:LOCALAPPDATA\Programs\GitHub CLI\gh.exe",
            "C:\Program Files\GitHub CLI\gh.exe",
            "$env:ProgramFiles\GitHub CLI\gh.exe"
        )
        foreach ($g in $guesses) {
            if (Test-Path $g) {
                $ghPath = $g
                break
            }
        }
        if (-not $ghPath) {
            log "gh CLI not found. Install: winget install --id GitHub.cli" -Level ERROR
            exit 1
        }
    } else {
        $ghPath = "gh"
    }
    log "Using gh: $ghPath"

    # 2. 检查认证
    $authStatus = & $ghPath auth status --hostname github.com 2>&1
    if ($LASTEXITCODE -ne 0) {
        log "Not authenticated with GitHub. Run: gh auth login" -Level ERROR
        exit 1
    }
    log "Authenticated: $($authStatus -join ' ')"

    # 3. 检查当前分支
    $currentBranch = cmd /c "git branch --show-current 2>nul"
    if ($currentBranch -ne $BranchName) {
        log "Current branch is $currentBranch, expected $BranchName" -Level ERROR
        log "Checkout first: git checkout $BranchName" -Level ERROR
        exit 1
    }

    # 4. 检查远端分支是否已推送
    $remoteBranch = cmd /c "git rev-parse --verify origin/$BranchName 2>nul"
    if (-not $remoteBranch) {
        log "Branch $BranchName not pushed to origin. Run pr-push.ps1 first" -Level ERROR
        exit 1
    }

    # 5. 创建 PR
    $headRef = "$ForkOwner`:$BranchName"
    log "Creating PR: $ForkOwner:$BranchName → $UpstreamOwner/$UpstreamRepo:$BaseBranch"

    $ghArgs = @(
        "pr", "create",
        "--repo", "$UpstreamOwner/$UpstreamRepo",
        "--head", $headRef,
        "--base", $BaseBranch,
        "--title", $Title,
        "--body-file", $BodyFile
    )
    if ($Draft) {
        $ghArgs += "--draft"
    }

    $output = & $ghPath $ghArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        log "gh pr create failed:" -Level ERROR
        Write-Host $output
        exit 1
    }

    $prUrl = $output | Where-Object { $_ -match "^https://" } | Select-Object -First 1
    log "PR created: $prUrl" -Level INFO
    if ($Draft) {
        log "Status: DRAFT — review then mark Ready" -Level INFO
    }

} finally {
    Pop-Location
}
