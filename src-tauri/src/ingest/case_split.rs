//! 多案件文件夹检测(Phase 1 · 2026-06-04 · 纯结构启发式,只读不写库)。
//!
//! 详见 `docs/提案-多案件文件夹识别-2026-06-04.md`。
//!
//! 目标:拖一个文件夹进来,判断它该拆成 1~N 个案件。覆盖三类:
//! - **单案件**(保底):文件夹直接放文档 → 1 个案件。
//! - **多案·已整理**:顶层 `02_案件A/ 03_案件B/ 01_原告与共用证据/` → N 案件 + 共用材料。
//! - **年份大文件夹**:`2026/{张三案/, 李四案/, …}` 递归展开成很多案件。
//!
//! ## 核心判别(2026-06-16 修「过拆」· 反馈 ea761d3d)
//! `collect_cases(D)`:
//! 1. children = D 的子目录 **减去** {阶段词 / 共用词 / 杂项词} 命中的、且(递归)含文档的;
//! 2. case_like = children 里**本身含阶段子目录**(`has_stage_subdirs`,组织过的案件强信号)的个数;
//! 3. `case_like >= 2` → D 是容器(递归展开每个候选);否则 D 自己是一个案件。
//!
//! 关键:`案件A/` 下的 `起诉文书 / 法院文件 / 合同与证据 / 律师与主体材料` 等**材料分类目录**
//! 不在阶段词表里、且直接放文件(无阶段子目录)→ case_like=0 → `案件A` 收敛成**一个**案件
//! (旧逻辑只数候选个数 ≥2 就拆,把案件A 误拆成 5 案);
//! 而 `张三/{02_案件A(含01_诉讼文书), 03_案件B(含01_诉讼文书)}` 两候选都含阶段子目录
//! → case_like=2 → `张三` 判为容器 → 拆成两案。

use std::path::{Path, PathBuf};

use serde::Serialize;

/// 阶段子目录词表:命中(剥前缀后 **starts_with**)= 案件**内部**的组织子目录,不单独成案。
/// 用 starts_with 而非 contains —— 否则「张三借贷材料」这类**案件名**会被「材料」误判成阶段目录。
/// 故只收**具体**阶段词,且要求目录名以其开头(`01_诉讼文书`→`诉讼文书`✓ / `张三执行案`✗)。
const STAGE_HINTS: &[&str] = &[
    "诉讼文书",
    "法院文书",
    "最终结果",
    "盖章扫描",
    "执行",
    "证据",
    "身份",
];
/// 共用材料词表:必须含「分享」语义(contains;「证据」单独不算,避免和证据阶段目录撞)。
const SHARED_HINTS: &[&str] = &["共用", "共享", "共同", "通用"];
/// 杂项/忽略目录词表(contains)。
const MISC_HINTS: &[&str] = &["后续", "待整理", "归档备份", "其他", "其它"];
/// 非案件资料词表(contains,剥前缀后匹配)。命中 → 候选**默认不勾选**(`default_selected=false`),
/// 但仍作为候选展示给用户(可手动勾上),**不直接丢弃** —— 关键词是「猜默认」,不是「定生死」:
/// 像「宣传侵权案」这类真案件万一撞词,用户在拆分弹窗里勾回即可,不会无可挽回。
///
/// 2026-06-16 加(反馈 ea761d3d 第①问):年度目录下的 `证件 / 宣传资料 / 模板资料 / 企业宣传册`
/// 等非案件目录此前被无差别当成候选案件、默认全勾选导入。
/// 只收**顶层常见**的资料目录名;`办公区域 / 会议室 / 接待洽谈` 这类是 `企业宣传册` 的**深层子目录**,
/// 因 `case_like=0` 已被收敛进「企业宣传册」单候选、不会单独冒泡进候选列表,故无需列。
/// 故意避开会和真案件类型撞的裸词(如「行政」会撞行政诉讼、「管理」太泛),只用够具体的词。
const EXCLUDE_HINTS: &[&str] = &[
    "非案件",
    "证件",
    "证照",
    "宣传",
    "模板",
    "范本",
    "素材",
    "照片",
    "相册",
    "行政资料",
    "律所方案",
    "律所管理",
    "规章制度",
];
/// 不进检测的目录(隐藏 / 系统 / 依赖)。
const IGNORED_DIRS: &[&str] = &[".git", "node_modules", "__MACOSX", ".idea", ".vscode"];
/// 文档型扩展名(用于"目录是否含材料"的计数)。
const DOC_EXTS: &[&str] = &[
    "pdf", "doc", "docx", "txt", "rtf", "odt", "md", "png", "jpg", "jpeg", "webp", "tiff", "bmp",
    "gif", "jp2", "xls", "xlsx", "csv",
];

/// 递归深度上限(年份 → 案件 → 阶段 ≈ 3,留一层余量)。
const MAX_DEPTH: usize = 4;

/// 一个候选案件(对应一个子目录)。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CaseCandidate {
    /// 案件根目录绝对路径(导入时作 source_folder,天然唯一)
    pub dir: String,
    /// 建议案件名(剥掉 `NN_` 序号前缀的目录名)
    pub suggested_name: String,
    /// 目录内(递归)文档数
    pub doc_count: usize,
    /// 是否含阶段子目录(强信号:这是一个组织过的案件)
    pub has_stage_subdirs: bool,
    /// 拆分弹窗里**默认是否勾选**。命中非案件资料词表(`EXCLUDE_HINTS`)→ `false`(默认不选,
    /// 但仍展示可手动勾上)。纯展示/默认值,**不参与** `multi`/`strong` 判定 —— 否则会把弹窗整个吞掉。
    pub default_selected: bool,
}

/// 一个被忽略的目录及原因。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct IgnoredDir {
    pub path: String,
    pub reason: String,
}

/// 拆分预案(只读检测产物,交前端确认弹窗用)。
#[derive(Debug, Clone, Serialize)]
pub struct ImportPlan {
    pub root: String,
    /// 候选案件(已按目录排序)
    pub cases: Vec<CaseCandidate>,
    /// 共用材料目录(Phase 1 先挂主案)
    pub shared_dirs: Vec<String>,
    /// 被忽略的目录(杂项 / 产物 / 空目录)
    pub ignored: Vec<IgnoredDir>,
    /// 是否建议拆分(置信度 medium+;false = 走保底单案)
    pub multi: bool,
    /// 根文件夹此前是否已作为「单个案件」导入过(命令层查 DB 填;拆分会与旧案重复 → 前端告警)
    pub root_already_imported: bool,
}

// ───────────────────────── 名称归一化 + 词表匹配 ─────────────────────────

/// 剥掉目录名开头的 `NN_` / `NN-` / `NN.` / `NN ` 序号前缀(参考文件夹大量使用)。
fn strip_num_prefix(name: &str) -> &str {
    let trimmed = name.trim_start_matches(|c: char| {
        c.is_ascii_digit() || c == '_' || c == '-' || c == ' ' || c == '.' || c == '、'
    });
    if trimmed.is_empty() {
        name
    } else {
        trimmed
    }
}

/// 阶段目录:剥前缀后 **以**某阶段词**开头**(精确,不误伤含该词的案件名)。
fn is_stage_dir(name: &str) -> bool {
    let n = strip_num_prefix(name);
    STAGE_HINTS.iter().any(|h| n.starts_with(h))
}
/// 共用 / 杂项:剥前缀后**包含**该词(描述性命名,如「原告与共用证据」)。
fn is_shared_dir(name: &str) -> bool {
    let n = strip_num_prefix(name);
    SHARED_HINTS.iter().any(|h| n.contains(h))
}
fn is_misc_dir(name: &str) -> bool {
    let n = strip_num_prefix(name);
    MISC_HINTS.iter().any(|h| n.contains(h))
}
/// 非案件资料:剥前缀后**包含**排除词 → 候选默认不勾选(仍展示,用户可手动勾上)。
fn is_exclude_dir(name: &str) -> bool {
    let n = strip_num_prefix(name);
    EXCLUDE_HINTS.iter().any(|h| n.contains(h))
}

// ───────────────────────── 目录遍历工具 ─────────────────────────

fn dir_name(p: &Path) -> String {
    p.file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// 列出直接子目录(过滤隐藏 / 系统 / 依赖)。
fn list_subdirs(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else {
        return out;
    };
    for e in rd.flatten() {
        let p = e.path();
        if !p.is_dir() {
            continue;
        }
        let name = dir_name(&p);
        if name.starts_with('.') || IGNORED_DIRS.contains(&name.as_str()) {
            continue;
        }
        out.push(p);
    }
    out.sort();
    out
}

/// 是否文档型文件(按扩展名)。
fn is_doc_file(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| DOC_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// 递归数目录内的文档数(深度受限,跳过隐藏/系统目录)。
fn doc_count_recursive(dir: &Path, depth: usize) -> usize {
    if depth > MAX_DEPTH {
        return 0;
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut n = 0;
    for e in rd.flatten() {
        let p = e.path();
        let name = dir_name(&p);
        if name.starts_with('.') {
            continue;
        }
        if p.is_dir() {
            if IGNORED_DIRS.contains(&name.as_str()) {
                continue;
            }
            n += doc_count_recursive(&p, depth + 1);
        } else if is_doc_file(&p) {
            n += 1;
        }
    }
    n
}

/// 该目录是否有阶段子目录(强信号:组织过的案件)。
fn has_stage_subdirs(dir: &Path) -> bool {
    list_subdirs(dir).iter().any(|s| is_stage_dir(&dir_name(s)))
}

fn make_candidate(dir: &Path) -> CaseCandidate {
    let raw = dir_name(dir);
    CaseCandidate {
        dir: dir.to_string_lossy().to_string(),
        suggested_name: strip_num_prefix(&raw).to_string(),
        doc_count: doc_count_recursive(dir, 0),
        has_stage_subdirs: has_stage_subdirs(dir),
        default_selected: !is_exclude_dir(&raw),
    }
}

// ───────────────────────── 递归收集案件 ─────────────────────────

/// 收集 `dir` 子树里的案件。容器 → 递归展开;否则 `dir` 自己是一个案件。
fn collect_cases(dir: &Path, depth: usize) -> Vec<CaseCandidate> {
    if depth > MAX_DEPTH {
        return leaf(dir);
    }
    // 先剔除 阶段/共用/杂项 子目录,剩下的才是"可能是子案件"的候选
    let candidate_children: Vec<PathBuf> = list_subdirs(dir)
        .into_iter()
        .filter(|s| {
            let n = dir_name(s);
            !is_stage_dir(&n) && !is_shared_dir(&n) && !is_misc_dir(&n)
        })
        .filter(|s| doc_count_recursive(s, 0) > 0)
        .collect();

    // 2026-06-16 修「过拆」(反馈 ea761d3d):只有当 ≥2 个候选子目录**本身像组织好的案件**
    // (含阶段子目录,has_stage_subdirs)时,才把 dir 当容器递归展开;否则 dir 自己就是一个案件,
    // 它的子目录是「材料分类/阶段」,不是子案件。
    //
    // 旧逻辑用 `candidate_children.len() >= 2`:案件A 下的 `起诉文书 / 法院文件 / 合同与证据 /
    // 保全与查控 / 律师与主体材料` 这些材料目录都不在阶段词表里 → 被当成候选 → 案件A 被误拆成 5 案。
    // 这些材料目录里直接放文件、没有阶段子目录 → case_like=0 → 现在正确收敛成 1 案。
    // 而「张三民间借贷/{02_案件A(含01_诉讼文书), 03_案件B(含01_诉讼文书)}」这种真嵌套容器,
    // 两个候选都含阶段子目录 → case_like=2 → 仍正确递归拆开(保 nested_container_recurses 测试)。
    let case_like = candidate_children
        .iter()
        .filter(|c| has_stage_subdirs(c))
        .count();

    if case_like >= 2 {
        // 容器:递归展开每个候选
        candidate_children
            .iter()
            .flat_map(|c| collect_cases(c, depth + 1))
            .collect()
    } else {
        leaf(dir)
    }
}

/// `dir` 作为单个案件(若含文档)。
fn leaf(dir: &Path) -> Vec<CaseCandidate> {
    if doc_count_recursive(dir, 0) > 0 {
        vec![make_candidate(dir)]
    } else {
        Vec::new()
    }
}

// ───────────────────────── 顶层 plan ─────────────────────────

/// 检测一个文件夹的拆分预案(只读)。
pub fn plan_folder(root: &Path) -> ImportPlan {
    let root_str = root.to_string_lossy().to_string();
    let subdirs = list_subdirs(root);

    // 顶层分流:共用 / 杂项 / 候选
    let mut shared_dirs = Vec::new();
    let mut ignored = Vec::new();
    let mut candidate_children = Vec::new();
    for s in &subdirs {
        let n = dir_name(s);
        if is_shared_dir(&n) {
            shared_dirs.push(s.to_string_lossy().to_string());
        } else if is_misc_dir(&n) {
            ignored.push(IgnoredDir {
                path: s.to_string_lossy().to_string(),
                reason: "杂项/补充目录".to_string(),
            });
        } else if is_stage_dir(&n) {
            // 顶层就是阶段目录 → root 本身是单个案件,不参与拆分
        } else if doc_count_recursive(s, 0) > 0 {
            candidate_children.push(s.clone());
        } else {
            ignored.push(IgnoredDir {
                path: s.to_string_lossy().to_string(),
                reason: "空目录(无文档)".to_string(),
            });
        }
    }

    // 候选 < 2 → 保底:整个 root 作单个案件
    if candidate_children.len() < 2 {
        return single_case_plan(root, &root_str);
    }

    // 候选 ≥ 2 → 递归展开成案件
    let cases: Vec<CaseCandidate> = candidate_children
        .iter()
        .flat_map(|c| collect_cases(c, 1))
        .collect();

    // 置信度门控:≥2 个候选各自(有阶段子目录 或 ≥2 文档)才真拆;否则保底
    let strong = cases
        .iter()
        .filter(|c| c.has_stage_subdirs || c.doc_count >= 2)
        .count();
    if strong < 2 {
        return single_case_plan(root, &root_str);
    }

    ImportPlan {
        root: root_str,
        cases,
        shared_dirs,
        ignored,
        multi: true,
        root_already_imported: false,
    }
}

/// 保底:整个文件夹 = 一个案件(行为同现状单案导入)。
fn single_case_plan(root: &Path, root_str: &str) -> ImportPlan {
    let name = strip_num_prefix(&dir_name(root)).to_string();
    let name = if name.is_empty() {
        "未命名案件".to_string()
    } else {
        name
    };
    ImportPlan {
        root: root_str.to_string(),
        cases: vec![CaseCandidate {
            dir: root_str.to_string(),
            suggested_name: name,
            doc_count: doc_count_recursive(root, 0),
            has_stage_subdirs: has_stage_subdirs(root),
            // 保底单案(multi=false,不弹拆分弹窗)→ 默认勾选无意义,置 true 以示「就这一个」。
            default_selected: true,
        }],
        shared_dirs: Vec::new(),
        ignored: Vec::new(),
        multi: false,
        root_already_imported: false,
    }
}

// ───────────────────────── 测试 ─────────────────────────
