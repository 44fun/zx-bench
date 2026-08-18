import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import App from './App';
import { ThemeProvider, useTheme } from './theme';
import { LanguageProvider, useLanguage } from './i18n';
import './global.css';

function ThemedApp() {
  const { mode } = useTheme();
  const { lang } = useLanguage();

  return (
    <ConfigProvider
      locale={lang === 'en' ? enUS : zhCN}
      theme={{
        algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: mode === 'dark' ? '#5b7bff' : '#002fa7',
          borderRadius: 0,
          fontFamily: '"Inter", "Helvetica Neue", "Helvetica", "Arial", "Segoe UI", system-ui, -apple-system, sans-serif, "PingFang SC", "Microsoft YaHei UI"',
          fontSize: 14,
          colorBgContainer: mode === 'dark' ? '#121212' : '#fafaf8',
          colorBgLayout: mode === 'dark' ? '#0a0a0a' : '#fafaf8',
          colorText: mode === 'dark' ? '#fafaf8' : '#0a0a0a',
          colorTextSecondary: mode === 'dark' ? '#a8a8a8' : '#525252',
          colorBorder: mode === 'dark' ? '#2a2a2a' : '#e0e0e0',
          colorBorderSecondary: mode === 'dark' ? '#2a2a2a' : '#d4d4d2',
          wireframe: false,
        },
        components: {
          Layout: {
            siderBg: mode === 'dark' ? '#000000' : '#0a0a0a',
            headerBg: mode === 'dark' ? '#121212' : '#fafaf8',
            headerHeight: 56,
            bodyBg: mode === 'dark' ? '#0a0a0a' : '#fafaf8',
          },
          Menu: {
            darkItemBg: 'transparent',
            darkSubMenuItemBg: 'transparent',
            darkItemSelectedBg: 'rgba(91, 123, 255, 0.2)',
            darkItemHoverBg: 'rgba(255, 255, 255, 0.04)',
            darkItemColor: 'rgba(255, 255, 255, 0.65)',
            darkItemSelectedColor: '#ffffff',
            itemBorderRadius: 0,
            itemMarginInline: 0,
          },
          Card: {
            headerFontSize: 14,
            paddingLG: 24,
          },
          Table: {
            headerBg: mode === 'dark' ? '#121212' : '#fafaf8',
            headerColor: mode === 'dark' ? '#a8a8a8' : '#525252',
            rowHoverBg: mode === 'dark' ? 'rgba(91, 123, 255, 0.15)' : 'rgba(0, 47, 167, 0.06)',
            borderColor: mode === 'dark' ? '#2a2a2a' : '#e0e0e0',
          },
          Button: {
            borderRadius: 0,
            primaryShadow: 'none',
            defaultShadow: 'none',
          },
          Input: {
            borderRadius: 0,
            activeShadow: '0 0 0 2px rgba(0, 47, 167, 0.12)',
          },
          Select: {
            borderRadius: 0,
          },
          Tag: {
            borderRadiusSM: 0,
          },
          Progress: {
            defaultColor: mode === 'dark' ? '#5b7bff' : '#002fa7',
          },
        },
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <LanguageProvider>
        <ThemedApp />
      </LanguageProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
