//! PDF 页码书签(2026-06-20 · 源文件看板)。
//!
//! 律师开庭前把重要页标好,点书签直接跳页。挂 `documents.id`(重抽/刷新稳定),
//! 软删文档级联清。**纯增量功能**:不用书签 = 跟原来一样看 PDF。

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Bookmark {
    pub id: String,
    pub document_id: String,
    /// 1-based 页码
    pub page: i64,
    pub label: Option<String>,
    pub created_at: String,
}

/// 列某文档的全部书签,按页码升序。
pub async fn list_by_document(pool: &SqlitePool, document_id: &str) -> sqlx::Result<Vec<Bookmark>> {
    sqlx::query_as::<_, Bookmark>(
        "SELECT id, document_id, page, label, created_at FROM document_bookmarks \
         WHERE document_id = ?1 ORDER BY page ASC, created_at ASC",
    )
    .bind(document_id)
    .fetch_all(pool)
    .await
}

/// 加一个书签(页码必填,label 可空)。页码 < 1 视作 1。返回新书签。
pub async fn add(
    pool: &SqlitePool,
    document_id: &str,
    page: i64,
    label: Option<&str>,
) -> Result<Bookmark, String> {
    let page = page.max(1);
    let label = label.map(str::trim).filter(|s| !s.is_empty());
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO document_bookmarks (id, document_id, page, label) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(&id)
    .bind(document_id)
    .bind(page)
    .bind(label)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(Bookmark {
        id,
        document_id: document_id.to_string(),
        page,
        label: label.map(str::to_string),
        created_at: String::new(),
    })
}

/// 删一个书签。返回受影响行数。
pub async fn delete(pool: &SqlitePool, id: &str) -> Result<u64, String> {
    let res = sqlx::query("DELETE FROM document_bookmarks WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(res.rows_affected())
}
