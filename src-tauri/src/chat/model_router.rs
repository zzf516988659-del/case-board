//! V0.2 D4-D5.B · 模型路由(V0.3 重构:统一到 `settings.cloud_llm_model` 单一字段)。
//!
//! 把 `(TaskType, user_message, Settings)` 映射到具体 DeepSeek 模型 + 温度 + max_tokens。
//!
//! **用户在设置里只有一个选择 `cloud_llm_model`(= 三档「模型档位」)**:
//!   - `"deepseek-v4-flash"`(默认)= **全局 Flash**:所有任务都走 flash(便宜,约 pro 的 1/3 价)。
//!   - `"deepseek-v4-pro"` / `"deepseek-v4-pro-thinking"` = **全局 Pro**:所有任务都走 pro(更准更贵)。
//!   - `"auto"` = **自动挡**:简单任务走 flash、复杂任务走 pro(下面的 task 路由表)。
//!
//! 关键:**非 auto 档绝不"偷偷"把某些任务升到 pro**(老逻辑工具型 chip 强制 pro 烧钱,已废)。
//! 自动挡(auto)下才按任务复杂度分流(V0.3.3 起 6 个生成型 chip 已删):
//!   - 4 个工具/分析型(法律依据/类案/校验/模拟对抗) → pro
//!   - FreeChat → 启发式:短问/无 reasoning 关键词 = flash,否则 pro

use serde::Serialize;

use super::context::TaskType;
use crate::settings::Settings;

/// 路由结果。给 agent_loop / commands 用,代替原来硬编码的 temperature / max_tokens。
#[derive(Debug, Clone, Serialize)]
pub struct ModelChoice {
    pub model: String,
    pub temperature: f32,
    pub max_tokens: u32,
}

/// DeepSeek V4 输出长度上限(官方文档:context 1M / output 最大 384K)。
/// flash / pro 用同一上限——旧的 4096/8192 低值会把长文书拦腰截断(`finish_reason=length`,
/// 体感像「写一半就傻了」)。这是「天花板」不是「目标」:只在模型真写那么长时才计费,
/// 短问答仍会自然停(`finish_reason=stop`)。模型档位(flash/pro)由作者在 Settings 手切,本值不区分。
pub const MAX_OUTPUT_TOKENS: u32 = 384_000;

impl ModelChoice {
    /// 2026-06-12 V0.3.14:flash(轻量档)模型 + 温度。
    ///   - backend=deepseek → "deepseek-v4-flash",温度 0.3
    ///   - backend=minimax  → "minimax-M2.7",温度 0.3
    pub fn flash(settings: &Settings) -> Self {
        let (model, temperature) = match settings.effective_cloud_llm_backend() {
            "minimax" => ("minimax-M2.7", 0.3),
            _ => ("deepseek-v4-flash", 0.3),
        };
        Self {
            model: model.into(),
            temperature,
            max_tokens: MAX_OUTPUT_TOKENS,
        }
    }

    /// 2026-06-12 V0.3.14:pro(强推理档)模型 + 温度。
    ///   - backend=deepseek → "deepseek-v4-pro" 或 "deepseek-v4-pro-thinking"(开思考)
    ///   - backend=minimax  → "minimax-M3"(M3 默认开思考,无独立 thinking 模型名)
    /// 第二个参数 `with_reasoning` 在 deepseek backend 下生效;minimax 下忽略(M3 恒思考)。
    pub fn pro(settings: &Settings) -> Self {
        let (model, temperature) = match settings.effective_cloud_llm_backend() {
            "minimax" => ("minimax-M3", 0.6), // 官方建议温度 0.6,M3 默认思考
            _ => ("deepseek-v4-pro", 0.15),
        };
        Self {
            model: model.into(),
            temperature,
            max_tokens: MAX_OUTPUT_TOKENS,
        }
    }

    /// 把用户在 Settings 强制选定的 model 字符串包装成 ModelChoice。
    /// 不识别的 model 名透传(让服务商自己报 400)。
    /// 2026-06-12 V0.3.14:温度按 model 名字特征判断,不再硬编码 backend。
    pub fn from_forced(model: &str) -> Self {
        let is_pro = model.contains("pro") || model.contains("M3") || model.contains("m3");
        let temperature = if model.contains("M3") || model.contains("m3") {
            0.6 // MiniMax-M3 官方建议
        } else if is_pro {
            0.15
        } else {
            0.3
        };
        Self {
            model: model.to_string(),
            temperature,
            max_tokens: MAX_OUTPUT_TOKENS,
        }
    }
}

/// 路由主入口。统一读 `settings.cloud_llm_model` 这一个「模型档位」字段。
///
/// 2026-06-12 V0.3.14:根据 `settings.effective_cloud_llm_backend()` 决定默认模型名。
///   - `"deepseek"` → 默认 `"deepseek-v4-flash"`
///   - `"minimax"`  → 默认 `"minimax-M2.7"`
/// 用户显式选了具体模型名(非 "auto")时透传,不再做 backend 区分。
pub fn route_model(task: TaskType, user_message: &str, settings: &Settings) -> ModelChoice {
    // 默认模型 = backend 默认(老用户 deepseek 零感知)
    let default_model = match settings.effective_cloud_llm_backend() {
        "minimax" => "minimax-M2.7",
        _ => "deepseek-v4-flash",
    };
    // 档位:空字符串 / None → backend 默认
    let model_setting = settings.effective_cloud_llm_model();
    let mode = model_setting
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(default_model);

    // 全局档(非 auto):所有任务都用这个模型,不再按任务强制 pro。
    if mode != "auto" {
        return ModelChoice::from_forced(mode);
    }

    // 自动挡(auto):按任务复杂度分流,模型名也按 backend 选
    match task {
        // 4 个工具/分析型 → pro(不开 reasoning,保持稳定 strict mode)
        TaskType::CompileLegalBasis
        | TaskType::FindSimilarCases
        | TaskType::VerifyMyDraft
        | TaskType::SimulateOpposition => ModelChoice::pro(settings),
        // 自由问 → 启发式
        TaskType::FreeChat => route_free_chat(user_message, settings),
    }
}

/// 启发式:短问(<30 字)或不带"推理类"关键词 → flash;否则 pro。
fn route_free_chat(msg: &str, settings: &Settings) -> ModelChoice {
    let chars = msg.chars().count();
    if chars < 30 {
        return ModelChoice::flash(settings);
    }
    const REASONING_KEYWORDS: &[&str] = &[
        "建议",
        "分析",
        "为什么",
        "怎么办",
        "如何",
        "拒执",
        "风险",
        "怎么处理",
        "策略",
        "对比",
        "评估",
        "推理",
    ];
    if REASONING_KEYWORDS.iter().any(|k| msg.contains(k)) {
        ModelChoice::pro(settings)
    } else {
        ModelChoice::flash(settings)
    }
}
