#!/bin/bash
# CaseBoard release builder · 2026-05-24 e
#
# 一键产出 macOS dmg 安装包,并打开 Finder 显示位置(方便上传)。
#
# 用法:
#   bash scripts/release.sh
#
# 前置:
#   - 已在 ~/.cargo/bin 装好 cargo / 已在 PATH
#   - 已 pnpm install(node_modules 完整)
#
# 产出:
#   src-tauri/target/release/bundle/dmg/案件看板_<version>_<arch>.dmg

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# 读 package.json 的 version
VERSION=$(node -p "require('./package.json').version")
ARCH=$(uname -m)
# arm64 → aarch64;Tauri 用 aarch64 命名
if [ "$ARCH" = "arm64" ]; then ARCH="aarch64"; fi

echo "════════════════════════════════════════════════════════"
echo "  CaseBoard release · v${VERSION} · ${ARCH}"
echo "════════════════════════════════════════════════════════"
echo

# 1. 前端构建 (Tauri build 会自动跑 beforeBuildCommand,所以这步可省;留作显式)
echo "▶ Step 1/2: 前端构建 (pnpm build)"
pnpm build
echo

# 2. Tauri 构建(签名/dmg/app)
echo "▶ Step 2/2: Tauri 构建 (pnpm tauri build --bundles app,dmg)"
echo "    (首次约 5-10 分钟,后续 1-2 分钟。期间不会弹窗,可放心等)"
# 注入匿名遥测配置(telemetry/.env.telemetry 为 gitignored;key 进 dmg 但不进 git)。
# 缺文件时 option_env! 取不到 → 遥测在该 dmg 里自动禁用,不报错。
if [ -f telemetry/.env.telemetry ]; then
  # shellcheck disable=SC1091
  . telemetry/.env.telemetry
  echo "    ✓ 已注入遥测配置(CASEBOARD_TELEMETRY_URL/KEY)"
else
  echo "    ⚠️ 未找到 telemetry/.env.telemetry —— 本次 dmg 不含遥测"
fi
pnpm tauri build --bundles app,dmg

# 找产出
# 注意:本项目是 cargo workspace,target 目录在仓库根而不是 src-tauri/target
DMG_PATH="target/release/bundle/dmg/案件看板_${VERSION}_${ARCH}.dmg"
APP_PATH="target/release/bundle/macos/案件看板.app"

# 3. 后处理:往 dmg 里塞「请先阅读.txt」+ AppleScript 设置窗口布局
# 原因:macOS 15.1+ 苹果封死「右键 → 打开」绕过 ad-hoc 签名的路径,
# 用户必须走「系统设置 → 隐私与安全 → 仍要打开」。
# 早期试过 .command 脚本调 xattr,但 quarantine 后 Terminal 行为不稳定,
# 改用纯文本指引 + AppleScript 把指引放在 dmg 窗口顶部最显眼位置。
if [ -f "$DMG_PATH" ]; then
  echo
  echo "▶ Step 3/3: 嵌入「请先阅读.txt」+ 设置 dmg 窗口布局"
  WRITABLE_DMG="target/release/bundle/dmg/_writable.dmg"
  VOLNAME="案件看板"
  README="scripts/请先阅读.txt"

  hdiutil detach "/Volumes/$VOLNAME" 2>/dev/null || true
  rm -f "$WRITABLE_DMG"

  hdiutil convert "$DMG_PATH" -format UDRW -o "$WRITABLE_DMG" -ov -quiet
  hdiutil attach "$WRITABLE_DMG" -quiet
  sleep 2

  VOL="/Volumes/$VOLNAME"
  rm -f "$VOL/.DS_Store"
  cp "$README" "$VOL/请先阅读.txt"
  # 2026-05-25 V0.1.10 删:之前塞过 安装助手.command,但 macOS 15.1+ 也会拦 .command(同 quarantine),
  # 用户照样打不开。改成「请先阅读.txt」主推一行终端命令,更稳。

  osascript <<APPLESCRIPT
tell application "Finder"
    tell disk "$VOLNAME"
        open
        delay 1
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        set the bounds of container window to {400, 120, 1120, 600}
        set viewOptions to the icon view options of container window
        set arrangement of viewOptions to not arranged
        set icon size of viewOptions to 96
        set text size of viewOptions to 14
        set label position of viewOptions to bottom
        set position of item "请先阅读.txt" of container window to {360, 100}
        set position of item "案件看板.app" of container window to {175, 280}
        set position of item "Applications" of container window to {545, 280}
        update without registering applications
        delay 2
        close
    end tell
end tell
APPLESCRIPT

  sleep 2
  sync
  hdiutil detach "$VOL" -quiet
  rm "$DMG_PATH"
  hdiutil convert "$WRITABLE_DMG" -format UDZO -imagekey zlib-level=9 -o "$DMG_PATH" -quiet
  rm "$WRITABLE_DMG"
  echo "  ✓ 请先阅读.txt + 窗口布局已嵌入"
fi

echo
echo "════════════════════════════════════════════════════════"
if [ -f "$DMG_PATH" ]; then
  SIZE=$(du -sh "$DMG_PATH" | cut -f1)
  echo "  ✅ DMG 产出成功"
  echo "  位置: $DMG_PATH"
  echo "  大小: $SIZE"
  echo
  echo "  下一步(自行分发):"
  echo "    1. 把 dmg 上传到你的分发渠道(对象存储 / 自有站点等)"
  echo "    2. (可选)在 GitHub 推 tag v${VERSION},发 Release"
  echo "    3. 提示:未签名 dmg 在 macOS 15.1+ 需用户跑 xattr -cr,见 scripts/请先阅读.txt"
  open -R "$DMG_PATH"
else
  echo "  ❌ DMG 未找到,可能在别的路径(检查 build 日志)"
  echo "  期望位置: $DMG_PATH"
  ls -la "src-tauri/target/release/bundle/dmg/" 2>/dev/null || echo "  bundle/dmg 目录不存在"
  exit 1
fi
echo "════════════════════════════════════════════════════════"
