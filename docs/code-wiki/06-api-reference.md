# 06 · REST API 参考与 WebSocket 协议

> 后端全部路由集中在 [apps/server/src/routes/index.ts](../../apps/server/src/routes/index.ts)，WebSocket 在 [apps/server/src/ws/index.ts](../../apps/server/src/ws/index.ts)。

## 1. 约定

- 基础前缀 `/api`；开发期前端经 Vite 代理（`/api`、`/ws` → `http://localhost:3000`），生产期同源。
- 响应风格：多数接口返回 `{ success: boolean, data?, error? }`。
- 时间格式 ISO 8601；JSON 字段在 DB 中为字符串，出参前反序列化。

## 2. 健康与版本

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查：`{ status, version, buildTime }`（[routes/index.ts](../../apps/server/src/routes/index.ts#L284-L286)） |
| GET | `/api/version` | 版本与运行信息：version、buildTime、serverStartTime、uptimeSeconds、nodeVersion、features 开关列表（[routes/index.ts](../../apps/server/src/routes/index.ts#L289-L306)） |

## 3. 模型配置（ModelConfig）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/models` | 模型列表（apiKey 脱敏，`deserializeModelMasked`）（[routes/index.ts](../../apps/server/src/routes/index.ts#L309-L316)） |
| POST | `/api/models` | 新增模型（apiKey 加密存储）（[routes/index.ts](../../apps/server/src/routes/index.ts#L318-L340)） |
| DELETE | `/api/models/:id` | 删除模型（[routes/index.ts](../../apps/server/src/routes/index.ts#L342-L352)） |

## 4. 评测运行（EvalRun）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/runs` | 运行列表（历史页按 groupName 聚合的依据）（[routes/index.ts](../../apps/server/src/routes/index.ts#L354-L370)） |
| GET | `/api/runs/:id` | 单个运行详情（[routes/index.ts](../../apps/server/src/routes/index.ts#L372-L394)） |
| GET | `/api/runs/:id/group-results` | 组级去重结果（详情页）（[routes/index.ts](../../apps/server/src/routes/index.ts#L396-L462)） |
| POST | `/api/runs` | **创建评测**：校验模型配置、启动异步执行（[routes/index.ts](../../apps/server/src/routes/index.ts#L464-L532)） |
| POST | `/api/runs/:id/cancel` | 取消运行（[routes/index.ts](../../apps/server/src/routes/index.ts#L534-L545)） |
| POST | `/api/runs/:id/pause` | 暂停运行（[routes/index.ts](../../apps/server/src/routes/index.ts#L547-L565)） |
| POST | `/api/runs/:id/resume` | 恢复运行（[routes/index.ts](../../apps/server/src/routes/index.ts#L567-L599)） |
| POST | `/api/runs/:id/fork` | **fork 分叉**：合并到同一 run 的并行维度测试（[routes/index.ts](../../apps/server/src/routes/index.ts#L652-L746)） |
| GET | `/api/runs/:id/group-progress` | 同组所有运行的聚合进度（[routes/index.ts](../../apps/server/src/routes/index.ts#L748-L912)） |
| GET | `/api/runs/:id/progress` | 实时进度（REST 兜底，WS 不可用时使用）（[routes/index.ts](../../apps/server/src/routes/index.ts#L914-L987)） |
| POST | `/api/runs/:id/results/:scenarioId/retry` | 单题重试（[routes/index.ts](../../apps/server/src/routes/index.ts#L2057)） |

### 创建评测请求体要点（`CreateEvalRunRequest`）

- `modelConfigId`、`name`、`evalConfig: EvalRunConfig`（maxTokens、runsPerQuestion、judgeEnabled、escalationEnabled、safetyCheckEnabled、hiddenTestsEnabled、structuredOutputEnabled、parallelism、parallelMode、dimensionFilter 等）。
- 支持 `groupId`/`parentRunId` 维度并行分组；创建后立即写入 EvalRun（`pending`）并异步 `runEvaluation`。

## 5. 题目管理（ScenarioDefinition）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/scenarios` | 题目列表（[routes/index.ts](../../apps/server/src/routes/index.ts#L990-L1008)） |
| POST | `/api/scenarios` | 新增/编辑题目（[routes/index.ts](../../apps/server/src/routes/index.ts#L1010-L1047)） |
| DELETE | `/api/scenarios/:id` | 删除题目（[routes/index.ts](../../apps/server/src/routes/index.ts#L1049-L1054)） |

## 6. 统计与导出

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/stats` | 总览统计（KPI、维度分布）（[routes/index.ts](../../apps/server/src/routes/index.ts#L1056-L1075)） |
| GET | `/api/runs/:id/export` | 导出运行结果（脱敏）（[routes/index.ts](../../apps/server/src/routes/index.ts#L1077-L1127)） |

## 7. 数据迁移

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/migrate/scenarios` | 从 ZxBench Pro 导入题目数据（[routes/index.ts](../../apps/server/src/routes/index.ts#L1130-L1174)） |
| POST | `/api/migrate/pack` | **测试包导入**：从 pack tar.gz URL 安装（含 SSRF 防护 `validateUrlSafety`、路径穿越检查）（[routes/index.ts](../../apps/server/src/routes/index.ts#L1179-L1363)） |

## 8. 报告

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/runs/:id/report` | 评测报告（聚合维度均分/加权总分/通过率/红线/分布/token 统计）（[routes/index.ts](../../apps/server/src/routes/index.ts#L1366-L1551)） |
| POST | `/api/runs/:id/report/generate` | 调用 LLM 生成 AI 评测报告（[routes/index.ts](../../apps/server/src/routes/index.ts#L1553-L1752)） |
| GET | `/api/runs/:id/report/download` | 报告下载（Markdown / HTML 打印版）（[routes/index.ts](../../apps/server/src/routes/index.ts#L1754-L1784)） |
| POST | `/api/reports/compare` | 生成模型对比报告（[routes/index.ts](../../apps/server/src/routes/index.ts#L1786-L1931)） |
| POST | `/api/reports/compare/download` | 对比报告下载（MD / HTML 打印版）（[routes/index.ts](../../apps/server/src/routes/index.ts#L1933-L1954)） |

## 9. 排行榜

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/leaderboard` | 模型排行榜（基于已完成运行聚合）（[routes/index.ts](../../apps/server/src/routes/index.ts#L1956-L2055)） |

## 10. WebSocket 协议（/ws）

端点：`ws(s)://<host>/ws?runId=<runId>`（不带 runId 接收全部）。

| 方向 | 消息 | 说明 |
| --- | --- | --- |
| 服务端 → 客户端 | `{ type: 'progress', data: EvalProgress }` | 评测进度（连接建立时先推缓存最新进度） |
| 客户端 → 服务端 | `{ type: 'ping', ts }` | 心跳（前端每 20s），服务端回 `{ type: 'pong', ts }` |
| 服务端 | `ws.ping()`（控制帧） | 服务端每 30s 心跳，异常关闭连接 |

`EvalProgress` 关键字段：`runId`、`status`、`total`、`completed`、`percentage`、`eta`、`tokensPerSecond`、`totalTokens`、`currentStage`、`dimensionProgress[]`（各维度 total/completed/passed/failed/redLine/avgScore/scores）、`activeDimensions`、`currentScenarios`、`recentResults[]`（最新 50 条实时结果）。

## 11. 共享类型契约

前后端接口数据结构统一在 [packages/types/src/index.ts](../../packages/types/src/index.ts)：`Scenario`、`ModelConfig`、`ModelParams`、`ModelResponse`、`OutputMetadata`、`ScenarioResult`、`EvalRunConfig`、`EvalProgress`、`DimensionProgress`、`QuestionLiveResult`、`EvalStage`、`JudgeResult`、`RunManifest`、`HiddenTestCase` 等。