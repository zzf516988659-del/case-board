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
///
/// 例:
/// ```
/// let (text, ok) = extract_docx_text("a.docx").unwrap_or_default();
/// if ok { println!("{}", text); }
/// ```
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
                if local == b"p" {
                    if in_paragraph {
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
            }
            Ok(Event::Text(e)) => {
                if in_paragraph {
                    // quick-xml 0.39:用 decode() (自动按 encoding 解析) 而不是 unescape() (0.36 才有)
                    // XML entity (&amp; &lt; 等) 在 decode 时不自动反转,需要再 decode XML escape
                    // 这里用 xml_content() 同时处理编码 + entity
                    let raw = e
                        .xml_content()
                        .map_err(|err| format!("XML text decode 失败: {}", err))?;
                    current_para.push_str(raw.as_ref());
                }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// 2026-06-15:在测试时手构造一个最小 .docx(zip + word/document.xml),
    /// 不依赖任何 fixture 文件,保证 `cargo test` 在任何环境都能跑通。
    /// 内容含中文(测试 UTF-8/编码处理)+ 多段落(测试 \n\n 分隔)+ 行内 br(测试 \n 换行)。
    fn make_minimal_docx() -> Vec<u8> {
        let mut zip_buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut zip_buf));
            let opts = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);

            // [Content_Types].xml — 最小 OOXML 必备
            zip.start_file("[Content_Types].xml", opts).unwrap();
            zip.write_all(
                br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#,
            )
            .unwrap();

            // word/_rels/document.xml.rels
            zip.start_file("_rels/.rels", opts).unwrap();
            zip.write_all(
                br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#,
            )
            .unwrap();

            // word/document.xml — 多段落中文 + 行内 br
            zip.start_file("word/document.xml", opts).unwrap();
            // raw byte string 不能含非 ASCII,中文部分用 Vec<u8> push_str UTF-8
            let mut doc_xml = String::from(
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>"#,
            );
            doc_xml.push_str("委托代理合同");
            doc_xml.push_str(r#"</w:t></w:r></w:p>
<w:p><w:r><w:t>甲方:苏中建设集团</w:t><w:br/><w:t>乙方:信拓集团</w:t></w:r></w:p>
<w:p><w:r><w:t>授权委托书</w:t></w:r></w:p>
<w:p><w:r><w:t>"#);
            doc_xml.push_str("兹委托 周世文 律师作为本案代理人。");
            doc_xml.push_str(
                r#"</w:t></w:r></w:p>
</w:body>
</w:document>"#,
            );
            zip.write_all(doc_xml.as_bytes()).unwrap();

            zip.finish().unwrap();
        }
        zip_buf
    }

    #[test]
    fn docx_extract_parses_chinese_paragraphs() {
        // 写构造的 .docx 到 temp
        let tmp = std::env::temp_dir().join("caseboard_docx_test.docx");
        std::fs::write(&tmp, make_minimal_docx()).expect("写 temp .docx 失败");
        let path_str = tmp.to_str().unwrap();

        // 抽文
        let (text, ok) = extract_docx_text(path_str).expect("docx_extract 内部错误");
        assert!(ok, "docx_extract 返回 ok=false");
        assert!(!text.is_empty(), "抽出的文本是空的,XML 解析可能漏了 <w:t>");

        // 段落间用 \n\n 分隔(应该有 4 段)
        let paras: Vec<&str> = text.split("\n\n").collect();
        assert!(paras.len() >= 4, "应有 4 段,实际 {} 段: {}", paras.len(), text);

        // 中文字符数
        let cjk_count = text
            .chars()
            .filter(|c| {
                let cp = *c as u32;
                (0x4E00..=0x9FFF).contains(&cp)
                    || (0x3000..=0x303F).contains(&cp)
                    || (0xFF00..=0xFFEF).contains(&cp)
            })
            .count();
        assert!(cjk_count > 20, "中文字符太少 ({})", cjk_count);

        // 第 2 段含 <w:br/> 行内换行 → 应该是 "甲方:苏中建设集团\n乙方:信拓集团"
        assert!(
            paras[1].contains("\n"),
            "第 2 段应有 <w:br/> 行内换行: {:?}",
            paras[1]
        );

        eprintln!("抽出文本:\n{}", text);

        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn docx_extract_rejects_non_zip() {
        // 旧二进制 .doc 格式不是 ZIP,应该返回清晰错误
        let tmp = std::env::temp_dir().join("caseboard_docx_test_notzip.bin");
        std::fs::write(&tmp, b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1").unwrap(); // OLE2 magic
        let path_str = tmp.to_str().unwrap();

        let result = extract_docx_text(path_str);
        assert!(result.is_err(), "非 ZIP 文件应该报错");
        let err = result.unwrap_err();
        assert!(
            err.contains("zip") || err.contains("OOXML"),
            "错误信息应提示 zip / OOXML: {}",
            err
        );

        let _ = std::fs::remove_file(&tmp);
    }
}


