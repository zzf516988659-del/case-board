"""在线立案运行环境体检 —— 输出组件清单(供 CaseBoard 渲染 / 命令行直接看)。

用法:
    python -m court_filing_cli.env_check          # 人类可读表格
    python -m court_filing_cli.env_check --json    # 机器可读 JSON(CaseBoard 用)

设计:只用标准库做顶层 import;第三方依赖一律在函数内 try 进口,缺了也不崩,
体检本身永远能跑出报告(缺哪个就标 ❌)。
"""

from __future__ import annotations

import json
import platform
import sys
from importlib import import_module

# 体检要查的第三方组件(import 名, 显示名)。
# numpy / onnxruntime / opencv 是 ddddocr 的间接依赖,一并显示让用户安心
# (对齐 pip 实际装出来的清单)。
_PACKAGES = [
    ("playwright", "playwright"),
    ("ddddocr", "ddddocr"),
    ("httpx", "httpx"),
    ("numpy", "numpy"),
    ("onnxruntime", "onnxruntime"),
    ("cv2", "opencv-python"),
]

# court_filing_cli 真正会 import 的内部模块(缺依赖时这些会失败)。
_CLI_MODULES = [
    "court_filing_cli.cli",
    "court_filing_cli.runner",
    "court_filing_cli.browser",
    "court_filing_cli.captcha_recognizer",
    "court_filing_cli.sites.court_zxfw",
]


def _pkg_version(mod_name: str) -> str | None:
    """返回包版本字符串;未安装返回 None。"""
    try:
        mod = import_module(mod_name)
    except Exception:
        return None
    for attr in ("__version__", "version", "VERSION"):
        v = getattr(mod, attr, None)
        if isinstance(v, str) and v:
            return v
    # 退而求其次:importlib.metadata
    try:
        from importlib.metadata import version as _v

        return _v(mod_name)
    except Exception:
        return "已安装"


def _chromium_status() -> bool:
    """Chromium 浏览器内核是否已 `playwright install`(只查可执行文件,不启动浏览器)。"""
    try:
        import os

        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            exe = p.chromium.executable_path
        return bool(exe and os.path.exists(exe))
    except Exception:
        return False


def collect() -> dict:
    components: list[dict] = []
    missing: list[str] = []

    # Python 本身
    pyver = platform.python_version()
    py_ok = sys.version_info >= (3, 11)
    components.append({"name": "Python", "id": "python", "version": pyver, "ok": py_ok})
    if not py_ok:
        missing.append("python")

    # 第三方包
    for mod_name, display in _PACKAGES:
        ver = _pkg_version(mod_name)
        ok = ver is not None
        components.append(
            {"name": display, "id": display, "version": ver or "未安装", "ok": ok}
        )
        if not ok:
            missing.append(display)

    # Chromium 内核
    chr_ok = _chromium_status()
    components.append(
        {"name": "Chromium 内核", "id": "chromium", "version": "已安装" if chr_ok else "未安装", "ok": chr_ok}
    )
    if not chr_ok:
        missing.append("chromium")

    # court_filing_cli 全部模块可 import
    cli_ok = True
    cli_note = "全部模块 import"
    for m in _CLI_MODULES:
        try:
            import_module(m)
        except Exception as e:  # noqa: BLE001
            cli_ok = False
            cli_note = f"{m} 失败: {e}"
            break
    components.append({"name": "court_filing_cli", "id": "cli", "version": cli_note, "ok": cli_ok})
    if not cli_ok:
        missing.append("cli")

    return {"ok": len(missing) == 0, "components": components, "missing": missing}


def _print_table(report: dict) -> None:
    print(f"{'组件':<22}{'版本':<30}{'状态'}")
    print("-" * 58)
    for c in report["components"]:
        mark = "✅" if c["ok"] else "❌"
        print(f"{c['name']:<22}{str(c['version']):<30}{mark}")
    print("-" * 58)
    print("100% 就绪 ✅" if report["ok"] else f"缺少: {', '.join(report['missing'])} ❌")


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    report = collect()
    if "--json" in argv:
        print(json.dumps(report, ensure_ascii=False))
    else:
        _print_table(report)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
