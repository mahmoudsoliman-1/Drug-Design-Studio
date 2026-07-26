import { useRef, useState } from 'react'
import { saveFile } from '../../download.js'

// Two-set Venn (compound ∩ disease) as a self-contained SVG — labels and counts sit
// on the coloured fills so it reads on any background. Auto-labelled from the compound
// and disease names. Exports to transparent / white / dark PNG or vector SVG.
export default function VennDiagram({ compoundLabel, diseaseLabel, compoundCount, diseaseCount, sharedCount }) {
  const svgRef = useRef(null)
  const [menu, setMenu] = useState(false)

  const shared = sharedCount || 0
  const cOnly = Math.max(0, (compoundCount || 0) - shared)
  const dOnly = Math.max(0, (diseaseCount || 0) - shared)
  const total = cOnly + shared + dOnly || 1
  const pct = (x) => `${Math.round((x / total) * 1000) / 10}%`
  const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '')

  const uid = 'vennB'
  const TEAL = '#2dd4bf', SKY = '#38bdf8', VIO = '#a78bfa'

  return (
    <div className="relative">
      <div className="absolute right-2 top-2 z-10 flex gap-1.5">
        <div className="relative">
          <button onClick={() => setMenu((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg bg-ink-850/90 px-2.5 py-1 text-[11px] text-slate-300 ring-1 ring-ink-600 transition hover:bg-ink-800 hover:text-white">
            <DownloadIcon /> PNG <CaretIcon />
          </button>
          {menu && (
            <div className="absolute right-0 mt-1 flex flex-col overflow-hidden rounded-lg bg-ink-850 py-1 text-[11px] ring-1 ring-ink-600">
              {[['Transparent', 'transparent'], ['White', 'white'], ['Dark', 'dark']].map(([label, bg]) => (
                <button key={bg} onClick={() => { downloadPNG(svgRef.current, filename(compoundLabel, diseaseLabel), bg); setMenu(false) }}
                  className="whitespace-nowrap px-3 py-1.5 text-left text-slate-300 hover:bg-ink-700 hover:text-white">{label}</button>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => downloadSVG(svgRef.current, filename(compoundLabel, diseaseLabel))}
          className="rounded-lg bg-ink-850/90 px-2.5 py-1 text-[11px] text-slate-300 ring-1 ring-ink-600 transition hover:bg-ink-800 hover:text-white">SVG</button>
      </div>

      <svg ref={svgRef} viewBox="0 0 480 330" width="100%" xmlns="http://www.w3.org/2000/svg"
        style={{ maxHeight: 330 }} fontFamily="Inter, system-ui, sans-serif">
        <defs>
          <clipPath id={uid}><circle cx="300" cy="150" r="108" /></clipPath>
        </defs>

        {/* fills */}
        <circle cx="180" cy="150" r="108" fill={TEAL} fillOpacity="0.9" />
        <circle cx="300" cy="150" r="108" fill={SKY} fillOpacity="0.88" />
        {/* intersection lens (circle A clipped to B) */}
        <g clipPath={`url(#${uid})`}><circle cx="180" cy="150" r="108" fill={VIO} fillOpacity="0.95" /></g>
        {/* crisp outlines on top */}
        <circle cx="180" cy="150" r="108" fill="none" stroke="#0f766e" strokeWidth="2" />
        <circle cx="300" cy="150" r="108" fill="none" stroke="#0369a1" strokeWidth="2" />

        {/* region counts (inside the fills) */}
        <text x="118" y="153" textAnchor="middle" fontSize="27" fontWeight="700" fill="#053a30">{cOnly}</text>
        <text x="118" y="171" textAnchor="middle" fontSize="11" fill="#0b5c4d">{pct(cOnly)}</text>

        <text x="240" y="153" textAnchor="middle" fontSize="27" fontWeight="700" fill="#ffffff">{shared}</text>
        <text x="240" y="171" textAnchor="middle" fontSize="11" fill="#efeaff">shared · {pct(shared)}</text>

        <text x="362" y="153" textAnchor="middle" fontSize="27" fontWeight="700" fill="#06384f">{dOnly}</text>
        <text x="362" y="171" textAnchor="middle" fontSize="11" fill="#0b4f70">{pct(dOnly)}</text>

        {/* names below each circle */}
        <text x="150" y="298" textAnchor="middle" fontSize="16" fontWeight="700" fill="#14b8a6">{clip(compoundLabel, 18) || 'compound'}</text>
        <text x="150" y="316" textAnchor="middle" fontSize="11.5" fill="#94a3b8">{compoundCount} targets</text>
        <text x="330" y="298" textAnchor="middle" fontSize="16" fontWeight="700" fill="#38bdf8">{clip(diseaseLabel, 18) || 'disease'}</text>
        <text x="330" y="316" textAnchor="middle" fontSize="11.5" fill="#94a3b8">{diseaseCount} genes</text>
      </svg>
    </div>
  )
}

function filename(c, d) {
  const s = (x) => (x || '').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'set'
  return `DDS_venn_${s(c)}_x_${s(d)}`
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
  const w = vb.width || 480, h = vb.height || 300
  const svg64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(serialize(svgEl))))
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = w * scale; canvas.height = h * scale
    const ctx = canvas.getContext('2d')
    if (bg === 'white') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height) }
    else if (bg === 'dark') { ctx.fillStyle = '#0b1424'; ctx.fillRect(0, 0, canvas.width, canvas.height) }
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
