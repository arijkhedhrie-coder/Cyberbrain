import { useEffect } from "react";
import { useServers } from "../../../application/services/useServers";

interface Props {
  selected: string;
  onChange: (dataset: string) => void;
}

export const ServerSelector = ({ selected, onChange }: Props) => {
  const { servers, loading } = useServers();

  useEffect(() => {
    if (!selected && servers.length > 0) {
      onChange(servers[0].id);
    }
  }, [onChange, selected, servers]);

  if (loading) {
    return <span style={{ fontSize: 11, color: "#64748b" }}>...</span>;
  }

  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginLeft: 8,
        color: "#94a3b8",
        fontSize: 11,
        letterSpacing: 1,
      }}
    >
      SOURCE
      <select
        value={selected}
        onChange={(event) => onChange(event.target.value)}
        style={{
          minWidth: 220,
          padding: "6px 10px",
          borderRadius: 6,
          border: "1px solid #334155",
          background: "#0f172a",
          color: "#e2e8f0",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {servers.length === 0 && <option value="">Aucune source</option>}
        {servers.map((dataset) => (
          <option key={dataset.id} value={dataset.id}>
            {dataset.display}
          </option>
        ))}
      </select>
    </label>
  );
};
