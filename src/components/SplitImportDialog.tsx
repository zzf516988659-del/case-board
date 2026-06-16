/**
 * 多案件拆分确认弹窗(2026-06-04 · Phase 1)。
 *
 * 拖入文件夹后,后端 `plan_import_folder` 检测到 ≥2 个候选案件时弹出本框。
 * 检测只给**建议**,最终以用户确认为准 —— 可勾选/取消、改案件名,或一键「合并成 1 个案件」(保底)。
 * 详见 docs/提案-多案件文件夹识别-2026-06-04.md。
 */
import { useState } from "react";
import { Layers, FileText, FolderOpen, AlertTriangle } from "lucide-react";
import type { ImportPlan } from "../lib/types";

function basename(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function SplitImportDialog({
  plan,
  busy,
  onConfirm,
  onMergeAll,
  onCancel,
}: {
  plan: ImportPlan;
  busy: boolean;
  onConfirm: (cases: { dir: string; name: string }[], sharedDirs: string[]) => void;
  onMergeAll: () => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState(
    plan.cases.map((c) => ({
      dir: c.dir,
      name: c.suggested_name,
      // 后端按目录名给默认勾选:命中「证件/宣传/模板…」等非案件资料词的默认不勾选(仍可手动勾上)
      include: c.default_selected,
      docCount: c.doc_count,
      hasStage: c.has_stage_subdirs,
      // 疑似非案件资料(默认未勾选的原因),用于行内提示标记
      suspected: !c.default_selected,
    })),
  );

  const selected = rows.filter((r) => r.include);
  const setName = (i: number, name: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, name } : r)));
  const toggle = (i: number) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, include: !r.include } : r)));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* 头 */}
        <div className="flex items-start gap-3 border-b border-stone-200 px-6 py-4">
          <Layers className="mt-0.5 size-6 shrink-0 text-sky-500" />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-stone-800">
              检测到 {plan.cases.length} 个目录 · 已勾选 {selected.length} 个案件
            </h2>
            <p className="mt-0.5 text-sm text-stone-500">
              这个文件夹像是多个案件混在一起。请核对下面的勾选 ——
              <span className="text-stone-600">证件 / 宣传 / 模板</span>
              等疑似资料目录已默认不选,需要的话手动勾上;或合并成一个案件。
            </p>
          </div>
        </div>

        {/* 体 */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* 防呆:案件过多(>3)→ 免费 OCR 批量易被限流卡死,建议逐个导入 */}
          {selected.length > 3 && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                <strong>案件过多(已选 {selected.length} 个)。</strong>
                一次批量导入超过 3 个案件,免费 OCR
                批量识别很容易因限流卡死、大量文档识别失败。
                <strong>建议一个一个案件导入</strong>
                ,或在下方取消勾选、本次只留 1~3 个。
              </span>
            </div>
          )}

          {plan.root_already_imported && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                这个文件夹之前已作为「一个案件」导入过。点「拆成 N 个案件导入」会用拆分结果**替换掉**那个旧的整体案件(旧案及其文档会被删除)。
              </span>
            </div>
          )}

          {/* 候选案件 */}
          <div className="space-y-2">
            {rows.map((r, i) => (
              <label
                key={r.dir}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
                  r.include
                    ? "border-sky-200 bg-sky-50/60"
                    : "border-stone-200 bg-stone-50 opacity-60"
                }`}
              >
                <input
                  type="checkbox"
                  checked={r.include}
                  onChange={() => toggle(i)}
                  className="size-4 accent-sky-500"
                />
                <FolderOpen className="size-4 shrink-0 text-stone-400" />
                <input
                  value={r.name}
                  onChange={(e) => setName(i, e.target.value)}
                  className="min-w-0 flex-1 rounded border border-stone-200 bg-white px-2 py-1 text-sm text-stone-800 focus:border-sky-400 focus:outline-none"
                  placeholder="案件名"
                />
                <span className="flex shrink-0 items-center gap-1 text-xs text-stone-500">
                  <FileText className="size-3.5" />
                  {r.docCount}
                </span>
                {r.hasStage && (
                  <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-600">
                    已分阶段
                  </span>
                )}
                {r.suspected && (
                  <span
                    className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-600"
                    title="目录名像是证件/宣传/模板等非案件资料,已默认不选;确认是案件可手动勾上"
                  >
                    疑似资料
                  </span>
                )}
              </label>
            ))}
          </div>

          {/* 共用材料 */}
          {plan.shared_dirs.length > 0 && (
            <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5">
              <p className="text-xs font-medium text-stone-600">
                共用材料(挂到每个案件)
              </p>
              <ul className="mt-1 space-y-0.5">
                {plan.shared_dirs.map((d) => (
                  <li key={d} className="truncate text-sm text-stone-500">
                    · {basename(d)}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-stone-400">
                这些材料会同时挂到上面每一个案件,各案分析时都能用到。
              </p>
            </div>
          )}

          {/* 已忽略 */}
          {plan.ignored.length > 0 && (
            <p className="mt-3 text-xs text-stone-400">
              已忽略:
              {plan.ignored.map((g) => `${basename(g.path)}(${g.reason})`).join("、")}
            </p>
          )}
        </div>

        {/* 脚 */}
        <div className="flex items-center justify-between gap-2 border-t border-stone-200 bg-stone-50 px-6 py-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg px-3 py-2 text-sm text-stone-500 hover:bg-stone-200 disabled:opacity-50"
          >
            取消
          </button>
          <div className="flex gap-2">
            <button
              onClick={onMergeAll}
              disabled={busy}
              className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-600 hover:bg-stone-100 disabled:opacity-50"
            >
              合并成 1 个案件
            </button>
            <button
              onClick={() =>
                onConfirm(
                  selected.map((r) => ({ dir: r.dir, name: r.name })),
                  plan.shared_dirs,
                )
              }
              disabled={busy || selected.length === 0 || selected.length > 3}
              title={
                selected.length > 3
                  ? "一次最多导入 3 个案件,请取消勾选到 3 个以内(或点「合并成 1 个案件」)"
                  : undefined
              }
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50"
            >
              {busy
                ? "导入中…"
                : selected.length > 3
                  ? `最多 3 个(已选 ${selected.length})`
                  : `拆成 ${selected.length} 个案件导入`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
