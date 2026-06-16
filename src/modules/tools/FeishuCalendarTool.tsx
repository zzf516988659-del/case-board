/**
 * 飞书日历配置(整合外部贡献 PR #9,gcheng-001;2026-06-17)。
 *
 * 在这里打开「飞书日历」并填配置;开启且连接成功后,首页会用飞书月历替代本地「日程日历」卡。
 * 复用本机 lark-cli 的登录态,CaseBoard **不保存飞书 token**。
 *
 * 依赖(诚实标明,装不上属正常):
 *   1. 本机装好飞书官方 `lark-cli` 并 `lark-cli login`(macOS / Windows / Linux 都有);
 *   2. (可选)飞书"案件池"多维表格,用于点日历事件反查并导入本地案件目录。
 */
import { useEffect, useState } from "react";
import {
  CalendarClock,
  Loader2,
  Save,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

import { getSettings, saveSettings, fetchFeishuCalendar } from "@/lib/api";
import type { Settings } from "@/lib/types";
import { toast } from "@/components/ui/toast";

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function FeishuCalendarTool() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [larkPath, setLarkPath] = useState("");
  const [appToken, setAppToken] = useState("");
  const [tableId, setTableId] = useState("");
  const [poolOpen, setPoolOpen] = useState(false);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s);
        setEnabled(s.feishu_enabled === true);
        setLarkPath(s.feishu_lark_cli_path ?? "");
        setAppToken(s.feishu_app_token ?? "");
        setTableId(s.feishu_cases_table_id ?? "");
        if ((s.feishu_app_token ?? "").trim() || (s.feishu_cases_table_id ?? "").trim()) {
          setPoolOpen(true);
        }
      })
      .catch(() => {});
  }, []);

  const markDirty = () => setDirty(true);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const next: Settings = {
        ...settings,
        feishu_enabled: enabled,
        feishu_lark_cli_path: larkPath.trim() || null,
        feishu_app_token: appToken.trim() || null,
        feishu_cases_table_id: tableId.trim() || null,
      };
      await saveSettings(next);
      setSettings(next);
      setDirty(false);
      toast("飞书日历配置已保存", "info");
    } catch (e) {
      toast(`保存失败:${e}`, "error");
    } finally {
      setSaving(false);
    }
  };

  // 测试连接:先存当前配置,再拉今天的飞书日历(透传真实错误,守坑#8)。
  const handleTest = async () => {
    setTesting(true);
    setTestOk(null);
    setTestMsg(null);
    try {
      if (settings) {
        const next: Settings = {
          ...settings,
          feishu_enabled: true,
          feishu_lark_cli_path: larkPath.trim() || null,
          feishu_app_token: appToken.trim() || null,
          feishu_cases_table_id: tableId.trim() || null,
        };
        await saveSettings(next);
        setSettings(next);
        setEnabled(true);
        setDirty(false);
      }
      const today = todayISO();
      const events = await fetchFeishuCalendar(today, today);
      setTestOk(true);
      setTestMsg(`连接成功 · 今天有 ${events.length} 个日程`);
    } catch (e) {
      setTestOk(false);
      setTestMsg(String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* 标题 */}
      <div className="flex items-center gap-2">
        <CalendarClock className="size-5 text-foreground" />
        <h3 className="text-base font-semibold text-foreground">飞书日历</h3>
      </div>

      {/* 依赖说明(淡蓝,诚实标明门槛) */}
      <div className="rounded-lg bg-sky-50 px-4 py-3 text-sm text-slate-700">
        <p className="font-medium text-slate-800">用前先准备:</p>
        <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed">
          <li>
            本机安装飞书官方 <code className="rounded bg-white px-1">lark-cli</code> 并登录
            (<code className="rounded bg-white px-1">lark-cli login</code>);CaseBoard 只复用它的登录态,不保存你的飞书 token。
          </li>
          <li>
            macOS 自动找 Homebrew 路径;<b>Windows / Linux</b> 需把 lark-cli 加入系统 PATH,
            或在下方填它的<b>完整路径</b>。
          </li>
          <li>
            日历数据来自你<b>飞书日历应用</b>里的日程。开启并测试成功后,首页会用飞书月历
            替代本地「日程日历」卡片。
          </li>
        </ol>
      </div>

      {/* 总开关 */}
      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            markDirty();
          }}
          className="size-4"
        />
        <div>
          <p className="text-sm font-medium text-foreground">启用飞书日历</p>
          <p className="text-xs text-muted-foreground">开启后首页显示飞书月历(蓝点=飞书日程 / 黄点=案件节点)</p>
        </div>
      </label>

      {/* lark-cli 路径(可选) */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">
          lark-cli 路径 <span className="text-muted-foreground">(可选)</span>
        </label>
        <input
          type="text"
          value={larkPath}
          onChange={(e) => {
            setLarkPath(e.target.value);
            markDirty();
          }}
          placeholder="留空 = 自动查找。Windows 示例:C:\\Tools\\lark-cli.exe"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
        />
      </div>

      {/* 案件池配置(可选折叠) */}
      <div className="rounded-lg border border-border">
        <button
          type="button"
          onClick={() => setPoolOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-foreground"
        >
          {poolOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          案件池多维表格 <span className="text-xs font-normal text-muted-foreground">(可选 · 点日历事件一键导入对应案件)</span>
        </button>
        {poolOpen && (
          <div className="space-y-3 border-t border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">
              在飞书多维表格里建一张"案件池"表,含「案件名称」「本地路径」两列。配好后,
              点首页飞书日历的事件可按标题反查本地案件目录并一键导入。不配则只展示日历、不影响。
            </p>
            <div className="space-y-1.5">
              <label className="text-sm text-foreground">App Token</label>
              <input
                type="text"
                value={appToken}
                onChange={(e) => {
                  setAppToken(e.target.value);
                  markDirty();
                }}
                placeholder="bascn... / 多维表格 URL 里的 app_token"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-foreground">Table ID</label>
              <input
                type="text"
                value={tableId}
                onChange={(e) => {
                  setTableId(e.target.value);
                  markDirty();
                }}
                placeholder="tbl... / 多维表格 URL 里的 table_id"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
              />
            </div>
          </div>
        )}
      </div>

      {/* 测试结果 */}
      {testMsg && (
        <div
          className={
            testOk
              ? "flex items-start gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
              : "flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          }
        >
          {testOk ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          )}
          <span className="break-all">{testMsg}</span>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing || saving}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          {testing ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />}
          测试连接
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || testing || !dirty}
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          保存配置
        </button>
        {dirty && <span className="text-xs text-muted-foreground">有未保存改动</span>}
      </div>
    </div>
  );
}
