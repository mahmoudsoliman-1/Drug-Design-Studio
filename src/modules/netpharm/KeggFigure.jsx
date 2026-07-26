import { useMemo, useRef, useState } from 'react'
import { saveFile } from '../../download.js'

// Publication-style enrichment figure (two panels in one exportable SVG):
//   A — Sankey flow: target genes → enriched pathways (coloured flows show genes
//       shared across multiple pathways).
//   B — lollipop/bubble plot: pathways ranked by Enrichr combined score, dot size
//       ∝ number of genes, dot colour ∝ −log10(FDR).
// Designed as a light "paper" figure; exports to transparent / white PNG or SVG.

const GENE_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981',
  '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
  '#d946ef', '#ec4899', '#f43f5e', '#0891b2', '#65a30d', '#64748b',
]
// FDR colour ramp: blue (low) → violet → red (high)
const FDR_STOPS = [[37, 99, 235], [124, 58, 237], [219, 39, 119], [239, 68, 68]]
function fdrColor(t) {
  t = Math.max(0, Math.min(1, t))
  const seg = t * (FDR_STOPS.length - 1)
  const i = Math.min(FDR_STOPS.length - 2, Math.floor(seg))
  const f = seg - i, a = FDR_STOPS[i], b = FDR_STOPS[i + 1]
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`
}
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '')

// figure geometry
const VB_W = 1320, VB_H = 712
const TOP = 96, BOT = 648
const GX = 130, GW = 13               // gene column
const PX = 452, PW = 13               // pathway (sankey target) column
const LBL_X = PX + 24                  // pathway labels (shared centre)
const BX0 = 830, BX1 = 1168            // lollipop x-axis span
const LEG_X = 1196

export default function KeggFigure({ enrichment, libs }) {
  const svgRef = useRef(null)
  const [menu, setMenu] = useState(false)

  // pick the library to plot — prefer KEGG, else first selected lib with results
  const results = enrichment?.results || {}
  const libKey = useMemo(() => {
    const order = ['KEGG', 'GO_BP', 'GO_MF', 'GO_CC']
    return order.find((k) => libs?.[k] && (results[k] || []).length)
      || Object.keys(results).find((k) => (results[k] || []).length) || null
  }, [results, libs])

  const layout = useMemo(() => {
    if (!libKey) return null
    const terms = [...(results[libKey] || [])]
      .filter((t) => (t.genes || []).length)
      .sort((a, b) => (b.combined || 0) - (a.combined || 0))
      .slice(0, 15)
    if (terms.length < 2) return null

    // rows (shared by both panels)
    const P = terms.length
    const rowStep = (BOT - TOP) / P
    const rowY = (i) => TOP + rowStep * (i + 0.5)

    // gene frequency across the selected pathways
    const freq = {}
    terms.forEach((t, i) => (t.genes || []).forEach((g) => {
      (freq[g] || (freq[g] = { count: 0, rows: [] }))
      freq[g].count++; freq[g].rows.push(i)
    }))
    let genes = Object.keys(freq).filter((g) => freq[g].count >= 1)
    genes.sort((a, b) => freq[b].count - freq[a].count)
    genes = genes.slice(0, 16)
    const geneSet = new Set(genes)
    // order genes vertically by mean pathway-row (reduces crossings)
    genes.sort((a, b) => mean(freq[a].rows) - mean(freq[b].rows))
    const gi = Object.fromEntries(genes.map((g, i) => [g, i]))
    const color = Object.fromEntries(genes.map((g, i) => [g, GENE_COLORS[i % GENE_COLORS.length]]))

    // links gene→pathway
    const links = []
    terms.forEach((t, pi) => (t.genes || []).forEach((g) => {
      if (geneSet.has(g)) links.push({ g, pi })
    }))

    // gene node heights ∝ degree (proportional stack in the left column)
    const deg = {}; genes.forEach((g) => (deg[g] = 0))
    links.forEach((l) => deg[l.g]++)
    const totalDeg = Object.values(deg).reduce((s, d) => s + d, 0) || 1
    const gap = 6, colH = BOT - TOP - gap * (genes.length - 1)
    const gY = {}, gH = {}
    let y = TOP
    genes.forEach((g) => {
      const h = Math.max(9, (deg[g] / totalDeg) * colH)
      gY[g] = y; gH[g] = h; y += h + gap
    })
    // renormalise if overflow
    const overflow = y - gap - BOT
    if (overflow > 0) { let yy = TOP; genes.forEach((g) => { gH[g] -= overflow / genes.length; gY[g] = yy; yy += gH[g] + gap }) }

    // per-node cumulative slot counters for link endpoints
    const gSlot = {}, pSlot = {}, pIn = {}
    links.forEach((l) => { pIn[l.pi] = (pIn[l.pi] || 0) + 1 })
    // sort links stably: by gene index then pathway row for tidy fanning
    links.sort((a, b) => (gi[a.g] - gi[b.g]) || (a.pi - b.pi))
    const pTargetH = Math.min(rowStep * 0.6, 28)
    const paths = links.map((l) => {
      const sN = deg[l.g], tN = pIn[l.pi]
      const sk = (gSlot[l.g] = (gSlot[l.g] || 0)); gSlot[l.g]++
      const tk = (pSlot[l.pi] = (pSlot[l.pi] || 0)); pSlot[l.pi]++
      const sy = gY[l.g] + ((sk + 0.5) / sN) * gH[l.g]
      const ty = rowY(l.pi) - pTargetH / 2 + ((tk + 0.5) / tN) * pTargetH
      const x0 = GX + GW, x1 = PX, mx = (x0 + x1) / 2
      return { d: `M${x0},${sy} C${mx},${sy} ${mx},${ty} ${x1},${ty}`, c: color[l.g] }
    })

    // panel B scales
    const maxComb = Math.max(...terms.map((t) => t.combined || 0), 1)
    const counts = terms.map((t) => t.count || 0)
    const cMin = Math.min(...counts), cMax = Math.max(...counts)
    const fdrs = terms.map((t) => -Math.log10(Math.max(t.adj_pvalue || 1, 1e-300)))
    const fMin = Math.min(...fdrs), fMax = Math.max(...fdrs)
    const rad = (c) => 6.5 + (cMax > cMin ? (c - cMin) / (cMax - cMin) : 0.5) * 10
    const xB = (v) => BX0 + (v / maxComb) * (BX1 - BX0)

    return { terms, P, rowY, rowStep, genes, gY, gH, color, paths, gi,
      maxComb, cMin, cMax, fMin, fMax, rad, xB, fdrs, counts, pTargetH, deg }
  }, [libKey, results])

  if (!layout) {
    return (
      <div className="grid h-full place-items-center rounded-xl bg-ink-950/40 text-center text-slate-500">
        <div><div className="text-[14px] font-medium text-slate-300">No pathway data</div>
          <div className="mt-1 text-[12px]">Select KEGG (or a GO library) and re-run the analysis.</div></div>
      </div>
    )
  }

  const L = layout
  const libLabel = ({ KEGG: 'KEGG pathways', GO_BP: 'GO · Biological process', GO_MF: 'GO · Molecular function', GO_CC: 'GO · Cellular component' })[libKey] || libKey
  const xticks = tickVals(L.maxComb, 4)

  return (
    <div className="relative flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] text-slate-400">Enrichment figure · <span className="text-slate-300">{libLabel}</span></div>
        <div className="relative">
          <button onClick={() => setMenu((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg bg-ink-850/90 px-2.5 py-1 text-[11px] text-slate-300 ring-1 ring-ink-600 transition hover:bg-ink-800 hover:text-white">
            <DownloadIcon /> Export <CaretIcon />
          </button>
          {menu && (
            <div className="absolute right-0 z-10 mt-1 flex flex-col overflow-hidden rounded-lg bg-ink-850 py-1 text-[11px] ring-1 ring-ink-600">
              <button onClick={() => { downloadPNG(svgRef.current, 'DDS_enrichment_figure', 'transparent'); setMenu(false) }}
                className="whitespace-nowrap px-3 py-1.5 text-left text-slate-300 hover:bg-ink-700 hover:text-white">PNG · transparent</button>
              <button onClick={() => { downloadPNG(svgRef.current, 'DDS_enrichment_figure', 'white'); setMenu(false) }}
                className="whitespace-nowrap px-3 py-1.5 text-left text-slate-300 hover:bg-ink-700 hover:text-white">PNG · white</button>
              <button onClick={() => { downloadSVG(svgRef.current, 'DDS_enrichment_figure'); setMenu(false) }}
                className="whitespace-nowrap px-3 py-1.5 text-left text-slate-300 hover:bg-ink-700 hover:text-white">SVG (vector)</button>
            </div>
          )}
        </div>
      </div>

      {/* light "paper" preview so dark text reads in-app exactly as it will export */}
      <div className="min-h-0 flex-1 overflow-auto rounded-xl bg-white p-2 ring-1 ring-ink-700/50">
        <svg ref={svgRef} viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" xmlns="http://www.w3.org/2000/svg"
          fontFamily="Inter, system-ui, sans-serif">
          {/* panel letters + titles */}
          <text x="24" y="46" fontSize="30" fontWeight="800" fill="#0f172a">A</text>
          <text x="830" y="46" fontSize="30" fontWeight="800" fill="#0f172a">B</text>
          <text x="56" y="46" fontSize="18" fontWeight="700" fill="#334155">Target genes → pathway flow</text>
          <text x="866" y="46" fontSize="18" fontWeight="700" fill="#334155">Pathway enrichment</text>

          {/* A: sankey links */}
          <g fill="none" strokeOpacity="0.5">
            {L.paths.map((p, i) => <path key={i} d={p.d} stroke={p.c} strokeWidth="2" />)}
          </g>
          {/* A: gene nodes + labels */}
          {L.genes.map((g) => (
            <g key={g}>
              <rect x={GX} y={L.gY[g]} width={GW} height={L.gH[g]} rx="2.5" fill={L.color[g]} />
              <text x={GX - 8} y={L.gY[g] + L.gH[g] / 2 + 4.5} textAnchor="end" fontSize="13.5" fontWeight="700" fill="#1e293b">{g}</text>
            </g>
          ))}
          {/* A: pathway target nodes + shared centre labels */}
          {L.terms.map((t, i) => {
            const y = L.rowY(i)
            return (
              <g key={i}>
                <rect x={PX} y={y - L.pTargetH / 2} width={PW} height={L.pTargetH} rx="2.5" fill="#94a3b8" />
                <text x={LBL_X} y={y + 4.5} fontSize="13.5" fill="#0f172a">{clip(t.term.replace(/\s*\(GO:.*\)|\s*Homo sapiens.*$/i, ''), 42)}</text>
              </g>
            )
          })}

          {/* B: baseline + x ticks */}
          <line x1={BX0} y1={BOT + 6} x2={BX1} y2={BOT + 6} stroke="#cbd5e1" strokeWidth="1.2" />
          {xticks.map((v, i) => (
            <g key={i}>
              <line x1={L.xB(v)} y1={BOT + 6} x2={L.xB(v)} y2={BOT + 12} stroke="#94a3b8" strokeWidth="1" />
              <text x={L.xB(v)} y={BOT + 28} textAnchor="middle" fontSize="12.5" fill="#475569">{v}</text>
            </g>
          ))}
          <text x={(BX0 + BX1) / 2} y={BOT + 50} textAnchor="middle" fontSize="15" fontWeight="700" fill="#334155">Enrichr combined score</text>

          {/* B: lollipops */}
          {L.terms.map((t, i) => {
            const y = L.rowY(i), xd = L.xB(t.combined || 0)
            const f = (L.fMax > L.fMin) ? (L.fdrs[i] - L.fMin) / (L.fMax - L.fMin) : 0.5
            return (
              <g key={i}>
                <line x1={BX0} y1={y} x2={xd} y2={y} stroke="#cbd5e1" strokeWidth="1.6" />
                <circle cx={xd} cy={y} r={L.rad(t.count || 0)} fill={fdrColor(f)} stroke="#ffffff" strokeWidth="0.8" />
              </g>
            )
          })}

          {/* legends */}
          <Legends L={L} xLeg={LEG_X} />
        </svg>
      </div>
    </div>
  )
}

function Legends({ L, xLeg }) {
  const sizeVals = uniqSizes(L.cMin, L.cMax)
  const gradId = 'fdrGrad'
  return (
    <g>
      {/* size legend */}
      <text x={xLeg} y={TOP + 6} fontSize="14" fontWeight="700" fill="#334155">N genes</text>
      {sizeVals.map((c, i) => {
        const cy = TOP + 34 + i * 44, cx = xLeg + 18
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r={L.rad(c)} fill="none" stroke="#64748b" strokeWidth="1.4" />
            <text x={cx + 38} y={cy + 5} fontSize="13" fill="#475569">{c}</text>
          </g>
        )
      })}
      {/* colour legend */}
      <defs>
        <linearGradient id={gradId} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={fdrColor(0)} /><stop offset="0.5" stopColor={fdrColor(0.5)} /><stop offset="1" stopColor={fdrColor(1)} />
        </linearGradient>
      </defs>
      <text x={xLeg} y={TOP + 208} fontSize="14" fontWeight="700" fill="#334155">−log10(FDR)</text>
      <rect x={xLeg + 8} y={TOP + 222} width="20" height="140" rx="3" fill={`url(#${gradId})`} stroke="#cbd5e1" strokeWidth="0.8" />
      <text x={xLeg + 38} y={TOP + 233} fontSize="13" fill="#475569">{L.fMax.toFixed(1)}</text>
      <text x={xLeg + 38} y={TOP + 366} fontSize="13" fill="#475569">{L.fMin.toFixed(1)}</text>
    </g>
  )
}

// ---- helpers ----
function mean(a) { return a.reduce((s, x) => s + x, 0) / (a.length || 1) }
function tickVals(max, n) {
  const step = niceStep(max / n)
  const out = []
  for (let v = 0; v <= max + 1e-9; v += step) out.push(Math.round(v))
  return out
}
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)))
  const f = raw / p
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p
}
function uniqSizes(min, max) {
  if (max <= min) return [max || 1]
  const mid = Math.round((min + max) / 2)
  return [...new Set([min, mid, max])]
}
function serialize(svgEl) {
  const clone = svgEl.cloneNode(true)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const vb = svgEl.viewBox.baseVal
  if (vb && vb.width) { clone.setAttribute('width', vb.width); clone.setAttribute('height', vb.height) }
  return new XMLSerializer().serializeToString(clone)
}
function downloadSVG(svgEl, name) {
  if (!svgEl) return
  saveFile(`${name}.svg`, new Blob([serialize(svgEl)], { type: 'image/svg+xml;charset=utf-8' }))
}
function downloadPNG(svgEl, name, bg = 'transparent', scale = 3) {
  if (!svgEl) return
  const vb = svgEl.viewBox.baseVal
  const w = vb.width || VB_W, h = vb.height || VB_H
  const svg64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(serialize(svgEl))))
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = w * scale; canvas.height = h * scale
    const ctx = canvas.getContext('2d')
    if (bg === 'white') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height) }
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.drawImage(img, 0, 0)
    canvas.toBlob((b) => b && saveFile(`${name}.png`, b), 'image/png')
  }
  img.src = svg64
}
function DownloadIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3M8 11l4 4 4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>
}
function CaretIcon() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
}
