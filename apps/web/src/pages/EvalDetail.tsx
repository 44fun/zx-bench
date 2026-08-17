import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Table, Tag, Descriptions, Collapse, Progress, Button, Space, Tooltip, message, Input, Select, Segmented } from 'antd';
import { DownloadOutlined, FileSearchOutlined, ReloadOutlined, SearchOutlined, RobotOutlined } from '@ant-design/icons';
import type { ScenarioResult } from '@zxbench/types';

interface GroupResultsData {
  runId: string;
  runName: string;
  status: string;
  groupName: string | null;
  totalRuns: number;
  totalResults: number;
  modelConfig: { name: string; provider: string };
  config: Record<string, unknown>;
  summary: { averageScore: number; dimensionAverages: Record<string, number> } | null;
  results: ScenarioResult[];
  evalStartedAt: string | null;
  evalFinishedAt: string | null;
}

const DIM_LABELS: Record<string, string> = {
  data_extraction: '数据抽取',
  instruction_following: '指令遵循',
  reasoning_math: '推理数学',
  structured_output: '结构化输出',
  tool_cli_workflow: '工具CLI',
  safety_authority: '安全权限',
  agent_workflow: '智能体工作流',
  cli_deep_tasks: '深度CLI任务',
  program: '编程能力',
  hallucination_resistance: '幻觉抵抗',
  bug_finding: 'Bug发现',
};

type StatusFilter = 'all' | 'passed' | 'failed' | 'red_line' | 'truncated';

function formatTime(t: string | null): string {
  if (!t) return '-';
  const d = new Date(t);
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${M}-${D} ${h}:${m}`;
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '-';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin} 分钟`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}

export default function EvalDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<GroupResultsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryingIds, setRetryingIds] = useState<string[]>([]);

  // 筛选状态
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dimensionFilter, setDimensionFilter] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');

  const fetchData = useCallback(() => {
    if (!id) return;
    fetch(`/api/runs/${id}/group-results`)
      .then((r) => r.json())
      .then((res) => { if (res.success) setData(res.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 单题重试（最多同时4题）
  const handleRetry = useCallback(async (scenarioId: string) => {
    if (!id || retryingIds.includes(scenarioId) || retryingIds.length >= 4) return;
    setRetryingIds((prev) => [...prev, scenarioId]);
    try {
      const res = await fetch(`/api/runs/${id}/results/${scenarioId}/retry`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        message.success(`重试完成：${scenarioId}，得分 ${json.data.totalScore}`);
        // 立即更新本地数据，无需等待 fetchData
        const { totalScore, groupStats } = json.data;
        setData((prev) => {
          if (!prev) return prev;
          const updatedResults = prev.results.map((r) =>
            r.scenarioId === scenarioId ? { ...r, totalScore } : r
          );
          return {
            ...prev,
            results: updatedResults,
            totalResults: groupStats?.totalScenarios ?? prev.totalResults,
            // 同步更新 difficulty-weighted 均分，确保 avgScore 立即反映重测结果
            summary: groupStats
              ? { averageScore: groupStats.averageScore, dimensionAverages: prev.summary?.dimensionAverages ?? {} }
              : prev.summary,
          };
        });
        // 后台同步确保数据完整一致
        fetchData();
      } else {
        message.error(`重试失败：${json.error}`);
      }
    } catch {
      message.error('重试请求失败');
    } finally {
      setRetryingIds((prev) => prev.filter((id) => id !== scenarioId));
    }
  }, [id, fetchData]);

  const allResults = data?.results || [];

  // 维度选项（必须在所有 return 之前调用 Hooks）
  const dimensionOptions = useMemo(() => {
    const dims = [...new Set(allResults.map((r) => r.dimension))];
    return dims.map((d) => ({ label: DIM_LABELS[d] || d, value: d }));
  }, [allResults]);

  // 筛选后的结果（必须在所有 return 之前调用 Hooks）
  const filteredResults = useMemo(() => {
    let list = allResults;
    if (statusFilter !== 'all') {
      switch (statusFilter) {
        case 'passed':
          list = list.filter((r) => r.totalScore >= 60);
          break;
        case 'failed':
          list = list.filter((r) => r.totalScore < 60);
          break;
        case 'red_line':
          list = list.filter((r) => r.safetyLevel === 'red_line');
          break;
        case 'truncated':
          list = list.filter((r) => r.outputMetadata?.truncated);
          break;
      }
    }
    if (dimensionFilter.length > 0) {
      list = list.filter((r) => dimensionFilter.includes(r.dimension));
    }
    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      list = list.filter((r) =>
        r.scenarioId.toLowerCase().includes(kw) ||
        (DIM_LABELS[r.dimension] || r.dimension).toLowerCase().includes(kw)
      );
    }
    return list;
  }, [allResults, statusFilter, dimensionFilter, keyword]);

  if (loading) return <div style={{ padding: 80, textAlign: 'center', color: 'var(--text-helper)' }}>加载中...</div>;
  if (!data) return <div style={{ padding: 80, textAlign: 'center', color: 'var(--text-helper)' }}>未找到评测记录</div>;

  // 统计数据 — 优先使用后端难度加权计算的均分
  const avgScore = data.summary?.averageScore != null
    ? data.summary.averageScore
    : allResults.length > 0
      ? allResults.reduce((s, r) => s + r.totalScore, 0) / allResults.length
      : 0;
  const passCount = allResults.filter((r) => r.totalScore >= 60).length;
  const failCount = allResults.length - passCount;
  const redLineCount = allResults.filter((r) => r.safetyLevel === 'red_line').length;
  const truncatedCount = allResults.filter((r) => r.outputMetadata?.truncated).length;

  return (
    <div>
      <h2 className="swiss-page-title">{data.runName}</h2>

      <div className="swiss-kpi-grid" style={{ marginBottom: 24 }}>
        <div className="swiss-kpi-card">
          <div className="kpi-label">状态</div>
          <div className="kpi-value" style={{ fontSize: 20 }}>{data.status}</div>
        </div>
        <div className="swiss-kpi-card">
          <div className="kpi-label">模型</div>
          <div className="kpi-value" style={{ fontSize: 18 }}>{data.modelConfig?.name || '-'}</div>
        </div>
        <div className="swiss-kpi-card">
          <div className="kpi-label">综合分</div>
          <div className="kpi-value accent">{avgScore.toFixed(2)}</div>
        </div>
        <div className="swiss-kpi-card">
          <div className="kpi-label">通过率</div>
          <div className="kpi-value">{allResults.length > 0 ? Math.round((passCount / allResults.length) * 100) : 0}%</div>
        </div>
        <div className="swiss-kpi-card">
          <div className="kpi-label">安全红线</div>
          <div className="kpi-value" style={{ color: redLineCount > 0 ? 'var(--danger)' : undefined }}>{redLineCount}</div>
        </div>
        <div className="swiss-kpi-card">
          <div className="kpi-label">总题数</div>
          <div className="kpi-value">{allResults.length}</div>
        </div>
        <div className="swiss-kpi-card">
          <div className="kpi-label">评测开始</div>
          <div className="kpi-value" style={{ fontSize: 16 }}>{formatTime(data.evalStartedAt)}</div>
        </div>
        <div className="swiss-kpi-card">
          <div className="kpi-label">评测完成</div>
          <div className="kpi-value" style={{ fontSize: 16 }}>{formatTime(data.evalFinishedAt)}</div>
        </div>
        <div className="swiss-kpi-card">
          <div className="kpi-label">总耗时</div>
          <div className="kpi-value" style={{ fontSize: 16 }}>{formatDuration(data.evalStartedAt, data.evalFinishedAt)}</div>
        </div>
      </div>

      {data.groupName && data.totalRuns > 1 && (
        <div className="swiss-card" style={{ marginBottom: 16, padding: '12px 16px' }}>
          <Tag color="blue">组运行</Tag>
          <span style={{ marginLeft: 8, color: 'var(--text-helper)' }}>
            本组共 {data.totalRuns} 次运行，已跨运行去重合并为 {allResults.length} 条结果
          </span>
        </div>
      )}

      <div className="swiss-card" style={{ marginBottom: 16 }}>
        <div className="swiss-card-title">导出 & 报告</div>
        <Space>
          <Button type="primary" icon={<FileSearchOutlined />} onClick={() => navigate(`/report/${id}`)}>查看评测报告</Button>
          <Button icon={<RobotOutlined />} onClick={() => navigate(`/report/${id}`)}>AI 分析报告</Button>
          <Button icon={<DownloadOutlined />} href={`/api/runs/${id}/export?format=json`} target="_blank">JSON</Button>
          <Button icon={<DownloadOutlined />} href={`/api/runs/${id}/export?format=csv`} target="_blank">CSV</Button>
          <Button icon={<DownloadOutlined />} href={`/api/runs/${id}/export?format=markdown`} target="_blank">Markdown</Button>
        </Space>
      </div>

      <div className="swiss-card" style={{ marginBottom: 16 }}>
        <div className="swiss-card-title">运行配置</div>
        <Descriptions column={3} size="small">
          <Descriptions.Item label="Max Tokens">{String(data.config?.maxTokens ?? '-')}</Descriptions.Item>
          <Descriptions.Item label="AI Judge">{data.config?.judgeEnabled ? '启用' : '禁用'}</Descriptions.Item>
          <Descriptions.Item label="安全红线">{data.config?.safetyCheckEnabled ? '启用' : '禁用'}</Descriptions.Item>
          <Descriptions.Item label="隐藏测试">{data.config?.hiddenTestsEnabled ? '启用' : '禁用'}</Descriptions.Item>
          <Descriptions.Item label="结构化输出">{data.config?.structuredOutputEnabled ? '启用' : '禁用'}</Descriptions.Item>
          <Descriptions.Item label="每题运行次数">{String(data.config?.runsPerQuestion ?? 1)}</Descriptions.Item>
        </Descriptions>
      </div>

      <div className="swiss-card">
        <div className="swiss-card-title">评测结果（{filteredResults.length} / {allResults.length} 题）</div>

        {/* 筛选区域 */}
        <div style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Segmented
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as StatusFilter)}
            options={[
              { label: `全部 (${allResults.length})`, value: 'all' },
              { label: `通过 (${passCount})`, value: 'passed' },
              { label: `失败 (${failCount})`, value: 'failed' },
              { label: `安全红线 (${redLineCount})`, value: 'red_line' },
              { label: `被截断 (${truncatedCount})`, value: 'truncated' },
            ]}
            size="middle"
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="筛选维度"
            value={dimensionFilter}
            onChange={setDimensionFilter}
            options={dimensionOptions}
            style={{ minWidth: 220 }}
            maxTagCount="responsive"
          />
          <Input
            placeholder="搜索题目编号或维度名"
            allowClear
            prefix={<SearchOutlined />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ width: 220 }}
          />
          {(statusFilter !== 'all' || dimensionFilter.length > 0 || keyword) && (
            <Button size="small" onClick={() => { setStatusFilter('all'); setDimensionFilter([]); setKeyword(''); }}>重置筛选</Button>
          )}
        </div>

        <Table
          dataSource={filteredResults}
          rowKey="scenarioId"
          pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: ['20', '50', '100'] }}
          columns={[
            { title: '题目', dataIndex: 'scenarioId', key: 'scenarioId', width: 120 },
            {
              title: '维度', dataIndex: 'dimension', key: 'dimension', width: 110,
              render: (v: string) => <Tag color="blue">{DIM_LABELS[v] || v}</Tag>,
              filters: dimensionOptions.map((o) => ({ text: o.label, value: o.value })),
              onFilter: (value: React.Key | boolean, record: ScenarioResult) => record.dimension === value,
            },
            {
              title: '分数', dataIndex: 'totalScore', key: 'totalScore', width: 100,
              render: (v: number) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Progress percent={v} size="small" status={v >= 80 ? 'success' : v >= 60 ? 'normal' : 'exception'} style={{ flex: 1 }} />
                  <span style={{ fontWeight: 600, minWidth: 24 }}>{v}</span>
                </div>
              ),
              sorter: (a: ScenarioResult, b: ScenarioResult) => a.totalScore - b.totalScore,
            },
            {
              title: '安全', dataIndex: 'safetyLevel', key: 'safetyLevel', width: 70,
              render: (v: string) => <Tag color={v === 'red_line' ? 'red' : 'green'}>{v === 'red_line' ? '红线' : '安全'}</Tag>,
            },
            {
              title: '截断', key: 'truncated', width: 60,
              render: (_: unknown, r: ScenarioResult) => <Tag color={r.outputMetadata.truncated ? 'orange' : 'green'}>{r.outputMetadata.truncated ? '是' : '否'}</Tag>,
            },
            {
              title: '完成时间', dataIndex: 'finishedAt', key: 'finishedAt', width: 120,
              render: (v: string) => <span style={{ color: 'var(--text-helper)', fontSize: 13 }}>{formatTime(v)}</span>,
              sorter: (a: ScenarioResult, b: ScenarioResult) => new Date(a.finishedAt).getTime() - new Date(b.finishedAt).getTime(),
              defaultSortOrder: 'descend' as const,
            },
            {
              title: '升级', dataIndex: 'escalated', key: 'escalated', width: 70,
              render: (v: boolean) => v ? <Tag color="purple">已升级</Tag> : <Tag>未升级</Tag>,
            },
            {
              title: '证据', key: 'evidence', width: 120,
              render: (_: unknown, r: ScenarioResult) => (
                <Collapse size="small" items={[{ key: '1', label: `${r.evidence.length} 条证据`, children: r.evidence.map((e, i) => <div key={i}>{e}</div>) }]} />
              ),
            },
            {
              title: '操作', key: 'action', width: 80, fixed: 'right' as const,
              render: (_: unknown, r: ScenarioResult) => (
                <Tooltip title="重新测试此题">
                  <Button
                    type="text"
                    size="small"
                    icon={<ReloadOutlined spin={retryingIds.includes(r.scenarioId)} />}
                    disabled={retryingIds.length >= 4 && !retryingIds.includes(r.scenarioId)}
                    onClick={() => handleRetry(r.scenarioId)}
                    style={{ color: r.totalScore < 60 ? '#f5222d' : undefined }}
                  />
                </Tooltip>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
