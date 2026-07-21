// Drug Design Studio (DDS) logo — an aromatic ligand docking into a receptor
// pocket, with dashed interaction lines and a highlighted binding atom.
export default function Logo({ size = 40, className = '' }) {
  const nodes = [
    [37, 24], [33.5, 17.94], [26.5, 17.94], [33.5, 30.06], [26.5, 30.06],
  ]
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none"
      xmlns="http://www.w3.org/2000/svg" className={className}
      role="img" aria-label="Drug Design Studio logo">
      <defs>
        <linearGradient id="ddsTile" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#13233f" />
          <stop offset="1" stopColor="#0a1120" />
        </linearGradient>
        <linearGradient id="ddsTeal" x1="14" y1="12" x2="38" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7ff2df" />
          <stop offset="1" stopColor="#14b8a6" />
        </linearGradient>
      </defs>

      <rect x="0.75" y="0.75" width="46.5" height="46.5" rx="12"
        fill="url(#ddsTile)" stroke="#2dd4bf" strokeOpacity="0.4" strokeWidth="1.5" />

      {/* receptor pocket (crescent) */}
      <path d="M26 13.5 A 10.5 10.5 0 1 0 26 34.5" fill="none"
        stroke="url(#ddsTeal)" strokeWidth="2.6" strokeLinecap="round" />

      {/* interaction contacts */}
      <path d="M22.6 19.6 L26.4 18.1 M22.6 28.4 L26.4 29.9 M18.5 24 L23 24"
        stroke="#7ff2df" strokeWidth="1.3" strokeLinecap="round" strokeDasharray="0.1 2.5" />

      {/* aromatic ligand ring */}
      <polygon points="37,24 33.5,17.94 26.5,17.94 23,24 26.5,30.06 33.5,30.06"
        fill="none" stroke="url(#ddsTeal)" strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="30" cy="24" r="3.3" fill="none" stroke="url(#ddsTeal)" strokeWidth="1.3" />
      {nodes.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.35" fill="#5eead4" />)}

      {/* key binding atom */}
      <circle cx="23" cy="24" r="2.7" fill="#ffffff" />
      <circle cx="23" cy="24" r="2.7" fill="none" stroke="#2dd4bf" strokeWidth="0.8" />
    </svg>
  )
}
