/**
 * DetachedChatWindow — 2026-06-23 PR #25 fallback
 *
 * 这个组件仍然存在,作为 `?window=chat&...` URL 的入口。
 *
 * 2026-06-23:Windows 上 WebView2 跨 webview 进程渲染 React 有深层 bug(连
 * hello world 都空白),独立 webview 方案彻底走不通。我们改用主窗口内
 * 全屏覆盖层替代(见 CaseChatPanel 的 `poppedOut` state)。
 *
 * 这个独立 webview 现在不应该再被打开(Rust 端 `detach_chat_window`
 * 仍保留命令但前端已不调用)。如果用户拿到老版本 .exe 或第三方插件
 * 直接打开 `?window=chat&...`,这里显示一个明确提示 + 关闭按钮兜底。
 *
 * macOS / Linux 用户:理论上 CaseChatPanel 的 `detached` prop 仍能
 * 走原独立窗口路径(见 CaseChatPanel 顶部注释)。这个 fallback 也适用
 * 那些不小心触发了 detached 路径的场景。
 */
import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { X } from "lucide-react";

export function DetachedChatWindow({
  caseId,
  caseName,
  domain: _domain,
}: {
  caseId: string | null;
  caseName?: string | null;
  domain?: "civil" | "criminal";
}) {
  // 自动把 case 信息塞进 document.title,方便用户从任务栏/Alt-Tab 辨认这是哪个案件。
  useEffect(() => {
    if (caseName) document.title = `案件 AI 助手 · ${caseName} (请改用主窗口全屏模式)`;
    else document.title = "案件 AI 助手 · (请改用主窗口全屏模式)";
  }, [caseName]);

  return (
    <div
      data-testid="detached-chat-fallback"
      className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center text-slate-700 dark:bg-slate-950 dark:text-slate-200"
    >
      <div className="rounded-full bg-amber-100 p-3 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
        <X className="size-6" />
      </div>
      <h1 className="text-xl font-semibold">独立 AI 助手窗口暂不可用</h1>
      <p className="max-w-md text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        在当前平台上,独立窗口里的 React 渲染存在兼容性问题(2026-06-23 排查确认)。
        请关闭此窗口,在主窗口内使用 AI 助手右上角的
        <span className="mx-1 inline-flex items-center rounded border border-slate-300 px-1.5 py-0.5 align-middle font-mono text-xs dark:border-slate-700">
          ↗ 全屏模式
        </span>
        按钮(同样的聊天 UI,铺满主窗口)。
      </p>
      {caseName && (
        <p className="text-xs text-slate-500 dark:text-slate-500">
          案件:{caseName}
          {caseId && <span className="ml-2 font-mono opacity-60">({caseId})</span>}
        </p>
      )}
      <button
        type="button"
        onClick={() => getCurrentWindow().close()}
        className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
      >
        <X className="size-4" />
        关闭此窗口
      </button>
    </div>
  );
}