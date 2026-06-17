-- 2026-06-XX V0.3.x:法院网上立案 jobs 表
-- 一张网 / ChinaCourt 立案机器人的任务队列,前端设参数 → 后端 Playwright 执行。
CREATE TABLE court_filing_jobs (
    id              TEXT PRIMARY KEY,
    case_id         TEXT NOT NULL REFERENCES cases(id),
    filing_type     TEXT NOT NULL DEFAULT 'civil',         -- civil / execution
    court_name      TEXT NOT NULL DEFAULT '',
    cookie_account  TEXT,                                    -- 一张网账号(脱敏展示用)
    status          TEXT NOT NULL DEFAULT 'pending',        -- pending / running / waiting_captcha / completed / failed / cancelled
    output_dir      TEXT,
    preview_url     TEXT,                                    -- 成功时的预览页 URL
    progress_json   TEXT,                                    -- 最近一条 progress 事件 JSON(前端实时展示)
    captcha_active  INTEGER NOT NULL DEFAULT 0,             -- 0/1 是否正在等验证码
    error           TEXT,
    timing_json     TEXT,                                    -- {"login_ms":...,"playwright_ms":...,"overall_ms":...}
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_court_filing_jobs_case_id ON court_filing_jobs(case_id);
