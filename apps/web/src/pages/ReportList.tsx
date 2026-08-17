import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Tag, Spin, Empty, Card, Tooltip } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

interface ReportEntry {
  runId: string;
  runName: string;
  modelName: string;
  provider: string;
  status: string;
  totalScenarios: number;
  averageScore: number;
  passRate: number;
  passCount: number;
  redLineCount: number;
  createdAt: string;
}

function scoreColor(score: number): string {
  if (score >= 80) return '#52c41a';
  if (score >= 60) return '#1890ff';
  if (score >= 40) return '#faad14';
  return '#f5222d';
}

export default function ReportList() {
  const navigate = useNavigate();
  const [data, setData] = useState<ReportEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/runs?status=completed')
      .then((r) => r.json())
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          const entries: ReportEntry[] = res.data
            .filter((r: { status: string }) => r.status === 'completed')
            .map((r: {
              id: string;
              name: string;
              modelConfig?: { name: string; provider: string };
              modelConfigId?: string;
              _count?: { scenarioResults: number };
              createdAt: string;
              status: string;
            }) => ({
              runId: r.id,
              runName: r.name || '未命名',
              modelName: r.modelConfig?.name || '未知模型',
              provider: r.modelConfig?.provider || '-',
              status: r.status,
              totalScenarios: r._count?.scenarioResults ?? 0,
              averageScore: 0,
              passRate: 0,
              passCount: 0,
              redLineCount: 0,
              createdAt: r.createdAt,
            }));
          setData(entries);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // 加载每条运行的报告摘要
  useEffect(() => {
    if (data.length === 0) return;
    let cancelled = false;
    (async () => {
      const updated = await Promise.all(
        data.map(async (entry) => {
          try {
            const res = await fetch(`/api/runs/${entry.runId}/report`);
            const json = await res.json();
            if (json.success && json.data) {
              return {
                ...entry,
                averageScore: json.data.averageScore ?? 0,
                passRate: json.data.passRate ?? 0,
                passCount: json.data.passCount ?? 0,
                totalScenarios: json.data.totalScenarios ?? entry.totalScenarios,
                redLineCount: json.data.redLineCount ?? 0,
              };
            }
            return entry;
          } catch {
            return entry;
          }
        })
      );
      if (!cancelled) setData(updated);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.length > 0]);

  if (loading) return <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" /></div>;
  if (!data || data.length === 0) return <Empty description="暂无已完成的评测报告" style={{ padding: 80 }} />;

  // 按成绩降序排列
  data.sort((a, b) => b.averageScore - a.averageScore);

  const columns: ColumnsType<ReportEntry> = [
    {
      title: '评测名称',
      dataIndex: 'runName',
      key: 'runName',
      width: 200,
      render: (name: string, record: ReportEntry) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileTextOutlined style={{ color: 'var(--text-helper)' }} />
          <span style={{ fontWeight: 500 }}>{name}</span>
          <Tag color={record.status === 'completed' ? 'green' : 'default'} style={{ margin: 0 }}>{record.status === 'completed' ? '已完成' : record.status}</Tag>
        </div>
      ),
    },
    {
      title: '模型',
      dataIndex: 'modelName',
      key: 'modelName',
      width: 180,
      render: (name: string, record: ReportEntry) => (
        <div>
          <div style={{ fontWeight: 600 }}>{name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-helper)' }}>{record.provider}</div>
        </div>
      ),
    },
    {
      title: '综合分',
      dataIndex: 'averageScore',
      key: 'averageScore',
      width: 90,
      sorter: (a, b) => a.averageScore - b.averageScore,
      defaultSortOrder: 'descend',
      render: (score: number) => (
        <span style={{ fontSize: 18, fontWeight: 700, color: scoreColor(score) }}>{score.toFixed(2)}</span>
      ),
    },
    {
      title: '通过率',
      key: 'passRate',
      width: 100,
      render: (_: unknown, record: ReportEntry) => (
        <div>
          <span style={{ fontWeight: 600, color: record.passRate >= 70 ? '#52c41a' : '#faad14' }}>{record.passRate}%</span>
          <div style={{ fontSize: 11, color: 'var(--text-helper)' }}>{record.passCount}/{record.totalScenarios}</div>
        </div>
      ),
    },
    {
      title: '题数',
      dataIndex: 'totalScenarios',
      key: 'totalScenarios',
      width: 70,
      render: (n: number) => <span style={{ color: n >= 400 ? '#52c41a' : 'var(--text-helper)' }}>{n}</span>,
    },
    {
      title: '安全红线',
      dataIndex: 'redLineCount',
      key: 'redLineCount',
      width: 80,
      render: (n: number) => (
        n > 0
          ? <Tag color="red">{n}</Tag>
          : <Tag color="green">无</Tag>
      ),
    },
    {
      title: '评测时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 120,
      render: (t: string) => <span style={{ fontSize: 12, color: 'var(--text-helper)' }}>{new Date(t).toLocaleString('zh-CN')}</span>,
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      fixed: 'right',
      render: (_: unknown, record: ReportEntry) => (
        <a onClick={() => navigate(`/report/${record.runId}`)}>查看报告</a>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <h2 className="swiss-page-title" style={{ marginBottom: 24 }}>评测报告</h2>
      <Card className="swiss-card">
        <Table
          columns={columns}
          dataSource={data}
          rowKey="runId"
          scroll={{ x: 1000 }}
          pagination={false}
          size="middle"
        />
      </Card>
    </div>
  );
}
