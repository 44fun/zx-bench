import { createHash } from 'node:crypto';

/** SHA-256 哈希 */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** 题目哈希（基于 prompt + expectedVerdict + graderVersion） */
export function scenarioHash(prompt: string, expectedVerdict: string, graderVersion: string): string {
  const combined = `${prompt}|||${expectedVerdict}|||${graderVersion}`;
  return sha256(combined).slice(0, 16);
}
