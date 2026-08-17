import { randomUUID } from 'node:crypto';

/** 生成唯一 ID */
export function generateId(): string {
  return randomUUID();
}

/** 生成评测运行 ID：zxbench-pro-{timestamp}-{random} */
export function generateRunId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = randomUUID().slice(0, 8);
  return `zxbench-pro-${ts}-${rand}`;
}
