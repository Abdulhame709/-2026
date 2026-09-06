import { App as AntApp, ConfigProvider } from 'antd';
import arEG from 'antd/locale/ar_EG';
import type { ReactNode } from 'react';
import { AuthProvider } from './AuthContext';
import { antdTheme } from './theme';
import { AppRoutes } from './AppRoutes';

/**
 * مزودات التطبيق: RTL + الثيم المعتمد + اللغة العربية + سياق المصادقة + التوجيه.
 * ملاحظة: locale ar_EG يضبط صيغ AntD؛ رسائلنا النصية عربية أصلاً.
 */
export function AppProviders({ children }: { children?: ReactNode }) {
  return (
    <ConfigProvider direction="rtl" locale={arEG} theme={antdTheme}>
      <AntApp>
        <AuthProvider>
          <AppRoutes />
          {children}
        </AuthProvider>
      </AntApp>
    </ConfigProvider>
  );
}
