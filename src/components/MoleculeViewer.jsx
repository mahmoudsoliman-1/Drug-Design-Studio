import { useEffect, useRef, useState } from 'react'
import { saveFile } from '../download.js'

// Renders a protein (or docked complex) with 3Dmol.js. If `pdb` (raw PDB text)
// is supplied it is rendered directly; otherwise the demo 1HSG complex is fetched.
// With `showInteractions`, protein–ligand contacts are computed from the REAL 3D
// coordinates and drawn as dashed lines (H-bonds green, hydrophobic amber), with
// interacting residues shown as sticks + labels. The ligand is `ligResn`.
export default function MoleculeViewer({
  style = 'cartoon', showLigand = true, spin = false, showInteractions = false,
  pdb = null, ligResn = 'MK1', empty = false, box = null, showBox = false,
  covalentTarget = null, overlayLigand = null,
}) {
  const boxKey = box ? `${box.center.x}|${box.center.y}|${box.center.z}|${box.size.x}|${box.size.y}|${box.size.z}` : ''
  const covKey = covalentTarget ? JSON.stringify(covalentTarget) : ''
  const hostRef = useRef(null)
  const viewerRef = useRef(null)
  const modelRef = useRef(null)
  const overlayModelRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState('loading')
  const [counts, setCounts] = useState({ hb: 0, hydro: 0 })
  const [menu, setMenu] = useState(false)

  function exportPNG(bg) {
    const viewer = viewerRef.current
    const host = hostRef.current
    setMenu(false)
    if (!viewer || !host) return
    const SCALE = 3
    const ow = host.style.width, oh = host.style.height
    const w = host.clientWidth, h = host.clientHeight
    let uri = null
    try {
      host.style.width = `${w * SCALE}px`
      host.style.height = `${h * SCALE}px`
      viewer.resize()
      viewer.removeAllShapes(); viewer.removeAllLabels()
      applyStyle(viewer, style, showLigand, ligResn)
      if (showInteractions && modelRef.current) drawInteractions(viewer, modelRef.current, SCALE, ligResn)
      if (covalentTarget) drawCovalentTarget(viewer, covalentTarget, SCALE)
      if (bg === 'transparent') viewer.setBackgroundColor(0xffffff, 0)
      else if (bg === 'white') viewer.setBackgroundColor(0xffffff, 1)
      else viewer.setBackgroundColor(0x000000, 1)
      viewer.render()
      uri = viewer.pngURI()
    } catch (e) { uri = null }
    host.style.width = ow
    host.style.height = oh
    viewer.resize()
    viewer.removeAllShapes(); viewer.removeAllLabels()
    applyStyle(viewer, style, showLigand, ligResn)
    if (showInteractions && modelRef.current) drawInteractions(viewer, modelRef.current, 1, ligResn)
    if (covalentTarget) drawCovalentTarget(viewer, covalentTarget, 1)
    viewer.setBackgroundColor(0x070b14, 1)
    viewer.render()
    if (!uri) return
    saveFile(`DDS_complex_${bg}.png`, uri, 'image/png')
  }

  // create the viewer once
  useEffect(() => {
    let cancelled = false
    async function init() {
      const $3Dmol = await import('3dmol')
      if (cancelled || !hostRef.current) return
      viewerRef.current = $3Dmol.createViewer(hostRef.current, { backgroundColor: 'rgb(7,11,20)', antialias: true })
      setReady(true)
    }
    init()
    return () => { cancelled = true; try { viewerRef.current && viewerRef.current.clear() } catch {} }
  }, [])

  // (re)load the model whenever the source changes
  useEffect(() => {
    const viewer = viewerRef.current
    if (!ready || !viewer) return
    let cancelled = false
    async function load() {
      if (empty) {
        viewer.removeAllModels(); viewer.removeAllShapes(); viewer.removeAllLabels(); viewer.removeAllSurfaces()
        modelRef.current = null; overlayModelRef.current = null
        viewer.render()
        setStatus('empty')
        return
      }
      setStatus('loading')
      try {
        let text = pdb
        if (!text) {
          const res = await fetch('https://files.rcsb.org/download/1HSG.pdb')
          if (!res.ok) throw new Error('fetch failed')
          text = await res.text()
        }
        if (cancelled) return
        viewer.removeAllModels(); viewer.removeAllShapes(); viewer.removeAllLabels(); viewer.removeAllSurfaces()
        overlayModelRef.current = null
        modelRef.current = viewer.addModel(text, 'pdb')
        applyStyle(viewer, style, showLigand, ligResn)
        if (showInteractions) setCounts(drawInteractions(viewer, modelRef.current, 1, ligResn))
        if (covalentTarget) drawCovalentTarget(viewer, covalentTarget, 1)
        viewer.zoomTo()          // fit & centre the whole structure
        viewer.zoom(0.85)
        viewer.center()
        viewer.render()
        if (spin) viewer.spin('y', 0.4)
        setStatus('ready')
      } catch (e) {
        if (!cancelled) setStatus(pdb ? 'error' : 'offline')
      }
    }
    load()
    return () => { cancelled = true }
  }, [ready, pdb, empty])

  // style / interactions
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || status !== 'ready') return
    viewer.removeAllShapes(); viewer.removeAllLabels()
    applyStyle(viewer, style, showLigand, ligResn)
    if (showInteractions && modelRef.current) setCounts(drawInteractions(viewer, modelRef.current, 1, ligResn))
    else setCounts({ hb: 0, hydro: 0 })
    if (covalentTarget) drawCovalentTarget(viewer, covalentTarget, 1)
    if (overlayModelRef.current) styleOverlay(overlayModelRef.current)
    if (showBox && box) drawBox(viewer, box)
    viewer.render()
  }, [style, showLigand, showInteractions, status, ligResn, showBox, boxKey, covKey])

  // overlay ligand (a separately-loaded compound placed at the box centre before
  // docking) — its own model, re-placed whenever the ligand or box centre changes
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || status !== 'ready') return
    if (overlayModelRef.current) { try { viewer.removeModel(overlayModelRef.current) } catch {} overlayModelRef.current = null }
    if (overlayLigand) {
      try {
        const m = viewer.addModel(overlayLigand, 'pdb')
        styleOverlay(m)
        overlayModelRef.current = m
      } catch {}
    }
    viewer.render()
  }, [overlayLigand, status])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || status !== 'ready') return
    viewer.spin(spin ? 'y' : false, 0.4)
  }, [spin, status])

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl">
      <div ref={hostRef} className="absolute inset-0" />

      {status === 'ready' && (
        <div className="absolute right-2 top-2 z-10">
          <button onClick={() => setMenu((m) => !m)}
            className="flex items-center gap-1.5 rounded-lg bg-ink-800/85 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 ring-1 ring-ink-600/70 backdrop-blur-sm hover:bg-ink-700 hover:text-white">
            <PngIcon /> PNG
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {menu && (
            <div className="absolute right-0 mt-1 w-40 overflow-hidden rounded-lg bg-ink-850 py-1 shadow-xl ring-1 ring-ink-600/70">
              <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500">Background</div>
              {[
                { id: 'transparent', label: 'Transparent', sw: 'checker' },
                { id: 'white', label: 'White', sw: '#ffffff' },
                { id: 'black', label: 'Black', sw: '#000000' },
              ].map((o) => (
                <button key={o.id} onClick={() => exportPNG(o.id)}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] text-slate-200 hover:bg-ink-700">
                  <span className="h-3.5 w-3.5 shrink-0 rounded ring-1 ring-ink-500"
                    style={o.sw === 'checker'
                      ? { backgroundImage: 'linear-gradient(45deg,#64748b 25%,transparent 25%,transparent 75%,#64748b 75%),linear-gradient(45deg,#64748b 25%,#334155 25%,#334155 75%,#64748b 75%)', backgroundSize: '6px 6px', backgroundPosition: '0 0,3px 3px' }
                      : { background: o.sw }} />
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {showBox && box && status === 'ready' && (
        <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-lg bg-ink-950/70 px-3 py-1.5 backdrop-blur-sm">
          <span className="text-[11px] font-semibold text-accent">Search box</span>
          <span className="ml-2 font-mono text-[11px] text-slate-300">{box.size.x}×{box.size.y}×{box.size.z} Å</span>
          <span className="ml-2 font-mono text-[10px] text-slate-500">@ ({box.center.x}, {box.center.y}, {box.center.z})</span>
        </div>
      )}

      {showInteractions && status === 'ready' && (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded-lg bg-ink-950/70 px-3 py-2 backdrop-blur-sm">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Interactions</div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-300">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: 'repeating-linear-gradient(90deg,#34d399 0 3px,transparent 3px 6px)' }} />
            H-bond <span className="ml-1 font-mono text-emerald-400">{counts.hb}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-300">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: 'repeating-linear-gradient(90deg,#fbbf24 0 3px,transparent 3px 6px)' }} />
            Hydrophobic <span className="ml-1 font-mono text-amber-400">{counts.hydro}</span>
          </div>
        </div>
      )}

      {overlayLigand && !showInteractions && status === 'ready' && (
        <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 rounded-lg bg-ink-950/70 px-3 py-1.5 text-[11px] text-slate-300 backdrop-blur-sm">
          <span className="h-2 w-2 rounded-full" style={{ background: '#e879f9' }} />
          Ligand placed at box centre · pre-docking preview
        </div>
      )}

      {covalentTarget && status === 'ready' && (
        <div className="pointer-events-none absolute bottom-2 right-2 rounded-lg bg-ink-950/70 px-3 py-2 backdrop-blur-sm">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-accent">Covalent</div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-300">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#2dd4bf' }} />
            {covalentTarget.residueLabel} {covalentTarget.atomLabel} <span className="text-slate-500">nucleophile</span>
          </div>
          {covalentTarget.warhead && (
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-300">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#f59e0b' }} />
              warhead{covalentTarget.distance != null ? ` · ${covalentTarget.distance} Å` : ''}
            </div>
          )}
        </div>
      )}

      {status === 'loading' && (
        <div className="absolute inset-0 grid place-items-center text-slate-400">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
            <span className="text-xs tracking-wide">Rendering structure…</span>
          </div>
        </div>
      )}
      {(status === 'offline' || status === 'error' || status === 'empty') && (
        <div className="absolute inset-0 grid place-items-center px-6 text-center text-slate-400">
          <div>
            <div className="text-sm font-medium text-slate-300">No structure loaded</div>
            <div className="mt-1 text-xs text-slate-500">Fetch a PDB ID or upload a receptor in the Receptor step.</div>
          </div>
        </div>
      )}
    </div>
  )
}

function applyStyle(viewer, style, showLigand, ligResn) {
  viewer.removeAllSurfaces() // surfaces persist independently of setStyle — clear before restyling
  viewer.setStyle({}, {})
  const protein = { hetflag: false }
  if (style === 'cartoon') viewer.setStyle(protein, { cartoon: { colorscheme: 'spectrum', thickness: 0.4 } })
  else if (style === 'surface') viewer.setStyle(protein, { cartoon: { color: '#1c2842' } })
  else if (style === 'stick') viewer.setStyle(protein, { stick: { radius: 0.12, colorscheme: 'cyanCarbon' } })

  if (showLigand) {
    viewer.setStyle({ resn: ligResn }, {
      stick: { radius: 0.22, colorscheme: 'magentaCarbon' },
      sphere: { scale: 0.28, colorscheme: 'magentaCarbon' },
    })
  }

  // native (co-crystal) ligand in a validation overlay — same ball-and-stick style
  // as the docked ligand, only a different colour (green vs magenta)
  viewer.setStyle({ resn: 'NAT' }, {
    stick: { radius: 0.22, colorscheme: 'greenCarbon' },
    sphere: { scale: 0.28, colorscheme: 'greenCarbon' },
  })

  // retained crystallographic waters — small red spheres (otherwise invisible under cartoon)
  viewer.setStyle({ resn: ['HOH', 'WAT', 'DOD', 'H2O'] }, { sphere: { radius: 0.32, color: '#f87171' } })
  // retained ions — larger element-coloured spheres
  viewer.setStyle(
    { resn: ['NA', 'CL', 'K', 'MG', 'CA', 'ZN', 'MN', 'FE', 'CU', 'CO', 'NI', 'CD', 'BR', 'IOD'] },
    { sphere: { scale: 0.42, colorscheme: 'Jmol' } },
  )

  if (style === 'surface') {
    try { viewer.addSurface('VDW', { opacity: 0.72, color: '#2dd4bf' }, protein) } catch {}
  }
}

/* -------- real distance-based interaction detection -------- */
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) }

function drawInteractions(viewer, model, fontScale = 1, ligResn = 'MK1') {
  const ligPolar = model.selectedAtoms({ resn: ligResn, elem: ['N', 'O'] })
  const protPolar = model.selectedAtoms({ hetflag: false, elem: ['N', 'O'] })
  const ligC = model.selectedAtoms({ resn: ligResn, elem: 'C' })
  const protC = model.selectedAtoms({ hetflag: false, elem: 'C' })

  const cand = []
  for (const a of ligPolar) for (const b of protPolar) {
    const d = dist(a, b)
    if (d >= 2.4 && d <= 3.6) cand.push({ a, b, d })
  }
  cand.sort((x, y) => x.d - y.d)
  const seenProt = new Set()
  const hb = []
  for (const p of cand) { if (seenProt.has(p.b.serial)) continue; seenProt.add(p.b.serial); hb.push(p) }
  const hbRes = new Set(hb.map((p) => p.b.chain + p.b.resi))

  const perRes = {}
  for (const a of ligC) for (const b of protC) {
    const d = dist(a, b)
    if (d <= 4.0) {
      const k = b.chain + b.resi
      if (!perRes[k] || d < perRes[k].d) perRes[k] = { a, b, d }
    }
  }
  const hydro = Object.values(perRes).filter((p) => !hbRes.has(p.b.chain + p.b.resi)).sort((x, y) => x.d - y.d).slice(0, 6)

  const resSet = {}
  ;[...hb.map((p) => ({ p, t: 'hb' })), ...hydro.map((p) => ({ p, t: 'hy' }))].forEach(({ p, t }) => {
    const k = p.b.chain + p.b.resi
    if (!resSet[k]) resSet[k] = { chain: p.b.chain, resi: p.b.resi, resn: p.b.resn, pos: { x: p.b.x, y: p.b.y, z: p.b.z }, t }
  })
  Object.values(resSet).forEach((r) => {
    viewer.setStyle({ chain: r.chain, resi: r.resi, hetflag: false }, { stick: { radius: 0.12, colorscheme: 'whiteCarbon' } })
    textLabel(viewer, `${r.resn}${r.resi}`, r.pos, r.t === 'hb' ? '#5eead4' : '#fbbf24', 13 * fontScale)
  })

  hb.forEach((p) => {
    dashedLine(viewer, p.a, p.b, '#34d399')
    const mid = { x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2, z: (p.a.z + p.b.z) / 2 }
    textLabel(viewer, `${p.d.toFixed(1)} Å`, mid, '#5eead4', 11 * fontScale)
  })
  hydro.forEach((p) => dashedLine(viewer, p.a, p.b, '#fbbf24'))

  return { hb: hb.length, hydro: hydro.length }
}

// style for an overlay ligand model (a compound placed pre-docking)
function styleOverlay(m) {
  m.setStyle({}, {
    stick: { radius: 0.2, colorscheme: 'magentaCarbon' },
    sphere: { scale: 0.26, colorscheme: 'magentaCarbon' },
  })
}

// Highlight the covalent target: the nucleophilic residue as sticks + a labelled
// sphere on its reactive atom. In results (a docked pose) it also draws the
// warhead atom and a dashed bond to the nucleophile with the distance.
const COV_TEAL = '#2dd4bf'
const COV_AMBER = '#f59e0b'
function drawCovalentTarget(viewer, cov, fontScale = 1) {
  if (!cov || !cov.nuc) return
  const n = { x: cov.nuc[0], y: cov.nuc[1], z: cov.nuc[2] }

  // side chain of the target residue, so the user sees the whole nucleophile
  if (cov.chain != null && cov.resi != null) {
    viewer.setStyle({ chain: cov.chain, resi: String(cov.resi), hetflag: false },
      { stick: { radius: 0.16, colorscheme: 'cyanCarbon' } })
  }
  viewer.addSphere({ center: n, radius: 0.36, color: COV_TEAL })
  textLabel(viewer, `${cov.residueLabel || 'Nu'} ${cov.atomLabel || ''}`.trim(), n, '#5eead4', 13 * fontScale)

  if (cov.warhead) {
    const w = { x: cov.warhead[0], y: cov.warhead[1], z: cov.warhead[2] }
    viewer.addSphere({ center: w, radius: 0.36, color: COV_AMBER })
    textLabel(viewer, 'warhead', w, '#fbbf24', 12 * fontScale)
    // solid cylinder for a formed (tethered) bond; dashed line for geometry proximity
    if (cov.bonded) viewer.addCylinder({ start: w, end: n, radius: 0.16, color: COV_TEAL, fromCap: 1, toCap: 1 })
    else dashedLine(viewer, w, n, COV_TEAL)
    if (cov.distance != null) {
      const mid = { x: (w.x + n.x) / 2, y: (w.y + n.y) / 2, z: (w.z + n.z) / 2 }
      textLabel(viewer, `${cov.distance} Å`, mid, '#99f6e4', 12 * fontScale)
    }
  }
}

// a clean text-only 3D label (no filled background block) — bright colour, thin
// dark outline for legibility against both the dark scene and light cartoon
function textLabel(viewer, text, position, color, fontSize) {
  viewer.addLabel(text, {
    position, fontSize: Math.round(fontSize), font: 'Arial', fontColor: color,
    backgroundOpacity: 0, borderThickness: 0, inFront: true,
    showBackground: false,
  })
}

// draw the docking search box as a translucent 3D box + wireframe edges + corner nodes
function drawBox(viewer, box) {
  const c = box.center, s = box.size
  const hx = s.x / 2, hy = s.y / 2, hz = s.z / 2
  const col = '#2dd4bf'
  try {
    viewer.addBox({ center: { x: c.x, y: c.y, z: c.z }, dimensions: { w: s.x, h: s.y, d: s.z }, color: col, opacity: 0.12 })
  } catch {}
  const cor = {}
  for (const [ix, i] of [['m', -1], ['p', 1]])
    for (const [jy, j] of [['m', -1], ['p', 1]])
      for (const [kz, k] of [['m', -1], ['p', 1]])
        cor[ix + jy + kz] = { x: c.x + i * hx, y: c.y + j * hy, z: c.z + k * hz }
  const edges = [
    ['mmm', 'pmm'], ['pmm', 'ppm'], ['ppm', 'mpm'], ['mpm', 'mmm'],
    ['mmp', 'pmp'], ['pmp', 'ppp'], ['ppp', 'mpp'], ['mpp', 'mmp'],
    ['mmm', 'mmp'], ['pmm', 'pmp'], ['ppm', 'ppp'], ['mpm', 'mpp'],
  ]
  edges.forEach(([a, b]) => viewer.addCylinder({ start: cor[a], end: cor[b], radius: 0.12, color: col, fromCap: 1, toCap: 1 }))
  Object.values(cor).forEach((p) => viewer.addSphere({ center: p, radius: 0.32, color: col }))
}

function dashedLine(viewer, s, e, color) {
  const dx = e.x - s.x, dy = e.y - s.y, dz = e.z - s.z
  const len = Math.hypot(dx, dy, dz) || 1
  const ux = dx / len, uy = dy / len, uz = dz / len
  const seg = 0.3, step = 0.52
  for (let t = 0; t + seg <= len; t += step) {
    viewer.addCylinder({
      start: { x: s.x + ux * t, y: s.y + uy * t, z: s.z + uz * t },
      end: { x: s.x + ux * (t + seg), y: s.y + uy * (t + seg), z: s.z + uz * (t + seg) },
      radius: 0.05, color, fromCap: 1, toCap: 1,
    })
  }
}

function PngIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 15l5-5 4 4 3-3 6 6" /><circle cx="8.5" cy="8.5" r="1.5" /></svg>
}
