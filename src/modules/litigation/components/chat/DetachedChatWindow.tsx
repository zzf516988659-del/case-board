/**
 * 案件 AI 助手的分离界面。
 *
 * 它不是第二个助手实例:与主窗口侧栏复用 CaseChatPanel 和同一份 SQLite 聊天记录。
 * 主窗口负责把助手从侧栏分离出来;本界面用「放回侧栏」重新停靠到原位置。
 */
import { CaseChatPanel } from "./CaseChatPanel";

export function DetachedChatWindow({
  caseId,
  caseName,
  domain = "civil",
}: {
  caseId: string | null;
  caseName?: string | null;
  domain?: "civil" | "criminal";
}) {
  return (
    <div className="flex h-screen w-screen flex-col">
      <CaseChatPanel
        detached
        caseId={caseId}
        caseName={caseName}
        domain={domain}
      />
    </div>
  );
}
