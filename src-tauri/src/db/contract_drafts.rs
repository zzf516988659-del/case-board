//! 合同起草草案 + 多轮版本管理(2026-06-18 · 非诉「合同起草」B2)。
//!
//! `contract_drafts` = 一份起草事项;`contract_draft_versions` = 其历次版本。
//! migration 0031。挂 draft_id 扛刷新;最终版必须由用户明确确认才标(不替用户猜)。

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use uuid::Uuid;

/// 一份合同起草事项。
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ContractDraft {
    pub id: String,
    pub contract_name: String,
    pub contract_type: String,
    pub stance: String,
    pub requirement: String,
    pub status: String, // working / final
    pub latest_version: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// 一版合同稿。
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ContractDraftVersion {
    pub id: String,
    pub draft_id: String,
    pub version_no: i64,
    pub source: String,
    pub based_on_version: Option<i64>,
    pub purpose: String,
    pub draft_md: String,
    pub change_summary: String,
    pub is_final: i64,
    pub created_at: String,
}

/// 新建草案(同时落第 1 版,source=initial)。返回草案行。
#[allow(clippy::too_many_arguments)]
pub async fn create_draft(
    pool: &SqlitePool,
    contract_name: &str,
    contract_type: &str,
    stance: &str,
    requirement: &str,
    draft_md: &str,
) -> Result<ContractDraft, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO contract_drafts \
         (id, contract_name, contract_type, stance, requirement, status, latest_version) \
         VALUES (?, ?, ?, ?, ?, 'working', 1)",
    )
    .bind(&id)
    .bind(contract_name)
    .bind(contract_type)
    .bind(stance)
    .bind(requirement)
    .execute(pool)
    .await?;

    let ver_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO contract_draft_versions \
         (id, draft_id, version_no, source, based_on_version, purpose, draft_md, change_summary, is_final) \
         VALUES (?, ?, 1, 'initial', NULL, '初稿', ?, '', 0)",
    )
    .bind(&ver_id)
    .bind(&id)
    .bind(draft_md)
    .execute(pool)
    .await?;

    get_draft(pool, &id)
        .await?
        .ok_or_else(|| sqlx::Error::RowNotFound)
}

/// 追加一版。version_no = 当前 latest_version + 1。返回新版本行。
#[allow(clippy::too_many_arguments)]
pub async fn add_version(
    pool: &SqlitePool,
    draft_id: &str,
    source: &str,
    based_on_version: Option<i64>,
    purpose: &str,
    draft_md: &str,
    change_summary: &str,
) -> Result<ContractDraftVersion, sqlx::Error> {
    let draft = get_draft(pool, draft_id)
        .await?
        .ok_or_else(|| sqlx::Error::RowNotFound)?;
    let next = draft.latest_version + 1;
    let ver_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO contract_draft_versions \
         (id, draft_id, version_no, source, based_on_version, purpose, draft_md, change_summary, is_final) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
    )
    .bind(&ver_id)
    .bind(draft_id)
    .bind(next)
    .bind(source)
    .bind(based_on_version)
    .bind(purpose)
    .bind(draft_md)
    .bind(change_summary)
    .execute(pool)
    .await?;

    sqlx::query(
        "UPDATE contract_drafts SET latest_version = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(next)
    .bind(draft_id)
    .execute(pool)
    .await?;

    get_version(pool, &ver_id)
        .await?
        .ok_or_else(|| sqlx::Error::RowNotFound)
}

/// 全部草案,最近更新在前。
pub async fn list_drafts(pool: &SqlitePool) -> Result<Vec<ContractDraft>, sqlx::Error> {
    sqlx::query_as::<_, ContractDraft>("SELECT * FROM contract_drafts ORDER BY updated_at DESC")
        .fetch_all(pool)
        .await
}

pub async fn get_draft(pool: &SqlitePool, id: &str) -> Result<Option<ContractDraft>, sqlx::Error> {
    sqlx::query_as::<_, ContractDraft>("SELECT * FROM contract_drafts WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}

/// 某草案的全部版本,版本号升序。
pub async fn list_versions(
    pool: &SqlitePool,
    draft_id: &str,
) -> Result<Vec<ContractDraftVersion>, sqlx::Error> {
    sqlx::query_as::<_, ContractDraftVersion>(
        "SELECT * FROM contract_draft_versions WHERE draft_id = ? ORDER BY version_no ASC",
    )
    .bind(draft_id)
    .fetch_all(pool)
    .await
}

pub async fn get_version(
    pool: &SqlitePool,
    version_id: &str,
) -> Result<Option<ContractDraftVersion>, sqlx::Error> {
    sqlx::query_as::<_, ContractDraftVersion>("SELECT * FROM contract_draft_versions WHERE id = ?")
        .bind(version_id)
        .fetch_optional(pool)
        .await
}

/// 标记某版为最终版:该版 is_final=1、其余版清 0、草案 status=final。用户明确确认才调。
pub async fn mark_final(
    pool: &SqlitePool,
    draft_id: &str,
    version_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE contract_draft_versions SET is_final = 0 WHERE draft_id = ?")
        .bind(draft_id)
        .execute(pool)
        .await?;
    sqlx::query("UPDATE contract_draft_versions SET is_final = 1 WHERE id = ? AND draft_id = ?")
        .bind(version_id)
        .bind(draft_id)
        .execute(pool)
        .await?;
    sqlx::query(
        "UPDATE contract_drafts SET status = 'final', updated_at = datetime('now') WHERE id = ?",
    )
    .bind(draft_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// 删除草案及其全部版本。返回删除的草案行数(0/1)。
pub async fn delete_draft(pool: &SqlitePool, id: &str) -> Result<u64, sqlx::Error> {
    sqlx::query("DELETE FROM contract_draft_versions WHERE draft_id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    let r = sqlx::query("DELETE FROM contract_drafts WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected())
}
