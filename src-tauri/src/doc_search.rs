//! 文档内「关键词搜索 → 定位到页」(2026-06-20 · 源文件看板)。
//!
//! 在已抽取的 .md 文本里按页搜索关键词,返回命中页码 + 摘要,前端点一下跳那一页。
//! 页码来源:抽取时写入的 `--- 第 N 页 ---` 标记(paddle_vl / 本机 vision 多页件带)
//! 或换页符 `\f`(部分文本 PDF)。都没有 → 页码 None(旧文档,提示重抽后可定位)。
//!
//! ⚠️ 纯增量、原生方案:不依赖 pdf.js,大扫描件无副作用(advisor 定:搜索与渲染器解耦)。

use serde::Serialize;

/// 一条命中(按页聚合:一页一条,带该页命中次数 + 一段摘要)。
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SearchHit {
    /// 命中所在页码(1-based);None = 文本无页码标记,无法定位(旧文档)。
    pub page: Option<i64>,
    /// 含关键词的一小段上下文摘要。
    pub snippet: String,
    /// 该页命中次数。
    pub count: usize,
}

/// 摘要左右各取的字符数。
const SNIPPET_HALF: usize = 40;

/// 把抽取文本按页切分:`Vec<(页码, 该页文本)>`。
/// 优先认 `--- 第 N 页 ---` 标记;否则认换页符 `\f`;都没有 → 整篇一段、页码 None。
fn split_pages(text: &str) -> Vec<(Option<i64>, String)> {
    let re = regex::Regex::new(r"(?m)^---\s*第\s*(\d+)\s*页\s*---\s*$").unwrap();
    let marks: Vec<(usize, usize, i64)> = re
        .captures_iter(text)
        .filter_map(|c| {
            let m = c.get(0)?;
            let n = c.get(1)?.as_str().parse::<i64>().ok()?;
            Some((m.start(), m.end(), n))
        })
        .collect();
    if !marks.is_empty() {
        let mut out = Vec::with_capacity(marks.len());
        for (i, &(_, end, page)) in marks.iter().enumerate() {
            let content_end = marks.get(i + 1).map(|m| m.0).unwrap_or(text.len());
            out.push((Some(page), text[end..content_end].to_string()));
        }
        return out;
    }
    if text.contains('\u{000C}') {
        return text
            .split('\u{000C}')
            .enumerate()
            .map(|(i, s)| (Some(i as i64 + 1), s.to_string()))
            .collect();
    }
    vec![(None, text.to_string())]
}

/// 取一段含关键词的摘要(unicode 安全,按 char 取窗口)。`lower_content`/`lower_q` 已小写。
fn make_snippet(content: &str, lower_content: &str, lower_q: &str) -> String {
    let Some(byte_pos) = lower_content.find(lower_q) else {
        return content.chars().take(SNIPPET_HALF * 2).collect();
    };
    // byte_pos → char 索引
    let char_pos = lower_content[..byte_pos].chars().count();
    let q_chars = lower_q.chars().count();
    let chars: Vec<char> = content.chars().collect();
    let start = char_pos.saturating_sub(SNIPPET_HALF);
    let end = (char_pos + q_chars + SNIPPET_HALF).min(chars.len());
    let mut s: String = chars[start..end].iter().collect();
    s = s.replace('\n', " ").trim().to_string();
    if start > 0 {
        s = format!("…{}", s);
    }
    if end < chars.len() {
        s.push('…');
    }
    s
}

/// 在文本里按页搜索关键词(大小写不敏感、子串匹配)。返回最多 `max_pages` 条命中页。
pub fn search_pages(text: &str, query: &str, max_pages: usize) -> Vec<SearchHit> {
    let q = query.trim();
    if q.is_empty() {
        return vec![];
    }
    let lower_q = q.to_lowercase();
    let mut hits = Vec::new();
    for (page, content) in split_pages(text) {
        let lower_content = content.to_lowercase();
        let count = lower_content.matches(&lower_q).count();
        if count == 0 {
            continue;
        }
        hits.push(SearchHit {
            page,
            snippet: make_snippet(&content, &lower_content, &lower_q),
            count,
        });
        if hits.len() >= max_pages {
            break;
        }
    }
    hits
}
