import { useState } from 'react'
import { saveFile } from '../../download.js'

// Shared figure-export controls for the QSAR module, matching the netpharm
// figures: high-resolution PNG (transparent or white) and vector SVG.
function serialize(svgEl) {
  const clone = svgEl.cloneNode(true)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const vb = svgEl.viewBox.baseVal
  if (vb && vb.width) { clone.setAttribute('width', vb.width); clone.setAttribute('height', vb.height) }
  return new XMLSerializer().serializeToString(clone)
}
export function downloadSVG(svgEl, name) {
  if (!svgEl) return
  saveFile(`${name}.svg`, new Blob([serialize(svgEl)], { type: 'image/svg+xml;charset=utf-8' }))
}
export function downloadPNG(svgEl, name, bg = 'transparent', scale = 3) {
  if (!svgEl) return
  const vb = svgEl.viewBox.baseVal
  const w = vb.width || 800, h = vb.height || 600
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

export function ExportMenu({ svgRef, name }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-lg bg-ink-850/90 px-2.5 py-1 text-[11px] text-slate-300 ring-1 ring-ink-600 transition hover:bg-ink-800 hover:text-white">
        <DL /> Export <Caret />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 flex flex-col overflow-hidden rounded-lg bg-ink-850 py-1 text-[11px] ring-1 ring-ink-600">
          <button onClick={() => { downloadPNG(svgRef.current, name, 'transparent'); setOpen(false) }}
            className="whitespace-nowrap px-3 py-1.5 text-left text-slate-300 hover:bg-ink-700 hover:text-white">PNG · transparent</button>
          <button onClick={() => { downloadPNG(svgRef.current, name, 'white'); setOpen(false) }}
            className="whitespace-nowrap px-3 py-1.5 text-left text-slate-300 hover:bg-ink-700 hover:text-white">PNG · white</button>
          <button onClick={() => { downloadSVG(svgRef.current, name); setOpen(false) }}
            className="whitespace-nowrap px-3 py-1.5 text-left text-slate-300 hover:bg-ink-700 hover:text-white">SVG (vector)</button>
        </div>
      )}
    </div>
  )
}
// Renders a raw SVG string (e.g. an RDKit-drawn structure grid) with its own
// PNG (transparent/white) + SVG export, sizing from the SVG's width/height.
export function RawFigure({ svg: rawSvg, name }) {
  const [open, setOpen] = useState(false)
  const svg = rawSvg.replace(/<\?xml[^>]*\?>/i, '').replace(/<!DOCTYPE[^>]*>/i, '').trim()
  const w = +(svg.match(/width=['"]([\d.]+)/)?.[1] || 800)
  const h = +(svg.match(/height=['"]([\d.]+)/)?.[1] || 600)
  function png(bg) {
    const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = w * 3; c.height = h * 3
      const ctx = c.getContext('2d')
      if (bg === 'white') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height) }
      ctx.setTransform(3, 0, 0, 3, 0, 0); ctx.drawImage(img, 0, 0)
      c.toBlob((b) => b && saveFile(`${name}.png`, b), 'image/png')
    }
    img.src = url
  }
  return (
    <div className="relative">
      <div className="absolute right-2 top-2 z-20">
        <div className="relative">
          <button onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg bg-ink-850/90 px-2.5 py-1 text-[11px] text-slate-300 ring-1 ring-ink-600 transition hover:bg-ink-800 hover:text-white">
            <DL /> Export <Caret />
          </button>
          {open && (
            <div className="absolute right-0 z-20 mt-1 flex flex-col overflow-hidden rounded-lg bg-ink-850 py-1 text-[11px] ring-1 ring-ink-600">
              <button onClick={() => { png('transparent'); setOpen(false) }} className="whitespace-nowrap px-3 py-1.5 text-left text-slate-300 hover:bg-ink-700 hover:text-white">PNG · transparent</button>
              <button onClick={() => { png('white'); setOpen(false) }} className="whitespace-nowrap px-3 py-1.5 text-left text-slate-300 hover:bg-ink-700 hover:text-white">PNG · white</button>
              <button onClick={() => { saveFile(`${name}.svg`, new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })); setOpen(false) }} className="whitespace-nowrap px-3 py-1.5 text-left text-slate-300 hover:bg-ink-700 hover:text-white">SVG (vector)</button>
            </div>
          )}
        </div>
      </div>
      <div className="w-full overflow-auto [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  )
}
function DL() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3M8 11l4 4 4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg> }
function Caret() { return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg> }
