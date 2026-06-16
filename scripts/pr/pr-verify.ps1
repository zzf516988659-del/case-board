# pr-verify.ps1 — 验证本地分支可构建（vite build + tauri build --no-bundle）
param(
    [switch]$SkipTauriBuild,
    [string]$Proxy = "http://127.0.0.1:7897"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

function log {
    param([string]$Msg, [string]$Level = "INFO")
    $ts = Get-Date -Format "HH:mm:ss"
    "[$ts][$Level] $Msg"
}

function removeBom {
    # 去除 UTF-8 BOM，防止 vite PostCSS config 解析失败
    param([string]$FilePath)
    $bytes = [System.IO.File]::ReadAllBytes($FilePath)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        [System.IO.File]::WriteAllBytes($FilePath, $bytes[3..($bytes.Length - 1)])
        log "Removed BOM from: $FilePath"
    }
}

Push-Location $RepoRoot

try {
    $env:HTTPS_PROXY = $Proxy
    $env:HTTP_PROXY = $Proxy

    # 0. 清理 package.json BOM
    log "Checking package.json BOM..."
    removeBom "$RepoRoot\package.json"

    # 1. vite build
    log "Running vite build (tsc + vite build)..."
    $viteOut = cmd /c "cd /d $RepoRoot && pnpm build 2>&1"
    if ($LASTEXITCODE -ne 0) {
        log "vite build failed:" -Level ERROR
        Write-Host $viteOut
        exit 1
    }
    # 检查 dist 输出
    $distFiles = Get-ChildItem "$RepoRoot\dist" -File -ErrorAction SilentlyContinue
    log "dist/ output: $($distFiles.Count) files"
    if ($distFiles.Count -eq 0) {
        log "dist/ is empty — build failed silently" -Level ERROR
        exit 1
    }
    $mainJs = $distFiles | Where-Object { $_.Name -match "index-[a-zA-Z0-9_-]+[.]js" }
    if ($mainJs) {
        log "Main bundle: $($mainJs.Name) ($([Math]::Round($mainJs.Length/1KB)) KB)"
    }

    if ($SkipTauriBuild) {
        log "SkipTauriBuild set — frontend build only." -Level INFO
        exit 0
    }

    # 2. tauri build --no-bundle
    log "Running tauri build --no-bundle (this takes ~10-15 min)..."
    $tauriOut = cmd /c "cd /d $RepoRoot && pnpm tauri build --no-bundle 2>&1"
    if ($LASTEXITCODE -ne 0) {
        log "tauri build failed:" -Level ERROR
        Write-Host $tauriOut
        exit 1
    }

    # 3. 验证 exe
    $exePath = "$RepoRoot\target\release\caseboard.exe"
    if (-not (Test-Path $exePath)) {
        log "caseboard.exe not found at $exePath" -Level ERROR
        exit 1
    }
    $exeSize = (Get-Item $exePath).Length
    $exeSizeMB = [Math]::Round($exeSize / 1MB, 2)
    log "caseboard.exe: $exeSizeMB MB"

    # 4. 检查 exe 内嵌 dist
    $buf = [System.IO.File]::ReadAllBytes($exePath)
    $str = [System.Text.Encoding]::UTF8.GetString($buf)
    if ($str -match "index-[a-zA-Z0-9_-]+[.]js") {
        $matches = [regex]::Matches($str, "index-[a-zA-Z0-9_-]+[.]js")
        $unique = $matches.Value | Sort-Object -Unique
        log "Embedded bundles: $($unique -join ', ')"
    }
    if ($str.Contains("<!DOCTYPE") -or $str.Contains("<html")) {
        log "HTML shell embedded: yes"
    }

    log "All checks passed." -Level INFO
    log "Next: Run pr-push.ps1 to push to origin"

} finally {
    Pop-Location
}
