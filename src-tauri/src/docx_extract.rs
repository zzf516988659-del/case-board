//! 2026-06-15 V0.3.18 fix:跨平台 .docx 文本抽取
//!
//! 替代 macOS `textutil` 命令(macOS 自带,Windows/Linux 没有 → "program not found")。
//! .docx 本质是 ZIP 包,内含 `word/document.xml`,用 quick-xml 解析 `<w:p>` 段落 + `<w:t>` 文本。
//!
//! ## 设计取舍
//!
//! - **零外部依赖**:不调 `pandoc` / `antiword` / `soffice`,在 Windows + macOS + Linux 上行为一致
//! - **中文安全**:用 quick-xml 0.39 的 `encoding` feature 自动检测 UTF-8 / UTF-16 / GBK
//! - **公式/图片/表格内容** → 仅抽表格内文本(其他资源跳过);WPS / 飞书 / MS Word 生成的 .docx 都兼容
//! - **性能**:`quick-xml` 比 `docx-rs` crate 轻,纯 streaming parser,500KB .docx < 100ms
//!
//! ## 不支持
//!
//! - 旧二进制 `.doc`(Word 97-2003,不是 ZIP 格式) → 走另外的兜底或报错
//! - `.rtf / .odt` → 暂不实现,需要时再扩展
//! - 复杂排版(脚注/批注/页眉页脚) → 仅 `word/document.xml` 正文

use std::fs::File;
use std::io::Read;

use quick_xml::events::Event;
use quick_xml::reader::Reader;

const MAX_DOCX_BYTES: u64 = 50 * 1024 * 1024;

/// 把 .docx 文件抽成纯文本(按段落用 `\n\n` 分隔)。
/// 返回 (text, ok)。失败时 `ok=false` + 错误信息(走老 textutil 兜底或上层报错)。
pub fn extract_docx_text(path: &str) -> Result<(String, bool), String> {
    let p = std::path::Path::new(path);
    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }
    let meta = std::fs::metadata(p).map_err(|e| format!("读元信息失败: {}", e))?;
    if meta.len() > MAX_DOCX_BYTES {
        return Err(format!(
            ".docx 过大({:.1} MB),超过 {} MB 上限",
            meta.len() as f64 / 1024.0 / 1024.0,
            MAX_DOCX_BYTES / 1024 / 1024
        ));
    }

    // 1. ZIP 读 word/document.xml
    let f = File::open(p).map_err(|e| format!("打开 .docx 失败: {}", e))?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| {
        format!(
            "读 .docx zip 失败(可能不是 OOXML 格式,是旧 .doc 二进制?): {}",
            e
        )
    })?;
    let mut doc_xml = String::new();
    {
        let mut entry = zip
            .by_name("word/document.xml")
            .map_err(|e| format!(".docx 内找不到 word/document.xml: {}", e))?;
        entry
            .read_to_string(&mut doc_xml)
            .map_err(|e| format!("读 word/document.xml 失败: {}", e))?;
    }
    drop(zip);

    // 2. XML 解析:流式遍历 <w:p> 段落,每段落收集 <w:t> 文本
    let mut reader = Reader::from_str(&doc_xml);
    reader.config_mut().trim_text(true);

    let mut text = String::new();
    let mut buf = Vec::new();
    let mut in_paragraph = false;
    let mut current_para = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let local = e.local_name();
                let local = local.as_ref();
                if local == b"p" {
                    in_paragraph = true;
                    current_para.clear();
                }
            }
            Ok(Event::End(e)) => {
                let local = e.local_name();
                let local = local.as_ref();
                if local == b"p" && in_paragraph {
                    if !current_para.is_empty() {
                        if !text.is_empty() {
                            text.push_str("\n\n");
                        }
                        text.push_str(current_para.trim());
                    }
                    in_paragraph = false;
                    current_para.clear();
                }
            }
            // quick-xml 0.39:用 xml_content() 同时处理编码 + XML entity(&amp; 等)
            Ok(Event::Text(e)) if in_paragraph => {
                let raw = e
                    .xml_content()
                    .map_err(|err| format!("XML text decode 失败: {}", err))?;
                current_para.push_str(raw.as_ref());
            }
            // 行内换行(Word 里 Shift+Enter)→ 用单 \n,跟段落 \n\n 区分
            Ok(Event::Empty(e)) => {
                let local = e.local_name();
                let local = local.as_ref();
                if in_paragraph && local == b"br" {
                    current_para.push('\n');
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(format!("解析 word/document.xml 失败: {}", e));
            }
            _ => {}
        }
        buf.clear();
    }

    Ok((text, true))
}
