const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const Logo = () => (
  <svg {...base} width={22} height={22} strokeWidth={1.8}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <path d="M14 17.5h7M17.5 14v7" />
  </svg>
);
export const Chevrons = ({ flip }: { flip?: boolean }) => (
  <svg {...base} style={flip ? { transform: "rotate(180deg)" } : undefined}>
    <path d="M11 17l-5-5 5-5" />
    <path d="M18 17l-5-5 5-5" />
  </svg>
);
export const Radar = ({ size = 20 }: { size?: number }) => (
  <svg {...base} width={size} height={size}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
  </svg>
);
export const Flag = () => (
  <svg {...base}>
    <path d="M5 21V4h11l-2 4 2 4H5" />
  </svg>
);
export const List = () => (
  <svg {...base}>
    <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </svg>
);
export const Close = () => (
  <svg {...base}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const Sun = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
export const Moon = () => (
  <svg {...base}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </svg>
);
export const Lock = () => (
  <svg {...base} width={16} height={16} style={{ flex: "none", marginTop: 2 }}>
    <rect x="4" y="10" width="16" height="11" rx="1" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);
export const Person = () => (
  <svg {...base}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c1-4 4.5-6 8-6s7 2 8 6" />
  </svg>
);
