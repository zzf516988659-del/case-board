//! AI 自动整理(源文件看板 Phase 3b):通读每份材料 → 判 重要度 + 归类。
//! 一次 LLM 调用处理整案材料(省积分);输出建议,由命令层写成 `ai_suggest` 标记。

use serde::{Deserialize, Serialize};

use super::{LlmConfig, LlmError};

/// 喂给 AI 的单份材料(id + 文件名 + 正文摘要)。
#[derive(Debug, Serialize)]
pub struct OrganizeDocInput {
    pub id: String,
    pub filename: String,
    pub snippet: String,
}

/// AI 对单份材料的分类结果。
#[derive(Debug, Clone, Deserialize)]
pub struct DocClassification {
    pub id: String,
    /// 重要 / 普通 / 忽略
    pub importance: String,
    /// 起诉材料 / 证据 / 法院文书 / 对方材料 / 程序文书 / 其他
    pub category: String,
    /// 建议的板内显示名(干净、带类型前缀的中文名,如「证据-微信聊天记录」)。
    /// 空字符串 / 缺省 = 不改名(沿用原文件名)。
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ClassifyResult {
    items: Vec<DocClassification>,
}

const SYSTEM_PROMPT: &str = r###"你是资深律师助理,擅长把一堆杂乱的案件材料快速整理分类。我会给你同一个案件的若干材料,每份含 id、文件名、正文摘要。

请你**通读后输出一个 JSON 对象**,对**每一份**材料判断三件事:
1. `importance`(三选一):
   - "重要":核心证据 / 裁判文书 / 起诉应诉的关键材料 / 直接影响事实认定或金额的材料。
   - "普通":一般材料。
   - "忽略":明显无关、重复、空白、宣传/模板/广告、与本案无实质关系的材料。
2. `category`(**只能从这六个里选一个**):起诉材料 / 证据 / 法院文书 / 对方材料 / 程序文书 / 其他。
3. `name`:给这份材料起一个**简洁、能一眼看懂、带类型前缀**的中文显示名,用于在看板里替代杂乱的原始文件名。规则:
   - 证据类 → `证据-<内容简述>`,如「证据-微信聊天记录」「证据-XX买卖合同」「证据-银行转账回单」。
   - 其它类 → 直接用规范文书名,如「民事起诉状」「答辩状」「授权委托书」「(2024)X民初X号判决书」。
   - 控制在 20 字内;**不要带文件扩展名**;不要自己编号(原件本身有案号则保留)。
   - 拿不准 / 原文件名已经够清楚 → 把 name 设为空字符串 ""(表示不改名)。

输出格式严格为(不要任何多余文字、不要 markdown 代码块):
{"items":[{"id":"<原样回填的 id>","importance":"重要","category":"证据","name":"证据-微信聊天记录"}]}

要求:每份材料对应且仅对应一项,id 必须原样回填,不要遗漏也不要新增。"###;

/// 摘要单份材料正文的最大字符数(控制 corpus 体积 / 成本)。
const SNIPPET_CAP: usize = 600;

/// 截取正文摘要(按字符,不按字节,避免切坏中文)。
pub fn snippet_of(text: &str) -> String {
    text.chars().take(SNIPPET_CAP).collect()
}

/// 一次 LLM 调用对整案材料做 重要度 + 归类 分类。
pub async fn classify_documents(
    config: &LlmConfig,
    docs: &[OrganizeDocInput],
) -> Result<Vec<DocClassification>, LlmError> {
    let mut corpus = String::with_capacity(docs.len() * 200);
    for d in docs {
        corpus.push_str("\n---\nid: ");
        corpus.push_str(&d.id);
        corpus.push_str("\n文件名: ");
        corpus.push_str(&d.filename);
        corpus.push_str("\n正文摘要: ");
        corpus.push_str(if d.snippet.trim().is_empty() {
            "(无可用正文)"
        } else {
            &d.snippet
        });
        corpus.push('\n');
    }

    let is_minimax = config.endpoint.contains("chatcompletion_v2");
    let mut body = serde_json::json!({
        "model": config.model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": corpus},
        ],
        "max_tokens": if is_minimax { 32768 } else { 8192 },
        "temperature": config.temperature,
        "stream": false,
    });
    if !is_minimax {
        body["response_format"] = serde_json::json!({"type": "json_object"});
    }

    let mut req = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(config.timeout_secs * 3))
        .build()
        .map_err(|e| LlmError::Network(e.to_string()))?
        .post(&config.endpoint)
        .json(&body);
    if let Some(key) = &config.api_key {
        req = req.bearer_auth(key);
    }

    let response = req
        .send()
        .await
        .map_err(|e| LlmError::Network(e.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(LlmError::HttpStatus(status.as_u16(), text));
    }
    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| LlmError::ResponseFormat(e.to_string()))?;

    let first_message = json
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"));
    let content = first_message
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            first_message
                .and_then(|m| m.get("reasoning_content"))
                .and_then(|c| c.as_str())
                .filter(|s| !s.trim().is_empty())
        })
        .ok_or_else(|| LlmError::ResponseFormat("AI 整理:响应无 content".to_string()))?;

    let cleaned = super::extract_json_from_content(content);
    let result = serde_json::from_str::<ClassifyResult>(&cleaned)
        .map_err(|e| LlmError::ContentJson(format!("{}\n---原始---\n{}", e, cleaned)))?;
    Ok(result.items)
}
