import { useEffect, useRef, useState } from 'react'
import { saveFile } from '../../download.js'

// Lightweight multi-body 3D viewer for the nano module. Each supplied PDB block is
// rendered as sticks with its own carbon colour, so the guest drug stands out
// against the carrier (or the co-formulated drugs stand apart from one another).
// An optional translucent VDW surface on the carrier makes cavity inclusion
// obvious, and (host↔guest) H-bond / hydrophobic contacts can be drawn as dashed
// lines — computed in-browser from the real 3D coordinates, exactly as the docking
// viewer does. Reuses the same 3Dmol.js the docking module uses; no new dependency.
const SCHEMES = ['orangeCarbon', 'cyanCarbon', 'magentaCarbon', 'yellowCarbon']

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) }

function dashedLine(viewer, a, b, color) {
  viewer.addCylinder({ start: { x: a.x, y: a.y, z: a.z }, end: { x: b.x, y: b.y, z: b.z },
    radius: 0.04, fromCap: 1, toCap: 1, color, dashed: true })
}

// Draw host(model 0)↔guest(model 1) contacts. Returns {hb, hydro}.
function drawContacts(viewer, host, guest, scale = 1) {
  const hPolar = host.selectedAtoms({ elem: ['N', 'O'] })
  const gPolar = guest.selectedAtoms({ elem: ['N', 'O'] })
  const hC = host.selectedAtoms({ elem: 'C' })
  const gC = guest.selectedAtoms({ elem: 'C' })
  // H-bonds: nearest polar host atom per guest polar atom, 2.4–3.6 Å
  const cand = []
  for (const a of gPolar) for (const b of hPolar) { const d = dist(a, b); if (d >= 2.4 && d <= 3.6) cand.push({ a, b, d }) }
  cand.sort((x, y) => x.d - y.d)
  const seen = new Set(); const hb = []
  for (const p of cand) { if (seen.has(p.b.serial)) continue; seen.add(p.b.serial); hb.push(p) }
  // hydrophobic: closest C–C per host atom, ≤4.0 Å (cap at 8)
  const per = {}
  for (const a of gC) for (const b of hC) { const d = dist(a, b); if (d <= 4.0 && (!per[b.serial] || d < per[b.serial].d)) per[b.serial] = { a, b, d } }
  const hydro = Object.values(per).sort((x, y) => x.d - y.d).slice(0, 8)
  hb.forEach((p) => {
    dashedLine(viewer, p.a, p.b, '#34d399')
    const mid = { x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2, z: (p.a.z + p.b.z) / 2 }
    viewer.addLabel(`${p.d.toFixed(1)} Å`, { position: mid, fontSize: 11 * scale, fontColor: '#5eead4', backgroundColor: '#0b1220', backgroundOpacity: 0.6, borderThickness: 0 })
  })
  hydro.forEach((p) => dashedLine(viewer, p.a, p.b, '#fbbf24'))
  return { hb: hb.length, hydro: hydro.length }
}

export default function NanoViewer({ models = [], spin = true, surface = false, showInteractions = false, coulomb = null, exportName = 'complex' }) {
  const hostRef = useRef(null)
  const viewerRef = useRef(null)
  const modelRefs = useRef([])
  const [ready, setReady] = useState(false)
  const [menu, setMenu] = useState(false)

  // create the viewer once
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const $3Dmol = await import('3dmol')
      if (cancelled || !hostRef.current) return
      viewerRef.current = $3Dmol.createViewer(hostRef.current, { backgroundColor: 'rgb(7,11,20)', antialias: true })
      setReady(true)
    })()
    return () => { cancelled = true; try { viewerRef.current && viewerRef.current.clear() } catch { /* ignore */ } }
  }, [])

  // (re)draw whenever the models / options change
  useEffect(() => {
    const viewer = viewerRef.current
    if (!ready || !viewer) return
    let cancelled = false
    ;(async () => {
      const $3Dmol = await import('3dmol')
      if (cancelled) return
      viewer.removeAllSurfaces(); viewer.removeAllShapes(); viewer.removeAllLabels(); viewer.removeAllModels()
      modelRefs.current = []
      models.filter((m) => m && m.pdb).forEach((m, i) => {
        const model = viewer.addModel(m.pdb, 'pdb')
        modelRefs.current.push(model)
        if (m.potential && coulomb) {
          // Coulombic potential surface: colour a molecular surface by the per-atom
          // classical potential (red −ve / electron-rich → blue +ve). Thin sticks stay
          // visible underneath so host↔guest complementarity reads clearly.
          const atoms = model.selectedAtoms({})
          atoms.forEach((a, idx) => { a.partialCharge = coulomb.potential[idx] ?? 0 })
          model.setStyle({}, {})   // surface only — coloured host/guest sticks come from the other models
          const r = coulomb.range || 0.2
          try {
            viewer.addSurface($3Dmol.SurfaceType.SES, {
              opacity: 0.85,
              colorscheme: { prop: 'partialCharge', gradient: 'rwb', min: -r, max: r },
            }, { model })
          } catch {
            try { viewer.addSurface($3Dmol.SurfaceType.VDW, { opacity: 0.85,
              colorscheme: { prop: 'partialCharge', gradient: 'rwb', min: -r, max: r } }, { model }) } catch { /* skip */ }
          }
        } else {
          model.setStyle({}, { stick: { radius: m.thin ? 0.11 : 0.16, colorscheme: m.element ? 'Jmol' : (m.scheme || SCHEMES[i % SCHEMES.length]) } })
        }
      })
      const [host, guest] = modelRefs.current
      if (surface && host && !coulomb) {
        try { viewer.addSurface($3Dmol.SurfaceType.VDW, { opacity: 0.55, color: '#3b5170' }, { model: host }) } catch { /* skip */ }
      }
      if (showInteractions && host && guest && !coulomb) { try { drawContacts(viewer, host, guest, 1) } catch { /* skip */ } }
      viewer.zoomTo(); viewer.render(); viewer.spin(spin ? 'y' : false)
    })()
    return () => { cancelled = true }
  }, [ready, models, spin, surface, showInteractions, coulomb])

  function exportPNG(bg) {
    const viewer = viewerRef.current, host = hostRef.current
    setMenu(false)
    if (!viewer || !host) return
    const SCALE = 3
    const ow = host.style.width, oh = host.style.height
    const w = host.clientWidth, h = host.clientHeight
    let uri = null
    try {
      host.style.width = `${w * SCALE}px`; host.style.height = `${h * SCALE}px`
      viewer.resize()
      if (bg === 'transparent') viewer.setBackgroundColor(0xffffff, 0)
      else if (bg === 'white') viewer.setBackgroundColor(0xffffff, 1)
      else viewer.setBackgroundColor(0x070b14, 1)
      viewer.render(); uri = viewer.pngURI()
    } catch { uri = null }
    host.style.width = ow; host.style.height = oh
    viewer.resize(); viewer.setBackgroundColor(0x070b14, 1); viewer.render()
    if (uri) saveFile(`DDS_nano_${exportName}_${bg}.png`, uri, 'image/png')
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl">
      <div ref={hostRef} className="h-full w-full" style={{ position: 'relative' }} />
      <div className="absolute right-2 top-2">
        <button onClick={() => setMenu((v) => !v)}
          className="rounded-lg bg-ink-900/80 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 ring-1 ring-ink-600 backdrop-blur transition hover:text-white">
          Export PNG ▾
        </button>
        {menu && (
          <div className="absolute right-0 mt-1 w-40 overflow-hidden rounded-lg bg-ink-900 py-1 text-[12px] shadow-xl ring-1 ring-ink-600">
            {[['dark', 'Dark background'], ['white', 'White background'], ['transparent', 'Transparent']].map(([k, l]) => (
              <button key={k} onClick={() => exportPNG(k)} className="block w-full px-3 py-1.5 text-left text-slate-300 hover:bg-ink-800 hover:text-white">{l}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
