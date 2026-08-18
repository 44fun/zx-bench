# 07 · 运行方式与部署

## 1. 环境要求

- Node.js ≥ 22.13（根 [package.json](../../package.json#L19-L22) engines 声明；pnpm 11 与 node:sqlite 需要）
- pnpm ≥ 11
- 包管理器安装：`pnpm install`（工作区 `apps/*`、`packages/*`）

## 2. 开发运行

根目录统一编排脚本见 [package.json](../../package.json#L6-L18)：

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 并行启动全部 workspace 的 dev（前端 5173 + 后端 3000 + 共享包 watch） |
| `pnpm dev:web` | 仅前端：`pnpm --filter web dev` → `vite`（端口 5173） |
| `pnpm dev:server` | 仅后端：`pnpm --filter server dev` → `tsx watch src/index.ts`（端口 3000） |

前端开发时通过 [vite.config.ts](../../apps/web/vite.config.ts) 将 `/api`、`/ws` 代理到 `http://localhost:3000`，因此浏览器只需访问 `http://localhost:5173`。

后端开发依赖的共享包（core/types/utils）若被改动，需保证其构建产物最新（根 dev 并行 watch 可自动处理）。

## 3. 构建

| 命令 | 作用 |
| --- | --- |
| `pnpm build` | 全量构建（所有 workspace `build`） |
| `pnpm build:web` | `tsc -b && vite build`，输出 `apps/web/dist`（[apps/web/package.json](../../apps/web/package.json#L6-L10)） |
| `pnpm build:server` | `tsc`，输出 `apps/server/dist`（[apps/server/package.json](../../apps/server/package.json#L6-L13)） |
| `pnpm type-check` | 全部 workspace 类型检查 |
| `pnpm lint` | 全部 workspace lint（当前未配置 lint 脚本） |

## 4. 数据库

| 命令 | 作用 |
| --- | --- |
| `pnpm db:generate` | Prisma Client 生成（`prisma generate`） |
| `pnpm db:push` | 同步数据库结构到 SQLite（`prisma db push`） |
| `pnpm db:studio` | 打开 Prisma Studio 可视化管理 |

Schema 位置：[apps/server/prisma/schema.prisma](../../apps/server/prisma/schema.prisma)。`DATABASE_URL` 配置在 [apps/server/.env](../../apps/server/.env)。

## 5. 生产部署（Windows）

部署态由后端统一托管前端静态产物（[index.ts](../../apps/server/src/index.ts#L58-L64)），**单端口整站服务**。

### 5.1 启动：`start.bat`

入口脚本 [start.bat](../../start.bat)：
1. 检查 Node 环境；
2. 检查前后端构建产物（`apps/web/dist`、`apps/server/dist`），必要时自动构建；
3. 调用 `start-server.ps1`。

守护启动器 [start-server.ps1](../../start-server.ps1)：
- 注入环境变量 `PORT=9876`、`BUILD_TIME`（[start-server.ps1](../../start-server.ps1#L63-L65)）；
- 启动 `node apps/server/dist/index.js`；
- 健康检查 `/api/health`，异常自动重启。

### 5.2 停止：`stop.bat`

关闭守护进程与后端服务。

> 注：代码未内置 `dotenv` 加载，直接 `node dist/index.js` 时环境变量由启动器（start-server.ps1）注入；开发态由 tsx/vite 各自读取。

## 6. 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 监听端口（部署脚本设为 `9876`） |
| `ZXBENCH_HOST` | `127.0.0.1` | 监听地址（仅本地访问；`0.0.0.0` 时打印安全警告） |
| `ZXBENCH_CORS_ORIGIN` | `false` | CORS 允许来源（默认拒绝跨域） |
| `ZXBENCH_ENCRYPTION_KEY` | 内置默认值 | API Key 加密密钥（生产建议设置） |
| `DATABASE_URL` | 见 .env | SQLite 连接串 |
| `BUILD_TIME` | `dev` | 构建时间标记（健康/版本接口返回） |

## 7. 辅助脚本

- `scripts/seed-cr2.mjs`：导入 CR2 题库到数据库。
- `scripts/verify-evaluator.mjs`：评分器验证（以退出码表示通过/失败）。
- `scripts/*.py`、`scripts/*.mjs`：题库分析、空结果重跑、顽固题目重试、重新判分等运维工具（详见目录列表）。
- `apps/server/scripts/`：服务端运维脚本（reeval_qwopus）。
- `apps/server/src/scripts/recalc-scores.ts`：重算所有运行 summary（难度/维度加权聚合层）。
- **`apps/server/src/scripts/rescore-scores.ts`：历史结果离线重算**（评分契约升级后用新评分器对已保存 `modelOutput` 重新评分，无需重调模型）。运行：
  ```bash
  cd apps/server
  npx tsx src/scripts/rescore-scores.ts
  # 可选: RESCORE_LIMIT=100（条数）、RESCORE_DIM=program（维度）、DRY_RUN=1（预览不写库）、RESCORE_FORCE=1（强制重算已标记结果）
  ```
- **`apps/server/src/scripts/audit-config-gaps.ts`：题集配置审计与补全**（扫描 tool_cli/instruction_following/agent_workflow 缺检查项的题，生成补全草稿）。运行：
  ```bash
  cd apps/server
  npx tsx src/scripts/audit-config-gaps.ts          # 生成草稿 config-gaps.json（工具候选/约束句自动提取，需人工审阅）
  npx tsx src/scripts/audit-config-gaps.ts --apply   # 审阅后写库（编辑 JSON 把项改为 apply:true）
  npx tsx src/scripts/audit-config-gaps.ts --auto-apply-single  # 对 tool_cli 中"唯一候选工具"的题直接写库
  # 可选: GAPS_DIM=tool_cli_workflow 只审计指定维度
  ```

## 8. 常见启动流程速查

```text
# 开发（前后端分离）
pnpm install
pnpm dev
# → 浏览器 http://localhost:5173

# 生产（Windows 单端口）
pnpm install
pnpm build
start.bat
# → 浏览器 http://localhost:9876
```