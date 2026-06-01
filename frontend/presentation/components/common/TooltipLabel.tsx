import type { CSSProperties, ReactNode } from "react";

type TooltipLabelProps = {
  children: ReactNode;
  tooltip: string;
  style?: CSSProperties;
  iconSize?: number;
};

const iconStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 14,
  height: 14,
  borderRadius: 999,
  border: "1px solid currentColor",
  fontSize: 9,
  fontWeight: 700,
  lineHeight: 1,
  flexShrink: 0,
  opacity: 0.8,
};

export function TooltipLabel({ children, tooltip, style, iconSize = 9 }: TooltipLabelProps) {
  return (
    <span
      title={tooltip}
      aria-label={tooltip}
      tabIndex={0}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        cursor: "help",
        ...style,
      }}
    >
      <span>{children}</span>
      <span style={{ ...iconStyle, fontSize: iconSize }}>?</span>
    </span>
  );
}
