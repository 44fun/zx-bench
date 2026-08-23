import { useEffect, useState } from 'react';
import { Form, Input, Select, Button, Table, message, Popconfirm, Space, Tag, Switch, Alert, Modal, Checkbox, Spin } from 'antd';
import { useLanguage } from '../i18n';

interface ModelItem {
  id: string;
  name: string;              // 模型 ID（API model 参数）
  displayName?: string | null; // 模型名称（显示名）
  provider: string;
  baseUrl: string;
  modelType: string;
  reasoningModel?: boolean;
}

const MODEL_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  tested: { label: '被测模型', color: 'blue' },
  judge: { label: 'AI Judge', color: 'purple' },
};

interface CcsModel { model: string; isPrimary: boolean; exists: boolean; existingId?: string }
interface CcsProvider {
  providerId: string;
  name: string;
  isCurrent: boolean;
  baseUrl: string;
  baseUrlSource: 'opencode' | 'derived';
  apiKeyMasked: string;
  models: CcsModel[];
}
interface CcsImportResult {
  model: string; providerName: string; action: 'created' | 'updated' | 'skipped';
  ok?: boolean; latencyMs?: number; error?: string;
}

export default function ModelConfigPage() {
  const { t } = useLanguage();
  const [models, setModels] = useState<ModelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [togglingTypeId, setTogglingTypeId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ModelItem | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const modelType = Form.useWatch('modelType', form);
  // CC Switch 导入
  const [ccsOpen, setCcsOpen] = useState(false);
  const [ccsProviders, setCcsProviders] = useState<CcsProvider[]>([]);
  const [ccsLoading, setCcsLoading] = useState(false);
  const [ccsError, setCcsError] = useState<string | null>(null);
  const [ccsSelected, setCcsSelected] = useState<Set<string>>(new Set());
  const [ccsOverride, setCcsOverride] = useState(false);
  const [ccsImporting, setCcsImporting] = useState(false);
  const [ccsResults, setCcsResults] = useState<{ results: CcsImportResult[]; summary: { created: number; updated: number; skipped: number } } | null>(null);

  const fetchModels = () => {
    fetch('/api/models')
      .then((r) => r.json())
      .then((res) => { if (res.success) setModels(res.data); })
      .catch(console.error);
  };

  useEffect(() => { fetchModels(); }, []);

  const showName = (m: ModelItem) => m.displayName || m.name;

  const onFinish = async (values: Record<string, string>) => {
    setLoading(true);
    try {
      if (values.modelType === 'judge') {
        message.loading({ content: '正在测试 AI Judge 连通性，请稍候…', key: 'judge-add', duration: 0 });
      }
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (data.success) {
        message.success(values.modelType === 'judge' ? '连通性测试通过，AI Judge 已添加' : '模型已添加');
        message.destroy('judge-add');
        form.resetFields();
        fetchModels();
      } else {
        message.destroy('judge-add');
        message.error(data.error || '添加失败', 8);
      }
    } catch {
      message.destroy('judge-add');
      message.error('请求失败');
    } finally {
      setLoading(false);
    }
  };

  const onTestConnection = async (formInstance = form, extra?: { provider?: string; modelId?: string }) => {
    try {
      const values = await formInstance.validateFields(['name', 'baseUrl']);
      setTesting(true);
      message.loading({ content: '正在' + t('model.testConn') + '…', key: 'conn-test', duration: 0 });
      const fields = formInstance.getFieldsValue();
      const res = await fetch('/api/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name,
          baseUrl: values.baseUrl,
          provider: extra?.provider || fields.provider || 'openai',
          apiKey: fields.apiKey,
          reasoningModel: fields.reasoningModel,
          modelId: extra?.modelId,
        }),
      });
      const data = await res.json().catch(() => null);
      message.destroy('conn-test');
      if (data?.success) {
        message.success('连接成功（延迟 ' + data.data.latencyMs + 'ms），模型 ID 与密钥有效');
      } else {
        message.error(data?.error || '连接失败：请求异常', 8);
      }
    } catch (err) {
      message.destroy('conn-test');
      // 网络错误/响应解析失败等真实异常需要反馈给用户；表单校验失败由表单内联提示，无需额外弹错
      if (err instanceof Error && !err.message.includes('Validation')) {
        message.error('连接测试请求失败: ' + err.message, 8);
      }
    } finally {
      setTesting(false);
    }
  };

  const onDelete = async (id: string) => {
    await fetch('/api/models/' + id, { method: 'DELETE' });
    message.success('已删除');
    fetchModels();
  };

  const onToggleType = async (model: ModelItem, target: 'tested' | 'judge') => {
    setTogglingTypeId(model.id);
    try {
      const res = await fetch('/api/models/' + model.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelType: target }),
      });
      const data = await res.json().catch(() => null);
      if (data?.success) {
        message.success(target === 'judge' ? `「${showName(model)}」已设为 AI Judge` : `「${showName(model)}」已设为被测模型`);
        fetchModels();
      } else {
        message.error(data?.error || '转换失败', 8);
      }
    } catch (err) {
      message.error('类型转换请求失败: ' + (err instanceof Error ? err.message : String(err)), 8);
    } finally {
      setTogglingTypeId(null);
    }
  };

  // ===== CC Switch 导入 =====
  const ccsItemKey = (p: CcsProvider, m: CcsModel) => `${p.providerId}|${m.model}`;

  const ccsSelectableKeys = () => {
    const keys: string[] = [];
    for (const p of ccsProviders) {
      for (const m of p.models) {
        if (!(m.exists && !ccsOverride)) keys.push(ccsItemKey(p, m));
      }
    }
    return keys;
  };

  const onCcsSelectAll = () => {
    setCcsSelected(new Set(ccsSelectableKeys()));
  };

  const onCcsSelectInvert = () => {
    const next = new Set<string>();
    for (const k of ccsSelectableKeys()) {
      if (!ccsSelected.has(k)) next.add(k);
    }
    setCcsSelected(next);
  };

  const openCcsImport = async () => {
    setCcsOpen(true);
    setCcsLoading(true);
    setCcsError(null);
    setCcsResults(null);
    setCcsOverride(false);
    setCcsSelected(new Set());
    try {
      const res = await fetch('/api/models/ccswitch/preview');
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '读取失败');
      setCcsProviders(data.data.providers || []);
      // 默认勾选：每个 provider 的主模型（跳过已存在的）
      const sel = new Set<string>();
      for (const p of data.data.providers as CcsProvider[]) {
        for (const m of p.models) {
          if (m.isPrimary && !m.exists) sel.add(ccsItemKey(p, m));
        }
      }
      setCcsSelected(sel);
    } catch (err) {
      setCcsError(err instanceof Error ? err.message : String(err));
    } finally {
      setCcsLoading(false);
    }
  };

  const onCcsImport = async () => {
    if (ccsSelected.size === 0) { message.warning('请至少勾选一个模型'); return; }
    setCcsImporting(true);
    try {
      const items = [...ccsSelected].map((key) => {
        const [providerId, model] = key.split('|');
        // override 需随条目传递：后端按 item.override 决定是否覆盖同名同端点的已有配置
        return { providerId, model, override: ccsOverride };
      });
      const res = await fetch('/api/models/ccswitch/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '导入失败');
      setCcsResults(data.data);
      message.success(`导入完成：新增 ${data.data.summary.created} 条 / 覆盖 ${data.data.summary.updated} 条 / 跳过 ${data.data.summary.skipped} 条`);
      fetchModels();
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err), 8);
    } finally {
      setCcsImporting(false);
    }
  };

  const openEdit = (model: ModelItem) => {
    setEditing(model);
    editForm.setFieldsValue({
      displayName: model.displayName || '',
      name: model.name,
      baseUrl: model.baseUrl,
      reasoningModel: model.reasoningModel ?? false,
    });
  };

  const onEdit = async (values: Record<string, unknown>) => {
    if (!editing) return;
    setEditLoading(true);
    try {
      const res = await fetch('/api/models/' + editing.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (data.success) {
        message.success('模型已更新');
        setEditing(null);
        fetchModels();
      } else {
        message.error(data.error || '更新失败', 8);
      }
    } catch {
      message.error('请求失败');
    } finally {
      setEditLoading(false);
    }
  };

  const testedModels = models.filter((m) => m.modelType !== 'judge');
  const judgeModels = models.filter((m) => m.modelType === 'judge');

  const nameColumn = {
    title: '模型名称', key: 'displayName',
    render: (_: unknown, r: ModelItem) => (
      <span>{showName(r)}{!r.displayName && <Tag style={{ marginLeft: 6 }}>未设置</Tag>}</span>
    ),
  };
  const idColumn = { title: '模型 ID', dataIndex: 'name', key: 'name' };
  const providerColumn = { title: 'Provider', dataIndex: 'provider', key: 'provider' };
  const baseUrlColumn = { title: 'Base URL', dataIndex: 'baseUrl', key: 'baseUrl' };
  const actionColumn = (type: 'tested' | 'judge') => ({
    title: '操作', key: 'action',
    render: (_: unknown, r: ModelItem) => (
      <Space>
        <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
        <Popconfirm
          title={type === 'tested' ? `将「${showName(r)}」转为 AI Judge？` : `将「${showName(r)}」转为被测模型？`}
          onConfirm={() => onToggleType(r, type === 'tested' ? 'judge' : 'tested')}
        >
          <Button size="small" loading={togglingTypeId === r.id} disabled={togglingTypeId != null}>{type === 'tested' ? '设为 AI Judge' : '设为被测'}</Button>
        </Popconfirm>
        <Popconfirm title="确认删除？" onConfirm={() => onDelete(r.id)}>
          <Button danger size="small">删除</Button>
        </Popconfirm>
      </Space>
    ),
  });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 className="swiss-page-title">{t('model.title')}</h2>
        <Button onClick={openCcsImport}>从 CC Switch 导入</Button>
      </div>

      <div className="swiss-card" style={{ marginBottom: 24, maxWidth: 580 }}>
        <div className="swiss-card-title">{t('model.add')}</div>
        <Form form={form} layout="vertical" onFinish={onFinish} style={{ maxWidth: 500 }}>
          <Form.Item label={t('model.id')} name="name" rules={[{ required: true }]} tooltip="模型的真实 API 模型 ID（用于直接调用端点），如 hermes3.6-35b、qwen3.8-max。注意：这是调用参数，不是显示名称">
            <Input placeholder="例如：hermes3.6-35b" />
          </Form.Item>
          <Form.Item label={t('model.displayName')} name="displayName" tooltip="用户友好的显示名称，用于界面展示和区分；不填则默认与模型 ID 相同">
            <Input placeholder="例如：我的 35B 编程模型（不填则同模型 ID）" />
          </Form.Item>
          <Form.Item label={t('model.type')} name="modelType" initialValue="tested" tooltip="被测模型：参与 9 大维度评测的模型；AI Judge：用于对被测模型的回答进行二次评分复核的模型，自身不参与评测">
            <Select>
              <Select.Option value="tested">被测模型（参与评测的模型）</Select.Option>
              <Select.Option value="judge">AI Judge（评分复核模型）</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label={t('model.provider')} name="provider" initialValue="openai" tooltip="选择 API 提供商类型。OpenAI Compatible：兼容 OpenAI 接口格式的服务（如 vLLM、LM Studio 等）；Ollama：本地 Ollama 服务；Local：本地自定义服务">
            <Select>
              <Select.Option value="openai">OpenAI Compatible</Select.Option>
              <Select.Option value="ollama">Ollama</Select.Option>
              <Select.Option value="local">Local</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label={t('model.baseUrl')} name="baseUrl" rules={[{ required: true }]} tooltip="模型服务的 API 地址。OpenAI 兼容格式通常以 /v1 结尾，Ollama 默认为 http://localhost:11434/v1">
            <Input placeholder="http://localhost:11434/v1" />
          </Form.Item>
          <Form.Item label={t('model.apiKey')} name="apiKey" tooltip="访问模型服务的密钥。本地部署的模型（如 Ollama）通常无需填写；远程服务（如 OpenAI API、第三方推理平台）需要提供有效密钥">
            <Input.Password placeholder="可选" />
          </Form.Item>
          <Form.Item label={t('model.reasoning')} name="reasoningModel" valuePropName="checked" initialValue={false}
            tooltip="推理模型（如 QwQ、DeepSeek-R1）会产生大量思考链 tokens，勾选后系统自动分配更大的 token 预算（默认 32768），避免思考链耗尽输出配额导致空回复">
            <Switch />
          </Form.Item>
          {modelType === 'judge' && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="AI Judge 添加前将自动进行连通性测试"
              description="系统会用该配置发送一个小测试请求，确认模型 ID、API Key、端点全部可用后才会保存；测试失败将被拒绝添加，避免评测中途因 Judge 配置错误整批作废。"
            />
          )}
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={loading}>{modelType === 'judge' ? '测试并添加' : '添加模型'}</Button>
              <Button onClick={() => onTestConnection()} loading={testing}>{t('model.testConn')}</Button>
            </Space>
          </Form.Item>
        </Form>
      </div>

      <div className="swiss-card" style={{ marginBottom: 24 }}>
        <div className="swiss-card-title">{t('model.testedList')}</div>
        <Table
          dataSource={testedModels}
          rowKey="id"
          locale={{ emptyText: '暂无被测模型，请先添加' }}
          columns={[
            nameColumn,
            idColumn,
            providerColumn,
            baseUrlColumn,
            {
              title: '类型', key: 'type',
              render: (_: unknown, r: ModelItem) => (
                <Space size={4}>
                  <Tag color={MODEL_TYPE_LABELS[r.modelType]?.color || 'blue'}>
                    {MODEL_TYPE_LABELS[r.modelType]?.label || r.modelType}
                  </Tag>
                  {r.reasoningModel && <Tag color="orange">推理</Tag>}
                </Space>
              ),
            },
            actionColumn('tested'),
          ]}
        />
      </div>

      <div className="swiss-card">
        <div className="swiss-card-title">{t('model.judgeList')}</div>
        <Table
          dataSource={judgeModels}
          rowKey="id"
          locale={{ emptyText: '暂无 AI Judge 模型，评测时将跳过 AI Judge 复核' }}
          columns={[
            nameColumn,
            idColumn,
            providerColumn,
            baseUrlColumn,
            actionColumn('judge'),
          ]}
        />
      </div>

      <Modal
        title="编辑模型"
        open={!!editing}
        onOk={() => editForm.submit()}
        onCancel={() => setEditing(null)}
        confirmLoading={editLoading}
        okText="保存"
        cancelText="取消"
      >
        <Form form={editForm} layout="vertical" onFinish={onEdit} style={{ marginTop: 16 }}>
          <Form.Item label="模型名称（显示名）" name="displayName" tooltip="用户友好的显示名称；留空则显示模型 ID">
            <Input placeholder="留空则与模型 ID 相同" />
          </Form.Item>
          <Form.Item label={t('model.id')} name="name" rules={[{ required: true }]} tooltip="API 调用的 model 参数，修改会影响实际调用">
            <Input />
          </Form.Item>
          <Form.Item label={t('model.baseUrl')} name="baseUrl" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label={t('model.reasoning')} name="reasoningModel" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              onClick={() => onTestConnection(editForm, { provider: editing?.provider, modelId: editing?.id })}
              loading={testing}
              block
            >
              {t('model.testConn')}
            </Button>
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="从 CC Switch 导入模型"
        open={ccsOpen}
        onCancel={() => !ccsImporting && setCcsOpen(false)}
        width={720}
        footer={ccsResults ? (
          <Button type="primary" onClick={() => setCcsOpen(false)}>关闭</Button>
        ) : (
          <Space>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              已选 {ccsSelected.size} 个模型（导入后自动测试连接）
            </span>
            <Button onClick={() => setCcsOpen(false)} disabled={ccsImporting}>取消</Button>
            <Button type="primary" onClick={onCcsImport} loading={ccsImporting} disabled={ccsSelected.size === 0}>导入选中</Button>
          </Space>
        )}
      >
        {ccsLoading && <div style={{ textAlign: 'center', padding: 32 }}><Spin tip="正在读取 CC Switch 配置库..." /></div>}
        {!ccsLoading && ccsError && (
          <Alert type="warning" showIcon message="无法读取 CC Switch 配置" description={ccsError} />
        )}
        {!ccsLoading && !ccsError && ccsResults && (
          <div>
            <Alert
              type="info" showIcon style={{ marginBottom: 12 }}
              message={`新增 ${ccsResults.summary.created} 条 / 覆盖 ${ccsResults.summary.updated} 条 / 跳过 ${ccsResults.summary.skipped} 条`}
              description="每条已自动测试连接；红色条目为连接失败（模型 ID 或端点不可用），可点击表格「编辑」修正后重试"
            />
            <Table
              dataSource={ccsResults.results}
              rowKey={(r) => `${r.providerName}|${r.model}`}
              size="small" pagination={false}
              columns={[
                { title: 'Provider', dataIndex: 'providerName', width: 140 },
                { title: '模型', dataIndex: 'model', ellipsis: true },
                {
                  title: '结果', key: 'result', width: 260,
                  render: (_: unknown, r: CcsImportResult) => {
                    if (r.action === 'skipped') return <Tag>跳过：{r.error}</Tag>;
                    if (r.ok) return <Tag color="green">{r.action === 'created' ? '新增' : '覆盖'}成功 · {r.latencyMs}ms</Tag>;
                    return <Tag color="red" style={{ maxWidth: 240, whiteSpace: 'normal' }}>{(r.error || '测试失败').slice(0, 120)}</Tag>;
                  },
                },
              ]}
            />
          </div>
        )}
        {!ccsLoading && !ccsError && !ccsResults && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>来源：~\.cc-switch\cc-switch.db · 密钥仅显示掩码，导入时加密存储</span>
              <Space size={6}>
                <Button size="small" onClick={onCcsSelectAll} disabled={ccsProviders.length === 0}>全选</Button>
                <Button size="small" onClick={onCcsSelectInvert} disabled={ccsProviders.length === 0}>反选</Button>
                <span style={{ fontSize: 12 }}>覆盖已有配置</span>
                <Switch size="small" checked={ccsOverride} onChange={setCcsOverride} />
              </Space>
            </div>
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {ccsProviders.map((p) => (
                <div key={p.providerId} style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '10px 14px', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600 }}>{p.name}</span>
                    {p.isCurrent && <Tag color="green">当前使用</Tag>}
                    <Tag>{p.baseUrlSource === 'opencode' ? '端点·权威' : '端点·推导'}</Tag>
                    <code style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{p.baseUrl}</code>
                    <span style={{ fontSize: 11, color: 'var(--text-placeholder)' }}>key {p.apiKeyMasked}</span>
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {p.models.map((m) => {
                      const key = ccsItemKey(p, m);
                      const disabled = m.exists && !ccsOverride;
                      return (
                        <Checkbox
                          key={key}
                          checked={ccsSelected.has(key)}
                          disabled={disabled}
                          onChange={(e) => {
                            const next = new Set(ccsSelected);
                            if (e.target.checked) next.add(key); else next.delete(key);
                            setCcsSelected(next);
                          }}
                        >
                          <code style={{ fontSize: 12 }}>{m.model}</code>
                          {m.isPrimary && <Tag color="blue" style={{ marginLeft: 6 }}>主模型</Tag>}
                          {m.exists && <Tag color="purple">已存在</Tag>}
                        </Checkbox>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
