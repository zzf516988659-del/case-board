/**
 * React Error Boundary — 捕获子组件 render 阶段抛错,
 * 显示 fallback UI 而不是让整个 React tree 卸载 → 整个 webview 空白。
 *
 * 2026-06-23:为 v0.3.26 PR #18 独立窗口(DetachedChatWindow)Windows 平台挂死
 * 临时加防御性 ErrorBoundary。即使根因还没找到,至少保证:
 *  1. 任何 React render 抛错 → 显示明确错误,不再空白
 *  2. X 关闭按钮始终响应(ErrorBoundary 自身不在 render 链上)
 *  3. 错误细节写 console-tap ring buffer,方便反馈通道
 */
import React from "react";

interface Props {
  children: React.ReactNode;
  /** fallback 标题,方便用户知道是哪个组件挂的 */
  scope: string;
  /** 自定义 fallback;默认是简单错误卡 + 「关窗口」按钮 */
  fallback?: (err: Error, info: React.ErrorInfo, retry: () => void) => React.ReactNode;
}

interface State {
  err: Error | null;
  info: React.ErrorInfo | null;
}

export class ChatWindowErrorBoundary extends React.Component<Props, State> {
  state: State = { err: null, info: null };

  static getDerivedStateFromError(err: Error): Partial<State> {
    return { err };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    // 写 console-tap ring buffer,反馈通道能拿到
    // 避免循环 import 这里直接 window.onerror fallback
    try {
      console.error("[ChatWindowErrorBoundary]", this.props.scope, err, info.componentStack);
    } catch { /* ignore */ }
    this.setState({ err, info });
  }

  retry = () => {
    this.setState({ err: null, info: null });
  };

  render() {
    const { err } = this.state;
    if (err) {
      if (this.props.fallback) {
        return this.props.fallback(err, this.state.info!, this.retry);
      }
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
          <div className="text-base font-semibold text-foreground">
            {this.props.scope} 加载失败
          </div>
          <div className="max-w-prose rounded border border-border bg-background/60 p-3 font-mono text-xs text-rose-600 dark:text-rose-400">
            {err.message || String(err)}
          </div>
          <div className="text-xs text-muted-foreground">
            请关掉这个独立窗口,回到主窗口侧栏继续工作。
          </div>
          <button
            type="button"
            onClick={this.retry}
            className="rounded border border-border bg-background px-3 py-1.5 text-xs hover:bg-accent"
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
