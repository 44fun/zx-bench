# ZxBench Pro（智秀大模型评测）

一个本地优先的大模型能力评测平台：**10 大维度 · 502 道基准题 · 难度加权 + AI Judge 双轨评分**，自带可视化报告、排行榜、模型对比与性价比分析。

## 特性

- **10 大能力维度**：编程、推理数学、幻觉抵抗、指令遵循、安全权限、智能体工作流、工具/CLI、数据抽取、深度 CLI、结构化输出。
- **难度加权评分**：维度内按难度加权（easy=1 / medium=2 / hard=3 / adversarial=4），维度间按权重合成综合分。
- **双轨评分**：确定性评分器 + 可选 AI Judge 复核（覆盖率不足时 Judge 补判）。
- **反拖尾约束**：answerFirst、maxAnswerTokens、hardTimeLimitMs，防止推理模型思考链拖垮输出。
- **完整可视化**：评测历史、实时监控、维度雷达图、分数分布、AI 评测报告、排行榜、模型对比、性价比散点图。
- **支持任意 OpenAI 兼容端点**：云端 API、vLLM、llama.cpp、Ollama、LM Studio 均可接入。

## 架构（pnpm monorepo）

| 包 | 说明 |
|---|---|
| apps/web | React 18 + Vite 5 + AntD 5 + ECharts |
| apps/server | Fastify 5 + Prisma 5 + SQLite(WAL) |
| packages/core | 评测引擎：编排器、评分器、AI Judge、报告生成 |
| packages/types | 共享类型定义 |
| packages/utils | 工具函数（截断检测、统计等） |

## 基准题集

502 道题，覆盖 10 个维度，难度含 adversarial（对抗样本）：

| 维度 | 题数 | 权重 |
|---|---|---|
| 编程能力 program | 77 | 20% |
| 推理数学 reasoning_math | 35 | 12% |
| 幻觉抵抗 hallucination_resistance | 78 | 12% |
| 指令遵循 instruction_following | 40 | 12% |
| 安全权限 safety_authority | 50 | 10% |
| 智能体工作流 agent_workflow | 45 | 8% |
| 工具/CLI tool_cli_workflow | 56 | 7% |
| 数据抽取 data_extraction | 35 | 7% |
| 深度 CLI cli_deep_tasks | 56 | 7% |
| 结构化输出 structured_output | 30 | 5% |

## 评分公式

1. 单题得分 = 确定性评分 x W_det + AI Judge 评分 x W_judge
2. 维度均分 = Σ(题目得分 x 难度权重) / Σ(难度权重)
3. 综合分   = Σ(维度均分 x 维度权重) / Σ(维度权重)

- 确定性评分器无法覆盖的轴（覆盖率 < 50%）权重让渡给 AI Judge。
- 评分器对格式问题（代码未包裹、JSON 解析失败等）识别为「格式盲区」，Judge 权重临时上调。

## 快速开始

### 环境要求

- Node.js >= 20、pnpm >= 8
- 至少一个被测模型端点（OpenAI 兼容），本地 GGUF 建议用 llama.cpp / Ollama / LM Studio
- （可选）一个 AI Judge 模型端点

### 安装与初始化

```bash
# 1. 安装依赖
pnpm install

# 2. 生成 Prisma Client 并初始化数据库
pnpm db:generate
pnpm db:push

# 3. 配置环境变量
cp apps/server/.env.example apps/server/.env

# 4. 构建
pnpm build

# 5. 启动服务
pnpm --filter server start
```

### 导入基准题集

```bash
node scripts/seed-benchmark.mjs
```

### 使用

1. 打开 http://localhost:3001
2. 「系统设置」添加被测模型（和 AI Judge 模型）
3. 「创建评测」选择模型/维度发起评测
4. 查看「实时监控」「评测历史」「评测报告」「排行榜」「模型性价比」

## 配置（apps/server/.env）

| 变量 | 说明 | 默认 |
|---|---|---|
| DATABASE_URL | SQLite 路径 | file:../../data/zxbench.db |
| PORT | 服务端口 | 3000 |
| ZXBENCH_HOST | 监听地址 | 127.0.0.1 |
| ZXBENCH_CORS_ORIGIN | CORS 来源 | 关闭 |
| ZXBENCH_ENCRYPTION_KEY | API Key 加密密钥 | 无（请务必设置随机值） |

## 目录结构

apps/web   前端
apps/server  后端 + Prisma + 维护脚本
packages/core  评测引擎
packages/types  类型
packages/utils  工具
data/scenarios  基准题集 JSON
scripts  seed/export 等工具脚本

## License

[MIT](LICENSE)