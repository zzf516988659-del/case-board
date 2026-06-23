/**
 * 案件 AI 助手的独立窗口(v2 — 2026-06-23 重写)。
 *
 * 背景:case-board v0.3.26 PR #18 引入的 DetachedChatWindow 在 Windows 上
 * 100% 复现空白 + 无法关闭,即便修了 db acquire_timeout / scroll rAF /
 * SqlitePool 等多个根因嫌疑仍不能解决。根因是 CaseChatPanel 的 detached
 * 模式在跨窗口 / 跨平台 / WebView2 同步渲染下有深层 bug。
 *
 * 策略:绕过 CaseChatPanel 的 detached 模式,重写一个**简化独立 UI**。
 * 只做最必要的事:拉 history、显示消息列表、输入框、发送、调 case_chat、
 * 监听 chat-stream-。不用 chatRunRegistry、forceRerender、useCallback
 * 重渲染链、useMemo 缓存等复杂 state。
 *
 * 数据:与主窗口共用同一份 SQLite chat_messages 表,实时同步。
 * 流式:独立 webview 监听 chat-stream-{messageId},不阻塞 JS 主线程。
 */
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Send, ArrowLeft, RefreshCw } from "lucide-react";
import { ChatWindowErrorBoundary } from "./ChatWindowErrorBoundary";

interface ChatMessage {
  id: number;
  case_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  created_at: string;
  tool_call_id?: string | null;
  tool_name?: string | null;
  tool_input?: string | null;
  reasoning?: string | null;
}

interface ChatStreamEvent {
  kind: "delta" | "reasoning" | "tool_call" | "tool_result" | "error" | "done";
  text?: string;
  reasoning?: string;
  tool_call_id?: string;
  tool_name?: string;
  tool_input?: string;
  tool_result?: string;
  error?: string;
}

export function DetachedChatWindow({
  caseId,
  caseName,
  domain = "civil",
}: {
  caseId: string | null;
  caseName?: string | null;
  domain?: "civil" | "criminal";
}) {
  return (
    <div className="flex h-screen w-screen flex-col bg-background">
      <ChatWindowErrorBoundary scope="独立 AI 助手窗口">
        {caseId ? (
          <DetachedChatInner caseId={caseId} caseName={caseName} domain={domain} />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-6 text-sm text-muted-foreground">
            请先在主窗口选一个案件,再打开独立 AI 助手。
          </div>
        )}
      </ChatWindowErrorBoundary>
    </div>
  );
}

function DetachedChatInner({
  caseId,
  caseName,
  domain,
}: {
  caseId: string;
  caseName?: string | null;
  domain: "civil" | "criminal";
}) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // 拉 history
  const refresh = async () => {
    if (!caseId) return;
    setLoading(true);
    try {
      const rows = await invoke<ChatMessage[]>("list_chat_history", {
        caseId,
        limit: null,
      });
      setHistory(rows || []);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // 监听主窗口关闭/重开事件,刷 history
    const focusHandler = () => {
      void refresh();
    };
    window.addEventListener("focus", focusHandler);
    return () => {
      window.removeEventListener("focus", focusHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  // 自动贴底(避免 layout thrashing:仅当接近底部 + 限制频率)
  useEffect(() => {
    if (!scrollerRef.current) return;
    const el = scrollerRef.current;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom < 100) {
      requestAnimationFrame(() => {
        if (scrollerRef.current) {
          scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
        }
      });
    }
  }, [history.length, streamingText, streamingReasoning]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    setError(null);
    setStreamingText("");
    setStreamingReasoning("");
    const tempUserMsg: ChatMessage = {
      id: -Date.now(),
      case_id: caseId,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setHistory((h) => [...h, tempUserMsg]);

    let unlisten: UnlistenFn | undefined;
    const messageId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      unlisten = await listen<ChatStreamEvent>(
        `chat-stream-${messageId}`,
        (e: { payload: ChatStreamEvent }) => {
          const p = e.payload;
          if (p.kind === "delta" && p.text) {
            setStreamingText((s) => s + p.text);
          } else if (p.kind === "reasoning" && p.reasoning) {
            setStreamingReasoning((s) => s + p.reasoning);
          } else if (p.kind === "error" && p.error) {
            setError(p.error);
          } else if (p.kind === "done") {
            setSending(false);
            void refresh();
            setStreamingText("");
            setStreamingReasoning("");
          }
        },
      );
      await invoke("case_chat", {
        caseId,
        messageId,
        message: text,
        domain,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      unlisten?.();
      setSending(false);
      void refresh();
    }
  };

  const reattach = async () => {
    try {
      await getCurrentWindow().close();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border bg-card/40 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            案件 AI 助手
          </span>
          {caseName && (
            <span className="truncate text-xs text-muted-foreground">· {caseName}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
            title="刷新聊天记录"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={reattach}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
            title="把 AI 助手重新停靠到案件页右侧"
          >
            <ArrowLeft className="size-3.5" />
            放回侧栏
          </button>
        </div>
      </header>

      {error && (
        <div className="border-b border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      <div
        ref={scrollerRef}
        className="flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm"
      >
        {loading && history.length === 0 && (
          <p className="py-10 text-center text-xs text-muted-foreground">
            读取聊天记录…
          </p>
        )}
        {!loading && history.length === 0 && !sending && (
          <div className="rounded-md border border-dashed border-border bg-background/40 px-3 py-4 text-xs text-muted-foreground">
            <p className="mb-2 font-medium text-foreground">你可以这样问当前案件:</p>
            <ul className="space-y-1">
              <li>· 这个案子的争议焦点是什么?</li>
              <li>· 帮我列出所有付款记录</li>
              <li>· 现有材料缺什么、对方可能怎么打?</li>
            </ul>
          </div>
        )}
        {history.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        {streamingReasoning && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs italic text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            推理中… {streamingReasoning.length} 字
          </div>
        )}
        {streamingText && (
          <MessageBubble
            msg={{
              id: 0,
              case_id: caseId,
              role: "assistant",
              content: streamingText,
              created_at: new Date().toISOString(),
            }}
          />
        )}
      </div>

      <div className="border-t border-border bg-card/40 p-2">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="问当前案件的问题… (Shift+Enter 换行,Enter 发送)"
            rows={2}
            disabled={sending}
            className="flex-1 resize-none rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-foreground/40 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={send}
            disabled={sending || !input.trim()}
            className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
          >
            <Send className="size-3.5" />
            发送
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
          isUser
            ? "bg-foreground/10 text-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        {msg.content}
      </div>
    </div>
  );
}
