//! 用户设置的读写。
//!
//! 设计原则(对应 CLAUDE.md 隐私铁律):
//!   - **每个用户填自己的 token**,工具不内置任何人的 key
//!   - 配置落本机 `~/Library/Application Support/CaseBoard/settings.json`
//!   - V0.1 明文存(本机用户文件保护即可);V0.2 升 macOS Keychain
//!   - 飞书反馈 webhook 不在这里(它是编译时常量,所有用户共用,
//!     接收方是作者;放在 task #8 单独处理)
//!
//! 文件结构(扁平,V0.1 简单优先):
//! ```json
//! {
//!   "mineru_api_key": "",
//!   "mineru_endpoint": "https://api.mineru.net/v1",
//!   "ollama_endpoint": "http://localhost:11434",
//!   "ollama_model": "qwen2.5:7b"
//! }
//! ```

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::chat::mcp_bridge::McpServerConfig;
use crate::db::app_data_dir;

/// 用户配置。字段全部 Option<String>,因为初始全是空的。
///
/// 这里**只放每个用户私有的配置**——不放飞书 webhook 这种"全局共享"的常量。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// 用户的显示称呼(例:"刘律师" / "周律师"),首页问候用。
    /// 留空时显示"律师"作为兜底。2026-05-23 晚九加。
    pub user_display_name: Option<String>,

    // ===== 2026-05-23 加(作者隐私分流决策,详见 docs/产品决策与理念.md 第 2 节) =====
    /// 用户是否完成过 onboarding。
    ///
    /// **默认 false** —— 首次启动 App 检测到为 false 时,强制弹 OnboardingWizard 让用户做选择。
    /// 完成后置 true,后续启动跳过 onboarding。
    pub setup_completed: bool,

    // ===== 2026-05-23 晚六 二维独立分流(替代原 cloud_enabled) =====
    /// OCR 后端选择:`"local"` = 本机 MiniCPM-V vision / `"cloud"` = MinerU 在线
    pub ocr_provider: Option<String>,
    /// LLM 后端选择:`"local"` = 本机 MiniCPM-V chat / `"cloud"` = DeepSeek
    pub llm_provider: Option<String>,

    /// 本机模型目录(放 MiniCPM-V-4_6-Q8_0.gguf 和 mmproj-model-f16.gguf)
    ///
    /// 默认会建议 `~/.cache/caseboard/models/`,用户也可以指定其他目录(比如已经下载在
    /// `~/.lmstudio/models/openbmb/MiniCPM-V-4.6-gguf/`)
    pub local_model_dir: Option<String>,
    /// 是否允许 App 自动拉起 llama-server(默认 true,用户不用动终端)
    pub local_server_auto_start: Option<bool>,

    // ===== 旧字段:保留作向后兼容,迁移到新字段后还会用一段时间 =====
    /// [DEPRECATED] 老的"全局云端开关",2026-05-23 晚六改成 ocr_provider/llm_provider 独立
    /// 仍保留是为了不破坏老配置 — read 时如果新字段空就 fall back 到这个
    pub cloud_enabled: bool,

    /// MinerU 在线 OCR 的 API key(用户自己注册账号拿)
    pub mineru_api_key: Option<String>,
    /// MinerU endpoint(一般不用改,默认值)
    pub mineru_endpoint: Option<String>,

    /// 2026-06-12:PaddleOCR VL-1.6(百度 AI Studio 星河社区)访问令牌。
    /// 申请:https://aistudio.baidu.com/account/accessToken,免费 20,000 页/天。
    /// 作者实测与 MinerU 精度打平、速度约快一倍;详 ingest/paddle_vl_http.rs 头注释。
    pub paddle_vl_api_key: Option<String>,
    /// PaddleOCR key 验证通过时间(坑#11:新 cloud key 必配 verified_at,改 key 重置)
    pub paddle_vl_verified_at: Option<String>,
    /// 云端 OCR 主力选择:`"mineru"`(默认,老用户零感知)/ `"paddle-vl"`。
    /// 另一个自动成为备用:主力失败 / 超时 / 额度用完时,**备用 key 已填**才自动切换。
    pub ocr_cloud_primary: Option<String>,

    /// 本机 llama-server endpoint(默认 http://127.0.0.1:8899)
    /// 字段名是历史包袱 "ollama_*",实际用的是 llama.cpp 的 llama-server
    pub ollama_endpoint: Option<String>,
    /// 本机 LLM 模型名(默认 MiniCPM-V-4_6-Q8_0.gguf)
    pub ollama_model: Option<String>,

    /// 云端 LLM endpoint(默认推荐 DeepSeek `https://api.deepseek.com`)
    pub cloud_llm_endpoint: Option<String>,
    /// 云端 LLM 模型档位(V0.3 统一为唯一的模型选择,被 `model_router::route_model` 读取):
    ///   - `'deepseek-v4-flash'`(默认)= 全局 Flash(便宜,约 pro 的 1/3 价)
    ///   - `'deepseek-v4-pro'` / `'deepseek-v4-pro-thinking'` = 全局 Pro(更准更贵)
    ///   - `'auto'` = 自动挡(简单走 flash,复杂走 pro)
    ///
    /// 默认 flash;不再有"工具型任务偷偷强制 pro"的隐藏逻辑。
    pub cloud_llm_model: Option<String>,
    /// 云端 LLM API key
    pub cloud_llm_api_key: Option<String>,

    /// 2026-06-12 V0.3.14:云端 LLM 后端选择。`"deepseek"`(默认) / `"minimax"`。
    /// 老配置 None = 默认 deepseek(向后兼容)。
    /// 选择决定 `LlmConfig::from_settings` 走哪条 endpoint / 模型 / api_key 链路,
    /// 也决定 `deepseek/mod.rs` 余额查询是否发起远程请求。
    pub cloud_llm_backend: Option<String>,
    /// 2026-06-12 V0.3.14:MiniMax API key(独立字段,跟 deepseek 互不干扰)。
    pub minimax_api_key: Option<String>,
    /// 2026-06-12 V0.3.14:MiniMax endpoint(默认 `https://api.minimaxi.com`)。
    pub minimax_endpoint: Option<String>,
    /// 2026-06-12 V0.3.14:MiniMax 模型档位(覆盖 cloud_llm_model,允许每个后端独立配):
    ///   - `'minimax-M2.7'`(默认)= 轻量档
    ///   - `'minimax-M3'` = 强推理档(默认开思考)
    ///   - `'auto'` = 自动挡(短问 M2.7 / 长问 + 推理关键词 M3)
    pub minimax_model: Option<String>,

    /// 2026-05-24 k:元典法律开放平台 API key — 执行案件查被执行人 / 失信 / 财产线索 用
    /// 申请:https://open.chineselaw.com/
    pub yuandian_api_key: Option<String>,

    /// 2026-06-01 V0.3:快递100 实时查询 customer 编号 + 授权 key(快递查询工具用)。
    /// 申请:https://api.kuaidi100.com/(个人免费版约 50 次/天,无需企业资质)。
    /// 签名 = 大写 MD5(param + key + customer)。两者都填了才启用快递查询。
    pub kuaidi100_customer: Option<String>,
    pub kuaidi100_key: Option<String>,

    /// 2026-06-01 V0.3.3:Embedding 云端模型(案件文档语义检索)。OpenAI 兼容 /embeddings。
    /// 默认硅基流动 BAAI/bge-m3(免费);填了 api_key 才启用语义检索,否则回退关键词选材料。
    /// 申请:https://cloud.siliconflow.cn/me/account/ak
    pub embedding_endpoint: Option<String>,
    pub embedding_model: Option<String>,
    pub embedding_api_key: Option<String>,
    /// embedding key 验证通过时间(坑#11:新 cloud key 必配 verified_at,改 key 重置)
    pub embedding_verified_at: Option<String>,

    /// 2026-05-24 e:匿名反馈识别码(UUID v4),首次启动时自动生成 + 持久化。
    /// 跟用户名/邮箱无关 — 作者拿到反馈 MD 后可以识别"这个 ID 之前反馈过"。
    /// 用户能在设置里清空重生成(类比换匿名 ID)。
    pub client_id: Option<String>,

    /// 2026-05-25 V0.1.6:MinerU key 通过验证的时间(ISO 8601)。
    /// 非 null = 用户点过「验证」按钮且通过,UI 显示绿勾。
    /// 用户改 key 会被清空(前端逻辑控制)。
    pub mineru_verified_at: Option<String>,
    /// DeepSeek key 通过验证的时间(同上)。
    pub deepseek_verified_at: Option<String>,
    /// 2026-06-12 V0.3.14:MiniMax key 通过验证的时间(同上)。
    /// 跟 `deepseek_verified_at` 完全独立 —— 后端 = deepseek 时读老字段,后端 = minimax 时读这个。
    pub minimax_verified_at: Option<String>,
    /// 2026-05-25 V0.1.8:元典 key 通过验证的时间(同上)。
    pub yuandian_verified_at: Option<String>,

    /// 2026-05-26 V0.1.13:首页"在办案件"卡片用户拖动排序。
    /// 数组里的 case_id 按用户拖动后的顺序排;**没在数组里的案件**
    /// 按 listCases 默认顺序追加在末尾(新建案件不会被忘记)。
    /// 删过的案件 id 留在数组里也无害(前端 filter 掉)。
    pub home_case_order: Option<Vec<String>>,

    // ===== V0.2 D2 新增 · 本地知识库 + chat V2 budget =====
    /// 2026-05-27 V0.2:本地法律知识库根目录(支持 `~/` tilde 展开)。
    /// `None` = 不启用本地 KB,所有元典查询都走在线 + DB 临时缓存;
    /// 指向一个存在的目录 = LocalKb::auto_detect 启用,元典缓存写入
    /// `<root>/raw/yuandian-cache/`,chat 工具优先查本地。
    pub local_kb_root: Option<String>,
    /// 本地 KB 总开关(为 false 时即使 local_kb_root 有值也不启用,给用户临时停用的能力)
    pub local_kb_enabled: Option<bool>,

    /// 元典积分月度上限(整数,单位:1 次普通查询 = 1 积分;聚合查询 = 5)。
    /// `None` = 不限制。超出阈值时,chat 自动降级到 KB Stale 命中,不再发起在线调用。
    pub yuandian_monthly_credit_limit: Option<u32>,

    // V0.3:模型档位已统一到 `cloud_llm_model`(flash / pro / pro-thinking / 'auto' 自动挡),
    // 原 `chat_default_model` 字段已废弃移除(旧 settings.json 里的该键会被 serde 忽略)。
    /// chat 总上下文 char 预算(默认 300_000,~200K token)
    pub chat_context_budget_total: Option<u32>,
    /// chat system prompt + 案件快照 + 工具 schema 段 char 预算(默认 150_000)
    pub chat_context_budget_system: Option<u32>,
    /// chat 引用文档全文段 char 预算(默认 120_000)
    pub chat_context_budget_attached: Option<u32>,
    /// chat 历史对话段 char 预算(默认 40_000,超出走 compaction)
    pub chat_context_budget_history: Option<u32>,
    /// chat agent loop 最大迭代轮数(默认 12;见 with_defaults_for_display)
    pub chat_loop_max_iters: Option<u32>,
    /// chat 单条消息最多引用文档数(默认 5)
    pub chat_max_attached: Option<u32>,
    /// V0.3.6 · 外部 MCP server 白名单(CaseBoard 当客户端消费其工具)。默认空 = 桥接关闭、零行为变化。
    /// 每项 `{name, transport:{type:"stdio",command,args,env}|{type:"http",url}, enabled}`,详 ADR-0008。
    pub mcp_servers: Vec<McpServerConfig>,

    /// 2026-06-10 团队版 Phase 1(LAN 接力同步,详 docs/提案-团队版-2026-06-10.md §6)。
    /// None = 未加入团队,团队功能整体关闭零开销。secret/配对码跟 API key 同级:只存本机不进 git。
    pub team: Option<crate::team::TeamIdentity>,
}

impl Settings {
    /// 获取**真实生效**的 OCR provider。
    ///
    /// **V0.3(2026-05-31)暂时隐藏本地模型 → 强制云端(MinerU)。** 本地分支代码
    /// (`ingest/ocr.rs` 的 vision 路径)保留休眠;无论存的是 `cloud` / `local`(含老配置
    /// 残留)/ None,一律返回 `"cloud"`,顺带消化老用户 `ocr_provider="local"` 残留。
    /// **恢复本地**:把本函数改回读 `self.ocr_provider`(原逻辑见 git),同时恢复
    /// `effective_llm_provider` + `needs_local_server` 下游(pipeline 自动起 llama-server /
    /// feedback 诊断 / detect_local_readiness 引导)+ 前端 UI 入口即可。
    pub fn effective_ocr_provider(&self) -> &str {
        "cloud"
    }

    /// 云端 OCR 主力(2026-06-12)。`"paddle-vl"` 仅当用户显式选择**且** key 已填才生效,
    /// 否则一律 `"mineru"`(老用户 / key 被清掉后零感知回到原行为)。
    pub fn effective_ocr_cloud_primary(&self) -> &str {
        let paddle_key_set = self
            .paddle_vl_api_key
            .as_deref()
            .is_some_and(|k| !k.trim().is_empty());
        match self.ocr_cloud_primary.as_deref() {
            Some("paddle-vl") if paddle_key_set => "paddle-vl",
            _ => "mineru",
        }
    }

    /// 获取**真实生效**的 LLM provider。**V0.3 暂时隐藏本地模型 → 强制云端(DeepSeek)。**
    /// 同 `effective_ocr_provider`:本地分支(`llm/mod.rs::from_settings` 的 else)保留休眠。
    pub fn effective_llm_provider(&self) -> &str {
        "cloud"
    }

    /// 任何一个 provider 用到了本机,就需要 llama-server。
    /// V0.3 隐藏本地后 `effective_*` 恒 cloud → 本函数恒 false(pipeline 不再自动起本机服务)。
    pub fn needs_local_server(&self) -> bool {
        self.effective_ocr_provider() == "local" || self.effective_llm_provider() == "local"
    }

    /// 2026-06-12 V0.3.14:云端 LLM 后端选择(`"deepseek"` / `"minimax"`)。
    /// 老配置 None / 空字符串 / 不识别的值 = 默认 `"deepseek"`(零感知兼容)。
    pub fn effective_cloud_llm_backend(&self) -> &str {
        match self.cloud_llm_backend.as_deref().map(str::trim) {
            Some("minimax") => "minimax",
            Some("deepseek") | None | Some("") => "deepseek",
            // 兜底:不识别值一律按 deepseek 处理,跟老逻辑一致
            Some(_) => "deepseek",
        }
    }

    /// 2026-06-12 V0.3.14:当前后端生效的 API key。
    pub fn effective_cloud_llm_api_key(&self) -> Option<String> {
        match self.effective_cloud_llm_backend() {
            "minimax" => self.minimax_api_key.clone().filter(|k| !k.trim().is_empty()),
            _ => self.cloud_llm_api_key.clone().filter(|k| !k.trim().is_empty()),
        }
    }

    /// 2026-06-12 V0.3.14:当前后端生效的 endpoint。`None` 由 LlmConfig::from_settings 兜默认。
    pub fn effective_cloud_llm_endpoint(&self) -> Option<String> {
        match self.effective_cloud_llm_backend() {
            "minimax" => self.minimax_endpoint.clone(),
            _ => self.cloud_llm_endpoint.clone(),
        }
    }

    /// 2026-06-12 V0.3.14:当前后端生效的「模型档位」。`None` 时交给 model_router 用 backend 默认。
    pub fn effective_cloud_llm_model(&self) -> Option<String> {
        match self.effective_cloud_llm_backend() {
            "minimax" => self.minimax_model.clone(),
            _ => self.cloud_llm_model.clone(),
        }
    }

    /// 2026-06-12 V0.3.14:当前后端 key 是否验证过(绿勾判据)。
    pub fn effective_cloud_llm_verified_at(&self) -> Option<&String> {
        match self.effective_cloud_llm_backend() {
            "minimax" => self.minimax_verified_at.as_ref().filter(|s| !s.trim().is_empty()),
            _ => self.deepseek_verified_at.as_ref().filter(|s| !s.trim().is_empty()),
        }
    }
}

impl Settings {
    /// 给前端返回时,用 sensible 默认值补全空字段(便于直接渲染表单)。
    /// 注意:**这里不返回任何 token 默认值**——key 一律保持用户输入。
    pub fn with_defaults_for_display(self) -> Self {
        // 只对「有内置默认值」的字段填默认,其余字段一律 `..self` 原样透传。
        // 用 `..self` 而非逐字段手列:以后给 Settings 加字段会自动继承原值,
        // 不会因为这里漏写一行而被静默丢成默认(B14 防漏映射)。
        Self {
            local_server_auto_start: self.local_server_auto_start.or(Some(true)),
            mineru_endpoint: self
                .mineru_endpoint
                .or_else(|| Some("https://mineru.net/api/v4".to_string())),
            ollama_endpoint: self
                .ollama_endpoint
                .or_else(|| Some("http://127.0.0.1:8899".to_string())),
            ollama_model: self
                .ollama_model
                .or_else(|| Some("MiniCPM-V-4_6-Q8_0.gguf".to_string())),
            cloud_llm_endpoint: self
                .cloud_llm_endpoint
                .or_else(|| Some("https://api.deepseek.com".to_string())),
            cloud_llm_model: self
                .cloud_llm_model
                .or_else(|| Some("deepseek-v4-flash".to_string())),
            // 2026-06-12 V0.3.14:MiniMax 默认值兜底。None = 用 deepseek(老用户零感知)。
            cloud_llm_backend: self
                .cloud_llm_backend
                .or_else(|| Some("deepseek".to_string())),
            minimax_endpoint: self
                .minimax_endpoint
                .or_else(|| Some("https://api.minimaxi.com".to_string())),
            minimax_model: self
                .minimax_model
                .or_else(|| Some("minimax-M2.7".to_string())),
            embedding_endpoint: self
                .embedding_endpoint
                .or_else(|| Some(crate::embedding::DEFAULT_ENDPOINT.to_string())),
            embedding_model: self
                .embedding_model
                .or_else(|| Some(crate::embedding::DEFAULT_MODEL.to_string())),
            chat_context_budget_total: self.chat_context_budget_total.or(Some(300_000)),
            chat_context_budget_system: self.chat_context_budget_system.or(Some(150_000)),
            chat_context_budget_attached: self.chat_context_budget_attached.or(Some(120_000)),
            chat_context_budget_history: self.chat_context_budget_history.or(Some(40_000)),
            chat_loop_max_iters: self.chat_loop_max_iters.or(Some(16)),
            chat_max_attached: self.chat_max_attached.or(Some(5)),
            ..self
        }
    }
}

/// 拿到 settings.json 的路径(跟 caseboard.db 在同一个目录)。
pub fn settings_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()
        .map_err(|e| format!("找不到数据目录: {}", e))?
        .join("settings.json"))
}

/// 读取设置。文件不存在 / 解析失败,**不报错**,返回 `Settings::default()`。
/// 第一次启动时这是预期行为。
pub fn read_settings() -> Result<Settings, String> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(Settings::default());
    }
    let text =
        std::fs::read_to_string(&path).map_err(|e| format!("读 settings.json 失败: {}", e))?;
    if text.trim().is_empty() {
        return Ok(Settings::default());
    }
    serde_json::from_str::<Settings>(&text).map_err(|e| format!("settings.json 格式错误: {}", e))
}

/// 写入设置(覆盖)。会自动创建父目录。
pub fn write_settings(settings: &Settings) -> Result<(), String> {
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("建目录失败: {}", e))?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&path, text).map_err(|e| format!("写 settings.json 失败: {}", e))?;
    Ok(())
}

/// 2026-05-24 e:确保 client_id 存在(给反馈通道用的匿名识别码)。
///
/// 如果 settings.client_id 为空,生成新 UUID v4 并持久化;返回最终的 client_id。
/// 跟用户名/邮箱无关,纯随机。作者拿到反馈 MD 可识别"是否同一个人多次反馈"。
pub fn ensure_client_id() -> Result<String, String> {
    let mut s = read_settings()?;
    if let Some(existing) = s.client_id.as_ref() {
        if !existing.trim().is_empty() {
            return Ok(existing.clone());
        }
    }
    let new_id = uuid::Uuid::new_v4().to_string();
    s.client_id = Some(new_id.clone());
    write_settings(&s)?;
    Ok(new_id)
}

// ============================================================================
// 测试
// ============================================================================
