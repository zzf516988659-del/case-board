import { useCallback, useEffect, useState } from "react";

/**
 * 全局界面字号缩放(2026-06-16:有用户反映字小,做可微调 + 全局自适应)。
 *
 * 原理:缩放根元素 <html> 的 font-size。Tailwind 的字号/间距/圆角大多是 rem,
 * 改根字号即等比放大/缩小整个界面(字 + 间距 + 控件),实现「全局自适应」。
 *
 * 存储:localStorage(逐设备,与 featureFlags / view_mode 等界面偏好一致),
 * 不跨设备、不进后端 settings。启动时在 main.tsx 先 applyFontScale() 避免闪烁。
 */

const KEY = "caseboard:ui_font_scale";
const CHANGE_EVENT = "caseboard:font-scale-change";

export const FONT_SCALE = {
  MIN: 0.85,
  MAX: 1.4,
  DEFAULT: 1.0,
  STEP: 0.05,
} as const;

function clamp(n: number): number {
  if (!Number.isFinite(n)) return FONT_SCALE.DEFAULT;
  return Math.min(FONT_SCALE.MAX, Math.max(FONT_SCALE.MIN, n));
}

export function getFontScale(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return FONT_SCALE.DEFAULT;
    return clamp(parseFloat(raw));
  } catch {
    return FONT_SCALE.DEFAULT;
  }
}

/** 把缩放应用到 <html>(根字号 = 浏览器默认 16px × scale)。 */
export function applyFontScale(scale: number = getFontScale()): void {
  try {
    document.documentElement.style.fontSize = `${(clamp(scale) * 100).toFixed(1)}%`;
  } catch {
    /* ignore — 非浏览器环境 */
  }
}

export function setFontScale(scale: number): void {
  const v = clamp(scale);
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    /* localStorage 不可用时静默 */
  }
  applyFontScale(v);
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: v }));
  } catch {
    /* ignore */
  }
}

/** React hook:读 + 写界面字号,跨组件即时同步。返回 [scale, setScale]。 */
export function useFontScale(): [number, (scale: number) => void] {
  const [scale, setScale] = useState<number>(() => getFontScale());

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as number | undefined;
      if (typeof detail === "number") setScale(detail);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setScale(getFontScale());
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const set = useCallback((v: number) => setFontScale(v), []);
  return [scale, set];
}
