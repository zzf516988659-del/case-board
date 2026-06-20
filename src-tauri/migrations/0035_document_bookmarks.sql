-- 源文件看板:PDF 页码书签(2026-06-20)。
-- 律师开庭前把重要位置标好,一点直接跳那一页(不用现搜现等)。
-- 纯元数据,挂 documents.id(doc_id 重抽/刷新稳定 → 书签不丢);软删文档级联清。
-- ⚠️ 新增功能、可选不影响老用法:不点书签 = 跟原来一样看 PDF。
CREATE TABLE document_bookmarks (
    id           TEXT PRIMARY KEY NOT NULL,
    document_id  TEXT NOT NULL,
    page         INTEGER NOT NULL,           -- 1-based 页码
    label        TEXT,                        -- 可空,用户给的备注(如「权利要求书」)
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX idx_document_bookmarks_doc ON document_bookmarks(document_id);
