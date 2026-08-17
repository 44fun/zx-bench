# 03 · 后端服务详解（apps/server）

## 1. 概述

Fastify 5 HTTP 服务，职责：REST API、WebSocket 实时推送、前端静态资源托管、评测运行的调度与执行。数据层为 Prisma + SQLite。

依赖（见 [apps/server/package.json](../../apps/server/package.json)）：
- `fastify` ^5、`@fastify/cors`、`@fastify/static`、`@fastify/websocket`
- `@prisma/client` ^5.20、`prisma`（dev）
- `pino` + `pino-pretty`（日志）
- `@zxbench/core`、`@zxbench/types`、`@zxbench/utils`（workspace）
- `tsx`（dev 运行）

## 2. 服务入口 index.ts

[apps/server/src/index.ts](../../apps/server/src/index.ts)

### 2.1 启动流程

1. **启用 SQLite WAL**：`enableWAL()` 设置 `journal_mode=WAL`、`busy_timeout=5000`、`synchronous=NORMAL`、`cache_size=-64000`、`foreign_keys=ON`，避免写锁阻塞服务（[index.ts](../../apps/server/src/index.ts#L25-L38)）。
2. **创建 Fastify 实例**（pino-pretty 日志，忽略 pid/hostname）。
3. **CORS**：默认 `false`（仅同源），可用 `ZXBENCH_CORS_ORIGIN` 覆盖。
4. **注册插件**：`fastifyWebSocket`、`fastifyStatic`（托管 `../../web/dist` 前端构建产物）。
5. **注册评分器**：从 `@zxbench/core` 导入 10 个评分器实例并 `registerEvaluator`（[index.ts](../../apps/server/src/index.ts#L66-L76)）。
6. **注册路由与 WebSocket**：`registerRoutes(app)`、`registerWebSocket(app)`。
7. **SPA fallback**：未命中路由返回 `index.html`。
8. **启动恢复**：将 DB 中 `status=running` 的孤儿运行标记为 `failed`（服务重启后内存控制器丢失）。（[index.ts](../../apps/server/src/index.ts#L91-L114)）
9. **优雅关闭**：SIGTERM/SIGINT 时把 running 运行标为 failed、关闭 app 与 Prisma（[index.ts](../../apps/server/src/index.ts#L117-L142)）。
10. **监听** `ZXBENCH_HOST`（默认 `127.0.0.1`）:`PORT`（默认 `3000`）。

进程级兜底：`unhandledRejection` / `uncaughtException` 被捕获打日志，不退出进程（[index.ts](../../apps/server/src/index.ts#L159-L164)）。

### 2.2 导出的 Prisma 单例

`export const prisma = new PrismaClient()`（[index.ts](../../apps/server/src/index.ts#L22)），路由层直接使用（无 repository 分层）。

## 3. REST 路由（routes/index.ts）

单文件聚合全部 API（约 29 个端点，约 3300 行）。入口函数 `registerRoutes(app: FastifyInstance)`（[routes/index.ts](../../apps/server/src/routes/index.ts#L282)）。

### 3.1 常量与权重配置

| 常量 | 说明 |
| --- | --- |
| `PACK_DIMENSION_MAP` | Pack 短名 → 维度映射（de/if/rm/so/tc/sa/aw/cli/pr/all） |
| `DIMENSION_WEIGHTS` | 维度加权权重，program=0.32 最高，总和 1.0（[routes/index.ts](../../apps/server/src/routes/index.ts#L57-L67)） |
| `DIFFICULTY_WEIGHTS` | 难度权重 easy=1 / medium=2 / hard=3 / adversarial=4 |
| `DEFAULT_EVAL_CONFIG` | 默认评测配置（maxTokens 8192、runsPerQuestion 5、parallelism 4、safetyCheck 开、hiddenTests 开）（[routes/index.ts](../../apps/server/src/routes/index.ts#L199-L211)） |

### 3.2 评分计算函数

- `dimensionLabel(dim)`：维度英文 key → 中文标签。
- `computeWeightedTotal(dimAvgs)`：维度加权总分 = Σ(维度均分×权重) / Σ(权重)，四舍五入到 0.01（[routes/index.ts](../../apps/server/src/routes/index.ts#L75-L84)）。
- `computeDifficultyWeightedDimAvgs(results)`：批量查题目难度 → 维度内按难度加权求均分（高难题权重更大）（[routes/index.ts](../../apps/server/src/routes/index.ts#L110-L146)）。

### 3.3 API Key 加密（GPT5.6 P0-4）

- `ENCRYPTION_KEY`：`ZXBENCH_ENCRYPTION_KEY` 环境变量，缺省用内置默认值。
- `encryptApiKey` / `decryptApiKey`：scrypt 派生密钥 + AES-256-CBC，输出 `iv:密文`；未加密旧数据解密时直接返回原值（兼容迁移）。
- `maskApiKey`：脱敏为 `****` + 末 4 位。

### 3.4 评测运行控制器（暂停/继续/取消）

内存态 `evalControllers: Map<runId, EvalRunController>`（[routes/index.ts](../../apps/server/src/routes/index.ts#L215-L225)）。

| 函数 | 行为 |
| --- | --- |
| `pauseEvaluation(runId)` | running → paused |
| `resumeEvaluation(runId)` | paused → running，resolve `resumePromise` 唤醒等待中的执行循环 |
| `cancelEvaluation(runId)` | → cancelled，resolve 唤醒 |
| `checkPause(runId)` | 执行循环每题间调用；paused 时 await `resumePromise`，返回 `'continue'` / `'cancelled'`（[routes/index.ts](../../apps/server/src/routes/index.ts#L263-L280)） |

### 3.5 后台评测执行 runEvaluation()

核心执行函数（[routes/index.ts](../../apps/server/src/routes/index.ts#L2292)）：

1. 解密模型 apiKey，构造 `ModelConfig`。
2. 解析 `dimensionFilter`（fork override 优先，否则读运行记录）。
3. 加载 `status=valid` 的题目并做维度过滤。
4. **断点续跑**：查询该 run 已有 `ScenarioResult`，跳过已完成题目（按 scenarioId 去重统计）。
5. **按维度分组** + 初始化维度统计（含已完成数据，重试行去重）。
6. 选择并行模式（[routes/index.ts](../../apps/server/src/routes/index.ts#L2474-L2508)）：
   - `global`（默认）：全局轮转交叉队列，worker 共享同一队列。
   - `per_dimension`：每个维度独立队列 + 独立 worker 并行推进。
7. 并发 worker 池处理题目（`processQuestion` → `orchestrateEvaluation` → 写 `ScenarioResult` → 更新维度统计/累计 token → 广播进度）。
8. 每完成一题 `broadcastFullProgress()`；运行结束写入 `summary` 与状态。

### 3.6 辅助函数

- `deserializeModel(row)` / `deserializeModelMasked(row)`：DB 行 → `ModelConfig`（JSON 字段解析；masked 版脱敏 apiKey）。
- `deserializeResult(row)`：ScenarioResult 行 JSON 字段解析。
- 安全工具：`validateUrlSafety`（SSRF 防护，DNS 解析校验）、`checkPathTraversal`、`checkSymlinks`、`getDirectoryStats`。
- `loadScenariosFromStaticData(packRoot)`：从静态 JSON 目录加载题目数据。
- `maskSensitiveData`：导出脱敏。
- `simpleMarkdownToHtml` / `markdownToMorandiHtml`：报告下载时 Markdown → HTML 渲染。

## 4. WebSocket（ws/index.ts）

[apps/server/src/ws/index.ts](../../apps/server/src/ws/index.ts)

- **订阅模型**：连接 `/ws?runId=xxx` 只接收该 run 进度；不带 runId 接收全部。连接集合 `wsConnections: Set<WsConnection>`。
- **缓存**：`latestProgressMap: Map<runId, EvalProgress>`；连接建立时立即推送缓存进度（解决刷新页面无数据）。
- **心跳**：服务端每 30s `ws.ping()`，客户端 JSON `ping` → 回 `pong`；异常/关闭清理连接。
- 对外接口：
  - `broadcastProgress(progress)`：缓存 + 按 runId 过滤广播（[ws/index.ts](../../apps/server/src/ws/index.ts#L80-L99)）。
  - `getLatestProgress(runId)`：供 REST 进度接口兜底。
  - `clearProgressCache(runId)`。

## 5. 安全机制汇总

| 机制 | 实现位置 | 说明 |
| --- | --- | --- |
| API Key 加密存储 | routes/index.ts 3.3 节 | AES-256-CBC + scrypt |
| SSRF 防护 | `validateUrlSafety` | 对 Pack 下载 URL 做 DNS 解析与安全校验（GPT5.6 P0-3） |
| 路径穿越防护 | `checkPathTraversal` / `checkSymlinks` | 静态题目目录遍历检查 |
| 导出脱敏 | `maskSensitiveData` | 导出前脱敏敏感字段（P0-7） |
| 默认仅本机监听 | index.ts HOST | 默认 127.0.0.1，监听 0.0.0.0 时打印警告 |
| 孤儿运行恢复 | index.ts 启动流程 | 重启后 running → failed |

## 6. 脚本

- [scripts/recalc-scores.ts](../../apps/server/scripts/recalc-scores.ts)：分数重算。
- [scripts/rescore.mjs](../../apps/server/scripts/rescore.mjs)、[scripts/reeval_qwopus.mjs](../../apps/server/scripts/reeval_qwopus.mjs)：批量重评/重跑运维脚本。