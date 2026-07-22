type MapPanelToggleProps = {
  expanded: boolean;
  onToggle: () => void;
};

export default function MapPanelToggle({ expanded, onToggle }: MapPanelToggleProps) {
  const label = expanded ? "ย่อแผงข้อมูล" : "ขยายแผงข้อมูล";

  return (
    <button
      type="button"
      className={`map-panel-toggle ${expanded ? "map-panel-toggle-collapse" : "map-panel-toggle-expand"}`}
      aria-expanded={expanded}
      aria-controls="cesium-map-panel"
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <span aria-hidden="true">{expanded ? "‹" : "›"}</span>
    </button>
  );
}
