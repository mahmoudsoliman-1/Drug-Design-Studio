import { useRef } from 'react'
import { saveFile } from '../download.js'

/* ------------------------------------------------------------------ */
/*  Elegant 2D protein–ligand interaction diagram.                     */
/*  Draws the real ligand 2D structure (from RDKit `ligand2d`) and     */
/*  places each interacting residue as a glossy glowing sphere in the  */
/*  direction of the atom it contacts, so connectors radiate outward.  */
/*  Exports high-res PNG + vector SVG.                                 */
/* ------------------------------------------------------------------ */

const TYPES = {
  'H-bond':      { key: 'hbond', line: '#10b981', legend: 'Hydrogen bond',        dist: true,  stops: ['#d1fae5', '#6ee7b7', '#34d399'], edge: '#059669', glow: '#34d399', dash: '5 4' },
  'Salt bridge': { key: 'salt',  line: '#f59e0b', legend: 'Salt bridge / charge', dist: true,  stops: ['#ffedd5', '#fdba74', '#fb923c'], edge: '#ea580c', glow: '#fb923c', dash: '6 4' },
  'π-stacking':  { key: 'pi',    line: '#d946ef', legend: 'π–π stacking',          dist: true,  stops: ['#fae8ff', '#f0abfc', '#e879f9'], edge: '#c026d3', glow: '#e879f9', dash: '9 4' },
  'Hydrophobic': { key: 'hydro', line: '#f472b6', legend: 'Hydrophobic contact',  dist: false, stops: ['#fce7f3', '#f9a8d4', '#f472b6'], edge: '#db2777', glow: '#f472b6', dash: '1 5' },
}
const PRIO = { 'Salt bridge': 0, 'H-bond': 1, 'π-stacking': 2, 'Hydrophobic': 3 }
const EL_COLOR = { O: '#dc2626', N: '#2563eb', S: '#d97706', P: '#ea580c', F: '#16a34a', Cl: '#16a34a', Br: '#a16207', I: '#7c3aed' }

const W = 760
const H = 710
const C = { x: 380, y: 322 }
const RING_R = 233
const DISC_R = 22
const MAX_HYDRO = 5
const MAX_TOTAL = 10

export default function InteractionMap2D({ ligand = 'Ligand', pose = 1, affinity, interactions = [], ligand2d = null }) {
  const svgRef = useRef(null)
  const hasStruct = ligand2d && ligand2d.atoms && ligand2d.atoms.length

  // --- ligand structure transform ---
  let atomById = {}, rings = []
  if (hasStruct) {
    const xs = ligand2d.atoms.map((a) => a.x), ys = ligand2d.atoms.map((a) => a.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const molW = (maxX - minX) || 1, molH = (maxY - minY) || 1
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
    const scale = Math.min(250 / molW, 165 / molH, 34)
    const TP = (x, y) => ({ x: C.x + (x - cx) * scale, y: C.y - (y - cy) * scale })
    ligand2d.atoms.forEach((a) => { atomById[a.i] = { ...a, ...TP(a.x, a.y) } })
    rings = (ligand2d.rings || []).map((r) => {
      const pts = r.map((i) => atomById[i]).filter(Boolean)
      const rx = pts.reduce((s, p) => s + p.x, 0) / pts.length
      const ry = pts.reduce((s, p) => s + p.y, 0) / pts.length
      const rad = pts.reduce((s, p) => s + Math.hypot(p.x - rx, p.y - ry), 0) / pts.length
      return { cx: rx, cy: ry, r: rad * 0.6 }
    })
  }

  // --- dedupe residues (collapse dimer copies), keep strongest; cap hydrophobic ---
  const byRes = {}
  for (const it of interactions) {
    const type = TYPES[it.type] ? it.type : 'Hydrophobic'
    const cur = byRes[it.residue]
    if (!cur || PRIO[type] < PRIO[cur.type] || (PRIO[type] === PRIO[cur.type] && it.distance < cur.distance)) {
      byRes[it.residue] = { ...it, type }
    }
  }
  const dedup = Object.values(byRes)
  const nonHydro = dedup.filter((r) => r.type !== 'Hydrophobic')
  const hydro = dedup.filter((r) => r.type === 'Hydrophobic').sort((a, b) => a.distance - b.distance)
  let residues = [...nonHydro, ...hydro.slice(0, Math.max(0, Math.min(MAX_HYDRO, MAX_TOTAL - nonHydro.length)))]

  // anchor each residue to its ligand atom (or centre)
  residues = residues.map((r) => {
    const anchor = (hasStruct && atomById[r.lig_atom]) ? { x: atomById[r.lig_atom].x, y: atomById[r.lig_atom].y } : { x: C.x, y: C.y }
    return { ...r, t: TYPES[r.type], anchor, pref: Math.atan2(anchor.y - C.y, anchor.x - C.x) }
  })

  // --- place on ring: even spacing (no overlaps), rotated to best match anchor directions ---
  residues.sort((a, b) => a.pref - b.pref)
  const n = residues.length || 1
  let sumSin = 0, sumCos = 0
  residues.forEach((r, i) => { const d = r.pref - (i * 2 * Math.PI) / n; sumSin += Math.sin(d); sumCos += Math.cos(d) })
  const offset = Math.atan2(sumSin, sumCos)
  residues.forEach((r, i) => {
    r.angle = (i * 2 * Math.PI) / n + offset
    r.disc = { x: C.x + RING_R * Math.cos(r.angle), y: C.y + RING_R * Math.sin(r.angle) }
  })

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-3 pr-14">
        <div>
          <h3 className="text-[14px] font-semibold text-white">2D Interaction Map</h3>
          <p className="text-[11px] text-slate-500">{ligand}{pose ? ` · Pose ${pose}` : ''}{affinity != null ? ` · ${affinity} kcal/mol` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => downloadPNG(svgRef.current, `${ligand}_interactions`, 3)}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-accent to-accent-dim px-3 py-1.5 text-[12px] font-semibold text-ink-950 hover:brightness-110">
            <DownloadIcon /> PNG (high-res)
          </button>
          <button onClick={() => downloadSVG(svgRef.current, `${ligand}_interactions`)}
            className="rounded-lg bg-ink-700 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-ink-600">SVG</button>
        </div>
      </div>

      <div className="p-4">
        <div className="overflow-hidden rounded-xl" style={{ background: '#ffffff' }}>
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" xmlns="http://www.w3.org/2000/svg"
            style={{ display: 'block', fontFamily: 'Inter, Arial, sans-serif' }}>
            <defs>
              <pattern id="grid" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#eef2f7" /></pattern>
              <filter id="ddsGlow" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="5" /></filter>
              <radialGradient id="ligHalo" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#eff6ff" stopOpacity="0.9" /><stop offset="70%" stopColor="#eff6ff" stopOpacity="0.3" /><stop offset="100%" stopColor="#eff6ff" stopOpacity="0" /></radialGradient>
              {Object.values(TYPES).map((t) => (
                <radialGradient key={t.key} id={`sph-${t.key}`} cx="35%" cy="28%" r="80%">
                  <stop offset="0%" stopColor={t.stops[0]} />
                  <stop offset="55%" stopColor={t.stops[1]} />
                  <stop offset="100%" stopColor={t.stops[2]} />
                </radialGradient>
              ))}
            </defs>

            <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
            <rect x="0" y="0" width={W} height={H} fill="url(#grid)" />

            <text x={W / 2} y="34" textAnchor="middle" fontSize="16" fontWeight="700" fill="#0f172a">2D Ligand–Protein Interaction Diagram</text>
            <text x={W / 2} y="52" textAnchor="middle" fontSize="11.5" fill="#64748b">{ligand}{affinity != null ? ` · ΔG = ${affinity} kcal/mol` : ''}</text>

            <ellipse cx={C.x} cy={C.y} rx="150" ry="112" fill="url(#ligHalo)" />

            {/* connectors + distance pills */}
            {residues.map((r, i) => {
              const d = dir(r.disc, r.anchor)
              const from = { x: r.disc.x + d.x * DISC_R, y: r.disc.y + d.y * DISC_R }
              const to = { x: r.anchor.x - d.x * 6, y: r.anchor.y - d.y * 6 }
              const pill = { x: from.x + (to.x - from.x) * 0.4, y: from.y + (to.y - from.y) * 0.4 }
              return (
                <g key={`c${i}`}>
                  <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={r.t.line} strokeWidth="1.6" strokeDasharray={r.t.dash} strokeLinecap="round" opacity="0.85" />
                  <circle cx={r.anchor.x} cy={r.anchor.y} r="3.6" fill={r.t.line} fillOpacity="0.3" stroke={r.t.line} strokeWidth="1.2" />
                  {r.t.dist && (
                    <g>
                      <rect x={pill.x - 18} y={pill.y - 8} width="36" height="16" rx="8" fill="#ffffff" stroke={r.t.line} strokeWidth="0.75" />
                      <text x={pill.x} y={pill.y + 3} textAnchor="middle" fontSize="9" fontWeight="600" fill={r.t.line}>{r.distance} Å</text>
                    </g>
                  )}
                </g>
              )
            })}

            {/* ligand structure */}
            {hasStruct ? <Molecule atomById={atomById} bonds={ligand2d.bonds} rings={rings} />
              : <g><circle cx={C.x} cy={C.y} r="34" fill="#ffffff" stroke="#0f766e" strokeWidth="2" strokeDasharray="4 3" /><text x={C.x} y={C.y + 4} textAnchor="middle" fontSize="11" fill="#0f766e">ligand</text></g>}

            {/* residue spheres */}
            {residues.map((r, i) => (
              <g key={`s${i}`}>
                <circle cx={r.disc.x} cy={r.disc.y} r={DISC_R + 5} fill={r.t.glow} opacity="0.28" filter="url(#ddsGlow)" />
                <circle cx={r.disc.x} cy={r.disc.y} r={DISC_R} fill={`url(#sph-${r.t.key})`} />
                <ellipse cx={r.disc.x - 6} cy={r.disc.y - 7.5} rx="7" ry="4.2" fill="#ffffff" opacity="0.5" />
                <text x={r.disc.x} y={r.disc.y + 4} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#0f172a">{r.residue}</text>
              </g>
            ))}

            {/* ligand name is shown in the header/subtitle above — no central pill,
                so it never overlaps the interaction connectors */}
            <Legend x={30} y={H - 84} />
          </svg>
        </div>
      </div>
    </div>
  )
}

function Molecule({ atomById, bonds, rings }) {
  const atoms = Object.values(atomById)
  return (
    <g>
      {rings.map((r, i) => <circle key={'r' + i} cx={r.cx} cy={r.cy} r={r.r} fill="none" stroke="#94a3b8" strokeWidth="1.4" />)}
      {(bonds || []).map((b, i) => <Bond key={i} b={b} atomById={atomById} />)}
      {atoms.filter((a) => a.label).map((a) => (
        <text key={'l' + a.i} x={a.x} y={a.y + 4} textAnchor="middle" fontSize="12" fontWeight="700"
          fill={EL_COLOR[a.el] || '#334155'}
          style={{ paintOrder: 'stroke', stroke: '#ffffff', strokeWidth: 3.5, strokeLinejoin: 'round' }}>{a.label}</text>
      ))}
    </g>
  )
}

function Bond({ b, atomById }) {
  const A = atomById[b.a], B = atomById[b.b]
  if (!A || !B) return null
  let p1 = { x: A.x, y: A.y }, p2 = { x: B.x, y: B.y }
  const d = dir(p1, p2)
  if (A.label) p1 = { x: p1.x + d.x * 10, y: p1.y + d.y * 10 }
  if (B.label) p2 = { x: p2.x - d.x * 10, y: p2.y - d.y * 10 }
  if (b.order === 2 && !b.arom) {
    const n = { x: -d.y, y: d.x }, o = 2.6, sh = 0.16
    const a1 = { x: p1.x + (p2.x - p1.x) * sh, y: p1.y + (p2.y - p1.y) * sh }
    const a2 = { x: p2.x - (p2.x - p1.x) * sh, y: p2.y - (p2.y - p1.y) * sh }
    return (
      <g stroke="#1e293b" strokeWidth="1.8" strokeLinecap="round">
        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} />
        <line x1={a1.x + n.x * o} y1={a1.y + n.y * o} x2={a2.x + n.x * o} y2={a2.y + n.y * o} />
      </g>
    )
  }
  return <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#1e293b" strokeWidth="1.8" strokeLinecap="round" />
}

function Legend({ x, y }) {
  return (
    <g>
      <text x={x} y={y - 16} fontSize="10.5" fontWeight="700" fill="#334155" letterSpacing="0.5">INTERACTION TYPES</text>
      {Object.values(TYPES).map((t, i) => {
        const yy = y + i * 22
        return (
          <g key={t.key}>
            <circle cx={x + 8} cy={yy} r="7" fill={`url(#sph-${t.key})`} />
            <line x1={x + 24} y1={yy} x2={x + 50} y2={yy} stroke={t.line} strokeWidth="2" strokeDasharray={t.dash} strokeLinecap="round" />
            <text x={x + 62} y={yy + 4} fontSize="11" fill="#475569">{t.legend}</text>
          </g>
        )
      })}
    </g>
  )
}

function dir(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y
  const L = Math.hypot(dx, dy) || 1
  return { x: dx / L, y: dy / L }
}

function DownloadIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3M8 11l4 4 4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>
}

/* ---------------------------- export -------------------------------- */
function serialize(svgEl) {
  const clone = svgEl.cloneNode(true)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const vb = svgEl.viewBox.baseVal
  if (vb && vb.width) { clone.setAttribute('width', vb.width); clone.setAttribute('height', vb.height) }
  return new XMLSerializer().serializeToString(clone)
}
function saveBlob(blob, filename) {
  return saveFile(filename, blob)
}
function downloadSVG(svgEl, name) {
  if (!svgEl) return
  saveBlob(new Blob([serialize(svgEl)], { type: 'image/svg+xml;charset=utf-8' }), `${name}.svg`)
}
function downloadPNG(svgEl, name, scale = 3) {
  if (!svgEl) return
  const vb = svgEl.viewBox.baseVal
  const w = vb.width || svgEl.clientWidth
  const h = vb.height || svgEl.clientHeight
  const svg64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(serialize(svgEl))))
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = w * scale; canvas.height = h * scale
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.drawImage(img, 0, 0)
    canvas.toBlob((b) => b && saveBlob(b, `${name}.png`), 'image/png')
  }
  img.src = svg64
}
