import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * 合并 Tailwind class,自动去重冲突的 utility(shadcn 标配)。
 *
 * @example
 *   cn("px-2 py-1", isActive && "bg-blue-500", className)
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 文档板内显示名:有 display_name(AI 整理/人工改名)就用它,否则回退原始 filename。
 * 纯展示用 —— 识别/分组/抽取一律仍用 filename + source_path,显示名绝不漏进逻辑层。
 */
export function docDisplayName(doc: {
  display_name?: string | null;
  filename: string;
}): string {
  const n = doc.display_name?.trim();
  return n && n.length > 0 ? n : doc.filename;
}
