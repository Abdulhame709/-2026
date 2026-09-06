import { GlobalOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';

/**
 * مبدّل لغة الواجهة — العربية مفعّلة (الافتراضي المعتمد).
 * الإنجليزية ضمن النطاق لاحقاً (توطين التقارير FR-6/TLocalization) — العنصر جاهز من الآن.
 */
export function LanguageSwitch() {
  return (
    <div className="lang-switch" role="group" aria-label="لغة الواجهة">
      <GlobalOutlined aria-hidden="true" />
      <button type="button" className="lang-option lang-option--active" aria-pressed="true">
        العربية
      </button>
      <Tooltip title="النسخة الإنجليزية — في مرحلة لاحقة">
        <button type="button" className="lang-option" aria-pressed="false" disabled>
          English
        </button>
      </Tooltip>
    </div>
  );
}
