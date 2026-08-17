# ZxBench Pro WebUI — Code Wiki

> 大模型评测系统（ZxBench Pro WebUI）结构化代码文档。
> 覆盖项目整体架构、模块职责、关键类与函数、依赖关系与运行方式。

## 项目速览

| 项目 | 说明 |
| --- | --- |
| 名称 | ZxBench Pro WebUI |
| 定位 | 本地部署的大模型（LLM）能力评测平台 |
| 形态 | pnpm workspace TypeScript Monorepo |
| 前端 | React 18 + Vite 5 + Ant Design 5 + ECharts |
| 后端 | Fastify 5 + Prisma 5 + SQLite（WAL 模式） |
| 实时通道 | WebSocket（`/ws`，按 runId 订阅进度） |
| 核心能力 | 多维度（9 维度）评测、确定性评分 + AI Judge 双层裁决、断点续跑、并行维度测试、AI 报告/对比报告、排行榜 |

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [01-overview.md](./01-overview.md) | 项目概览、整体架构与数据流 |
| [02-frontend.md](./02-frontend.md) | 前端 WebUI：入口、路由、页面、组件、状态管理 |
| [03-backend.md](./03-backend.md) | 后端服务：Fastify 入口、REST 路由、运行控制器、WebSocket、安全机制 |
| [04-core-engine.md](./04-core-engine.md) | 评测引擎核心：编排器、模型调用、评分器、AI Judge、安全、沙箱 |
| [05-data-model.md](./05-data-model.md) | Prisma 数据模型与存储设计 |
| [06-api-reference.md](./06-api-reference.md) | REST API 接口参考与 WebSocket 协议 |
| [07-run-deploy.md](./07-run-deploy.md) | 开发运行、构建、生产部署与环境变量 |
| [08-key-flows.md](./08-key-flows.md) | 关键业务流程（评测生命周期、评分、实时推送） |

## 代码地图（快速跳转）

```
apps/web/                          # 前端 WebUI
  src/main.tsx                     # React 入口
  src/App.tsx                      # 路由 + 布局
  src/pages/                       # 12 个业务页面
  src/theme.tsx                    # 深浅色主题 Context
  src/components/                  # 通用组件（Markdown、背景、公式提示）
  vite.config.ts                   # 开发代理 /api、/ws → :3000

apps/server/                       # 后端服务
  src/index.ts                     # Fastify 入口（插件、静态托管、启动恢复、优雅关闭）
  src/routes/index.ts              # 全部 REST API（约 29 个端点）
  src/ws/index.ts                  # WebSocket 进度推送
  prisma/schema.prisma             # 数据模型（4 张表）

packages/core/                     # 评测引擎核心
  src/orchestrator.ts              # 单题评测编排（11 阶段）
  src/model/caller.ts              # OpenAI 兼容模型调用
  src/evaluators/                  # 10 个确定性评分器
  src/judge/                       # 分层 AI Judge
  src/safety/                      # 安全红线检测
  src/sandbox/                     # 子进程沙箱执行
  src/hidden-tests/                # 隐藏测试执行
  src/multi-run/                   # 多轮稳定性评测
  src/parameterize/                # 题目参数化（反污染）
  src/report/                      # 报告 / 对比报告生成

packages/types/                    # 前后端共享类型契约
packages/utils/                    # ID、哈希、统计、截断检测、参数化工具

data/scenarios/                    # 静态题库 JSON（seed 数据源）
scripts/                           # 数据修复 / 分析辅助脚本
start.bat / start-server.ps1 / stop.bat   # Windows 部署脚本
```

## 核心概念速览

- **维度（dimension）**：9 个评测维度（编程、安全权限、智能体工作流、工具CLI、深度CLI、数据抽取、指令遵循、推理数学、结构化输出），各维度有固定权重（编程 32% 最高）。
- **运行（EvalRun）**：一次评测任务，绑定一个模型配置与一套评测配置；支持 group/fork 并行维度分组。
- **单题结果（ScenarioResult）**：一道题的一次评测结果，包含确定性评分、AI Judge、安全红线、多轮统计等完整审计字段。
- **评分链路**：模型调用 → 格式验证 → 确定性评分 → 安全检查 → AI Judge（可选）→ 聚合加权。
- **思考约束（反拖尾）**：针对推理模型无限思考导致超时/上下文过长，支持 `answerFirst`（先答案后原因）、`maxReasoningTokens`/`maxAnswerTokens`（token 上限）、`hardTimeLimitMs`（硬时限）、`onLimit`（超限处置）——prompt 软约束 + 引擎硬校验双管齐下。
