import { useEffect, useRef, useMemo, useState } from 'react'
import cytoscape from 'cytoscape'
import { saveFile } from '../../download.js'

// Compound–Target–Pathway (C–T–P) network — a tripartite publication figure built
// from data DDS already computes: the compound, its targets, and the enriched
// pathways, with target→pathway edges from each Enrichr term's member genes.
// Compound = violet triangle (centre), targets = teal circles (inner ring),
// pathways = sky hexagons (outer ring). Explicit two-ring layout with radial pathway
// labels so it stays readable. Capped to the top pathways + best-connected targets.
const LIB_KEYS = ['KEGG', 'GO_BP', 'GO_MF', 'GO_CC']
const MAX_PATHWAYS = 16
const MAX_TARGETS = 34

export default function CTPNetwork({ compoundLabel, compounds, geneCompounds, enrichment, libs, topPerLib = 12 }) {
  const hostRef = useRef(null)
  const cyRef = useRef(null)
  const [menu, setMenu] = useState(false)

  const elements = useMemo(() => {
    const results = enrichment?.results || {}
    const keys = LIB_KEYS.filter((k) => libs?.[k] && (results[k] || []).length)
    const up = (g) => String(g).toUpperCase()

    // collect + dedupe pathways, keep the most significant
    const byTerm = new Map()
    for (const k of keys) {
      for (const t of (results[k] || []).slice(0, topPerLib)) {
        if (!byTerm.has(t.term)) byTerm.set(t.term, { term: t.term, genes: (t.genes || []).map(up), p: t.pvalue ?? 1, combined: t.combined ?? 0 })
      }
    }
    let pathways = [...byTerm.values()].sort((a, b) => (a.p - b.p) || (b.combined - a.combined)).slice(0, MAX_PATHWAYS)

    // targets = genes in those pathways, kept by how many pathways they connect (declutter)
    const deg = {}
    pathways.forEach((p) => p.genes.forEach((g) => { deg[g] = (deg[g] || 0) + 1 }))
    const targets = Object.keys(deg).sort((a, b) => deg[b] - deg[a]).slice(0, MAX_TARGETS)
    const tset = new Set(targets)
    pathways = pathways.filter((p) => p.genes.some((g) => tset.has(g)))

    const nT = targets.length, nP = pathways.length
    if (!nP || !nT) return { nodes: [], edges: [], nT, nP }

    const multi = Array.isArray(compounds) && compounds.length > 1
    const R0 = multi ? Math.max(74, Math.round((compounds.length * 36) / (2 * Math.PI))) : 0
    const R1 = Math.max(Math.min(340, Math.max(200, Math.round((nT * 28) / (2 * Math.PI)))), R0 + 120)
    const R2 = R1 + 240

    const nodes = []
    const edges = []
    if (multi) {
      compounds.forEach((cn, i) => {
        const a = (2 * Math.PI * i) / compounds.length - Math.PI / 2
        nodes.push({ data: { id: 'C:' + cn, label: cn, kind: 'compound', multi: true },
          position: { x: R0 * Math.cos(a), y: R0 * Math.sin(a) } })
      })
    } else {
      nodes.push({ data: { id: 'CMPD', label: (compoundLabel || 'compound').toUpperCase(), kind: 'compound' }, position: { x: 0, y: 0 } })
    }
    targets.forEach((g, i) => {
      const a = (2 * Math.PI * i) / nT - Math.PI / 2
      nodes.push({ data: { id: 'G:' + g, label: g, kind: 'target', side: Math.cos(a) >= 0 ? 'r' : 'l' },
        position: { x: R1 * Math.cos(a), y: R1 * Math.sin(a) } })
    })
    pathways.forEach((p, i) => {
      const a = (2 * Math.PI * i) / nP - Math.PI / 2
      nodes.push({ data: { id: 'P:' + p.term, label: p.term, kind: 'pathway', side: Math.cos(a) >= 0 ? 'r' : 'l' },
        position: { x: R2 * Math.cos(a), y: R2 * Math.sin(a) } })
    })
    if (multi) {
      const cset = new Set(compounds)
      targets.forEach((g) => ((geneCompounds && geneCompounds[g]) || compounds).forEach((cn) => {
        if (cset.has(cn)) edges.push({ data: { id: 'C:' + cn + '-' + g, source: 'C:' + cn, target: 'G:' + g } })
      }))
    } else {
      targets.forEach((g) => edges.push({ data: { id: 'c-' + g, source: 'CMPD', target: 'G:' + g } }))
    }
    pathways.forEach((p) => p.genes.forEach((g) => {
      if (tset.has(g)) edges.push({ data: { id: p.term + '-' + g, source: 'G:' + g, target: 'P:' + p.term } })
    }))
    return { nodes, edges, nT, nP, nC: multi ? compounds.length : 1 }
  }, [enrichment, libs, compoundLabel, compounds, geneCompounds, topPerLib])

  useEffect(() => {
    if (!hostRef.current || !elements.nodes.length) return
    const cy = cytoscape({
      container: hostRef.current,
      elements: [...elements.nodes, ...elements.edges],
      wheelSensitivity: 0.25,
      style: [
        { selector: 'node[kind="target"]', style: {
          shape: 'ellipse', 'background-color': '#2dd4bf', width: 34, height: 34,
          label: 'data(label)', color: '#053a30', 'font-size': 11, 'font-weight': 600,
          'text-valign': 'center', 'text-halign': 'center', 'min-zoomed-font-size': 2,
        } },
        { selector: 'node[kind="pathway"]', style: {
          shape: 'hexagon', 'background-color': '#38bdf8', width: 38, height: 38,
          label: 'data(label)', color: '#5f88b0', 'font-size': 12, 'font-weight': 600,
          'text-wrap': 'wrap', 'text-max-width': '180px', 'text-valign': 'center', 'min-zoomed-font-size': 2,
        } },
        { selector: 'node[kind="pathway"][side="r"]', style: { 'text-halign': 'right', 'text-margin-x': 6 } },
        { selector: 'node[kind="pathway"][side="l"]', style: { 'text-halign': 'left', 'text-margin-x': -6 } },
        { selector: 'node[kind="compound"]', style: {
          shape: 'triangle', 'background-color': '#a78bfa', width: 74, height: 74,
          label: 'data(label)', color: '#7159c4', 'font-size': 14, 'font-weight': 700,
          'text-valign': 'center', 'text-halign': 'center', 'text-max-width': '90px', 'text-wrap': 'wrap',
        } },
        { selector: 'node[kind="compound"][?multi]', style: { width: 54, height: 54, 'font-size': 10.5 } },
        { selector: 'edge', style: { width: 0.6, 'line-color': '#3a4d6b', 'curve-style': 'haystack', opacity: 0.3 } },
        { selector: 'node:selected', style: { 'border-width': 2, 'border-color': '#ffffff' } },
      ],
      layout: { name: 'preset', fit: true, padding: 120 },
    })
    cyRef.current = cy
    return () => cy.destroy()
  }, [elements])

  function fit() { cyRef.current && cyRef.current.fit(undefined, 120) }
  function relayout() { cyRef.current && cyRef.current.layout({ name: 'preset', fit: true, padding: 120 }).run() }
  function png(bg) {
    if (!cyRef.current) return
    const uri = cyRef.current.png({ full: true, scale: 2.5, bg: bg === 'white' ? '#ffffff' : bg === 'dark' ? '#0b1424' : undefined })
    saveFile('DDS_compound_target_pathway.png', uri, 'image/png')
  }

  if (!elements.nP) {
    return <div className="grid h-full w-full place-items-center rounded-xl bg-ink-950/40 text-center text-[12px] text-slate-500">
      No enriched pathways yet — run the analysis with a gene-set library selected.
    </div>
  }

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full rounded-xl bg-[#0b1424] ring-1 ring-ink-700/50" />
      <div className="absolute right-3 top-3 flex gap-1.5">
        {[['Fit', fit], ['Layout', relayout]].map(([label, fn]) => (
          <button key={label} onClick={fn} className="rounded-lg bg-ink-850/90 px-2.5 py-1 text-[11px] text-slate-300 ring-1 ring-ink-600 transition hover:bg-ink-800 hover:text-white">{label}</button>
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
      <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-3 rounded-lg bg-ink-950/70 px-2.5 py-1.5 text-[10.5px] text-slate-400">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0 w-0" style={{ borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: '9px solid #a78bfa' }} />Compound{elements.nC > 1 ? ` (${elements.nC})` : ''}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#2dd4bf]" />Target ({elements.nT})</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-[#38bdf8]" style={{ clipPath: 'polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)' }} />Top pathway ({elements.nP})</span>
        <span className="text-slate-600">targets ranked by pathway connections</span>
      </div>
    </div>
  )
}
