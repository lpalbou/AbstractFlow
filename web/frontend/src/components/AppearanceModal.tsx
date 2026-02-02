import { FontScaleSelect, HeaderDensitySelect, ThemeSelect } from '@abstractuic/ui-kit';

export type AppearanceSettings = {
  theme: string;
  font_scale: string;
  header_density: string;
};

export function AppearanceModal({
  isOpen,
  value,
  onChange,
  onClose,
}: {
  isOpen: boolean;
  value: AppearanceSettings;
  onChange: (next: AppearanceSettings) => void;
  onClose: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <h3>Appearance</h3>
        <p>Theme and typography are stored locally in this browser.</p>

        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10, alignItems: 'center' }}>
          <label className="property-label">Theme</label>
          <ThemeSelect value={value.theme} onChange={(theme) => onChange({ ...value, theme })} />

          <label className="property-label">Font size</label>
          <FontScaleSelect value={value.font_scale} onChange={(font_scale) => onChange({ ...value, font_scale })} />

          <label className="property-label">Header size</label>
          <HeaderDensitySelect value={value.header_density} onChange={(header_density) => onChange({ ...value, header_density })} />
        </div>

        <div className="modal-actions">
          <button className="modal-button cancel" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
