import { useRef, useState } from 'react'
import { saveFile } from '../../download.js'

// Multi-disease intersection Venn: shows each disease's target set and the COMMON
// (intersection) targets that proceed into the pipeline. Exports transparent/white/
// dark PNG or SVG. Handles 2–3 diseases as a proper Venn; 4+ as a compact summary.
const COLORS = ['#38bdf8', '#a78bfa', '#fbbf24', '#f472b6', '#5eead4', '#f87171']
const TEXT = ['#083b53', '#1e1747', '#412402', '#4b1528', '#053a30', '#4a1010']

export default function DiseaseVenn({ per = [], common = 0 }) {
  const svgRef = useRef(null)
  const [menu, setMenu] = useState(false)
  const n = per.length
  const clip = (s, m) => (s && s.length > m ? s.slice(0, m - 1) + '…' : s || '')
  const fname = 'DDS_disease_intersection'

  let body
  if (n === 2) {
    const a = per[0].total - common, b = per[1].total - common
    body = (
      <>
        <defs><clipPath id="dv2"><circle cx="300" cy="150" r="108" /></clipPath></defs>
        <circle cx="180" cy="150" r="108" fill={COLORS[0]} fillOpacity="0.88" />
        <circle cx="300" cy="150" r="108" fill={COLORS[1]} fillOpacity="0.85" />
        <g clipPath="url(#dv2)"><circle cx="180" cy="150" r="108" fill="#2dd4bf" fillOpacity="0.95" /></g>
        <circle cx="180" cy="150" r="108" fill="none" stroke="#0f608a" strokeWidth="2" />
        <circle cx="300" cy="150" r="108" fill="none" stroke="#5b45b0" strokeWidth="2" />
        <text x="120" y="156" textAnchor="middle" fontSize="26" fontWeight="700" fill={TEXT[0]}>{a}</text>
        <text x="240" y="150" textAnchor="middle" fontSize="27" fontWeight="700" fill="#053a30">{common}</text>
        <text x="240" y="167" textAnchor="middle" fontSize="10" fill="#053a30">common</text>
        <text x="360" y="156" textAnchor="middle" fontSize="26" fontWeight="700" fill={TEXT[1]}>{b}</text>
        <text x="150" y="298" textAnchor="middle" fontSize="15" fontWeight="700" fill={COLORS[0]}>{clip(per[0].label, 18)}</text>
        <text x="150" y="315" textAnchor="middle" fontSize="11" fill="#94a3b8">{per[0].total} genes</text>
        <text x="330" y="298" textAnchor="middle" fontSize="15" fontWeight="700" fill={COLORS[1]}>{clip(per[1].label, 18)}</text>
        <text x="330" y="315" textAnchor="middle" fontSize="11" fill="#94a3b8">{per[1].total} genes</text>
      </>
    )
  } else if (n === 3) {
    const C = [[240, 120], [162, 214], [318, 214]]
    body = (
      <>
        {C.map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="92" fill={COLORS[i]} fillOpacity="0.5" stroke={COLORS[i]} strokeWidth="2" />)}
        <text x="240" y="180" textAnchor="middle" fontSize="24" fontWeight="700" fill="#e6edf6">{common}</text>
        <text x="240" y="196" textAnchor="middle" fontSize="10" fill="#cbd5e1">common to all</text>
        {C.map(([cx, cy], i) => {
          const lx = cx, ly = i === 0 ? 40 : cy + 118
          return <g key={i}>
            <text x={lx} y={ly} textAnchor="middle" fontSize="13" fontWeight="700" fill={COLORS[i]}>{clip(per[i].label, 16)}</text>
            <text x={lx} y={ly + 15} textAnchor="middle" fontSize="10.5" fill="#94a3b8">{per[i].total} genes</text>
          </g>
        })}
      </>
    )
  } else {
    body = (
      <>
        <text x="240" y="120" textAnchor="middle" fontSize="30" fontWeight="700" fill="#2dd4bf">{common}</text>
        <text x="240" y="146" textAnchor="middle" fontSize="12" fill="#cbd5e1">common to all {n} diseases</text>
        {per.map((p, i) => (
          <text key={i} x="240" y={182 + i * 20} textAnchor="middle" fontSize="12" fill={COLORS[i % COLORS.length]}>{clip(p.label, 30)} · {p.total}</text>
        ))}
      </>
    )
  }

  return (
    <div className="relative">
      <div className="absolute right-2 top-2 z-10 flex gap-1.5">
        <div className="relative">
          <button onClick={() => setMenu((v) => !v)} className="inline-flex items-center gap-1 rounded-lg bg-ink-850/90 px-2.5 py-1 text-[11px] text-slate-300 ring-1 ring-ink-600 transition hover:bg-ink-800 hover:text-white">
            <DlIcon /> PNG <CaretIcon />
          </button>
          {menu && (
            <div className="absolute right-0 mt-1 flex flex-col overflow-hidden rounded-lg bg-ink-850 py-1 text-[11px] ring-1 ring-ink-600">
              {[['Transparent', 'transparent'], ['White', 'white'], ['Dark', 'dark']].map(([label, bg]) => (
                <button key={bg} onClick={() => { downloadPNG(svgRef.current, fname, bg); setMenu(false) }} className="whitespace-nowrap px-3 py-1.5 text-left text-slate-300 hover:bg-ink-700 hover:text-white">{label}</button>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => downloadSVG(svgRef.current, fname)} className="rounded-lg bg-ink-850/90 px-2.5 py-1 text-[11px] text-slate-300 ring-1 ring-ink-600 transition hover:bg-ink-800 hover:text-white">SVG</button>
      </div>
      <svg ref={svgRef} viewBox="0 0 480 330" width="100%" style={{ maxHeight: 330 }} xmlns="http://www.w3.org/2000/svg" fontFamily="Inter, system-ui, sans-serif">{body}</svg>
    </div>
  )
}

function serialize(svgEl) {
  const clone = svgEl.cloneNode(true)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const vb = svgEl.viewBox.baseVal
  if (vb && vb.width) { clone.setAttribute('width', vb.width); clone.setAttribute('height', vb.height) }
  return new XMLSerializer().serializeToString(clone)
}
function downloadSVG(svgEl, name) { if (svgEl) saveFile(`${name}.svg`, new Blob([serialize(svgEl)], { type: 'image/svg+xml;charset=utf-8' })) }
function downloadPNG(svgEl, name, bg = 'transparent', scale = 3) {
  if (!svgEl) return
  const vb = svgEl.viewBox.baseVal, w = vb.width || 480, h = vb.height || 330
  const svg64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(serialize(svgEl))))
  const img = new Image()
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale
    const ctx = c.getContext('2d')
    if (bg === 'white') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height) }
    else if (bg === 'dark') { ctx.fillStyle = '#0b1424'; ctx.fillRect(0, 0, c.width, c.height) }
    ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.drawImage(img, 0, 0)
    c.toBlob((b) => b && saveFile(`${name}.png`, b), 'image/png')
  }
  img.src = svg64
}
function DlIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3M8 11l4 4 4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg> }
function CaretIcon() { return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg> }
