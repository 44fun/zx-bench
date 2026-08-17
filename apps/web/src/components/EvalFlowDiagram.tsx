import { Fragment } from 'react';
import {
  SettingOutlined,
  ApartmentOutlined,
  ThunderboltOutlined,
  SnippetsOutlined,
  AuditOutlined,
  FunnelPlotOutlined,
  FileTextOutlined,
} from '@ant-design/icons';

interface Step {
  en: string;
  title: string;
  desc: string;
  Icon: React.ComponentType<{ className?: string }>;
}

// 大模型评测流水线（与 zxbench 引擎实际流程一致）
const STEPS: Step[] = [
  {
    en: 'CONFIG',
    title: '任务配置',
    desc: '选择被测模型、评测维度与运行参数',
    Icon: SettingOutlined,
  },
  {
    en: 'DISPATCH',
    title: '题目调度',
    desc: '全局并发池分发 404 道题目至各维度',
    Icon: ApartmentOutlined,
  },
  {
    en: 'INFERENCE',
    title: '模型推理',
    desc: '调用被测大模型生成回答与工具调用',
    Icon: ThunderboltOutlined,
  },
  {
    en: 'EXTRACTION',
    title: '结果提取',
    desc: '代码 / 答案三重提取策略精准解析',
    Icon: SnippetsOutlined,
  },
  {
    en: 'DUAL-SCORING',
    title: '双轨评分',
    desc: '确定性规则 + AI Judge 双轨裁决',
    Icon: AuditOutlined,
  },
  {
    en: 'AGGREGATE',
    title: '加权汇总',
    desc: '难度 × 维度双重加权合成综合分',
    Icon: FunnelPlotOutlined,
  },
  {
    en: 'REPORT',
    title: '报告生成',
    desc: '综合分 · 维度 · 多模型对比分析',
    Icon: FileTextOutlined,
  },
];

export default function EvalFlowDiagram() {
  return (
    <div className="ef-stage">
      <style>{`
        .ef-stage {
          --ef: #002fa7;
          --ef-2: #2f6bff;
          --ef-rgb: 0, 47, 167;
          position: relative;
          border-radius: 16px;
          padding: 22px 18px 26px;
          overflow: hidden;
          background:
            radial-gradient(130% 130% at 0% 0%, rgba(var(--ef-rgb), 0.10), transparent 42%),
            radial-gradient(130% 130% at 100% 100%, rgba(var(--ef-rgb), 0.08), transparent 42%),
            repeating-linear-gradient(0deg, rgba(var(--ef-rgb), 0.05) 0 1px, transparent 1px 26px),
            repeating-linear-gradient(90deg, rgba(var(--ef-rgb), 0.05) 0 1px, transparent 1px 26px);
        }
        [data-theme="dark"] .ef-stage {
          --ef: #4d8dff;
          --ef-2: #7db4ff;
          --ef-rgb: 77, 141, 255;
          background:
            radial-gradient(130% 130% at 0% 0%, rgba(var(--ef-rgb), 0.16), transparent 45%),
            radial-gradient(130% 130% at 100% 100%, rgba(var(--ef-rgb), 0.12), transparent 45%),
            repeating-linear-gradient(0deg, rgba(var(--ef-rgb), 0.06) 0 1px, transparent 1px 28px),
            repeating-linear-gradient(90deg, rgba(var(--ef-rgb), 0.06) 0 1px, transparent 1px 28px);
        }
        .ef-flow {
          display: flex;
          align-items: stretch;
          gap: 0;
          overflow-x: auto;
          padding: 6px 2px 10px;
        }
        .ef-node {
          flex: 1 1 0;
          min-width: 140px;
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 9px;
          padding: 16px 14px 15px;
          border-radius: 14px;
          background: linear-gradient(160deg, rgba(var(--ef-rgb), 0.07), rgba(var(--ef-rgb), 0.02));
          border: 1px solid rgba(var(--ef-rgb), 0.30);
          box-shadow: 0 0 0 1px rgba(var(--ef-rgb), 0.04), 0 8px 22px rgba(var(--ef-rgb), 0.10);
          animation: ef-rise 0.6s var(--ease-entry, ease) both;
          transition: transform 0.24s var(--ease-prod, ease), box-shadow 0.24s, border-color 0.24s;
        }
        .ef-node::before {
          content: "";
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 3px;
          background: linear-gradient(90deg, var(--ef), var(--ef-2));
          border-radius: 14px 14px 0 0;
        }
        .ef-node:hover {
          transform: translateY(-6px);
          border-color: var(--ef);
          box-shadow: 0 14px 34px rgba(var(--ef-rgb), 0.28);
        }
        .ef-head { display: flex; align-items: center; gap: 9px; }
        .ef-badge {
          width: 26px; height: 26px; flex: 0 0 auto;
          border-radius: 50%;
          background: var(--ef);
          color: #fff;
          display: flex; align-items: center; justify-content: center;
          font-weight: 700; font-size: 13px;
          box-shadow: 0 0 12px rgba(var(--ef-rgb), 0.55);
        }
        .ef-icon { font-size: 20px; color: var(--ef); line-height: 1; }
        .ef-en {
          font-family: var(--mono, monospace);
          font-size: 10px;
          letter-spacing: 1.5px;
          color: var(--ef);
          opacity: 0.85;
          text-transform: uppercase;
        }
        .ef-title { font-weight: 700; font-size: 15px; color: var(--text-primary); line-height: 1.2; }
        .ef-desc { font-size: 12px; color: var(--text-secondary); line-height: 1.5; }
        .ef-connector {
          flex: 0 0 42px;
          position: relative;
          display: flex;
          align-items: center;
        }
        .ef-line {
          position: absolute;
          top: 50%; left: 0; right: 0;
          height: 2px;
          transform: translateY(-50%);
          background-image: repeating-linear-gradient(90deg, var(--ef) 0 6px, transparent 6px 16px);
          background-size: 16px 2px;
          animation: ef-flow 0.9s linear infinite;
          border-radius: 2px;
          opacity: 0.55;
        }
        .ef-dot {
          position: absolute;
          top: 50%;
          width: 9px; height: 9px;
          margin-top: -4.5px;
          border-radius: 50%;
          background: var(--ef-2);
          box-shadow: 0 0 10px 2px var(--ef-2);
          animation: ef-travel 2.2s var(--ease-prod, ease) infinite;
        }
        @keyframes ef-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes ef-flow { to { background-position: 16px 0; } }
        @keyframes ef-travel { 0% { left: 0%; opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { left: 100%; opacity: 0; } }
        @media (max-width: 720px) { .ef-node { min-width: 152px; } }
      `}</style>
      <div className="ef-flow">
        {STEPS.map((s, i) => (
          <Fragment key={s.en}>
            <div className="ef-node" style={{ animationDelay: `${i * 0.09}s` }}>
              <div className="ef-head">
                <span className="ef-badge">{i + 1}</span>
                <s.Icon className="ef-icon" />
              </div>
              <div className="ef-en">{s.en}</div>
              <div className="ef-title">{s.title}</div>
              <div className="ef-desc">{s.desc}</div>
            </div>
            {i < STEPS.length - 1 && (
              <div className="ef-connector">
                <span className="ef-line" />
                <span className="ef-dot" style={{ animationDelay: `${i * 0.3}s` }} />
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
