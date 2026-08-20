import { useEffect, useState } from 'react';
import { Form, Input, Select, Button, Table, message, Popconfirm, Space, Tag, Switch, Alert, Modal } from 'antd';
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

export default function ModelConfigPage() {
  const { t } = useLanguage();
  const [models, setModels] = useState<ModelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [editing, setEditing] = useState<ModelItem | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const modelType = Form.useWatch('modelType', form);

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
      const data = await res.json();
      message.destroy('conn-test');
      if (data.success) {
        message.success('连接成功（延迟 ' + data.data.latencyMs + 'ms），模型 ID 与密钥有效');
      } else {
        message.error(data.error || '连接失败', 8);
      }
    } catch {
      message.destroy('conn-test');
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
    const res = await fetch('/api/models/' + model.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelType: target }),
    });
    const data = await res.json();
    if (data.success) {
      message.success(target === 'judge' ? `「${showName(model)}」已设为 AI Judge` : `「${showName(model)}」已设为被测模型`);
      fetchModels();
    } else {
      message.error(data.error || '转换失败', 8);
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
          <Button size="small">{type === 'tested' ? '设为 AI Judge' : '设为被测'}</Button>
        </Popconfirm>
        <Popconfirm title="确认删除？" onConfirm={() => onDelete(r.id)}>
          <Button danger size="small">删除</Button>
        </Popconfirm>
      </Space>
    ),
  });

  return (
    <div>
      <h2 className="swiss-page-title">{t('model.title')}</h2>

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
    </div>
  );
}
