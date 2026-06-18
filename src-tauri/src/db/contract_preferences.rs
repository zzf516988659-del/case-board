//! 合同起草偏好库(2026-06-18 · 非诉「合同起草」B3)。
//!
//! 用户确认的条款处理偏好;起草/修订时按「通用 + 匹配合同类型」注入,仅辅助条款取舍与谈判底线,
//! **不得降低违法/无效/强制性规范相关风险**(skill 铁律)。migration 0032。
//! 本轮只做 `source='user'`(用户显式录入);自动学习(`ai_suggest` 提案)留 v2。

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use uuid::Uuid;

/// 一条起草偏好。
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ContractPreference {
    pub id: String,
    pub contract_type: String, // '' = 通用
    pub topic: String,
    pub preference: String,
    pub source: String, // user / ai_suggest
    pub created_at: String,
}

/// 新增一条偏好。返回偏好行。
pub async fn add(
    pool: &SqlitePool,
    contract_type: &str,
    topic: &str,
    preference: &str,
    source: &str,
) -> Result<ContractPreference, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    let src = if source.trim().is_empty() {
        "user"
    } else {
        source
    };
    sqlx::query(
        "INSERT INTO contract_preferences (id, contract_type, topic, preference, source) \
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(contract_type)
    .bind(topic)
    .bind(preference)
    .bind(src)
    .execute(pool)
    .await?;
    get(pool, &id).await?.ok_or(sqlx::Error::RowNotFound)
}

pub async fn get(pool: &SqlitePool, id: &str) -> Result<Option<ContractPreference>, sqlx::Error> {
    sqlx::query_as::<_, ContractPreference>("SELECT * FROM contract_preferences WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}

/// 全部偏好(通用在前、按创建时间)。前端按合同类型筛选展示/注入。
pub async fn list(pool: &SqlitePool) -> Result<Vec<ContractPreference>, sqlx::Error> {
    sqlx::query_as::<_, ContractPreference>(
        "SELECT * FROM contract_preferences ORDER BY contract_type ASC, created_at ASC",
    )
    .fetch_all(pool)
    .await
}

pub async fn delete(pool: &SqlitePool, id: &str) -> Result<u64, sqlx::Error> {
    let r = sqlx::query("DELETE FROM contract_preferences WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected())
}
