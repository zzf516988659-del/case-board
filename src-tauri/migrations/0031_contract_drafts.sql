-- 2026-06-18 · 合同起草 B2:草案 + 多轮版本管理(非诉「合同起草」)
-- 纯新增两张表,不动既有表(additive-only)。
-- contract_drafts:一份合同起草事项(一次起草会话);contract_draft_versions:其历次版本。

CREATE TABLE IF NOT EXISTS contract_drafts (
    id              TEXT PRIMARY KEY NOT NULL,
    contract_name   TEXT NOT NULL,
    contract_type   TEXT NOT NULL DEFAULT '',
    stance          TEXT NOT NULL DEFAULT 'neutral',
    requirement     TEXT NOT NULL DEFAULT '',         -- 原始交易需求(便于继续修订)
    status          TEXT NOT NULL DEFAULT 'working',  -- working / final
    latest_version  INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contract_draft_versions (
    id               TEXT PRIMARY KEY NOT NULL,
    draft_id         TEXT NOT NULL,
    version_no       INTEGER NOT NULL,
    source           TEXT NOT NULL DEFAULT 'initial', -- initial / revision / client / counterparty / final
    based_on_version INTEGER,                          -- 基于哪一版(修订时)
    purpose          TEXT NOT NULL DEFAULT '',         -- 本轮目的
    draft_md         TEXT NOT NULL,                     -- 该版完整合同正文
    change_summary   TEXT NOT NULL DEFAULT '',          -- 本轮改了什么 / 为何改
    is_final         INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contract_draft_versions_draft
    ON contract_draft_versions(draft_id);
