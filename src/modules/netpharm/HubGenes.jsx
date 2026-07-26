import { useEffect, useRef, useState } from 'react'
import cytoscape from 'cytoscape'
import { saveFile } from '../../download.js'

// cytoHubba-style hub-gene plot: the top-ranked hub genes are packed into concentric
// rings — the most central hub sits in the middle — and coloured on a single-hue
// darkness scale (darker = higher centrality). Edges are the PPI interactions among
// these hubs only. Kept in the DDS theme (deep violet → light lilac).
const HI = [124, 92, 214]    // #7c5cd6 medium violet (highest centrality)
const LO = [227, 221, 255]   // #e3ddff light lilac   (lowest centrality)

function ramp(t) {
  const c = HI.map((hi, i) => Math.round(LO[i] + (hi - LO[i]) * Math.max(0, Math.min(1, t))))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export default function HubGenes({ hubs, edges = [], topn = 20 }) {
  const hostRef = useRef(null)
  const cyRef = useRef(null)
  const [menu, setMenu] = useState(false)

  const ranking = (hubs?.ranking || []).slice(0, topn)

  useEffect(() => {
    if (!hostRef.current || !ranking.length) return
    const scores = ranking.map((r) => r.score)
    const min = Math.min(...scores), max = Math.max(...scores)
    const span = max - min || 1
    const keep = new Set(ranking.map((r) => r.gene))
    // node value 0..1 by score → colour, size and concentric ring
    const nodes = ranking.map((r) => {
      const t = (r.score - min) / span
      return { data: { id: r.gene, label: r.gene, val: t, col: ramp(t), score: r.score, degree: r.degree } }
    })
    const subEdges = edges
      .filter((e) => keep.has(e.data?.source) && keep.has(e.data?.target))
      .map((e) => ({ data: { ...e.data } }))
    const cy = cytoscape({
      container: hostRef.current,
      elements: [...nodes, ...subEdges],
      wheelSensitivity: 0.25,
      style: [
        { selector: 'node', style: {
          'background-color': 'data(col)', label: 'data(label)', color: '#000000',
          'font-size': 11, 'font-weight': 700, 'font-family': 'Inter, sans-serif',
          'text-valign': 'center', 'text-halign': 'center',
          width: `mapData(val, 0, 1, 40, 78)`, height: `mapData(val, 0, 1, 40, 78)`,
          'border-width': 1.5, 'border-color': 'rgba(255,255,255,0.35)', 'min-zoomed-font-size': 5,
        } },
        { selector: 'edge', style: {
          width: 0.7, 'line-color': '#43506a', 'curve-style': 'haystack', opacity: 0.45,
        } },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#ffffff' } },
      ],
      layout: {
        name: 'concentric', padding: 30, minNodeSpacing: 14, avoidOverlap: true, equidistant: true,
        concentric: (n) => n.data('val'), levelWidth: () => 1 / Math.max(4, Math.round(topn / 3)),
      },
    })
    cyRef.current = cy
    cy.ready(() => cy.fit(undefined, 30))
    return () => cy.destroy()
  }, [hubs, edges, topn])

  function fit() { cyRef.current && cyRef.current.fit(undefined, 30) }
  function png(bg) {
    if (!cyRef.current) return
    const uri = cyRef.current.png({ full: true, scale: 2.5, bg: bg === 'white' ? '#ffffff' : bg === 'dark' ? '#0b1424' : undefined })
    saveFile('DDS_hub_genes.png', uri, 'image/png')
  }

  if (!ranking.length) {
    return (
      <div className="flex h-full items-center justify-center text-center text-slate-500">
        <div><div className="text-[15px] font-semibold text-slate-400">No hub genes</div>
          <div className="mt-1 text-[12px]">The PPI network had too few connected nodes.</div></div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="text-[14px] font-semibold text-white">Top {ranking.length} hub genes
          <span className="ml-1 text-[12px] font-normal text-slate-500">· {hubs.method} centrality</span></div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="h-full w-full rounded-xl bg-[#0b1424] ring-1 ring-ink-700/50" />
        <div className="absolute right-3 top-3 flex gap-1.5">
          <button onClick={fit}
            className="rounded-lg bg-ink-850/90 px-2.5 py-1 text-[11px] text-slate-300 ring-1 ring-ink-600 transition hover:bg-ink-800 hover:text-white">Fit</button>
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
        {/* colour-scale legend with a plain-language note */}
        <div className="absolute bottom-3 left-3 max-w-[300px] rounded-lg bg-ink-950/80 px-3 py-2 text-[10.5px] text-slate-400">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">low</span>
            <span className="h-2.5 w-28 rounded-full" style={{ background: 'linear-gradient(90deg, #e3ddff, #7c5cd6)' }} />
            <span className="text-slate-500">high</span>
          </div>
          <div className="mt-1.5 leading-snug">
            <span className="text-slate-300">Darker &amp; larger</span> = higher centrality (a more central hub);
            <span className="text-slate-300"> lighter &amp; smaller</span> = lower. Central position = top rank.
          </div>
        </div>
      </div>
    </div>
  )
}
