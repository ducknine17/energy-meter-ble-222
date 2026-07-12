export default function DataTile({ title, value, unit, accent = "" }) {
  return (
    <div className={`data-tile data-${accent}`}>
      <div className="data-title">{title}</div>

      <div className="data-main">
        <span className="data-value">{value}</span>
        {unit && <span className="data-unit">{unit}</span>}
      </div>
    </div>
  );
}