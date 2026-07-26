import { useEffect, useRef, useState } from 'react'
import cytoscape from 'cytoscape'
import { saveFile } from '../../download.js'

// Interactive PPI network (Cytoscape.js), cytoHubba-style: nodes are laid out in
// concentric rings by degree (most-connected in the centre) and coloured on a degree
// gradient (peripheral → hub) in the DDS theme (teal → violet). Node size also scales
// with degree. No per-target highlighting — covalent selection happens upstream.
const LOW = [45, 212, 191]   // #2dd4bf teal (peripheral)

function ramp(t, high) {
  const h = [parseInt(high.slice(1, 3), 16), parseInt(high.slice(3, 5), 16), parseInt(high.slice(5, 7), 16)]
  const c = LOW.map((lo, i) => Math.round(lo + (h[i] - lo) * Math.max(0, Math.min(1, t))))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export default function NetworkGraph({ nodes = [], edges = [], accent = '#a78bfa' }) {
  const hostRef = useRef(null)
  const cyRef = useRef(null)
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    if (!hostRef.current) return
    const maxDeg = Math.max(1, ...nodes.map((n) => n.data?.degree || 0))
    // colour each node by its degree (peripheral teal → hub violet)
    const colored = nodes.map((n) => ({ data: { ...n.data, col: ramp((n.data?.degree || 0) / maxDeg, accent) } }))
    const cy = cytoscape({
      container: hostRef.current,
      elements: [...colored, ...edges],
      wheelSensitivity: 0.25,
      style: [
        { selector: 'node', style: {
          'background-color': 'data(col)', label: 'data(label)', color: '#0a1a2b',
          'font-size': 9, 'font-weight': 600, 'font-family': 'Inter, sans-serif',
          'text-valign': 'center', 'text-halign': 'center',
          'text-wrap': 'wrap', 'text-max-width': `mapData(degree, 0, ${maxDeg}, 30, 58)`,
          width: `mapData(degree, 0, ${maxDeg}, 26, 66)`,
          height: `mapData(degree, 0, ${maxDeg}, 26, 66)`,
          'border-width': 0, 'min-zoomed-font-size': 4,
        } },
        { selector: 'edge', style: {
          width: `mapData(score, 0.4, 1, 0.5, 2.4)`, 'line-color': '#33455f',
          'curve-style': 'haystack', opacity: 0.4,
        } },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#ffffff' } },
      ],
      layout: {
        name: 'concentric', padding: 34, minNodeSpacing: 16, avoidOverlap: true, equidistant: false,
        concentric: (n) => n.data('degree') || 0, levelWidth: () => Math.max(1, Math.round(maxDeg / 6)),
      },
    })
    cyRef.current = cy
    cy.ready(() => cy.fit(undefined, 34))
    return () => cy.destroy()
  }, [nodes, edges, accent])

  const layoutOpts = (maxDeg) => ({ name: 'concentric', padding: 34, minNodeSpacing: 16, avoidOverlap: true, equidistant: false, animate: true, concentric: (n) => n.data('degree') || 0, levelWidth: () => Math.max(1, Math.round(maxDeg / 6)) })
  function fit() { cyRef.current && cyRef.current.fit(undefined, 34) }
  function relayout() {
    if (!cyRef.current) return
    const maxDeg = Math.max(1, ...nodes.map((n) => n.data?.degree || 0))
    cyRef.current.layout(layoutOpts(maxDeg)).run()
  }
  function png(bg) {
    if (!cyRef.current) return
    const uri = cyRef.current.png({ full: true, scale: 2.5, bg: bg === 'white' ? '#ffffff' : bg === 'dark' ? '#0b1424' : undefined })
    saveFile('DDS_ppi_network.png', uri, 'image/png')
  }

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full rounded-xl bg-[#0b1424] ring-1 ring-ink-700/50" />
      <div className="absolute right-3 top-3 flex gap-1.5">
        {[['Fit', fit], ['Layout', relayout]].map(([label, fn]) => (
          <button key={label} onClick={fn}
            className="rounded-lg bg-ink-850/90 px-2.5 py-1 text-[11px] text-slate-300 ring-1 ring-ink-600 transition hover:bg-ink-800 hover:text-white">
            {label}
          </button>
        ))}
        <div className="relative">
          <button onClick={() => setMenu((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg bg-ink-850/90 px-2.5 py-1 text-[11px] text-slate-300 ring-1 ring-ink-600 transition hover:bg-ink-800 hover:text-white">
            PNG <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {menu && (
            <div className="absolute right-0 mt-1 flex flex-col overflow-hidden rounded-lg bg-ink-850 py-1 text-[11px] ring-1 ring-ink-600">
              {[['Transparent', 'transparent'], ['White', 'white'], ['Dark', 'dark']].map(([label, bg]) => (
                <button key={bg} onClick={() => { png(bg); setMenu(false) }}
                  className="whitespace-nowrap px-3 py-1.5 text-left text-slate-300 hover:bg-ink-700 hover:text-white">{label}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* colour-scale legend */}
      <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-3 rounded-lg bg-ink-950/75 px-3 py-2 text-[10.5px] text-slate-400">
        <span className="inline-flex items-center gap-2">
          <span className="text-slate-500">peripheral</span>
          <span className="h-2.5 w-24 rounded-full" style={{ background: `linear-gradient(90deg, #2dd4bf, ${accent})` }} />
          <span className="text-slate-500">hub</span>
        </span>
        <span className="text-slate-500">colour &amp; size ∝ degree (connections)</span>
      </div>
    </div>
  )
}
