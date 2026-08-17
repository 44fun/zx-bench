import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
const db = new DatabaseSync(path.resolve(import.meta.dirname, '../../../data/zxbench.db'));
const c = db.prepare("SELECT COUNT(*) c FROM ScenarioResult WHERE evidence LIKE '%JUDGE_FAILED%'").get().c;
console.log('remaining JUDGE_FAILED across all runs:', c);
db.close();