# 02 · 前端 WebUI 详解（apps/web）

## 1. 概述

React 18 SPA，使用 Vite 构建，开发模式下将 `/api`、`/ws` 代理到后端 `localhost:3000`（见 [vite.config.ts](../../apps/web/vite.config.ts)）。UI 基于 Ant Design 5，主题为自研深浅色莫兰迪风格（直角 borderRadius=0）。

依赖（见 [apps/web/package.json](../../apps/web/package.json)）：
- `react` / `react-dom` ^18.3
- `react-router-dom` ^6.28
- `antd` ^5.22、`@ant-design/icons` ^6.3
- `echarts` ^5.5、`echarts-for-react` ^3.0
- `@zxbench/types`（workspace）

## 2. 入口与启动链

```
main.tsx → ThemeProvider → ThemedApp(ConfigProvider + BrowserRouter) → App.tsx
```

- [main.tsx](../../apps/web/src/main.tsx)：创建 React root，注入 `ThemeProvider`；`ThemedApp` 内使用 `ConfigProvider`（antd 主题 token、zh_CN locale、深浅色算法切换）并挂载 `BrowserRouter`。
- [App.tsx](../../apps/web/src/App.tsx)：应用壳 —— 侧边栏菜单 + 顶栏 + 路由出口。

## 3. 路由表

定义见 [App.tsx](../../apps/web/src/App.tsx#L141-L154)。

| 路径 | 页面组件 | 说明 |
| --- | --- | --- |
| `/` | [Dashboard.tsx](../../apps/web/src/pages/Dashboard.tsx) | 总览（KPI、维度雷达、维度分布） |
| `/eval/create` | [EvalCreate.tsx](../../apps/web/src/pages/EvalCreate.tsx) | 创建评测 |
| `/eval/live/:id` | [EvalLive.tsx](../../apps/web/src/pages/EvalLive.tsx) | 实时监控 |
| `/eval/history` | [EvalHistory.tsx](../../apps/web/src/pages/EvalHistory.tsx) | 评测历史（按 groupName 聚合） |
| `/eval/:id` | [EvalDetail.tsx](../../apps/web/src/pages/EvalDetail.tsx) | 单次评测详情 |
| `/report/:id` | [Report.tsx](../../apps/web/src/pages/Report.tsx) | 评测报告 |
| `/reports` | [ReportList.tsx](../../apps/web/src/pages/ReportList.tsx) | 报告列表 |
| `/leaderboard` | [Leaderboard.tsx](../../apps/web/src/pages/Leaderboard.tsx) | 排行榜 |
| `/scenarios` | [Scenarios.tsx](../../apps/web/src/pages/Scenarios.tsx) | 题目管理 |
| `/compare` | [CompareModels.tsx](../../apps/web/src/pages/CompareModels.tsx) | 模型对比 |
| `/settings` | [ModelConfig.tsx](../../apps/web/src/pages/ModelConfig.tsx) | 系统设置（模型配置） |
| `*` | `Navigate to /` | 兜底 |

## 4. 页面职责与关键交互

### 总览 Dashboard
- 拉取 `/api/stats`，展示 KPI 卡片、维度雷达图、维度分布表。加载逻辑见 [Dashboard.tsx](../../apps/web/src/pages/Dashboard.tsx#L31-L42)。

### 创建评测 EvalCreate
- 加载模型列表（[EvalCreate.tsx](../../apps/web/src/pages/EvalCreate.tsx#L15-L33)）。
- 提交评测配置到 `/api/runs`（[EvalCreate.tsx](../../apps/web/src/pages/EvalCreate.tsx#L33-L69)）。

### 实时监控 EvalLive（状态最复杂的页面）
- **双通道取数**：REST `/api/runs/:id/progress`（后备）+ WebSocket `/ws?runId=id`（实时），见 [EvalLive.tsx](../../apps/web/src/pages/EvalLive.tsx#L112-L156)。
- **WS 管理**：连接、心跳（20s JSON ping）、断线重连（指数退避 ≤5 次）、进度合并（兄弟运行 `currentScenarios`/`activeDimensions`、保留缺失维度），见 [EvalLive.tsx](../../apps/web/src/pages/EvalLive.tsx#L139-L256)。
- **控制**：暂停/恢复/取消（[EvalLive.tsx](../../apps/web/src/pages/EvalLive.tsx#L258-L313)）、fork 分叉维度测试、单题重试。
- **生成额度可调**：总体进度卡展示当前 maxTokens（InputNumber），PATCH `/api/runs/:id/config` 保存。运行中修改通过 controller 持有的 config 引用使**后续题目立即生效**（[EvalLive.tsx](../../apps/web/src/pages/EvalLive.tsx#L761-L791)）。
- **展示**：整体进度条、维度进度卡、阶段徽标（STAGE_CONFIG）、实时结果表（[EvalLive.tsx](../../apps/web/src/pages/EvalLive.tsx#L1099-L1219)）。

### 评测历史 EvalHistory
- 拉取 `/api/runs`，按 `groupName` 聚合同组运行（[EvalHistory.tsx](../../apps/web/src/pages/EvalHistory.tsx#L76-L128)）。
- 提供监控、恢复、详情、报告入口（[EvalHistory.tsx](../../apps/web/src/pages/EvalHistory.tsx#L271-L299)）。

### 评测详情 EvalDetail
- 拉取组级去重结果 `/api/runs/:id/group-results`（[EvalDetail.tsx](../../apps/web/src/pages/EvalDetail.tsx#L69-L76)）。
- 结果筛选、表格、证据折叠、单题重试（[EvalDetail.tsx](../../apps/web/src/pages/EvalDetail.tsx#L247-L349)）。

### 评测报告 Report
- 加载 `/api/runs/:id/report`；POST `report/generate` 触发 AI 报告（[Report.tsx](../../apps/web/src/pages/Report.tsx#L89-L122)）。
- 展示总分、维度图表、优劣势、AI Markdown 报告（[Report.tsx](../../apps/web/src/pages/Report.tsx#L210-L482)）。
- **评分证据构成卡**：展示每个维度总分由哪些证据支撑（真实执行 / 规则判定 / AI 判分 / 未测量 四种徽标，带 tooltip），底部汇总全局证据分布——直接反映"分数可信度"（[Report.tsx](../../apps/web/src/pages/Report.tsx#L397-L429)）。

### 报告列表 / 排行榜 / 模型对比
- ReportList：列出已完成运行并逐条补拉 `/report` 摘要（[ReportList.tsx](../../apps/web/src/pages/ReportList.tsx#L33-L97)）。
- Leaderboard：`/api/leaderboard` 排名表 + 查看报告（[Leaderboard.tsx](../../apps/web/src/pages/Leaderboard.tsx#L36-L123)）。
- CompareModels：基于排行榜加载候选模型，`/api/reports/compare` 生成对比报告，历史存 localStorage（[CompareModels.tsx](../../apps/web/src/pages/CompareModels.tsx#L47-L140)）。

### 题目管理 Scenarios / 系统设置 ModelConfig
- Scenarios：`/api/scenarios` 加载题库，JSON 编辑、删除、Pack 导入（[Scenarios.tsx](../../apps/web/src/pages/Scenarios.tsx#L82-L164)）。
- ModelConfig：`/api/models` 列表，新增/删除模型（[ModelConfig.tsx](../../apps/web/src/pages/ModelConfig.tsx#L18-L57)）。

## 5. 关键组件与工具

| 组件 | 职责 |
| --- | --- |
| [theme.tsx](../../apps/web/src/theme.tsx) | `ThemeContext`：mode（默认 dark）+ toggle/setMode；`data-theme` 属性 + localStorage 持久化（key `zxbench-theme`） |
| [MarkdownRenderer.tsx](../../apps/web/src/components/MarkdownRenderer.tsx) | 轻量 Markdown 渲染（标题、表格、列表、代码块、链接），用于 AI 报告展示 |
| [ScoreFormulaTooltip.tsx](../../apps/web/src/components/ScoreFormulaTooltip.tsx) | 得分公式解释 Tooltip |
| [AnimatedBackground.tsx](../../apps/web/src/components/AnimatedBackground.tsx) | 全局背景动效 |

## 6. 状态管理

- **无独立全局状态库**（无 Redux/Zustand/React Query）。
- 状态以**页面级 `useState/useEffect/useMemo/useRef/useCallback`** 为主，API 请求直接在页面组件内 `fetch('/api/...')`，无 service 层封装。
- 全局状态仅主题通过 Context（[theme.tsx](../../apps/web/src/theme.tsx)）。
- 少量持久化：主题（localStorage）、模型对比报告历史（localStorage）。

## 7. 与后端的通信

- **REST**：相对路径 `fetch('/api/...')`；开发期由 Vite 代理到 `http://localhost:3000`，生产期由后端 Fastify 同源托管。
- **WebSocket**：`ws(s)://host/ws?runId=<id>`，消息类型 `{ type: 'progress', data: EvalProgress }`，另有 ping/pong 心跳。