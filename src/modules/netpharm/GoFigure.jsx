import { useMemo, useRef, useState } from 'react'
import { saveFile } from '../../download.js'

// Publication-style GO enrichment figure: one dot/lollipop panel per selected GO
// category (BP / MF / CC). Terms ranked by Enrichr combined score; dot size ∝ number
// of genes, dot colour ∝ −log10(FDR) on a blue→green scale. Exports transparent /
// white PNG or vector SVG.

const GO_LABELS = { GO_BP: 'Biological process (BP)', GO_MF: 'Molecular function (MF)', GO_CC: 'Cellular component (CC)' }
const GO_KEYS = ['GO_BP', 'GO_CC', 'GO_MF']
// −log10(FDR) colour ramp: blue (low) → teal → green (high)
const STOPS = [[59, 91, 219], [45, 190, 180], [34, 197, 94]]
function fdrColor(t) {
  t = Math.max(0, Math.min(1, t))
  const seg = t * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(seg))
  const f = seg - i, a = STOPS[i], b = STOPS[i + 1]
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`
}
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '')

// geometry
const VB_W = 990
const LEFT = 18, LX = 356, AX0 = 368, AX1 = 690, LEG = 720   // x anchors
const ROW = 30, HEAD = 46, AXIS = 58                          // per-panel vertical parts
const TOPPAD = 12

export default function GoFigure({ enrichment, libs }) {
  const svgRef = useRef(null)
  const [menu, setMenu] = useState(false)
  const results = enrichment?.results || {}

  const fig = useMemo(() => {
    const keys = GO_KEYS.filter((k) => libs?.[k] && (results[k] || []).length)
    if (!keys.length) return null
    const panels = []
    let y = TOPPAD
    keys.forEach((k) => {
      const terms = [...(results[k] || [])]
        .filter((t) => (t.count || 0) > 0)
        .sort((a, b) => (b.combined || 0) - (a.combined || 0))
        .slice(0, 12)
      if (!terms.length) return
      const maxComb = Math.max(...terms.map((t) => t.combined || 0), 1)
      const counts = terms.map((t) => t.count || 0)
      const cMin = Math.min(...counts), cMax = Math.max(...counts)
      const fdrs = terms.map((t) => -Math.log10(Math.max(t.adj_pvalue || 1, 1e-300)))
      const fMin = Math.min(...fdrs), fMax = Math.max(...fdrs)
      const h = HEAD + terms.length * ROW + AXIS
      panels.push({ key: k, label: GO_LABELS[k], terms, maxComb, cMin, cMax, fMin, fMax, fdrs, y, h })
      y += h
    })
    return panels.length ? { panels, height: y + 6 } : null
  }, [results, libs])

  if (!fig) {
    return (
      <div className="grid h-full place-items-center rounded-xl bg-ink-950/40 text-center text-slate-500">
        <div><div className="text-[14px] font-medium text-slate-300">No GO terms</div>
          <div className="mt-1 text-[12px]">Select a GO library (BP / MF / CC) and re-run the analysis.</div></div>
      </div>
    )
  }

  const rad = (p, c) => 6 + (p.cMax > p.cMin ? (c - p.cMin) / (p.cMax - p.cMin) : 0.5) * 10
  const xB = (p, v) => AX0 + (v / p.maxComb) * (AX1 - AX0)

  return (
    <div className="relative flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] text-slate-400">GO enrichment · dot plot</div>
        <div className="relative">
          <button onClick={() => setMenu((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg bg-ink-850/90 px-2.5 py-1 text-[11px] text-slate-300 ring-1 ring-ink-600 transition hover:bg-ink-800 hover:text-white">
            <DownloadIcon /> Export <CaretIcon />
          </button>
          {menu && (
            <div className="absolute right-0 z-10 mt-1 flex flex-col overflow-hidden rounded-lg bg-ink-850 py-1 text-[11px] ring-1 ring-ink-600">
              <button onClick={() => { downloadPNG(svgRef.current, 'DDS_GO_enrichment', 'transparent'); setMenu(false) }}
                className="whitespace-nowrap px-3 py-1.5 text-left text-slate-300 hover:bg-ink-700 hover:text-white">PNG · transparent</button>
              <button onClick={() => { downloadPNG(svgRef.current, 'DDS_GO_enrichment', 'white'); setMenu(false) }}
                className="whitespace-nowrap px-3 py-1.5 text-left text-slate-300 hover:bg-ink-700 hover:text-white">PNG · white</button>
              <button onClick={() => { downloadSVG(svgRef.current, 'DDS_GO_enrichment'); setMenu(false) }}
                className="whitespace-nowrap px-3 py-1.5 text-left text-slate-300 hover:bg-ink-700 hover:text-white">SVG (vector)</button>
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl bg-white p-2 ring-1 ring-ink-700/50">
        <svg ref={svgRef} viewBox={`0 0 ${VB_W} ${fig.height}`} width="100%" xmlns="http://www.w3.org/2000/svg"
          fontFamily="Inter, system-ui, sans-serif">
          {fig.panels.map((p) => {
            const rowY = (i) => p.y + HEAD + i * ROW + ROW / 2
            const baseY = p.y + HEAD + p.terms.length * ROW + 8
            const xticks = tickVals(p.maxComb, 4)
            return (
              <g key={p.key}>
                {/* category title */}
                <text x={(AX0 + AX1) / 2} y={p.y + 28} textAnchor="middle" fontSize="18" fontWeight="800" fill="#0f172a">{p.label}</text>
                {/* rows */}
                {p.terms.map((t, i) => {
                  const y = rowY(i), xd = xB(p, t.combined || 0)
                  const f = (p.fMax > p.fMin) ? (p.fdrs[i] - p.fMin) / (p.fMax - p.fMin) : 0.5
                  return (
                    <g key={i}>
                      <text x={LX} y={y + 4.5} textAnchor="end" fontSize="12.5" fill="#0f172a">{clip(t.term.replace(/\s*\(GO:.*\)/, ''), 46)}</text>
                      <line x1={AX0} y1={y} x2={xd} y2={y} stroke="#cbd5e1" strokeWidth="1.6" />
                      <circle cx={xd} cy={y} r={rad(p, t.count || 0)} fill={fdrColor(f)} stroke="#ffffff" strokeWidth="0.8" />
                    </g>
                  )
                })}
                {/* x axis */}
                <line x1={AX0} y1={baseY} x2={AX1} y2={baseY} stroke="#cbd5e1" strokeWidth="1.2" />
                {xticks.map((v, i) => (
                  <g key={i}>
                    <line x1={xB(p, v)} y1={baseY} x2={xB(p, v)} y2={baseY + 6} stroke="#94a3b8" strokeWidth="1" />
                    <text x={xB(p, v)} y={baseY + 22} textAnchor="middle" fontSize="12" fill="#475569">{v}</text>
                  </g>
                ))}
                <text x={(AX0 + AX1) / 2} y={baseY + 44} textAnchor="middle" fontSize="14" fontWeight="700" fill="#334155">Enrichr combined score</text>
                {/* legends */}
                <PanelLegends p={p} rad={rad} />
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

function PanelLegends({ p, rad }) {
  const sizes = uniqSizes(p.cMin, p.cMax)
  const gradId = `goGrad_${p.key}`
  const y0 = p.y + HEAD + 4
  return (
    <g>
      <text x={LEG} y={y0} fontSize="13" fontWeight="700" fill="#334155">N genes</text>
      {sizes.map((c, i) => {
        const cy = y0 + 30 + i * 40, cx = LEG + 18
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r={rad(p, c)} fill="none" stroke="#64748b" strokeWidth="1.4" />
            <text x={cx + 38} y={cy + 5} fontSize="12.5" fill="#475569">{c}</text>
          </g>
        )
      })}
      <defs>
        <linearGradient id={gradId} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={fdrColor(0)} /><stop offset="0.5" stopColor={fdrColor(0.5)} /><stop offset="1" stopColor={fdrColor(1)} />
        </linearGradient>
      </defs>
      <text x={LEG} y={y0 + 176} fontSize="13" fontWeight="700" fill="#334155">−log10(FDR)</text>
      <rect x={LEG + 8} y={y0 + 188} width="20" height="120" rx="3" fill={`url(#${gradId})`} stroke="#cbd5e1" strokeWidth="0.8" />
      <text x={LEG + 38} y={y0 + 199} fontSize="12.5" fill="#475569">{p.fMax.toFixed(1)}</text>
      <text x={LEG + 38} y={y0 + 312} fontSize="12.5" fill="#475569">{p.fMin.toFixed(1)}</text>
    </g>
  )
}

// ---- helpers ----
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
  return [...new Set([min, Math.round((min + max) / 2), max])]
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
  const w = vb.width || VB_W, h = vb.height || VB_W
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
