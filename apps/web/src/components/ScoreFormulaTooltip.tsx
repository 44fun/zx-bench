import { Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

interface ScoreFormulaTooltipProps {
  /** Trigger element; if not provided, uses a default info icon */
  children?: ReactNode;
  /** Placement of the tooltip */
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'topLeft' | 'topRight';
  /** Show as a small info icon (default) or wrap around children */
  icon?: boolean;
}

/**
 * 综合分计算公式说明 Tooltip — 难度加权 + 维度加权
 *
 * 计算公式:
 *   ① 单题得分 = 确定性评分 × W_det + AI Judge 评分 × W_judge
 *   ② 维度均分 = Σ(题目得分 × 难度权重) / Σ(难度权重)
 *   ③ 综合分 = Σ(维度均分 × 维度权重) / Σ(维度权重)
 *
 * 难度权重：easy=1, medium=1.5, hard=2, adversarial=2.5（温和递增，跨度 2.5x）
 * 维度权重与服务端 routes/index.ts DIMENSION_WEIGHTS 一致。
 */
const FORMULA_CONTENT = (
  <div style={{ maxWidth: 400, fontSize: 13, lineHeight: 1.7 }}>
    <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>综合分计算公式（难度加权）</div>
    <div style={{ marginBottom: 6 }}>
      <span style={{ opacity: 0.7 }}>①</span> 单题得分 = 确定性评分 × W<sub>det</sub> + Judge评分 × W<sub>judge</sub>
    </div>
    <div style={{ marginBottom: 6 }}>
      <span style={{ opacity: 0.7 }}>②</span> <strong>维度均分 = Σ(题目得分 × 难度权重) / Σ(难度权重)</strong>
      <div style={{ fontSize: 12, opacity: 0.8, marginLeft: 18, marginTop: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', maxWidth: 200 }}>
          <span>easy</span><span>权重 1</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', maxWidth: 200 }}>
          <span>medium</span><span>权重 1.5</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', maxWidth: 200 }}>
          <span>hard</span><span>权重 2</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', maxWidth: 200 }}>
          <span>adversarial</span><span>权重 2.5</span>
        </div>
      </div>
    </div>
    <div style={{ marginBottom: 8 }}>
      <span style={{ opacity: 0.7 }}>③</span> <strong>综合分 = Σ(维度均分 × 维度权重) / Σ(权重)</strong>
    </div>
    <div style={{ borderTop: '1px solid rgba(128,128,128,0.3)', paddingTop: 8, marginTop: 4 }}>
      <div style={{ marginBottom: 6, fontWeight: 600 }}>各维度权重（总和 = 1.0）：</div>
      <div style={{ fontSize: 12, lineHeight: 1.8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>编程能力</span>
          <span style={{ fontWeight: 700, color: '#1890ff' }}>20%</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>推理数学</span>
          <span>12%</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>幻觉抵抗</span>
          <span>12%</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>指令遵循</span>
          <span>12%</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>安全权限</span>
          <span>10%</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>智能体工作流</span>
          <span>8%</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>工具CLI工作流</span>
          <span>7%</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>数据抽取</span>
          <span>7%</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>CLI深度任务</span>
          <span>7%</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>结构化输出</span>
          <span>5%</span>
        </div>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8, borderTop: '1px solid rgba(128,128,128,0.2)', paddingTop: 6 }}>
        难度加权确保高难度题对成绩有更大影响，维度权重体现各能力的重要性排序
      </div>
    </div>
  </div>
);

export default function ScoreFormulaTooltip({
  children,
  placement = 'top',
  icon = true,
}: ScoreFormulaTooltipProps) {
  if (children) {
    return (
      <Tooltip title={FORMULA_CONTENT} placement={placement} overlayStyle={{ maxWidth: 420 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'help' }}>
          {children}
          {icon && <InfoCircleOutlined style={{ fontSize: 13, opacity: 0.5 }} />}
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip title={FORMULA_CONTENT} placement={placement} overlayStyle={{ maxWidth: 420 }}>
      <InfoCircleOutlined style={{ fontSize: 13, opacity: 0.5, cursor: 'help', marginLeft: 4 }} />
    </Tooltip>
  );
}
