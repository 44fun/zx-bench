import { useEffect, useState, useCallback } from 'react';
import { Table, Tag, Select, Empty } from 'antd';
import ReactECharts from 'echarts-for-react';
import { useTheme } from '../theme';

interface RunSummary {
  id: string;
  name: string;
  status: string;
  modelConfig: { name: string; provider: string };
  summary: { averageScore: number; totalScenarios: number; safetyRedLineCount: number } | null;
  createdAt: string;
}

export default function ModelCompare() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const { mode } = useTheme();

  const fetchRuns = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/runs');
      const json = await res.json();
      if (json.success) setRuns(json.data);
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // 初次加载 + 每 5 秒轮询，使重测/重试后的综合分实时变动
  useEffect(() => {
    setLoading(true);
    fetchRuns(false);
    const timer = window.setInterval(() => fetchRuns(true), 5000);
    return () => window.clearInterval(timer);
  }, [fetchRuns]);

  // 已完成的评测按时间倒序（最新在前），便于选择最新结果
  const completedRuns = runs.filter((r) => r.status === 'completed').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const selectedRuns = completedRuns.filter((r) => selectedIds.includes(r.id));

  const isDark = mode === 'dark';
  const accentColor = isDark ? '#5b7bff' : '#002fa7';
  const textColor = isDark ? '#fafaf8' : '#0a0a0a';
  const textSecondary = isDark ? '#a8a8a8' : '#525252';
  const borderColor = isDark ? '#2a2a2a' : '#e0e0e0';

  const chartTextStyle = { color: textSecondary, fontSize: 11 };

  const barOption = selectedRuns.length > 0 ? {
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: isDark ? '#121212' : '#fff',
      borderColor: borderColor,
      textStyle: { color: textColor },
    },
    xAxis: {
      type: 'category' as const,
      data: selectedRuns.map((r) => r.modelConfig.name),
      axisLabel: { color: textSecondary, fontSize: 11 },
      axisLine: { lineStyle: { color: borderColor } },
    },
    yAxis: {
      type: 'value' as const, max: 100, name: '综合分',
      nameTextStyle: chartTextStyle,
      axisLabel: chartTextStyle,
      splitLine: { lineStyle: { color: borderColor } },
    },
    series: [
      {
        name: '综合分',
        type: 'bar',
        data: selectedRuns.map((r) => r.summary?.averageScore ?? 0),
        itemStyle: { color: accentColor },
        barWidth: '40%',
      },
      {
        name: '安全红线数',
        type: 'bar',
        data: selectedRuns.map((r) => r.summary?.safetyRedLineCount ?? 0),
        itemStyle: { color: '#c41e3a' },
        barWidth: '40%',
      },
    ],
  } : null;

  const trendOption = selectedRuns.length > 1 ? {
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: isDark ? '#121212' : '#fff',
      borderColor: borderColor,
      textStyle: { color: textColor },
    },
    xAxis: {
      type: 'category' as const,
      data: selectedRuns.map((r) => new Date(r.createdAt).toLocaleDateString()),
      axisLabel: chartTextStyle,
      axisLine: { lineStyle: { color: borderColor } },
    },
    yAxis: {
      type: 'value' as const, max: 100, name: '综合分',
      nameTextStyle: chartTextStyle,
      axisLabel: chartTextStyle,
      splitLine: { lineStyle: { color: borderColor } },
    },
    series: [{
      name: '综合分趋势',
      type: 'line',
      data: selectedRuns.map((r) => r.summary?.averageScore ?? 0),
      smooth: true,
      lineStyle: { color: accentColor, width: 2 },
      itemStyle: { color: accentColor },
      areaStyle: { color: accentColor + '20' },
    }],
  } : null;

  return (
    <div>
      <h2 className="swiss-page-title">多模型对比</h2>

      <div className="swiss-card" style={{ marginBottom: 16 }}>
        <div className="swiss-card-title">选择评测</div>
        <div style={{ marginBottom: 8, color: 'var(--text-secondary)', fontSize: 13 }}>选择要对比的评测（可多选）：</div>
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="选择评测运行"
          value={selectedIds}
          onChange={setSelectedIds}
          loading={loading}
        >
          {completedRuns.map((r) => (
            <Select.Option key={r.id} value={r.id}>
              {r.name} — {r.modelConfig.name} (综合分: {r.summary?.averageScore != null ? r.summary.averageScore.toFixed(2) : '0.00'})
            </Select.Option>
          ))}
        </Select>
      </div>

      {selectedRuns.length === 0 ? (
        <div className="swiss-card">
          <Empty description="请选择至少一个评测进行对比" />
        </div>
      ) : (
        <>
          <div className="swiss-card" style={{ marginBottom: 16 }}>
            <div className="swiss-card-title">综合分对比（柱状图）</div>
            {barOption && <ReactECharts option={barOption} style={{ height: 300 }} />}
          </div>

          {trendOption && (
            <div className="swiss-card" style={{ marginBottom: 16 }}>
              <div className="swiss-card-title">分数趋势线</div>
              <ReactECharts option={trendOption} style={{ height: 250 }} />
            </div>
          )}

          <div className="swiss-card">
            <div className="swiss-card-title">详细对比表</div>
            <Table
              dataSource={selectedRuns}
              rowKey="id"
              pagination={false}
              columns={[
                { title: '评测名称', dataIndex: 'name', key: 'name' },
                { title: '模型', key: 'model', render: (_: unknown, r: RunSummary) => <Tag color="blue">{r.modelConfig.name}</Tag> },
                { title: '综合分', key: 'avg', render: (_: unknown, r: RunSummary) => r.summary?.averageScore != null ? r.summary.averageScore.toFixed(2) : '0.00' },
                { title: '题目数', key: 'total', render: (_: unknown, r: RunSummary) => r.summary?.totalScenarios ?? 0 },
                { title: '安全红线', key: 'safety', render: (_: unknown, r: RunSummary) => <Tag color={r.summary?.safetyRedLineCount ? 'red' : 'green'}>{r.summary?.safetyRedLineCount ?? 0}</Tag> },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}
