# Changelog

本项目所有显著变更都会记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

> 开源版自 v0.3.9 起重新整理变更记录,早期内部迭代历史不在此公开仓列出。

---

## [0.3.14] - 2026-06-12

### 🆕 新增

- **云端 LLM 双后端架构**(`deepseek` / `minimax`)。`settings.cloud_llm_backend` 字段让用户下拉选择,任一后端的 key / endpoint / 模型档位独立保存,互不干扰。
- **MiniMax 后端接入**:`https://api.minimaxi.com` OpenAI 兼容协议,模型名 `minimax-M2.7`(轻量) / `minimax-M3`(强推理,默认开思考)。验证接口走 `GET /v1/models` 标准端点。设置页新加完整 MiniMax section(API Key + 端点 + 模型档位 + 验证按钮)。
- **`verify_minimax_key` IPC + `get_minimax_balance` IPC**(后者空壳返回 None,MiniMax 暂无公开余额端点)。
- **模型路由按 backend 切默认模型名**:`model_router::route_model` 读 `settings.effective_cloud_llm_backend()` 决定 flash/pro 默认值,温度按模型名特征判断(0.3 / 0.6 / 0.15)。

### 🔧 变更

- **保留 `deepseek` 后端 + 余额模块完整代码**:`deepseek/mod.rs` 函数签名 + IPC 全保留,仅在 `lib.rs::get_deepseek_balance` 加 backend 短路(切到 minimax 时直接返回 Ok(None),不发起远程调用)。老用户零感知,所有 DeepSeek 用户继续工作。
- **`feedback` 报告加 `cloud_llm_backend` 字段 + minimax 字段**:反馈报告里能直接看到用户在用哪个后端。
- **`pdf-inspector` / `lopdf` 从 git dep 改 path 指向 `vendor/`**:本地环境 github.com git 协议不稳,避免 cargo 联网拉源码卡住。
- **Cargo.toml + package.json 版本号 → 0.3.14**。

### ⚠️ 已知限制

- MiniMax 公开 API 没有余额查询端点,`get_minimax_balance` 恒返回 None。
- `lib.rs::get_deepseek_balance` 在 backend=minimax 时是空壳,切回 deepseek 后立即可用。

---

## [0.3.13] - 2026-06-12

### 🆕 新增(0.3.10 ~ 0.3.13 累积同步)

- **OCR 双线路**:新增 PaddleOCR VL-1.6(百度 AI Studio)云端识别,设置页填访问令牌(免费 20,000 页/天)即自动成为 MinerU 的备用线路 — 失败 / 排队超时 / 额度用完自动切换;也可一键设为主力。不填则一切照旧。
- **审级模型**:一个案件可记多个审级(仲裁 → 一审 → 二审 → 再审),各审级独立案号 / 承办机关 / 当事人称谓;首页显示最新审级,详情页新增「审级历程」;案件状态新增「仲裁中」「再审中」。
- **团队版(无服务器)**:创建团队 → 配对码加入 → 同一办公网内自动互相同步案件进度(接力传播);权限逐人配置,有编辑权可改队友案件状态,改动留痕可撤销。只同步案件登记信息,不传文档原文。
- **外部数据源接入(MCP)**:元典 / 企查查等平台的云端 MCP 服务可整段粘贴配置接入 AI 助手。
- **还款自动入账**:银行转账截图识别出还款后自动记进执行页还款记录(带 AI 标记,可删)。
- 法院短信可按当事人姓名匹配案件;案件详情页新增「重新分析」按钮;全案分析阶段显式进度提示,失败透传真实错误。
- **Windows 支持**:安装包内置 WebView2 引导器(构建工作流见 `.github/workflows`)。

### 🔧 变更

- 更新提醒每个新版本只弹一次;详情页手改信息首页同步更新。

### 🆕 新增

- **Word 导出排版升级**:统一到原生 OOXML 排版引擎,表格不再散架,支持仿宋 / 黑体 / 方正小标宋字体。
- **一个文件夹自动识别为多个案件**:拖入文件夹时自动检测,提供拆分预览确认,共用材料挂到每个案件。

### 🔧 变更

- 文档导出抬头补回案号 / 法院 / 案由等元信息。

### ⚠️ 已知限制

- 共用材料目前对每个案件各抽取一次(尚未做抽取结果复用)。
