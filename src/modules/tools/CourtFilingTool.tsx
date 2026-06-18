/**
 * 辅助在线立案 — 工具页配置 + 律师档案 + 引导(整合外部贡献 PR #8,gcheng-001;2026-06-17)。
 *
 * 这里只放「配置 + 律师档案 + 运行环境引导」。**实际发起立案在案件详情页**
 * (案件快照下方的「辅助在线立案」区,需要案件上下文)。
 *
 * ⚠️ 实验性功能:用 Playwright 驱动浏览器在「全国法院一张网」一路填到预览页**停住、不自动提交**,
 * 律师本人确认后手动提交。目前仅在 macOS 验证过;依赖本机 Python 运行时(不打包进安装包)。
 */
import { useEffect, useState } from "react";
import { Loader2, Save, AlertTriangle, Gavel } from "lucide-react";

import { getSettings, saveSettings } from "@/lib/api";
import type { Settings } from "@/lib/types";
import { toast } from "@/components/ui/toast";
import { LawyerProfilesCard } from "@/components/LawyerProfilesCard";
import { CourtFilingEnvPanel } from "./CourtFilingEnvPanel";

export function CourtFilingTool() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [cliPath, setCliPath] = useState("");
  const [python, setPython] = useState("");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [cookieDir, setCookieDir] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s);
        setCliPath(s.court_filing_cli_path ?? "");
        setPython(s.court_filing_python ?? "");
        setAccount(s.court_filing_account ?? "");
        setPassword(s.court_filing_password ?? "");
        setCookieDir(s.court_filing_cookie_dir ?? "");
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
        court_filing_cli_path: cliPath.trim() || null,
        court_filing_python: python.trim() || null,
        court_filing_account: account.trim() || null,
        court_filing_password: password.trim() || null,
        court_filing_cookie_dir: cookieDir.trim() || null,
      };
      await saveSettings(next);
      setSettings(next);
      setDirty(false);
      toast("立案配置已保存", "info");
    } catch (e) {
      toast(`保存失败:${e}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div className="flex items-center gap-2">
        <Gavel className="size-5 text-foreground" />
        <h3 className="text-base font-semibold text-foreground">辅助在线立案</h3>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
          实验性
        </span>
      </div>

      {/* 实验性 + 能力边界(诚实标明) */}
      <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1 text-[13px] leading-relaxed">
            <p>
              用 Playwright 驱动浏览器在「全国法院一张网」自动登录、选法院/案由、上传材料、填当事人,
              <b>一路填到预览页就停住、不会自动提交</b>;律师本人核对后手动点提交。
            </p>
            <p>目前<b>仅在 macOS 验证过</b>;法院页面改版可能导致流程失效。请把它当辅助、提交前务必人工核对。</p>
          </div>
        </div>
      </div>

      {/* 运行环境:体检 + 一键安装(Python 运行时不打包,需本机自备,这里帮你一键装好) */}
      <div className="rounded-lg bg-sky-50 px-4 py-3">
        <CourtFilingEnvPanel
          onReady={() => {
            // 安装成功后端会把 court_filing_python 写成 venv 路径;同步到本地 state +
            // 输入框,否则用户之后点「保存配置」会用旧的空值把它覆盖回去。
            getSettings()
              .then((s) => {
                setSettings(s);
                setPython(s.court_filing_python ?? "");
                setDirty(false);
              })
              .catch(() => {});
          }}
        />
      </div>

      {/* 立案配置 */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-foreground">一张网账号 / 运行配置</h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="一张网账号(手机号)">
            <input
              type="text"
              value={account}
              onChange={(e) => { setAccount(e.target.value); markDirty(); }}
              placeholder="登录全国法院一张网的手机号"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
            />
          </Field>
          <Field label="一张网密码">
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); markDirty(); }}
              placeholder="只存本机,不上传"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
            />
          </Field>
          <Field label="Python 解释器" hint="留空 = python3;Windows 填 python 或 venv 全路径">
            <input
              type="text"
              value={python}
              onChange={(e) => { setPython(e.target.value); markDirty(); }}
              placeholder="python3"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
            />
          </Field>
          <Field label="CLI 路径(可选)" hint="留空 = 用应用内置;仅调试外部版本时填">
            <input
              type="text"
              value={cliPath}
              onChange={(e) => { setCliPath(e.target.value); markDirty(); }}
              placeholder="留空使用内置 court_filing_cli"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
            />
          </Field>
          <Field label="Cookie 缓存目录(可选)" hint="留空 = 默认应用数据目录">
            <input
              type="text"
              value={cookieDir}
              onChange={(e) => { setCookieDir(e.target.value); markDirty(); }}
              placeholder="登录态缓存目录"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
            />
          </Field>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存配置
          </button>
          {dirty && <span className="text-xs text-muted-foreground">有未保存改动</span>}
        </div>
      </div>

      {/* 律师档案(发起立案时按需选代理律师) */}
      <div className="space-y-2 border-t border-border pt-5">
        <h4 className="text-sm font-semibold text-foreground">代理律师档案</h4>
        <p className="text-xs text-muted-foreground">
          维护代理律师信息(姓名/执业证号/律所/身份证号等),发起立案时勾选,自动填进当事人代理人栏。
        </p>
        <LawyerProfilesCard />
      </div>

      {/* 发起入口引导 */}
      <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        配好后,到<b className="text-foreground"> 诉讼看板 → 打开案件 → 案件详情页</b>,在案件快照下方的
        「辅助在线立案」区选立案材料文件夹 + 代理律师,发起立案。
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm text-foreground">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
