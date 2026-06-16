import { useState, useEffect, useCallback } from "react";

/**
 * 首页 / 界面功能开关(feature flags)统一机制。
 *
 * 作者偏好「清清爽爽的界面」:首页新功能默认关闭,用户想要再去设置 / 对应功能里打开。
 * 约定:以后首页新增模块 → 在 FEATURE_FLAGS 注册表里加一条即可:
 *   - 设置页「界面 / 首页」分区会自动渲染 location==="settings" 的开关;
 *   - 首页组件用 useFeatureFlag(name) 条件渲染;
 *   - 无需改后端 settings(纯前端 UI 偏好)。
 *
 * 存储:localStorage,key = `caseboard:feature:<name>`。
 *   per-device、不跨设备同步 —— 符合「这台机器界面清不清爽」的语义,
 *   与首页其它 `caseboard:*` 偏好(view_mode / sort / filters …)一致。
 */

const PREFIX = "caseboard:feature:";
const CHANGE_EVENT = "caseboard:feature-change";

export type FeatureFlagName = "home_filter_bar" | "home_ticktick";

export interface FeatureFlagMeta {
  name: FeatureFlagName;
  /** 开关旁显示的标题 */
  title: string;
  /** 一句话说明 */
  description: string;
  /** 默认值(作者偏好:一律默认关,保持清爽) */
  defaultValue: boolean;
  /** 开关 UI 主要放在哪:settings=设置页分区渲染;feature=对应功能页自己放 */
  location: "settings" | "feature";
}

/** 注册表:所有首页功能开关。**新增首页功能 → 在这里加一条。** */
export const FEATURE_FLAGS: FeatureFlagMeta[] = [
  {
    name: "home_filter_bar",
    title: "首页筛选工具栏",
    description:
      "显示首页的排序 / 筛选 / 列表视图 / 多选工具栏。关闭则回到清爽的纯案件卡片网格。",
    defaultValue: false,
    location: "settings",
  },
  {
    name: "home_ticktick",
    title: "首页滴答清单待办",
    description: "在首页显示滴答清单同步的待办汇总。关闭则首页不显示待办块。",
    defaultValue: false,
    location: "feature",
  },
];

const META_BY_NAME: Record<string, FeatureFlagMeta> = Object.fromEntries(
  FEATURE_FLAGS.map((f) => [f.name, f]),
);

function defaultOf(name: FeatureFlagName): boolean {
  return META_BY_NAME[name]?.defaultValue ?? false;
}

export function getFeatureFlag(name: FeatureFlagName): boolean {
  try {
    const raw = localStorage.getItem(PREFIX + name);
    if (raw === null) return defaultOf(name);
    return raw === "1" || raw === "true";
  } catch {
    return defaultOf(name);
  }
}

export function setFeatureFlag(name: FeatureFlagName, value: boolean): void {
  try {
    localStorage.setItem(PREFIX + name, value ? "1" : "0");
  } catch {
    /* localStorage 不可用时静默 —— UI 偏好不致命 */
  }
  // storage 事件只跨窗口、不触发本窗口,这里用自定义事件让同窗口其它组件即时同步
  try {
    window.dispatchEvent(
      new CustomEvent(CHANGE_EVENT, { detail: { name, value } }),
    );
  } catch {
    /* ignore */
  }
}

/** React hook:读 + 写一个开关,跨组件即时同步。返回 [enabled, setEnabled]。 */
export function useFeatureFlag(
  name: FeatureFlagName,
): [boolean, (value: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => getFeatureFlag(name));

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { name: FeatureFlagName; value: boolean }
        | undefined;
      if (detail && detail.name === name) setEnabled(detail.value);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREFIX + name) setEnabled(getFeatureFlag(name));
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [name]);

  const set = useCallback(
    (value: boolean) => {
      setFeatureFlag(name, value);
      setEnabled(value);
    },
    [name],
  );

  return [enabled, set];
}
