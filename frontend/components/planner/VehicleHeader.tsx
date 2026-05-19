interface VehicleHeaderProps {
  name: string;
  plate?: string;
  saving?: boolean;
  onSave?: () => void;
}

export function VehicleHeader({ name, plate = "DW 12345", saving, onSave }: VehicleHeaderProps) {
  return (
    <header className="vehicle-header">
      <div>
        <h2 className="vehicle-header__title">{name}</h2>
        <p className="vehicle-header__plate">{plate}</p>
      </div>
      {onSave ? (
        <button type="button" className="button button--primary" onClick={onSave} disabled={saving}>
          {saving ? "Zapisywanie…" : "Zapisz layout"}
        </button>
      ) : null}
    </header>
  );
}
