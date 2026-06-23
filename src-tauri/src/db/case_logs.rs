use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct CaseLog {
    pub id: String,
    pub case_id: String,
    pub occurred_at: String,
    pub content: String,
    pub source: Option<String>,
    pub source_doc_id: Option<String>,
    pub created_at: String,
}

pub async fn list(pool: &SqlitePool, case_id: &str) -> Result<Vec<CaseLog>, String> {
    sqlx::query_as::<_, CaseLog>(
        "SELECT id, case_id, occurred_at, content, source, source_doc_id, created_at \
         FROM case_logs WHERE case_id = ? ORDER BY occurred_at DESC, created_at DESC",
    )
    .bind(case_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

pub async fn create(
    pool: &SqlitePool,
    case_id: &str,
    occurred_at: &str,
    raw_input: &str,
    organized_markdown: Option<&str>,
) -> Result<CaseLog, String> {
    let base = crate::db::app_data_dir().map_err(|e| e.to_string())?;
    create_at_base(
        pool,
        &base,
        case_id,
        occurred_at,
        raw_input,
        organized_markdown,
    )
    .await
}

async fn create_at_base(
    pool: &SqlitePool,
    base: &std::path::Path,
    case_id: &str,
    occurred_at: &str,
    raw_input: &str,
    organized_markdown: Option<&str>,
) -> Result<CaseLog, String> {
    let raw = raw_input.trim();
    if raw.is_empty() {
        return Err("工作记录不能为空".into());
    }
    let id = Uuid::new_v4().to_string();
    let dir = base.join("case_notes").join(case_id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建工作记录目录失败:{e}"))?;
    let path = dir.join(format!("{id}.md"));
    let body = if let Some(organized) = organized_markdown.filter(|v| !v.trim().is_empty()) {
        format!(
            "# 案件工作记录\n\n- 记录时间：{occurred_at}\n- 记录方式：AI 整理（律师复核）\n\n## 整理内容\n\n{}\n\n## 原始记录\n\n{}\n",
            organized.trim(), raw
        )
    } else {
        format!(
            "# 案件工作记录\n\n- 记录时间：{occurred_at}\n- 记录方式：直接记录\n\n## 记录内容\n\n{raw}\n"
        )
    };
    std::fs::write(&path, &body).map_err(|e| format!("写入工作记录失败:{e}"))?;

    let path_text = path.to_string_lossy().into_owned();
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let result = async {
        sqlx::query(
            "INSERT INTO documents \
             (id, case_id, source_path, filename, category, is_ai_artifact, size_bytes, \
              extracted_text_path, extraction_status, source) \
             VALUES (?, ?, ?, ?, '工作记录', 1, ?, ?, 'done', 'case_note')",
        )
        .bind(&id)
        .bind(case_id)
        .bind(&path_text)
        .bind(format!(
            "工作记录-{}.md",
            occurred_at.replace([':', 'T'], "-")
        ))
        .bind(body.len() as i64)
        .bind(&path_text)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO case_logs (id, case_id, occurred_at, content, source, source_doc_id) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(case_id)
        .bind(occurred_at)
        .bind(&body)
        .bind(if organized_markdown.is_some() {
            "ai"
        } else {
            "manual"
        })
        .bind(&id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await
    }
    .await;
    if let Err(error) = result {
        let _ = std::fs::remove_file(&path);
        return Err(error.to_string());
    }
    sqlx::query_as::<_, CaseLog>(
        "SELECT id, case_id, occurred_at, content, source, source_doc_id, created_at \
         FROM case_logs WHERE id = ?",
    )
    .bind(&id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())
}
