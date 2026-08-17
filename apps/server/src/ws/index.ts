// ============================================================
// WebSocket — 实时进度推送（使用 @fastify/websocket）
// 支持按 runId 订阅：客户端连接 /ws?runId=xxx 仅接收该评测的进度
// 连接时自动推送缓存的最新进度（解决刷新页面后无数据问题）
// ============================================================

import type { FastifyInstance } from 'fastify';
import type { EvalProgress } from '@zxbench/types';
import type { WebSocket } from 'ws';

/** 每个连接可以订阅特定 runId，也可接收全部 */
interface WsConnection {
  ws: WebSocket;
  runId?: string;  // undefined = 接收全部
}

const wsConnections = new Set<WsConnection>();

/** 缓存每个 runId 的最新进度（用于 WS 连接时立即推送） */
const latestProgressMap = new Map<string, EvalProgress>();

export async function registerWebSocket(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, (ws: WebSocket, request) => {
    // 从 query 参数提取 runId
    const runId = (request.query as Record<string, string>)?.runId;
    const conn: WsConnection = { ws, runId };
    wsConnections.add(conn);

    // 连接建立时，如果有该 runId 的缓存进度（且有实际数据），立即推送
    if (runId) {
      const cached = latestProgressMap.get(runId);
      if (cached && cached.total > 0) {
        try {
          if (ws.readyState === 1) { // OPEN
            ws.send(JSON.stringify({ type: 'progress', data: cached }));
          } else {
            // 连接还没完全 open，等一帧再发
            ws.once('open', () => {
              try {
                ws.send(JSON.stringify({ type: 'progress', data: cached }));
              } catch { /* ignore */ }
            });
          }
        } catch { /* ignore */ }
      }
    }

    // 心跳：服务端回应客户端的 ping
    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        }
      } catch { /* ignore non-JSON messages */ }
    });

    // 服务端心跳：每 30s 发送 ping，超时 10s 无 pong 则关闭
    const pingInterval = setInterval(() => {
      if (ws.readyState === 1) {
        try { ws.ping(); } catch { /* ignore */ }
      } else {
        clearInterval(pingInterval);
        wsConnections.delete(conn);
      }
    }, 30000);

    ws.on('close', () => {
      clearInterval(pingInterval);
      wsConnections.delete(conn);
    });

    ws.on('error', () => {
      clearInterval(pingInterval);
      wsConnections.delete(conn);
    });
  });
}

/** 广播评测进度（仅推送给订阅了该 runId 或订阅全部的连接） */
export function broadcastProgress(progress: EvalProgress): void {
  // 缓存最新进度
  if (progress.runId) {
    latestProgressMap.set(progress.runId, progress);
  }

  const message = JSON.stringify({ type: 'progress', data: progress });
  for (const conn of wsConnections) {
    // 如果连接指定了 runId，仅推送匹配的进度
    if (conn.runId && conn.runId !== progress.runId) continue;
    try {
      if (conn.ws.readyState === 1) { // OPEN
        conn.ws.send(message);
      }
    } catch {
      wsConnections.delete(conn);
    }
  }
}

/** 获取缓存的最新进度（供 REST API 使用） */
export function getLatestProgress(runId: string): EvalProgress | null {
  return latestProgressMap.get(runId) || null;
}

/** 清除缓存的进度（评测完成后可调用以释放内存） */
export function clearProgressCache(runId: string): void {
  latestProgressMap.delete(runId);
}
