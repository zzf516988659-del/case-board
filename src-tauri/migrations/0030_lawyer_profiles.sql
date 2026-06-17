-- 2026-06-XX V0.3.x:律师档案(立案用,一张网必填律师执业证号)
-- 立案机器人在选律师 → 自动填进「诉讼参与人 → 代理人」。
CREATE TABLE lawyer_profiles (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    bar_number      TEXT,            -- 律师执业证号(一张网必填)
    law_firm        TEXT,            -- 律所名称
    id_number       TEXT,            -- 身份证号(代理人身份证明)
    phone           TEXT,            -- 手机号
    address         TEXT,            -- 律所地址(送达用)
    is_default      INTEGER NOT NULL DEFAULT 0,  -- 默认勾选的律师
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
