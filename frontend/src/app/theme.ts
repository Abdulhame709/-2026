import type { ThemeConfig } from 'antd';

/**
 * ترجمة نظام التصميم المعتمد (docs/stage-2c-ui-ux-design.md §0) إلى توكنز Ant Design.
 * ⚠️ هذه القيم ملزمة — أي لون جديد يُضاف هنا أولاً لا في المكوّنات.
 */
export const designTokens = {
  colorPrimary: '#0F4C81',
  colorPrimaryHover: '#0B3A63',
  colorPrimaryBg: '#E8F1F8',

  colorSuccess: '#16A34A',
  colorWarning: '#D97706',
  colorError: '#DC2626',
  colorInfo: '#2563EB',

  // ألوان الحالات الأربعة المحجوزة (لا تُستخدم لغيرها)
  statusMatched: '#16A34A',
  statusMatchedBg: '#F0FDF4',
  statusPartial: '#D97706',
  statusPartialBg: '#FFFBEB',
  statusOursOnly: '#7C3AED',
  statusOursOnlyBg: '#F5F3FF',
  statusTheirsOnly: '#DB2777',
  statusTheirsOnlyBg: '#FDF2F8',

  // شارات العملات الثابتة في كل النظام
  currencyYerBg: '#FEF3C7',
  currencyYerText: '#92400E',
  currencyUsdBg: '#DCFCE7',
  currencyUsdText: '#166534',
  currencySarBg: '#DBEAFE',
  currencySarText: '#1E40AF',

  colorText: '#0F172A',
  colorTextSecondary: '#475569',
  colorTextTertiary: '#94A3B8',
  colorBorder: '#E2E8F0',
  colorBgLayout: '#F8FAFC',

  borderRadius: 8,
  fontFamily: "'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, sans-serif",
} as const;

export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: designTokens.colorPrimary,
    colorInfo: designTokens.colorInfo,
    colorSuccess: designTokens.colorSuccess,
    colorWarning: designTokens.colorWarning,
    colorError: designTokens.colorError,
    colorText: designTokens.colorText,
    colorTextSecondary: designTokens.colorTextSecondary,
    colorBorder: designTokens.colorBorder,
    colorBgLayout: designTokens.colorBgLayout,
    borderRadius: designTokens.borderRadius,
    fontFamily: designTokens.fontFamily,
    fontSize: 14,
  },
  components: {
    Table: {
      // كثافة مالية مدمجة (§0.3)
      cellPaddingBlockSM: 6,
      cellPaddingInlineSM: 8,
    },
  },
};
