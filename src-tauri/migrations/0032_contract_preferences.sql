-- 2026-06-18 · 合同起草 B3:起草偏好库(非诉「合同起草」)
-- 纯新增一张表,不动既有表(additive-only)。
-- 用户确认的条款处理偏好;起草/修订时按合同类型 + 通用注入提示,仅辅助条款取舍,不降低强制性规范风险。

CREATE TABLE IF NOT EXISTS contract_preferences (
    id              TEXT PRIMARY KEY NOT NULL,
    contract_type   TEXT NOT NULL DEFAULT '',   -- '' = 通用;否则适用于该合同类型
    topic           TEXT NOT NULL DEFAULT '',   -- 条款主题(如 争议解决 / 违约金 / 付款方式)
    preference      TEXT NOT NULL,              -- 偏好处理(如 争议由无锡仲裁委仲裁)
    source          TEXT NOT NULL DEFAULT 'user', -- user(用户确认) / ai_suggest(待确认,本轮不产)
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contract_preferences_type
    ON contract_preferences(contract_type);
