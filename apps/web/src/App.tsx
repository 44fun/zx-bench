import { Routes, Route, Navigate } from 'react-router-dom';
import { message, Tooltip } from 'antd';
import {
  DashboardOutlined,
  PlayCircleOutlined,
  HistoryOutlined,
  FileTextOutlined,
  SettingOutlined,
  BarChartOutlined,
  MonitorOutlined,
  BulbOutlined,
  BulbFilled,
  TrophyOutlined,
  FileSearchOutlined,
  DollarOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTheme } from './theme';
import AnimatedBackground from './components/AnimatedBackground';
import Dashboard from './pages/Dashboard';
import EvalCreate from './pages/EvalCreate';
import EvalHistory from './pages/EvalHistory';
import EvalDetail from './pages/EvalDetail';
import EvalLive from './pages/EvalLive';
import EvalBatchLive from './pages/EvalBatchLive';
import Scenarios from './pages/Scenarios';
import ModelConfig from './pages/ModelConfig';
import ModelCompare from './pages/CompareModels';
import Report from './pages/Report';
import ReportList from './pages/ReportList';
import Leaderboard from './pages/Leaderboard';
import ModelValue from './pages/ModelValue';

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: '总览' },
  { key: '/eval/create', icon: <PlayCircleOutlined />, label: '创建评测' },
  { key: '/eval/live', icon: <MonitorOutlined />, label: '实时监控' },
  { key: '/eval/history', icon: <HistoryOutlined />, label: '评测历史' },
  { key: '/reports', icon: <FileSearchOutlined />, label: '评测报告' },
  { key: '/leaderboard', icon: <TrophyOutlined />, label: '排行榜' },
  { key: '/scenarios', icon: <FileTextOutlined />, label: '题目管理' },
  { key: '/compare', icon: <BarChartOutlined />, label: '模型对比' },
  { key: '/value', icon: <DollarOutlined />, label: '模型性价比' },
  { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
];

const pageTitles: Record<string, string> = {
  '/': '总览',
  '/eval/create': '创建评测',
  '/eval/live': '实时监控',
  '/eval/history': '评测历史',
  '/reports': '评测报告',
  '/leaderboard': '排行榜',
  '/scenarios': '题目管理',
  '/compare': '模型对比',
  '/value': '模型性价比',
  '/settings': '系统设置',
};

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, toggle } = useTheme();

  const handleMenuClick = async (key: string) => {
    if (key === '/eval/live') {
      try {
        const res = await fetch('/api/runs');
        const json = await res.json();
        if (json.success) {
          const running = json.data.find((r: { status: string }) => r.status === 'running' || r.status === 'pending');
          if (running) {
            navigate(`/eval/live/${running.id}`);
          } else {
            message.info('当前没有运行中的评测，请在「评测历史」中查看已完成评测');
            navigate('/eval/history');
          }
        } else {
          navigate('/eval/history');
        }
      } catch {
        navigate('/eval/history');
      }
    } else {
      navigate(key);
    }
  };

  const getSelectedKey = () => {
    if (location.pathname.startsWith('/eval/live')) return '/eval/live';
    if (location.pathname.startsWith('/eval/batch')) return '/eval/live';
    if (location.pathname.startsWith('/report/')) return '/reports';
    if (location.pathname.startsWith('/eval/') && location.pathname !== '/eval/create' && location.pathname !== '/eval/history' && location.pathname !== '/eval/live') return '/eval/history';
    return location.pathname;
  };

  const selectedKey = getSelectedKey();
  const currentTitle = pageTitles[selectedKey] || '智秀大模型评测';

  return (
    <div className="swiss-layout">
      <AnimatedBackground />

      {/* ===== Swiss Sidebar ===== */}
      <aside className="swiss-sider">
        <div className="swiss-sider-logo">
          <div className="logo-mark">ZX</div>
          <div className="logo-text">
            智秀大模型评测
            <span className="logo-sub">ZX · 大模型评测</span>
          </div>
        </div>
        <nav className="swiss-sider-menu">
          {menuItems.map((item) => (
            <div
              key={item.key}
              className={`swiss-menu-item ${selectedKey === item.key ? 'active' : ''}`}
              onClick={() => handleMenuClick(item.key)}
            >
              {item.icon}
              <span>{item.label}</span>
            </div>
          ))}
        </nav>
        <div className="swiss-sider-footer">
          v2.0 · <span className="footer-accent">9 DIM</span> · 404 Q
        </div>
      </aside>

      {/* ===== Main Area ===== */}
      <div className="swiss-main">
        <header className="swiss-header">
          <div className="swiss-header-title">
            <span className="header-accent"></span>
            {currentTitle}
          </div>
          <div className="swiss-header-actions">
            <Tooltip title={mode === 'dark' ? '切换到亮色' : '切换到暗色'}>
              <button className="theme-toggle" onClick={toggle}>
                {mode === 'dark' ? <BulbFilled /> : <BulbOutlined />}
              </button>
            </Tooltip>
          </div>
        </header>

        <main className="swiss-content swiss-fade-in">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/eval/create" element={<EvalCreate />} />
            <Route path="/eval/live/:id" element={<EvalLive />} />
            <Route path="/eval/batch/:groupName" element={<EvalBatchLive />} />
            <Route path="/eval/history" element={<EvalHistory />} />
            <Route path="/eval/:id" element={<EvalDetail />} />
            <Route path="/report/:id" element={<Report />} />
            <Route path="/reports" element={<ReportList />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/scenarios" element={<Scenarios />} />
            <Route path="/compare" element={<ModelCompare />} />
            <Route path="/value" element={<ModelValue />} />
            <Route path="/settings" element={<ModelConfig />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
