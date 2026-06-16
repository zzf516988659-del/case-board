// 滴答清单双向同步面板(公开功能)。设置页用它做连接管理 + 待办增删改。
//
// 「我的待办镜像」:维护一份滴答某清单(默认收件箱)的本地镜像,完整双向、带完成状态,
// 不碰案件待办。cutoff:首次同步建基线,只拉取之后新建的远端任务。
import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  RefreshCw,
  Plug,
  Unplug,
  Plus,
  Trash2,
  CheckCircle2,
  Circle,
  Smartphone,
  ArrowLeftRight,
} from "lucide-react";
import { openUrl } from "@/lib/api";
import {
  ttStatus,
  ttConnectToken,
  ttDisconnect,
  ttListProjects,
  ttSetProject,
  ttClearProject,
  ttSetAutoSync,
  ttSyncNow,
  ttListItems,
  ttAddItem,
  ttToggleItem,
  ttDeleteItem,
  type TickTickStatus,
  type TickTickItem,
  type TickTickProject,
  type SyncReport,
} from "@/lib/ticktickApi";

const fmt = (ms: number) => (ms > 0 ? new Date(ms).toLocaleString("zh-CN") : "—");

export function TickTickPanel() {
  const [status, setStatus] = useState<TickTickStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void refreshStatus();
    return () => {
      mounted.current = false;
    };
  }, []);

  async function refreshStatus() {
    try {
      const s = await ttStatus();
      if (mounted.current) setStatus(s);
    } catch (e) {
      if (mounted.current) setErr(String(e));
    }
  }

  if (!status) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> 读取滴答清单状态…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-foreground">滴答清单(双向同步)</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          在这里维护一份滴答清单的镜像,完整双向 · 勾完成两边同步。
          <b className="text-foreground">只同步「连接之后」新建/改动的任务</b>,手机里的历史积压不会被一锅端进来。
        </p>
      </div>

      {err && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {err}
        </div>
      )}

      {!status.connected ? (
        <ConnectForm
          onConnected={(s) => {
            setStatus(s);
            setErr(null);
          }}
          onError={setErr}
        />
      ) : (
        <ConnectedView status={status} onStatus={setStatus} onError={setErr} />
      )}
    </div>
  );
}

function ConnectForm({
  onConnected,
  onError,
}: {
  onConnected: (s: TickTickStatus) => void;
  onError: (e: string | null) => void;
}) {
  const [token, setToken] = useState("");
  const [server, setServer] = useState("dida365");
  const [connecting, setConnecting] = useState(false);

  async function connect() {
    if (!token.trim()) {
      onError("请先粘贴 API 口令");
      return;
    }
    setConnecting(true);
    onError(null);
    try {
      // 后端会用口令同步校验(只读拉清单),通过才落库 —— 无浏览器、无轮询。
      await ttConnectToken(token.trim(), server);
      onConnected(await ttStatus());
    } catch (e) {
      onError(String(e));
    } finally {
      setConnecting(false);
    }
  }

  const inputCls =
    "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-sky-400";

  return (
    <div className="space-y-4 rounded-lg border border-border bg-background/50 p-4">
      <p className="text-sm font-medium text-foreground">用「API 口令」连接你的滴答清单</p>

      {/* ① 怎么拿口令 */}
      <div className="space-y-1.5 rounded-md bg-sky-50 px-3 py-2.5 text-xs leading-relaxed text-sky-900">
        <p className="font-semibold">① 在滴答清单里生成 API 口令</p>
        <p>
          打开滴答清单(手机或电脑)→ <b>设置 → 账户与安全 → API 口令 → 添加新口令</b> → 复制那串
          <code className="mx-0.5 rounded bg-white px-1">dp_</code>开头的口令。
          <span className="text-sky-700">免费用户也能用,口令长期有效。</span>
        </p>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-sky-300 bg-white px-2 py-0.5 font-medium text-sky-700 hover:bg-sky-100"
          onClick={() => void openUrl("https://dida365.com/webapp/#settings/account")}
        >
          电脑端打开滴答清单设置 ↗
        </button>
        <img
          src="/ticktick-token-guide.png"
          alt="滴答清单 设置 → 账户与安全 → API 口令 示意图"
          className="mt-1.5 w-full rounded-md border border-sky-200"
          loading="lazy"
        />
      </div>

      {/* ② 粘贴口令 */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">② 把口令粘贴到这里</label>
        <input
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void connect()}
          placeholder="dp_xxxxxxxxxxxxxxxx"
          className="w-full rounded-md border border-sky-300 bg-background px-3 py-2 font-mono text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-200"
          autoComplete="off"
          spellCheck={false}
          disabled={connecting}
        />
      </div>

      {/* 服务器(默认国内滴答,极少人改) */}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">服务器:{server === "ticktick" ? "TickTick(国际版)" : "滴答清单(国内)"} · 点此切换</summary>
        <select
          value={server}
          onChange={(e) => setServer(e.target.value)}
          className={`mt-1.5 ${inputCls}`}
          disabled={connecting}
        >
          <option value="dida365">滴答清单(国内 · dida365)</option>
          <option value="ticktick">TickTick(国际版 · ticktick.com)</option>
        </select>
      </details>

      <button
        type="button"
        onClick={() => void connect()}
        disabled={connecting || !token.trim()}
        className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
      >
        {connecting ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
        {connecting ? "验证中…" : "连接滴答清单"}
      </button>
    </div>
  );
}

function ConnectedView({
  status,
  onStatus,
  onError,
}: {
  status: TickTickStatus;
  onStatus: (s: TickTickStatus) => void;
  onError: (e: string | null) => void;
}) {
  const [projects, setProjects] = useState<TickTickProject[] | null>(null);
  const [items, setItems] = useState<TickTickItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newDue, setNewDue] = useState("");

  useEffect(() => {
    if (status.projectId) void reloadItems();
    if (!status.projectId) void loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.projectId]);

  async function loadProjects() {
    try {
      setProjects(await ttListProjects());
    } catch (e) {
      onError(String(e));
    }
  }

  async function reloadItems() {
    try {
      setItems(await ttListItems());
    } catch (e) {
      onError(String(e));
    }
  }

  async function chooseProject(p: TickTickProject) {
    try {
      await ttSetProject(p.id, p.name);
      onError(null);
      onStatus(await ttStatus());
    } catch (e) {
      onError(String(e));
    }
  }

  async function sync() {
    setSyncing(true);
    onError(null);
    try {
      const r = await ttSyncNow();
      setReport(r);
      if (r.errors.length) onError(r.errors.join("; "));
      await reloadItems();
      onStatus(await ttStatus());
    } catch (e) {
      onError(String(e));
    } finally {
      setSyncing(false);
    }
  }

  async function add() {
    if (!newTitle.trim()) return;
    try {
      await ttAddItem(newTitle.trim(), newDue || null);
      setNewTitle("");
      setNewDue("");
      await reloadItems();
    } catch (e) {
      onError(String(e));
    }
  }

  async function toggle(it: TickTickItem) {
    try {
      await ttToggleItem(it.id, !it.done);
      await reloadItems();
    } catch (e) {
      onError(String(e));
    }
  }

  async function remove(it: TickTickItem) {
    try {
      await ttDeleteItem(it.id);
      await reloadItems();
    } catch (e) {
      onError(String(e));
    }
  }

  async function disconnect() {
    try {
      await ttDisconnect();
      onStatus(await ttStatus());
    } catch (e) {
      onError(String(e));
    }
  }

  async function changeProject() {
    try {
      await ttClearProject();
      onError(null);
      onStatus(await ttStatus());
    } catch (e) {
      onError(String(e));
    }
  }

  async function toggleAuto() {
    try {
      await ttSetAutoSync(!status.autoSync);
      onStatus(await ttStatus());
    } catch (e) {
      onError(String(e));
    }
  }

  // 已连接但未选清单
  if (!status.projectId) {
    return (
      <div className="space-y-3 rounded-lg border border-border bg-background/50 p-4">
        <p className="text-sm font-medium text-foreground">选择要镜像同步的清单</p>
        {projects === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> 读取清单列表…
          </div>
        ) : (
          <div className="space-y-1.5">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void chooseProject(p)}
                className="block w-full rounded-md border border-border bg-background px-3 py-2 text-left text-sm hover:border-sky-300 hover:bg-sky-50/60"
              >
                {p.name || "(未命名清单)"}
              </button>
            ))}
            {projects.length === 0 && (
              <p className="text-xs text-muted-foreground">没有清单,先去滴答清单 App 建一个。</p>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => void disconnect()}
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          断开重连
        </button>
      </div>
    );
  }

  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  return (
    <div className="space-y-3">
      {/* 状态条 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-background/50 px-3 py-2 text-xs">
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          <Smartphone className="size-3.5 text-sky-600" />
          {status.projectName || "清单"}
        </span>
        <button
          type="button"
          onClick={() => void changeProject()}
          title="换一个要同步的清单"
          className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 hover:bg-sky-100"
        >
          <ArrowLeftRight className="size-3.5" /> 切换清单
        </button>
        <span className="text-muted-foreground">同步起点 {fmt(status.cutoffMs)}</span>
        <span className="text-muted-foreground">上次同步 {fmt(status.lastSyncMs)}</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void sync()}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-2.5 py-1 font-medium text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {syncing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {syncing ? "同步中…" : "立即同步"}
          </button>
          <button
            type="button"
            onClick={() => void disconnect()}
            title="断开连接(想改用 API 口令 / 换账号就点这里,然后重新粘贴口令)"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-muted-foreground hover:border-red-300 hover:text-red-600"
          >
            <Unplug className="size-3.5" /> 断开
          </button>
        </div>
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={status.autoSync} onChange={() => void toggleAuto()} />
        自动同步(每分钟 + 切回 App 时)
      </label>

      {report && (
        <p className="text-xs text-muted-foreground">
          上次同步:拉入 {report.pulled} · 推出 {report.pushed} · 远端完成 {report.completedRemote} · 远端删除{" "}
          {report.deletedRemote}
          {report.errors.length > 0 && <span className="text-red-600"> · 错误 {report.errors.length}</span>}
        </p>
      )}

      {/* 新增 */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            placeholder="加一条待办(回车),下次同步推到手机"
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-sky-400"
          />
          <input
            type="date"
            value={newDue}
            onChange={(e) => setNewDue(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-sky-400"
          />
          <button
            type="button"
            onClick={() => void add()}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-sm hover:border-sky-300 hover:bg-sky-50/60"
          >
            <Plus className="size-4" /> 加
          </button>
        </div>
        <p className="text-caption text-muted-foreground">
          不选日期默认「今天」,这样在手机滴答的「今天」页就能看到(否则只会躺在收件箱里)。
        </p>
      </div>

      {/* 列表 */}
      <div className="space-y-1">
        {open.map((it) => (
          <ItemRow key={it.id} it={it} onToggle={toggle} onRemove={remove} />
        ))}
        {open.length === 0 && (
          <p className="px-1 py-2 text-xs text-muted-foreground">暂无未完成待办。</p>
        )}
      </div>

      {done.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">已完成 {done.length} 条</summary>
          <div className="mt-1 space-y-1">
            {done.map((it) => (
              <ItemRow key={it.id} it={it} onToggle={toggle} onRemove={remove} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function ItemRow({
  it,
  onToggle,
  onRemove,
}: {
  it: TickTickItem;
  onToggle: (it: TickTickItem) => void;
  onRemove: (it: TickTickItem) => void;
}) {
  return (
    <div className="group flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm">
      <button type="button" onClick={() => onToggle(it)} className="shrink-0">
        {it.done ? (
          <CheckCircle2 className="size-4 text-sky-600" />
        ) : (
          <Circle className="size-4 text-muted-foreground" />
        )}
      </button>
      <span className={it.done ? "flex-1 text-muted-foreground line-through" : "flex-1 text-foreground"}>
        {it.title}
      </span>
      {it.due && <span className="shrink-0 text-xs text-muted-foreground">{it.due.slice(0, 10)}</span>}
      {it.dirty && <span className="shrink-0 text-[10px] text-amber-600" title="待同步">●</span>}
      <button
        type="button"
        onClick={() => onRemove(it)}
        className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}
