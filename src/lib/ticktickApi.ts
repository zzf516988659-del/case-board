// 滴答清单双向同步 —— 前端 API(公开功能)。
//
// 所有调用走 Rust 单一命令 ticktick_call(action + payload),见
// src-tauri/src/ticktick/mod.rs::dispatch。鉴权用用户在滴答设置里生成的「API 口令」
//(dp_ 个人访问令牌),免注册开发者应用、免 OAuth。
import { invoke } from "@tauri-apps/api/core";

export interface TickTickStatus {
  connected: boolean;
  projectId: string | null;
  projectName: string | null;
  cutoffMs: number;
  lastSyncMs: number;
  itemCount: number;
  autoSync: boolean;
  lastError: string | null;
}

export interface TickTickItem {
  id: string;
  ticktickId: string | null;
  title: string;
  done: boolean;
  due: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  deleted: boolean;
  dirty: boolean;
}

export interface TickTickProject {
  id: string;
  name: string;
}

export interface SyncReport {
  pulled: number;
  pushed: number;
  completedRemote: number;
  deletedRemote: number;
  errors: string[];
}

function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  return invoke<T>("ticktick_call", { action, payload });
}

export const ttStatus = () => call<TickTickStatus>("status");
export const ttConnectToken = (token: string, server: string) =>
  call<{ ok: boolean }>("connectToken", { token, server });
export const ttDisconnect = () => call<unknown>("disconnect");
export const ttListProjects = () => call<TickTickProject[]>("listProjects");
export const ttSetProject = (projectId: string, projectName: string) =>
  call<unknown>("setProject", { projectId, projectName });
export const ttClearProject = () => call<unknown>("clearProject");
export const ttSetAutoSync = (on: boolean) => call<unknown>("setAutoSync", { on });
export const ttSyncNow = () => call<SyncReport>("syncNow");
export const ttListItems = () => call<TickTickItem[]>("listItems");
export const ttAddItem = (title: string, due: string | null) =>
  call<TickTickItem>("addItem", { title, due });
export const ttToggleItem = (id: string, done: boolean) =>
  call<unknown>("toggleItem", { id, done });
export const ttDeleteItem = (id: string) => call<unknown>("deleteItem", { id });
