/**
 * 合同起草工具(非诉 tab · 2026-06-18 · B1 起草 + B2 多轮修订/版本管理)。
 *
 * 三观四步法两段式 + 版本管理:
 *   ① 输入交易需求 + 我方立场 → ② AI 规划(判类型 + 结构大纲 + 引导式采集清单/追问)
 *   → 用户补全信息 → ③ 生成完整合同草案 → 导出 Word / 保存草案库 / 多轮修订 / 标记最终版。
 *
 * 后端命令见 contract_draft 模块 + db::contract_drafts(版本落库,挂 draft_id)。
 * 方法论借鉴 pa1nrui1/legal-skills(MIT,作者「小潘律师」);prompt/引擎本系统自建。错误真错透传(坑 #8)。
 */

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { save as dialogSave } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  BookMarked,
  FileSignature,
  FolderOpen,
  History,
  Lightbulb,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/lib/dialog";
import {
  addContractDraftVersion,
  addContractPreference,
  deleteContractDraft,
  deleteContractPreference,
  exportContractDraftDocx,
  generateContractDraft,
  listContractDraftVersions,
  listContractDrafts,
  listContractPreferences,
  markContractDraftFinal,
  planContractDraft,
  reviseContractDraft,
  revealInFinder,
  saveContractDraft,
  type ContractDraft,
  type ContractDraftPlan,
  type ContractDraftResult,
  type ContractDraftVersion,
  type ContractPreference,
} from "@/lib/api";

type Stance = "party_a" | "party_b" | "neutral";
type Step = "input" | "plan" | "draft";

const STANCE_OPTIONS: { id: Stance; label: string; hint: string }[] = [
  { id: "party_a", label: "我方代表甲方", hint: "条款倾向护甲方" },
  { id: "party_b", label: "我方代表乙方", hint: "条款倾向护乙方" },
  { id: "neutral", label: "中立平衡", hint: "双方公平、能落地" },
];

function stanceCn(s: string): string {
  return STANCE_OPTIONS.find((o) => o.id === s)?.label ?? "中立平衡";
}

function formatError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export function ContractDraftTool() {
  const [step, setStep] = useState<Step>("input");
  const [requirement, setRequirement] = useState("");
  const [stance, setStance] = useState<Stance>("neutral");
  const [typeHint, setTypeHint] = useState("");
  const [collected, setCollected] = useState("");

  const [plan, setPlan] = useState<ContractDraftPlan | null>(null);
  const [draft, setDraft] = useState<ContractDraftResult | null>(null);
  /** 当前预览/导出/修订基准的合同正文(初稿、所看版本或修订结果)。 */
  const [previewMd, setPreviewMd] = useState("");

  // B2 版本管理
  const [draftId, setDraftId] = useState<string | null>(null);
  const [versions, setVersions] = useState<ContractDraftVersion[]>([]);
  const [activeVersionNo, setActiveVersionNo] = useState<number | null>(null);
  const [reviseFeedback, setReviseFeedback] = useState("");
  const [drafts, setDrafts] = useState<ContractDraft[]>([]);

  // B3 起草偏好
  const [prefs, setPrefs] = useState<ContractPreference[]>([]);
  const [prefTopic, setPrefTopic] = useState("");
  const [prefText, setPrefText] = useState("");
  const [prefType, setPrefType] = useState("");

  const [busy, setBusy] = useState(false);
  const [busyMsg, setBusyMsg] = useState("");
  const [error, setError] = useState("");

  const loadLibrary = () => {
    listContractDrafts()
      .then(setDrafts)
      .catch(() => {});
  };
  const loadPrefs = () => {
    listContractPreferences()
      .then(setPrefs)
      .catch(() => {});
  };
  useEffect(() => {
    loadLibrary();
    loadPrefs();
  }, []);

  /** 组装与当前合同类型相关的已确认偏好(通用 + 类型匹配),供注入起草/修订提示。 */
  const relevantPrefsBlock = (): string => {
    const typeStr = (typeHint || plan?.contract_type || draft?.contract_type || "").trim();
    const hit = prefs.filter(
      (p) =>
        !p.contract_type.trim() ||
        (typeStr && (typeStr.includes(p.contract_type) || p.contract_type.includes(typeStr))),
    );
    if (!hit.length) return "";
    const lines = hit.map(
      (p) => `· ${p.topic ? `[${p.topic}] ` : ""}${p.preference}`,
    );
    return `\n\n【我已确认的起草偏好】(仅供条款取舍/谈判底线参考,不得降低法律强制性风险)\n${lines.join("\n")}`;
  };

  const addPref = async () => {
    if (!prefText.trim()) {
      setError("偏好内容不能为空。");
      return;
    }
    try {
      await addContractPreference(prefType.trim(), prefTopic.trim(), prefText.trim());
      setPrefTopic("");
      setPrefText("");
      setPrefType("");
      loadPrefs();
    } catch (e) {
      setError(formatError(e));
    }
  };

  const removePref = async (id: string) => {
    try {
      await deleteContractPreference(id);
      loadPrefs();
    } catch (e) {
      setError(formatError(e));
    }
  };

  const reloadVersions = async (id: string) => {
    const vs = await listContractDraftVersions(id);
    setVersions(vs);
    return vs;
  };

  const doPlan = async () => {
    if (!requirement.trim()) {
      setError("请先描述你要起草的交易/合同需求。");
      return;
    }
    setBusy(true);
    setBusyMsg("AI 分析需求、规划起草中…");
    setError("");
    try {
      const p = await planContractDraft(requirement, stance, typeHint);
      setPlan(p);
      const skeleton = [
        ...p.required_info.map(
          (f) => `【${f.field}】${f.required ? "(必填)" : "(建议)"}:`,
        ),
        ...(p.clarifying_questions.length
          ? ["", "— 需澄清 —", ...p.clarifying_questions.map((q) => `· ${q}:`)]
          : []),
      ].join("\n");
      setCollected(skeleton);
      setStep("plan");
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
      setBusyMsg("");
    }
  };

  const doGenerate = async () => {
    setBusy(true);
    setBusyMsg("AI 起草合同草案中(完整正文,可能稍久)…");
    setError("");
    try {
      const r = await generateContractDraft(
        requirement,
        stance,
        typeHint,
        collected + relevantPrefsBlock(),
      );
      setDraft(r);
      setPreviewMd(r.draft_md);
      setDraftId(null);
      setVersions([]);
      setActiveVersionNo(null);
      setStep("draft");
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
      setBusyMsg("");
    }
  };

  const doExport = async () => {
    const name = draft?.contract_name || draft?.contract_type || "合同草案";
    const suffix = activeVersionNo ? `-v${activeVersionNo}` : "";
    setError("");
    try {
      const savePath = await dialogSave({
        defaultPath: `${name}${suffix}-草案.docx`,
        filters: [{ name: "Word 文档", extensions: ["docx"] }],
      });
      if (!savePath) return;
      setBusy(true);
      setBusyMsg("导出 Word…");
      const written = await exportContractDraftDocx(previewMd, name, savePath);
      await revealInFinder(written).catch(() => {});
      setBusyMsg("✓ 已导出");
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  /** 确保草案已落库,返回 draftId。 */
  const ensureSaved = async (): Promise<string> => {
    if (draftId) return draftId;
    if (!draft) throw new Error("无草案可保存");
    const d = await saveContractDraft(
      draft.contract_name || draft.contract_type || "合同草案",
      draft.contract_type,
      stance,
      requirement,
      previewMd,
    );
    setDraftId(d.id);
    setActiveVersionNo(1);
    await reloadVersions(d.id);
    loadLibrary();
    return d.id;
  };

  const doSave = async () => {
    setBusy(true);
    setBusyMsg("保存到草案库…");
    setError("");
    try {
      await ensureSaved();
      setBusyMsg("✓ 已保存");
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  const doRevise = async () => {
    if (!reviseFeedback.trim()) {
      setError("请先填写本轮修订要求。");
      return;
    }
    setBusy(true);
    setBusyMsg("AI 修订中…");
    setError("");
    try {
      const id = await ensureSaved();
      const r = await reviseContractDraft(
        previewMd,
        reviseFeedback + relevantPrefsBlock(),
        stance,
      );
      const v = await addContractDraftVersion(
        id,
        "revision",
        activeVersionNo,
        reviseFeedback.trim().slice(0, 80),
        r.draft_md,
        r.change_summary,
      );
      setPreviewMd(r.draft_md);
      setActiveVersionNo(v.version_no);
      setDraft((prev) =>
        prev
          ? { ...prev, draft_md: r.draft_md, key_clauses: r.key_clauses, risks: r.risks }
          : prev,
      );
      setReviseFeedback("");
      await reloadVersions(id);
      setBusyMsg(`✓ 已生成 v${v.version_no}`);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  const viewVersion = (v: ContractDraftVersion) => {
    setPreviewMd(v.draft_md);
    setActiveVersionNo(v.version_no);
  };

  const doMarkFinal = async (v: ContractDraftVersion) => {
    if (!draftId) return;
    const ok = await confirmDialog(
      `确定把 v${v.version_no} 标记为最终版吗?\n\n这会把本草案状态置为「最终版」。`,
      { okLabel: "标记最终版" },
    );
    if (!ok) return;
    try {
      await markContractDraftFinal(draftId, v.id);
      await reloadVersions(draftId);
      loadLibrary();
    } catch (e) {
      setError(formatError(e));
    }
  };

  const openFromLibrary = async (d: ContractDraft) => {
    setError("");
    try {
      const vs = await reloadVersions(d.id);
      const latest = vs[vs.length - 1];
      setDraftId(d.id);
      setRequirement(d.requirement);
      setStance((d.stance as Stance) || "neutral");
      setTypeHint(d.contract_type);
      setDraft({
        contract_type: d.contract_type,
        contract_name: d.contract_name,
        draft_md: latest?.draft_md ?? "",
        key_clauses: [],
        risks: [],
        assumptions: [],
        missing_info: [],
      });
      setPreviewMd(latest?.draft_md ?? "");
      setActiveVersionNo(latest?.version_no ?? null);
      setStep("draft");
    } catch (e) {
      setError(formatError(e));
    }
  };

  const doDeleteDraft = async (d: ContractDraft) => {
    const ok = await confirmDialog(
      `删除草案「${d.contract_name}」及其全部 ${d.latest_version} 个版本?此操作不可恢复。`,
      { danger: true, okLabel: "删除" },
    );
    if (!ok) return;
    try {
      await deleteContractDraft(d.id);
      loadLibrary();
    } catch (e) {
      setError(formatError(e));
    }
  };

  const reset = () => {
    setStep("input");
    setPlan(null);
    setDraft(null);
    setPreviewMd("");
    setCollected("");
    setDraftId(null);
    setVersions([]);
    setActiveVersionNo(null);
    setReviseFeedback("");
    setError("");
    setBusyMsg("");
    loadLibrary();
  };

  return (
    <div className="space-y-5">
      <p className="rounded-md border border-sky-200/60 bg-sky-50/60 px-3 py-2 text-[11px] leading-relaxed text-sky-800 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300">
        起草思路(三观四步法 / 三点一线法结构)借鉴开源项目
        <span className="font-medium"> pa1nrui1/legal-skills</span>(作者「小潘律师」,MIT
        许可)。感谢分享 —— 本功能 prompt、引擎、导出均由本系统自建。生成内容为
        <span className="font-medium">工作草案</span>,签署前请律师/你本人核定。
      </p>

      {/* 第一步:需求输入 */}
      {step === "input" && (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">
              我方代表立场
            </label>
            <div className="flex flex-wrap gap-2">
              {STANCE_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setStance(o.id)}
                  className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    stance === o.id
                      ? "border-sky-400 bg-sky-50 text-sky-800 dark:bg-sky-950/30 dark:text-sky-200"
                      : "border-border bg-card hover:bg-muted"
                  }`}
                >
                  <div className="font-medium">{o.label}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{o.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">
              交易/合同需求 <span className="text-muted-foreground">(口语描述即可)</span>
            </label>
            <textarea
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              rows={6}
              placeholder="例:我要把名下一间临街门面租给一家奶茶店,租期三年,押二付三,想约定到期优先续租、转租要我同意、装修不能动承重墙……"
              className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-sky-400"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">
              合同类型提示 <span className="text-muted-foreground">(可留空,AI 会自己判断)</span>
            </label>
            <input
              value={typeHint}
              onChange={(e) => setTypeHint(e.target.value)}
              placeholder="如:房屋租赁合同 / 股权转让协议 / 借款合同……"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-sky-400"
            />
          </div>

          <Button onClick={doPlan} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" /> {busyMsg}
              </>
            ) : (
              <>
                <Sparkles className="size-4" /> 分析需求、规划起草
              </>
            )}
          </Button>

          {/* 草案库 */}
          {drafts.length > 0 && (
            <div className="mt-2 rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <FolderOpen className="size-3.5" /> 草案库({drafts.length})
              </div>
              <ul className="mt-2 divide-y divide-border">
                {drafts.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => openFromLibrary(d)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="text-xs font-medium text-foreground">
                        {d.contract_name}
                      </span>
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        v{d.latest_version}
                        {d.status === "final" ? " · 最终版" : ""} · {stanceCn(d.stance)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => doDeleteDraft(d)}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                      title="删除"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 起草偏好(B3) */}
          <details className="rounded-lg border border-border bg-card p-3">
            <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-foreground">
              <BookMarked className="size-3.5" /> 起草偏好({prefs.length})
              <span className="text-[10px] font-normal text-muted-foreground">
                — 起草/修订时按合同类型自动套用(仅辅助条款取舍,不降强制性风险)
              </span>
            </summary>
            <div className="mt-2 space-y-2">
              {prefs.length > 0 && (
                <ul className="divide-y divide-border">
                  {prefs.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 py-1.5 text-xs">
                      <span className="min-w-0 flex-1">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {p.contract_type.trim() || "通用"}
                        </span>
                        {p.topic && (
                          <span className="ml-1.5 text-foreground/70">[{p.topic}]</span>
                        )}
                        <span className="ml-1.5 text-foreground">{p.preference}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removePref(p.id)}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                        title="删除"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={prefType}
                  onChange={(e) => setPrefType(e.target.value)}
                  placeholder="适用类型(空=通用)"
                  className="w-32 rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-sky-400"
                />
                <input
                  value={prefTopic}
                  onChange={(e) => setPrefTopic(e.target.value)}
                  placeholder="主题(如 争议解决)"
                  className="w-32 rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-sky-400"
                />
                <input
                  value={prefText}
                  onChange={(e) => setPrefText(e.target.value)}
                  placeholder="偏好(如 争议由无锡仲裁委仲裁)"
                  className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-sky-400"
                />
                <button
                  type="button"
                  onClick={addPref}
                  className="flex shrink-0 items-center gap-1 rounded bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-700"
                >
                  <Plus className="size-3.5" /> 加
                </button>
              </div>
            </div>
          </details>
        </div>
      )}

      {/* 第二步:规划 + 引导采集 */}
      {step === "plan" && plan && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Lightbulb className="size-4 text-amber-500" />
              {plan.contract_type || "合同类型待定"}
            </div>
            {plan.transaction_essence && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                交易本质:{plan.transaction_essence}
              </p>
            )}
            {plan.structure_outline.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] font-medium text-muted-foreground">拟用结构</div>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-foreground/80">
                  {plan.structure_outline.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {plan.notes && (
              <p className="mt-3 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                {plan.notes}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
              <ListChecks className="size-3.5" /> 补全起草要素
              <span className="text-muted-foreground">(逐项填写,留空处 AI 会用 ____ 占位)</span>
            </label>
            <textarea
              value={collected}
              onChange={(e) => setCollected(e.target.value)}
              rows={10}
              className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-sky-400"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={doGenerate} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> {busyMsg}
                </>
              ) : (
                <>
                  <FileSignature className="size-4" /> 生成合同草案
                </>
              )}
            </Button>
            <Button variant="outline" onClick={() => setStep("input")} disabled={busy}>
              返回修改需求
            </Button>
          </div>
        </div>
      )}

      {/* 第三步:草案 + 导出 + 版本管理 */}
      {step === "draft" && draft && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={doExport} disabled={busy}>
              导出 Word
            </Button>
            {!draftId && (
              <Button variant="outline" onClick={doSave} disabled={busy}>
                <Save className="size-4" /> 保存到草案库
              </Button>
            )}
            <Button variant="outline" onClick={() => setStep("plan")} disabled={busy}>
              改信息重新生成
            </Button>
            <Button variant="ghost" onClick={reset} disabled={busy}>
              新起草
            </Button>
            {busy && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> {busyMsg}
              </span>
            )}
            {!busy && busyMsg && (
              <span className="text-xs text-emerald-600">{busyMsg}</span>
            )}
            {activeVersionNo && (
              <span className="ml-auto rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                当前 v{activeVersionNo}
              </span>
            )}
          </div>

          {/* 版本历史 */}
          {draftId && versions.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <History className="size-3.5" /> 版本历史
              </div>
              <ul className="mt-2 space-y-1">
                {versions.map((v) => (
                  <li
                    key={v.id}
                    className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${
                      v.version_no === activeVersionNo ? "bg-sky-50 dark:bg-sky-950/30" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => viewVersion(v)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="font-medium text-foreground">v{v.version_no}</span>
                      {v.is_final === 1 && (
                        <Star className="ml-1 inline size-3 fill-amber-400 text-amber-400" />
                      )}
                      <span className="ml-2 text-muted-foreground">{v.purpose || v.source}</span>
                    </button>
                    {v.is_final !== 1 && (
                      <button
                        type="button"
                        onClick={() => doMarkFinal(v)}
                        className="shrink-0 text-[10px] text-muted-foreground hover:text-amber-600"
                      >
                        设为最终版
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 多轮修订 */}
          <div className="rounded-lg border border-border bg-card p-3">
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Pencil className="size-3.5" /> 修订本版
              <span className="text-muted-foreground">
                (描述要改什么 → 生成新版,自动存为下一版)
              </span>
            </label>
            <textarea
              value={reviseFeedback}
              onChange={(e) => setReviseFeedback(e.target.value)}
              rows={3}
              placeholder="例:把违约金从 30% 降到 20%;增加一条争议由无锡仲裁委仲裁;乙方逾期付款的利息按 LPR 计……"
              className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-sky-400"
            />
            <Button className="mt-2" variant="outline" onClick={doRevise} disabled={busy}>
              <Pencil className="size-4" /> 生成修订版
            </Button>
          </div>

          {(draft.assumptions.length > 0 || draft.missing_info.length > 0) && (
            <div className="rounded-lg border border-amber-200/70 bg-amber-50/50 p-3 text-xs dark:border-amber-900/40 dark:bg-amber-950/20">
              {draft.assumptions.length > 0 && (
                <div>
                  <span className="font-medium text-amber-800 dark:text-amber-300">
                    AI 所做假设(请核对 ____ 占位处):
                  </span>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-amber-900/80 dark:text-amber-200/80">
                    {draft.assumptions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
              {draft.missing_info.length > 0 && (
                <div className="mt-2">
                  <span className="font-medium text-amber-800 dark:text-amber-300">
                    建议补充/核实:
                  </span>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-amber-900/80 dark:text-amber-200/80">
                    {draft.missing_info.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* 草案正文 */}
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="prose prose-sm max-w-none dark:prose-invert [&_h1]:text-center [&_h1]:text-base [&_h2]:text-sm [&_p]:leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {previewMd || "(草案为空)"}
              </ReactMarkdown>
            </div>
          </div>

          {draft.key_clauses.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs font-medium text-foreground">关键条款设计说明</div>
              <ul className="mt-2 space-y-2 text-xs">
                {draft.key_clauses.map((k, i) => (
                  <li key={i}>
                    <span className="font-medium text-foreground">{k.clause}</span>
                    {k.rationale && (
                      <span className="text-muted-foreground"> —— {k.rationale}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {draft.risks.length > 0 && (
            <div className="rounded-lg border border-red-200/70 bg-red-50/40 p-4 dark:border-red-900/40 dark:bg-red-950/20">
              <div className="flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-300">
                <AlertTriangle className="size-3.5" /> 风险提示
              </div>
              <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-red-900/80 dark:text-red-200/80">
                {draft.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span className="whitespace-pre-wrap break-words">{error}</span>
        </div>
      )}
    </div>
  );
}
