-- 2026-06-23 · 飞书每日手机提醒发送记录
-- 每天成功发送（或当天没有待办）后落一行，App 重启也不会重复推送。
CREATE TABLE IF NOT EXISTS feishu_reminder_runs (
    sent_date  TEXT PRIMARY KEY NOT NULL,
    sent_at    TEXT NOT NULL DEFAULT (datetime('now')),
    item_count INTEGER NOT NULL DEFAULT 0
);
