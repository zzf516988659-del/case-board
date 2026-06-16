//! 滴答清单(dida365 / TickTick)Open API REST 客户端。
//!
//! 接口口径来自 `~/Desktop/滴答清单API调研报告.md`。注意:**`GET /project/{id}/data`
//! 只返回未完成任务**(已完成拉不到)——这是「手机勾完成同步回来」的硬限制,
//! 同步引擎里靠「曾同步过、现在从未完成列表消失」反推完成(best-effort)。

use super::state::TickTickConfig;
use serde::Deserialize;
use std::time::Duration;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProject {
    pub id: String,
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTask {
    pub id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub title: String,
    /// 0 = 未完成,2 = 已完成。
    #[serde(default)]
    pub status: i64,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub modified_time: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProjectData {
    #[serde(default)]
    tasks: Vec<RemoteTask>,
}

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("HTTP client 构建失败:{e}"))
}

fn api(cfg: &TickTickConfig, path: &str) -> String {
    format!("{}/open/v1/{}", cfg.api_base.trim_end_matches('/'), path)
}

/// 列出全部清单(project)。
pub async fn list_projects(
    cfg: &TickTickConfig,
    token: &str,
) -> Result<Vec<RemoteProject>, String> {
    let resp = http()?
        .get(api(cfg, "project"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("拉取清单列表失败:{e}"))?;
    read_json(resp, "清单列表").await
}

/// 探测「收件箱(Inbox)」的真实 id。
///
/// 滴答 `GET /open/v1/project` **不返回收件箱**,但创建任务时不带 projectId 会落到收件箱,
/// 且响应里带回收件箱的真实 id(形如 `inbox<uid>`)。这里发一个探针任务拿到 id 后立刻删掉。
pub async fn discover_inbox_id(cfg: &TickTickConfig, token: &str) -> Result<String, String> {
    let body = serde_json::json!({ "title": "CaseBoard·收件箱探测(可删)" });
    let resp = http()?
        .post(api(cfg, "task"))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("探测收件箱失败:{e}"))?;
    let created: RemoteTask = read_json(resp, "探测收件箱").await?;
    let inbox_id = created
        .project_id
        .clone()
        .ok_or("探测收件箱:响应未返回 projectId")?;
    // 删掉探针(失败不影响返回收件箱 id)。
    let _ = delete_task(cfg, token, &inbox_id, &created.id).await;
    Ok(inbox_id)
}

/// 拉某清单下**未完成**任务。
pub async fn project_data(
    cfg: &TickTickConfig,
    token: &str,
    project_id: &str,
) -> Result<Vec<RemoteTask>, String> {
    let resp = http()?
        .get(api(cfg, &format!("project/{project_id}/data")))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("拉取清单任务失败:{e}"))?;
    let data: ProjectData = read_json(resp, "清单任务").await?;
    Ok(data.tasks)
}

/// 创建任务,返回带 id 的远端任务。
pub async fn create_task(
    cfg: &TickTickConfig,
    token: &str,
    project_id: &str,
    title: &str,
    due: Option<&str>,
) -> Result<RemoteTask, String> {
    let mut body = serde_json::json!({ "title": title, "projectId": project_id });
    if let Some(d) = normalize_due(due) {
        body["dueDate"] = serde_json::Value::String(d);
        body["isAllDay"] = serde_json::Value::Bool(true);
    }
    let resp = http()?
        .post(api(cfg, "task"))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("创建任务失败:{e}"))?;
    read_json(resp, "创建任务").await
}

/// 更新任务标题/日期。官方 Open API 更新走 `POST /open/v1/task/{id}`;
/// 若服务端只认 PUT(部分文档口径)→ 自动回退一次 PUT。
pub async fn update_task(
    cfg: &TickTickConfig,
    token: &str,
    task_id: &str,
    project_id: &str,
    title: &str,
    done: bool,
    due: Option<&str>,
) -> Result<(), String> {
    let mut body = serde_json::json!({
        "id": task_id,
        "projectId": project_id,
        "title": title,
        "status": if done { 2 } else { 0 },
    });
    if let Some(d) = normalize_due(due) {
        body["dueDate"] = serde_json::Value::String(d);
        body["isAllDay"] = serde_json::Value::Bool(true);
    }
    let url = api(cfg, &format!("task/{task_id}"));
    let resp = http()?
        .post(&url)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("更新任务失败:{e}"))?;
    if resp.status().as_u16() == 405 {
        // 服务端不收 POST → 退回 PUT 再试一次。
        let resp2 = http()?
            .put(&url)
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("更新任务(PUT)失败:{e}"))?;
        return ok_or_err(resp2, "更新任务").await;
    }
    ok_or_err(resp, "更新任务").await
}

/// 标记任务完成。
pub async fn complete_task(
    cfg: &TickTickConfig,
    token: &str,
    project_id: &str,
    task_id: &str,
) -> Result<(), String> {
    let resp = http()?
        .post(api(
            cfg,
            &format!("project/{project_id}/task/{task_id}/complete"),
        ))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("完成任务失败:{e}"))?;
    ok_or_err(resp, "完成任务").await
}

/// 删除任务。
pub async fn delete_task(
    cfg: &TickTickConfig,
    token: &str,
    project_id: &str,
    task_id: &str,
) -> Result<(), String> {
    let resp = http()?
        .delete(api(cfg, &format!("project/{project_id}/task/{task_id}")))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("删除任务失败:{e}"))?;
    ok_or_err(resp, "删除任务").await
}

/// 把 `YYYY-MM-DD` 归一成滴答能收的日期时间(全天,北京时区 09:00)。
/// 已是日期时间则原样返回。
fn normalize_due(due: Option<&str>) -> Option<String> {
    let d = due?.trim();
    if d.is_empty() {
        return None;
    }
    if d.len() == 10 && d.as_bytes().get(4) == Some(&b'-') {
        Some(format!("{d}T09:00:00+0800"))
    } else {
        Some(d.to_string())
    }
}

async fn read_json<T: serde::de::DeserializeOwned>(
    resp: reqwest::Response,
    what: &str,
) -> Result<T, String> {
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let snippet: String = text.chars().take(300).collect();
        return Err(format!("{what} {}:{snippet}", status.as_u16()));
    }
    serde_json::from_str(&text).map_err(|e| format!("解析{what}响应失败:{e}(原文:{text})"))
}

async fn ok_or_err(resp: reqwest::Response, what: &str) -> Result<(), String> {
    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }
    let text = resp.text().await.unwrap_or_default();
    let snippet: String = text.chars().take(300).collect();
    Err(format!("{what} {}:{snippet}", status.as_u16()))
}
