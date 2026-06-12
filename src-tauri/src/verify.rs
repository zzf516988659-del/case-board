//! API key 在线验证(2026-05-25 V0.1.6)。
//!
//! 给前端 Settings / Onboarding 里的「验证」按钮用,验证成功 → 前端在 input 旁打绿勾。
//!
//! 设计:
//!   - DeepSeek 用 `GET /user/balance`(免费,延时低,标准做法)
//!   - MinerU 没有专用 verify 端点(2026-05 查询官方文档),用 `GET /extract/task/<bogus-uuid>`
//!     看返回:401/403 = key 无效;200/404 + 业务错误码 = key 有效(只是任务不存在)
//!   - 元典(open.chineselaw.com)用 `GET /rh_enterpriseSearch?name=test&top_k=1`
//!     看返回:HTTP 401 + `code:401` = key 无效;HTTP 200 = key 有效。会消耗 1 次企业搜索配额。
//!
//! 三个函数都设 8s 超时,不阻塞主线程。

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct VerifyResult {
    /// 是否验证通过
    pub ok: bool,
    /// 失败时给前端展示的中文消息(成功时为空)
    pub message: String,
}

impl VerifyResult {
    fn ok() -> Self {
        Self {
            ok: true,
            message: String::new(),
        }
    }
    fn fail(msg: impl Into<String>) -> Self {
        Self {
            ok: false,
            message: msg.into(),
        }
    }
}

/// 验证 MinerU API token。
///
/// 走 `GET https://mineru.net/api/v4/extract/task/<bogus-uuid>` 看响应:
///   - 401 / 403 → token 无效或过期
///   - 200 / 404 + 业务错误码("task not found" 等)→ token 通过认证
///
/// 用户的 bogus task id 全 0,MinerU 一定查不到,只能返回 token 错或业务"未找到"。
pub async fn verify_mineru_key(token: &str) -> VerifyResult {
    let token = token.trim();
    if token.is_empty() {
        return VerifyResult::fail("Token 为空");
    }
    if !token.starts_with("eyJ") {
        return VerifyResult::fail("格式不像 MinerU JWT token(应以 eyJ 开头)");
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(e) => return VerifyResult::fail(format!("HTTP 客户端创建失败: {}", e)),
    };

    let resp = match client
        .get("https://mineru.net/api/v4/extract/task/00000000-0000-0000-0000-000000000000")
        .bearer_auth(token)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return VerifyResult::fail(format!("网络错误: {}", e)),
    };

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();

    if status.as_u16() == 401 || status.as_u16() == 403 {
        return VerifyResult::fail("Token 无效或已过期,请到 MinerU 控制台重新获取");
    }

    // MinerU 也可能用 200 + 业务 errorCode 表达 token 错
    // 文档里 A0202 = Token Error
    if body.contains("A0202") || body.contains("\"errCode\":\"A0202\"") {
        return VerifyResult::fail("Token 无效(MinerU A0202)");
    }

    // 401 / 403 / A0202 之外都视为通过(查询不存在的任务返回 404 / 业务错都正常)
    VerifyResult::ok()
}

/// 验证 PaddleOCR VL(百度 AI Studio 星河社区)访问令牌(2026-06-12)。
///
/// AI Studio 没有专用 verify 端点,走 `GET /ocr/jobs/00000`(假 job id)看响应
/// (作者 token 实测):
///   - 401 / 403 → token 无效
///   - 404 + 业务 code 11001「jobId 不存在」→ token 通过认证
pub async fn verify_paddle_vl_key(token: &str) -> VerifyResult {
    let token = token.trim();
    if token.is_empty() {
        return VerifyResult::fail("访问令牌为空");
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(e) => return VerifyResult::fail(format!("HTTP 客户端创建失败: {}", e)),
    };

    let resp = match client
        .get("https://paddleocr.aistudio-app.com/api/v2/ocr/jobs/00000")
        .bearer_auth(token)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return VerifyResult::fail(format!("网络错误: {}", e)),
    };

    if resp.status().as_u16() == 401 || resp.status().as_u16() == 403 {
        return VerifyResult::fail("访问令牌无效或已过期,请到 AI Studio 重新获取");
    }
    // 401/403 之外都视为通过(查不存在的 job 返回 404 + code 11001 是预期)
    VerifyResult::ok()
}

/// 验证 DeepSeek API key。
///
/// 走 `GET {endpoint}/user/balance` 看 200。
pub async fn verify_deepseek_key(api_key: &str, endpoint: Option<&str>) -> VerifyResult {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return VerifyResult::fail("API Key 为空");
    }
    if !api_key.starts_with("sk-") {
        return VerifyResult::fail("格式不像 DeepSeek API key(应以 sk- 开头)");
    }

    let base = endpoint
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("https://api.deepseek.com");
    let base = base.trim_end_matches('/');
    let url = format!("{}/user/balance", base);

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(e) => return VerifyResult::fail(format!("HTTP 客户端创建失败: {}", e)),
    };

    let resp = match client
        .get(&url)
        .bearer_auth(api_key)
        .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return VerifyResult::fail(format!("网络错误: {}", e)),
    };

    let status = resp.status();
    if status.is_success() {
        return VerifyResult::ok();
    }
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return VerifyResult::fail("API Key 无效或已过期");
    }
    let body = resp.text().await.unwrap_or_default();
    VerifyResult::fail(format!(
        "HTTP {} · {}",
        status.as_u16(),
        body.chars().take(200).collect::<String>()
    ))
}

/// 2026-06-12 V0.3.14:验证 MiniMax API key(OpenAI 兼容标准端点)。
///
/// 走 `GET {endpoint}/v1/models` 看 200。MiniMax 没有 `/user/balance` 这种余额端点
/// (公开文档没有,跟 DeepSeek 不同),用 OpenAI 标准的 `/v1/models` 鉴权。
pub async fn verify_minimax_key(api_key: &str, endpoint: Option<&str>) -> VerifyResult {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return VerifyResult::fail("API Key 为空");
    }
    // MiniMax key 格式不一(JWT / sk-eyJ... / 自定义),不强制前缀,长度 >= 8 即可
    if api_key.len() < 8 {
        return VerifyResult::fail("API Key 太短(小于 8 位),可能填错了");
    }

    let base = endpoint
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("https://api.minimaxi.com");
    let base = base.trim_end_matches('/');
    // 用户可能只填 base URL,也可能填到 /v1,统一补 /v1/models
    let base = if base.ends_with("/v1") || base.contains("/v1/") {
        base.to_string()
    } else {
        format!("{}/v1", base)
    };
    let url = format!("{}/models", base);

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(e) => return VerifyResult::fail(format!("HTTP 客户端创建失败: {}", e)),
    };

    let resp = match client
        .get(&url)
        .bearer_auth(api_key)
        .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return VerifyResult::fail(format!("网络错误: {}", e)),
    };

    let status = resp.status();
    if status.is_success() {
        return VerifyResult::ok();
    }
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return VerifyResult::fail("API Key 无效或已过期");
    }
    let body = resp.text().await.unwrap_or_default();
    VerifyResult::fail(format!(
        "HTTP {} · {}",
        status.as_u16(),
        body.chars().take(200).collect::<String>()
    ))
}

/// 验证元典(open.chineselaw.com)API key。
///
/// 两段探测:
///   1. `GET /rh_enterpriseSearch?name=test&top_k=1` — 基础企业接口(老套餐就有)
///   2. `POST /hall_detect {"text":"《民法典》第1条"}` — V0.2 chat 依赖的法律幻觉校验
///      (新套餐才解锁,V0.2 实施时加这一步预先暴露套餐问题)
///
/// 判定:
///   - 1 失败 → fail(基础接口都不通,key 大概率失效)
///   - 1 ok + 2 ok → ok
///   - 1 ok + 2 失败(401/403)→ fail(套餐没解锁 hall_detect,chat 功能受限)
///   - 1 ok + 2 失败(其他错误)→ ok + 服务侧异常,不让用户卡在这
///
/// 注意:元典 key 格式 `sk_` 开头(注意是下划线,不是 DeepSeek 的 sk-)。
pub async fn verify_yuandian_key(api_key: &str) -> VerifyResult {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return VerifyResult::fail("API Key 为空");
    }
    if !api_key.starts_with("sk_") {
        return VerifyResult::fail("格式不像元典 API key(应以 sk_ 开头,注意是下划线)");
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(e) => return VerifyResult::fail(format!("HTTP 客户端创建失败: {}", e)),
    };

    // === 第 1 段:基础企业搜索 ===
    let resp = match client
        .get("https://open.chineselaw.com/open/rh_enterpriseSearch")
        .header("X-Api-Key", api_key)
        .header("accept", "application/json;charset=UTF-8")
        .query(&[("name", "test"), ("top_k", "1")])
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return VerifyResult::fail(format!("网络错误: {}", e)),
    };

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();

    if !status.is_success() {
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return VerifyResult::fail("API Key 无效或已禁用");
        }
        return VerifyResult::fail(format!(
            "HTTP {} · {}",
            status.as_u16(),
            body.chars().take(200).collect::<String>()
        ));
    }
    if body.contains("\"code\":401") {
        return VerifyResult::fail("API Key 无效或已禁用(元典 code:401)");
    }

    // === 第 2 段:V0.2 hall_detect 套餐探测(失败不一定让整个验证 fail) ===
    let hall_resp = client
        .post("https://open.chineselaw.com/open/hall_detect")
        .header("X-Api-Key", api_key)
        .header("accept", "application/json;charset=UTF-8")
        .header("Content-Type", "application/json")
        .body(r#"{"text":"《民法典》第1条"}"#)
        .send()
        .await;

    match hall_resp {
        Ok(r) => {
            let hs = r.status();
            // 套餐没解锁:401/403 明确 fail,让用户去开通
            if hs.as_u16() == 401 || hs.as_u16() == 403 {
                return VerifyResult::fail(
                    "key 通过基础企业接口,但 hall_detect 端点未授权 — 请到元典开通法律幻觉校验套餐(V0.2 AI 助手依赖)",
                );
            }
            // 业务码 401(HTTP 200 包业务错误)
            if hs.is_success() {
                let hb = r.text().await.unwrap_or_default();
                if hb.contains("\"code\":401") || hb.contains("\"code\":403") {
                    return VerifyResult::fail(
                        "key 通过基础企业接口,但 hall_detect 端点未授权 — 请到元典开通法律幻觉校验套餐(V0.2 AI 助手依赖)",
                    );
                }
            }
            // 其他状态(500 / 超时之类的服务侧问题)→ 不让用户卡住,放过
        }
        Err(_) => {
            // 网络抖动 → 放过
        }
    }

    VerifyResult::ok()
}
