/**
 * 在线立案运行环境:体检 + 一键安装(实时进度)。
 *
 * - 进面板自动检测一次,组件清单(Python / playwright / ddddocr / httpx / Chromium / CLI)逐项打勾。
 * - 缺依赖 → 点「检测并安装」:后端建独立 venv、pip 装依赖、下 Chromium,
 *   全程 `court-filing-env-progress` 事件流回,这里按步骤实时显示进度 + 滚动日志。
 * - 连 Python 都没有 → 给「下载 Python」入口(装完重启 App 再检测)。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Download,
  RefreshCw,
  Wrench,
} from "lucide-react";

import { courtFilingEnvCheck, courtFilingEnvInstall, openUrl } from "@/lib/api";
import type { CourtFilingEnvReport, CourtFilingEnvProgress } from "@/lib/types";
import { toast } from "@/components/ui/toast";

const PYTHON_DOWNLOAD = "https://www.python.org/downloads/";

// 安装步骤的固定顺序 + 中文标题(后端 emit 的 step 与之对应)。
const INSTALL_STEPS: { step: string; label: string }[] = [
  { step: "python", label: "检测 Python 运行时" },
  { step: "venv", label: "创建独立运行环境" },
  { step: "deps", label: "安装依赖库(playwright / ddddocr / httpx)" },
  { step: "chromium", label: "下载 Chromium 浏览器内核(约 130MB)" },
  { step: "verify", label: "校验所有组件" },
];

type StepStatus = "pending" | "running" | "done" | "error";

interface StepState {
  status: StepStatus;
  detail?: string;
  log?: string;
}

export function CourtFilingEnvPanel({ onReady }: { onReady?: () => void }) {
  const [report, setReport] = useState<CourtFilingEnvReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [steps, setSteps] = useState<Record<string, StepState>>({});
  const installingRef = useRef(false);

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      const r = await courtFilingEnvCheck();
      setReport(r);
      if (r.ok) onReady?.();
    } catch (e) {
      setReport({
        ok: false,
        components: [],
        missing: [],
        python_found: false,
        error: String(e),
      });
    } finally {
      setChecking(false);
    }
  }, [onReady]);

  // 进面板自动检测一次
  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  // 监听安装进度
  useEffect(() => {
    const un = listen<CourtFilingEnvProgress>("court-filing-env-progress", (e) => {
      if (!installingRef.current) return;
      const p = e.payload;
      setSteps((prev) => ({
        ...prev,
        [p.step]: {
          status: p.status as StepStatus,
          // running 时只更日志,保留上一次 detail;done/error 用事件 detail
          detail: p.status === "running" ? prev[p.step]?.detail : p.detail,
          log: p.log ?? (p.status === "running" ? prev[p.step]?.log : undefined),
        },
      }));
    });
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  async function handleInstall() {
    // 初始化步骤为 pending
    const init: Record<string, StepState> = {};
    for (const s of INSTALL_STEPS) init[s.step] = { status: "pending" };
    setSteps(init);
    setInstalling(true);
    installingRef.current = true;
    try {
      const r = await courtFilingEnvInstall();
      setReport(r);
      if (r.ok) {
        toast("在线立案环境已就绪 ✅", "info");
        onReady?.();
      } else if (r.missing.length > 0) {
        toast(`仍缺少:${r.missing.join("、")}`, "error");
      }
    } catch (e) {
      toast(`安装失败:${e}`, "error");
    } finally {
      setInstalling(false);
      installingRef.current = false;
    }
  }

  const pythonMissing = report && !report.python_found;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
          <Wrench className="size-4" /> 运行环境
        </p>
        <button
          type="button"
          onClick={() => void runCheck()}
          disabled={checking || installing}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          {checking ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          重新检测
        </button>
      </div>

      {/* 组件清单 */}
      {report && report.components.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-1.5 font-medium">组件</th>
                <th className="px-3 py-1.5 font-medium">版本</th>
                <th className="px-3 py-1.5 text-right font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {report.components.map((c) => (
                <tr key={c.id || c.name} className="border-t border-border">
                  <td className="px-3 py-1.5 text-foreground">{c.name}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{c.version}</td>
                  <td className="px-3 py-1.5 text-right">
                    {c.ok ? (
                      <CheckCircle2 className="ml-auto size-4 text-green-600" />
                    ) : (
                      <XCircle className="ml-auto size-4 text-red-500" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 总体状态 */}
      {report && !installing && (
        <>
          {report.ok ? (
            <div className="flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              <CheckCircle2 className="size-4" /> 环境已就绪,可以去案件详情页发起在线立案。
            </div>
          ) : pythonMissing ? (
            <div className="space-y-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <p>未检测到 Python。在线立案需要本机 Python 3.11+。</p>
              <p className="text-[12px] text-red-600/90">
                Windows 安装时务必勾选 “Add Python to PATH”;装完<b>重启本 App</b> 再点「重新检测」。
              </p>
              <button
                type="button"
                onClick={() => void openUrl(PYTHON_DOWNLOAD)}
                className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700"
              >
                <Download className="size-3.5" /> 下载 Python
              </button>
            </div>
          ) : (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              缺少:{report.missing.join("、") || "部分依赖"}。点下面「检测并安装」一键装好(走国内镜像,约 1-3 分钟,取决于网速)。
            </div>
          )}
          {report.error && !pythonMissing ? (
            <p className="text-xs text-red-600">{report.error}</p>
          ) : null}
        </>
      )}

      {/* 安装进度 */}
      {(installing || Object.keys(steps).length > 0) && (
        <div className="space-y-1.5 rounded-lg border border-border bg-card px-3 py-2.5">
          {INSTALL_STEPS.map(({ step, label }) => {
            const st = steps[step]?.status ?? "pending";
            const log = steps[step]?.log;
            const detail = steps[step]?.detail;
            return (
              <div key={step} className="text-[13px]">
                <div className="flex items-center gap-2">
                  <StepIcon status={st} />
                  <span className={st === "pending" ? "text-muted-foreground" : "text-foreground"}>
                    {label}
                  </span>
                  {detail ? <span className="text-xs text-muted-foreground">· {detail}</span> : null}
                </div>
                {st === "running" && log ? (
                  <p className="ml-6 mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={log}>
                    {log}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* 安装按钮 */}
      {!report?.ok && !pythonMissing && (
        <button
          type="button"
          onClick={() => void handleInstall()}
          disabled={installing || checking}
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
        >
          {installing ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
          {installing ? "正在安装…" : "检测并安装"}
        </button>
      )}
    </div>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") return <CheckCircle2 className="size-4 shrink-0 text-green-600" />;
  if (status === "error") return <XCircle className="size-4 shrink-0 text-red-500" />;
  if (status === "running") return <Loader2 className="size-4 shrink-0 animate-spin text-sky-600" />;
  return <span className="ml-0.5 size-3 shrink-0 rounded-full border border-muted-foreground/40" />;
}
