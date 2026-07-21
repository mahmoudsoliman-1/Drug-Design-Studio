// Renders a ligand's real 2D structure (from RDKit `ligand2d`: atoms/bonds/rings)
// using the same coloring/design as the interaction diagram — dark bonds,
// element-coloured heteroatom labels, aromatic ring circles. Fits to the box.
const EL_COLOR = { O: '#dc2626', N: '#2563eb', S: '#d97706', P: '#ea580c', F: '#16a34a', Cl: '#16a34a', Br: '#a16207', I: '#7c3aed' }

export default function Ligand2D({ ligand2d, width = 220, height = 128, pad = 16, className = '' }) {
  if (!ligand2d || !ligand2d.atoms || !ligand2d.atoms.length) {
    return <div className={className} style={{ width, height }} />
  }
  const xs = ligand2d.atoms.map((a) => a.x), ys = ligand2d.atoms.map((a) => a.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const molW = (maxX - minX) || 1, molH = (maxY - minY) || 1
  const scale = Math.min((width - 2 * pad) / molW, (height - 2 * pad) / molH)
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  const TP = (x, y) => ({ x: width / 2 + (x - cx) * scale, y: height / 2 - (y - cy) * scale })

  const byId = {}
  ligand2d.atoms.forEach((a) => { byId[a.i] = { ...a, ...TP(a.x, a.y) } })
  const rings = (ligand2d.rings || []).map((r) => {
    const pts = r.map((i) => byId[i]).filter(Boolean)
    const rx = pts.reduce((s, p) => s + p.x, 0) / pts.length
    const ry = pts.reduce((s, p) => s + p.y, 0) / pts.length
    const rad = pts.reduce((s, p) => s + Math.hypot(p.x - rx, p.y - ry), 0) / pts.length
    return { cx: rx, cy: ry, r: rad * 0.6 }
  })

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" className={className}
      xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
      {rings.map((r, i) => <circle key={'r' + i} cx={r.cx} cy={r.cy} r={r.r} fill="none" stroke="#94a3b8" strokeWidth="1.3" />)}
      {(ligand2d.bonds || []).map((b, i) => <Bond key={i} b={b} byId={byId} scale={scale} />)}
      {Object.values(byId).filter((a) => a.label).map((a) => (
        <text key={'l' + a.i} x={a.x} y={a.y + 3.5} textAnchor="middle" fontSize={Math.max(9, scale * 0.42)}
          fontWeight="700" fontFamily="Inter, Arial, sans-serif" fill={EL_COLOR[a.el] || '#334155'}
          style={{ paintOrder: 'stroke', stroke: '#ffffff', strokeWidth: 3, strokeLinejoin: 'round' }}>{a.label}</text>
      ))}
    </svg>
  )
}

function Bond({ b, byId, scale }) {
  const A = byId[b.a], B = byId[b.b]
  if (!A || !B) return null
  const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1
  const ux = dx / L, uy = dy / L
  const cut = Math.min(10, scale * 0.32)
  let p1 = { x: A.x, y: A.y }, p2 = { x: B.x, y: B.y }
  if (A.label) p1 = { x: p1.x + ux * cut, y: p1.y + uy * cut }
  if (B.label) p2 = { x: p2.x - ux * cut, y: p2.y - uy * cut }
  const sw = Math.max(1.4, scale * 0.075)
  if (b.order === 2 && !b.arom) {
    const nx = -uy, ny = ux, o = Math.max(2, scale * 0.11), sh = 0.16
    const a1 = { x: p1.x + (p2.x - p1.x) * sh, y: p1.y + (p2.y - p1.y) * sh }
    const a2 = { x: p2.x - (p2.x - p1.x) * sh, y: p2.y - (p2.y - p1.y) * sh }
    return (
      <g stroke="#1e293b" strokeWidth={sw} strokeLinecap="round">
        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} />
        <line x1={a1.x + nx * o} y1={a1.y + ny * o} x2={a2.x + nx * o} y2={a2.y + ny * o} />
      </g>
    )
  }
  return <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#1e293b" strokeWidth={sw} strokeLinecap="round" />
}
