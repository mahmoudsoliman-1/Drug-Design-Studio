import { useState, useEffect, useMemo, useRef } from 'react'
import * as api from '../../api.js'
import Logo from '../../components/Logo.jsx'
import DocsModal, { CiteModal } from '../../components/Documentation.jsx'

// Tissues — membrane permeability & absorption. Implicit-membrane Generalized-Born
// physics + per-tissue calibrated models (RDKit + scikit-learn), fast and offline.
// Emerald accent.
const S = '#34d399'
const TISSUE_COLORS = { gut: '#34d399', bbb: '#a78bfa', skin: '#fbbf24', pampa: '#38bdf8',
  nasal: '#f472b6', placenta: '#fb923c', mdck: '#22d3ee', lung: '#f87171' }

const EXAMPLES = [
  ['Caffeine', 'Cn1cnc2c1c(=O)n(C)c(=O)n2C'],
  ['Diazepam', 'CN1C(=O)CN=C(c2ccccc2)c2cc(Cl)ccc21'],
  ['Atenolol', 'CC(C)NCC(O)COc1ccc(CC(N)=O)cc1'],
  ['Ibuprofen', 'CC(C)Cc1ccc(C(C)C(=O)O)cc1'],
  ['Testosterone', 'CC12CCC3C(CCC4=CC(=O)CCC34C)C1CCC2O'],
]

export default function TissuesModule({ onSwitchModules }) {
  const [smiles, setSmiles] = useState('')
  const [catalog, setCatalog] = useState([])
  const [selected, setSelected] = useState([])   // none selected by default — user chooses
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [docs, setDocs] = useState(false)
  const [cite, setCite] = useState(false)
  const [active, setActive] = useState('bbb')      // tissue shown in the 3D scene
  const [place, setPlace] = useState(null)
  const [placing, setPlacing] = useState(false)

  useEffect(() => {
    api.tissuesCatalog().then((d) => setCatalog(d.tissues || [])).catch(() => {})
  }, [])

  function toggle(id) {
    setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])
  }

  async function run() {
    const smi = smiles.trim()
    if (!smi) { setError('Enter a SMILES string or pick an example.'); return }
    if (!selected.length) { setError('Select at least one tissue.'); return }
    setBusy(true); setError(''); setResult(null); setPlace(null)
    try {
      const r = await api.tissuesPredict({ smiles: smi, tissues: selected })
      setResult(r)
      const first = selected.find((t) => (r.tissues[t]?.tier) === 'validated') || selected[0]
      setActive(first)
    } catch (e) {
      setError(e.message === 'ENGINE_OFFLINE' ? 'Engine offline — start the DDS engine (port 8765).' : String(e.message || e))
    } finally { setBusy(false) }
  }

  // fetch the 3D placement whenever the active tissue (or molecule) changes
  useEffect(() => {
    if (!result || !active) return
    let stop = false
    setPlacing(true); setPlace(null)
    api.tissuesPlace({ smiles: result.smiles, tissue: active })
      .then((d) => { if (!stop) setPlace(d) }).catch(() => {}).finally(() => { if (!stop) setPlacing(false) })
    return () => { stop = true }
  }, [result, active])

  const cat = catalog.length ? catalog : FALLBACK_CAT
  const validated = cat.filter((t) => t.tier === 'validated')
  const estimate = cat.filter((t) => t.tier === 'estimate')

  return (
    <div className="flex h-full w-full bg-ink-950 text-slate-200">
      {/* rail */}
      <div className="flex w-[248px] shrink-0 flex-col border-r border-ink-700/60 bg-ink-900/60">
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <Logo size={40} className="rounded-xl" />
          <div>
            <div className="text-[15px] font-bold leading-none tracking-tight text-white">Drug Design</div>
            <div className="mt-1 text-[11px] font-medium tracking-wide" style={{ color: S }}>STUDIO · DDS</div>
          </div>
        </div>
        <div className="px-4 pb-2 pt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Tissues</div>
        <div className="px-4 text-[11.5px] leading-relaxed text-slate-400">
          Predict how a molecule crosses biological membranes — absorption &amp; permeability — from
          implicit-membrane biophysics, in seconds and fully offline.
        </div>
        <div className="mt-4 px-4 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Validated tissues</div>
        <div className="mt-1 space-y-1 px-3">
          {validated.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px]">
              <span className="h-2 w-2 rounded-full" style={{ background: TISSUE_COLORS[t.id] || S }} />
              <span className="flex-1 truncate text-slate-300">{t.name.replace(/ \(.*/, '')}</span>
              <span className="text-[10px] text-slate-500">{t.metric?.replace('Pearson ', '').replace('ROC-', '')}</span>
            </div>
          ))}
        </div>
        <div className="mt-auto p-3">
          <button onClick={() => setDocs(true)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-300 transition hover:bg-ink-800/70 hover:text-white">
            <BookIcon color={S} /><span className="text-[12px] font-medium">Documentation</span>
          </button>
          <button onClick={() => setCite(true)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-300 transition hover:bg-ink-800/70 hover:text-white">
            <QuoteIcon color={S} /><span className="text-[12px] font-medium">Cite DDS</span>
          </button>
          <div className="mt-1.5 px-2.5 text-[10px] text-slate-600">DDS v5.0 · Tissues</div>
        </div>
      </div>

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-ink-700/60 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[15px] font-semibold text-white">
              <span className="h-2 w-2 rounded-full" style={{ background: S }} />
              <span className="truncate">Membrane permeability &amp; absorption</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">Implicit-membrane Generalized-Born physics + calibrated models · RDKit + scikit-learn · offline</div>
          </div>
          <button onClick={onSwitchModules} className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold ring-1 transition"
            style={{ background: 'rgba(52,211,153,0.12)', color: '#6ee7b7', borderColor: 'rgba(52,211,153,0.4)' }}>
            <GridIcon /> Switch Module
          </button>
        </div>

        {error && (
          <div className="flex items-center justify-between border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-[12px] text-red-300">
            <span>{error}</span><button onClick={() => setError('')} className="text-red-300/70 hover:text-red-200">✕</button>
          </div>
        )}

        {/* input bar */}
        <div className="border-b border-ink-700/40 bg-emerald-500/[0.04] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <input value={smiles} onChange={(e) => setSmiles(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()}
              placeholder="Enter a SMILES string…" spellCheck={false}
              className="min-w-[280px] flex-1 rounded-xl bg-ink-900 px-3.5 py-2.5 font-mono text-[13px] text-slate-200 outline-none ring-1 ring-ink-700 focus:ring-2"
              style={{ '--tw-ring-color': S }} />
            <button onClick={run} disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-semibold shadow-lg transition disabled:opacity-60"
              style={{ background: S, color: '#04231a' }}>
              {busy ? <Spinner /> : <PlayIcon />} {busy ? 'Computing…' : 'Predict permeability'}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-500">Examples:</span>
            {EXAMPLES.map(([name, smi]) => (
              <button key={name} onClick={() => setSmiles(smi)}
                className="rounded-lg bg-ink-800/70 px-2.5 py-1 text-[11px] text-slate-300 ring-1 ring-ink-700 transition hover:text-white">{name}</button>
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-500">Tissues:</span>
            {validated.map((t) => (
              <TissueChip key={t.id} t={t} on={selected.includes(t.id)} onClick={() => toggle(t.id)} />
            ))}
            <span className="mx-1 text-ink-600">·</span>
            {estimate.map((t) => (
              <TissueChip key={t.id} t={t} on={selected.includes(t.id)} onClick={() => toggle(t.id)} estimate />
            ))}
          </div>
        </div>

        {/* results */}
        <main className="min-h-0 flex-1 overflow-y-auto p-4">
          {!result && !busy && <Empty />}
          {busy && <Msg spinner title="Computing membrane energetics…" sub="Generating a 3D conformer, running the Generalized-Born model, the G(z) barrier and the per-tissue prediction." />}
          {result && (
            <div className="flex flex-col gap-4">
              {/* tissue cards */}
              <div className="flex items-center justify-between px-0.5">
                <div className="text-[11px] text-slate-500">
                  All selected tissues are overlaid in the G(z) plot. <span className="text-slate-400">Click a tissue below to load its membrane in the 3D view →</span>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {selected.filter((t) => result.tissues[t]).map((t) => (
                  <TissueCard key={t} id={t} r={result.tissues[t]} active={active === t} onClick={() => setActive(t)} />
                ))}
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* G(z) barrier chart */}
                <div className="glass rounded-2xl p-4">
                  <div className="mb-1 flex items-center justify-between">
                    <div className="text-[13px] font-semibold text-white">Membrane free-energy barrier G(z)</div>
                    <div className="text-[11px] text-slate-500">0 = membrane core · barrier ↑ = harder to cross</div>
                  </div>
                  <GzChart result={result} selected={selected.filter((t) => result.tissues[t])} active={active} />
                </div>
                {/* 3D scene */}
                <div className="glass rounded-2xl p-4">
                  <div className="mb-1 flex items-center justify-between">
                    <div className="text-[13px] font-semibold text-white">
                      3D membrane placement · <span style={{ color: TISSUE_COLORS[active] || S }}>{result.tissues[active]?.name}</span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      drug: <span style={{ color: '#fb923c' }}>■</span> lipophilic · <span style={{ color: '#22d3ee' }}>■</span> polar · <span style={{ color: '#facc15' }}>■</span> cholesterol
                    </div>
                  </div>
                  <MembraneScene place={place} placing={placing} />
                  <div className="mt-1.5 text-[10.5px] leading-snug text-slate-500">
                    Real pre-equilibrated {membraneLabel(active)} (Berger/Tieleman){MEMBRANE_FILE[active] ? ', cholesterol shown in yellow' : ''}.
                    The molecule is shown <span className="text-slate-300">adsorbed at the entry surface — before crossing</span>,
                    at the physics-derived orientation (lipophilic groups toward the core, polar groups toward water). The green
                    arrow marks the crossing direction; the barrier it must climb is the G(z) peak at left. Representative pose, not an MD trajectory.
                  </div>
                </div>
              </div>
              {/* drivers */}
              <div className="glass rounded-2xl p-4">
                <div className="mb-2 text-[13px] font-semibold text-white">Why — physicochemical drivers <span className="font-normal text-slate-500">({result.tissues[active]?.name})</span></div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(result.tissues[active]?.drivers || []).map((d, i) => (
                    <div key={i} className="rounded-xl bg-ink-950/40 p-3 ring-1 ring-ink-700/50">
                      <div className="text-[11px] text-slate-500">{d.k}</div>
                      <div className="mt-0.5 text-[15px] font-semibold text-white">{d.v}</div>
                      {d.note && <div className="mt-0.5 text-[10.5px] leading-snug text-slate-400">{d.note}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {docs && <DocsModal onClose={() => setDocs(false)} initialModule="tissues" />}
      {cite && <CiteModal onClose={() => setCite(false)} />}
    </div>
  )
}

/* ------------------------------- tissue chips & cards ------------------------------- */
function TissueChip({ t, on, onClick, estimate }) {
  const c = TISSUE_COLORS[t.id] || S
  return (
    <button onClick={onClick} title={t.note}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium ring-1 transition"
      style={on ? { background: `${c}22`, color: '#fff', borderColor: `${c}88` }
                : { color: '#94a3b8', borderColor: 'rgba(100,116,139,0.3)' }}>
      <span className="h-2 w-2 rounded-full" style={{ background: on ? c : '#475569' }} />
      {t.name.replace(/ \(.*/, '')}{estimate && <span className="text-[9px] uppercase tracking-wide text-amber-400/80">est</span>}
    </button>
  )
}

function TissueCard({ id, r, active, onClick }) {
  const c = TISSUE_COLORS[id] || S
  const est = r.tier === 'estimate'
  const big = r.value != null ? r.value.toFixed(2)
    : r.prob != null ? `${Math.round(r.prob * 100)}%`
    : `${r.barrier?.toFixed(1)}`
  const biglabel = r.value != null ? r.unit : r.prob != null ? r.unit : 'barrier kcal/mol'
  return (
    <button onClick={onClick}
      className="flex flex-col rounded-2xl p-3.5 text-left ring-1 transition"
      style={active ? { background: `${c}14`, borderColor: `${c}99`, boxShadow: `inset 0 0 0 1px ${c}55` }
                    : { background: 'rgba(15,23,42,0.4)', borderColor: 'rgba(51,65,85,0.5)' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold text-white">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />{r.name.replace(/ \(.*/, '')}
        </div>
        <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
          style={est ? { background: 'rgba(251,191,36,0.15)', color: '#fbbf24' } : { background: 'rgba(52,211,153,0.15)', color: '#6ee7b7' }}>
          {est ? 'estimate' : 'validated'}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-[26px] font-bold leading-none" style={{ color: c }}>{big}</span>
        <span className="text-[10.5px] text-slate-500">{biglabel}</span>
      </div>
      <div className="mt-1 text-[12px] font-medium text-slate-200">{r.class}</div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500">
        <span>barrier {r.gz?.barrier?.toFixed(1)} kcal/mol</span>
        {active ? <span className="font-semibold" style={{ color: c }}>● shown in 3D</span> : <span>{est ? r.note : r.metric}</span>}
      </div>
    </button>
  )
}

/* ------------------------------- G(z) chart ------------------------------- */
function GzChart({ result, selected, active }) {
  const W = 560, H = 300, mL = 46, mB = 34, mT = 14, mR = 14
  const series = selected.map((t) => ({ id: t, gz: result.tissues[t].gz })).filter((s) => s.gz?.z?.length)
  const all = series.flatMap((s) => s.gz.Gz)
  const zmin = -35, zmax = 35
  const ymin = Math.min(0, ...all) - 1, ymax = Math.max(...all, 1) + 1
  const X = (z) => mL + ((z - zmin) / (zmax - zmin)) * (W - mL - mR)
  const Y = (g) => (H - mB) - ((g - ymin) / (ymax - ymin)) * (H - mB - mT)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" xmlns="http://www.w3.org/2000/svg" fontFamily="Inter, sans-serif">
      {/* membrane core band */}
      <rect x={X(-15)} y={mT} width={X(15) - X(-15)} height={H - mB - mT} fill="#f59e0b" opacity="0.06" />
      <line x1={mL} y1={Y(0)} x2={W - mR} y2={Y(0)} stroke="#334155" strokeWidth="1" />
      <line x1={X(0)} y1={mT} x2={X(0)} y2={H - mB} stroke="#334155" strokeDasharray="3 3" strokeWidth="0.8" />
      {/* axes */}
      <line x1={mL} y1={mT} x2={mL} y2={H - mB} stroke="#475569" strokeWidth="0.8" />
      <text x={(mL + W - mR) / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#94a3b8">membrane depth z (Å)</text>
      <text x="12" y={(mT + H - mB) / 2} textAnchor="middle" fontSize="11" fill="#94a3b8" transform={`rotate(-90 12 ${(mT + H - mB) / 2})`}>G(z) (kcal/mol)</text>
      <text x={X(0)} y={H - mB + 14} textAnchor="middle" fontSize="9" fill="#64748b">core</text>
      {series.map((s) => {
        const c = TISSUE_COLORS[s.id] || S
        const pts = s.gz.z.map((z, i) => `${X(z)},${Y(s.gz.Gz[i])}`).join(' ')
        return <polyline key={s.id} points={pts} fill="none" stroke={c} strokeWidth={s.id === active ? 3 : 1.6}
          opacity={s.id === active ? 1 : 0.55} />
      })}
      {/* legend */}
      {series.map((s, i) => {
        const c = TISSUE_COLORS[s.id] || S
        return (
          <g key={s.id} transform={`translate(${W - mR - 120}, ${mT + 6 + i * 15})`}>
            <line x1="0" y1="0" x2="16" y2="0" stroke={c} strokeWidth={s.id === active ? 3 : 2} />
            <text x="21" y="3.5" fontSize="10" fill={s.id === active ? '#e2e8f0' : '#94a3b8'}>
              {result.tissues[s.id].name.replace(/ \(.*/, '')} · {s.gz.barrier.toFixed(1)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/* ------------------------------- 3D membrane scene ------------------------------- */
// Real pre-equilibrated lipid bilayers (Berger/Tieleman patches, water stripped, centred on
// the midplane). Tissue-appropriate composition: cholesterol-rich for BBB & skin, fluid for the rest.
const FLUID = '/tissues_bilayer.pdb', CHOL = '/tissues_bilayer_chol.pdb'
const MEMBRANE_FILE = { bbb: CHOL, skin: CHOL }
const MEMBRANE_LABEL = { bbb: 'cholesterol-rich bilayer (BBB)', skin: 'cholesterol-rich, ordered membrane (stratum-corneum proxy)' }
const membraneFile = (t) => MEMBRANE_FILE[t] || FLUID
const membraneLabel = (t) => MEMBRANE_LABEL[t] || 'fluid phospholipid bilayer'

const BILAYER_CACHE = {}
async function loadBilayer(file) {
  if (BILAYER_CACHE[file]) return BILAYER_CACHE[file]
  let pdb = ''
  try { pdb = await (await fetch(file)).text() } catch { pdb = '' }
  const zs = []
  for (const ln of pdb.split('\n')) {
    if (!ln.startsWith('HETATM')) continue
    if ((ln.slice(76, 78).trim()) === 'P') { const z = parseFloat(ln.slice(46, 54)); if (z > 0) zs.push(z) }
  }
  const zP = zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : 18
  BILAYER_CACHE[file] = { pdb, zP }
  return BILAYER_CACHE[file]
}
// shift every atom's z by dz (Å) so the molecule sits at the entry-surface depth
function shiftPdbZ(pdb, dz) {
  return pdb.split('\n').map((ln) => {
    if (ln.startsWith('HETATM') || ln.startsWith('ATOM')) {
      const z = (parseFloat(ln.slice(46, 54)) + dz).toFixed(3).padStart(8)
      return ln.slice(0, 46) + z + ln.slice(54)
    }
    return ln
  }).join('\n')
}

function MembraneScene({ place, placing }) {
  const host = useRef(null)
  const viewerRef = useRef(null)
  useEffect(() => {
    if (!place?.pdb || !host.current) return
    let cancelled = false
    ;(async () => {
      try {
        const [$3Dmol, mem0] = await Promise.all([import('3dmol'), loadBilayer(membraneFile(place.tissue))])
        if (cancelled || !host.current) return
        if (!viewerRef.current) {
          viewerRef.current = $3Dmol.createViewer(host.current, { backgroundColor: 'rgb(8,12,22)', antialias: true })
        }
        const v = viewerRef.current
        v.clear()
        const bilayer = mem0.pdb, zP = mem0.zP
        // --- real lipid bilayer: gray tails, coloured head groups, cholesterol highlighted ---
        if (bilayer) {
          const mem = v.addModel(bilayer, 'pdb')
          mem.setStyle({}, { line: { color: '#5b6472' } })                            // gray tails
          mem.setStyle({ resn: 'CHO' }, { stick: { color: '#facc15', radius: 0.2 } }) // cholesterol = yellow
          mem.setStyle({ elem: 'P' }, { sphere: { color: '#f0a832', radius: 1.3 } })  // phosphate heads
          mem.setStyle({ elem: 'N' }, { sphere: { color: '#4b7bec', radius: 1.15 } })
          mem.setStyle({ elem: 'O' }, { sphere: { color: '#d0503a', radius: 1.0 }, line: { color: '#5b6472' } })
        }
        // --- molecule placed at the ENTRY SURFACE (adsorbed, pre-crossing) of the real bilayer ---
        const frac = Math.min(1, (place.z_com || 12) / (place.core_halfwidth || 15))
        const dz = zP * frac - (place.z_com || 12)
        const molIdx0 = bilayer ? 1 : 0
        const mol = v.addModel(shiftPdbZ(place.pdb, dz), 'pdb')
        const lipo = place.lipophilicity || []
        const lipoS = [], polarS = []
        lipo.forEach((val, i) => (val >= 0 ? lipoS : polarS).push(i + 1))
        // ball-and-stick, lipophilicity-coloured, so it reads as a distinct molecule (not lipid lines)
        mol.setStyle({}, { stick: { radius: 0.2 }, sphere: { scale: 0.32 } })
        mol.setStyle({ serial: lipoS }, { stick: { color: '#fb923c', radius: 0.2 }, sphere: { color: '#fb923c', scale: 0.32 } })
        mol.setStyle({ serial: polarS }, { stick: { color: '#22d3ee', radius: 0.2 }, sphere: { color: '#22d3ee', scale: 0.32 } })
        // translucent emerald envelope that clearly separates the drug from the membrane
        try { v.addSurface($3Dmol.SurfaceType.VDW, { opacity: 0.4, color: '#34d399' }, { resn: 'LIG' }) } catch { /* surface optional */ }
        // crossing-direction arrow + labels
        v.addArrow({ start: { x: 0, y: 0, z: zP + 6 }, end: { x: 0, y: 0, z: -zP - 6 }, radius: 0.32, color: '#34d399', opacity: 0.45 })
        v.addLabel('water', { position: { x: -zP, y: 0, z: zP + 7 }, fontSize: 12, fontColor: '#7dd3fc', backgroundOpacity: 0 })
        v.addLabel('drug (adsorbed)', { position: { x: 9, y: 0, z: zP * frac + 4 }, fontSize: 11, fontColor: '#6ee7b7', backgroundOpacity: 0 })
        v.addLabel('bilayer core', { position: { x: -zP - 2, y: 0, z: 0 }, fontSize: 11, fontColor: '#fbbf24', backgroundOpacity: 0 })
        v.zoomTo()                    // frame the whole assembly (reliably centred)
        v.rotate(90, 'x')             // edge-on: membrane normal vertical
        v.zoom(0.92)                  // small margin so nothing is clipped
        v.render()
      } catch { /* viewer unavailable */ }
    })()
    return () => { cancelled = true }
  }, [place])
  return (
    <div className="relative h-[320px] w-full overflow-hidden rounded-xl ring-1 ring-ink-700/50">
      <div ref={host} className="absolute inset-0" />
      {(placing || !place) && (
        <div className="absolute inset-0 grid place-items-center bg-ink-950/50 text-[12px] text-slate-400">
          {placing ? <span className="flex items-center gap-2"><Spinner /> placing molecule…</span> : 'Run a prediction to see the 3D scene.'}
        </div>
      )}
    </div>
  )
}

/* ------------------------------- misc ------------------------------- */
function Empty() {
  return (
    <div className="grid h-full place-items-center text-center">
      <div className="max-w-md">
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl" style={{ background: 'rgba(52,211,153,0.12)' }}>
          <MembraneBig />
        </div>
        <div className="text-[15px] font-semibold text-slate-200">Predict membrane permeability</div>
        <div className="mx-auto mt-1.5 text-[12.5px] leading-relaxed text-slate-400">
          Enter a molecule and choose your tissues. Tissues computes the water→membrane free-energy barrier and a
          calibrated permeability for each, and shows a 3D scene of the molecule sitting in the membrane — all in seconds, offline.
        </div>
      </div>
    </div>
  )
}
function Msg({ title, sub, spinner }) {
  return (
    <div className="grid h-full place-items-center text-center">
      <div className="max-w-md">
        {spinner && <div className="mx-auto mb-3"><Spinner big /></div>}
        <div className="text-[15px] font-semibold text-slate-200">{title}</div>
        <div className="mx-auto mt-1.5 text-[12.5px] leading-relaxed text-slate-400">{sub}</div>
      </div>
    </div>
  )
}
const FALLBACK_CAT = [
  { id: 'gut', name: 'Gut (intestinal, Caco-2)', tier: 'validated', metric: 'Pearson r = 0.71', note: '' },
  { id: 'bbb', name: 'Blood-brain barrier', tier: 'validated', metric: 'ROC-AUC = 0.90', note: '' },
  { id: 'skin', name: 'Skin (stratum corneum)', tier: 'validated', metric: 'Pearson r = 0.75', note: '' },
  { id: 'pampa', name: 'PAMPA (artificial membrane)', tier: 'validated', metric: 'ROC-AUC = 0.72', note: '' },
  { id: 'nasal', name: 'Nasal mucosa', tier: 'estimate', metric: 'physics estimate', note: 'No validation-grade public dataset yet.' },
  { id: 'placenta', name: 'Placenta', tier: 'estimate', metric: 'physics estimate', note: 'Sparse data; active transport not modelled.' },
  { id: 'mdck', name: 'MDCK monolayer', tier: 'estimate', metric: 'physics estimate', note: 'No open small-molecule dataset.' },
  { id: 'lung', name: 'Lung (pulmonary)', tier: 'estimate', metric: 'physics estimate', note: 'Data-poor; physics estimate only.' },
]

/* ------------------------------- icons ------------------------------- */
function Spinner({ big }) {
  const s = big ? 'h-7 w-7' : 'h-4 w-4'
  return <span className={`inline-block ${s} animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-400`} />
}
const I = (p, c) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={p.color || 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className}>{c}</svg>
function PlayIcon(p) { return I(p, <path d="M6 4l14 8-14 8V4z" />) }
function GridIcon(p) { return I(p, <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>) }
function BookIcon(p) { return I(p, <><path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2V5z" /><path d="M19 3v16" /></>) }
function QuoteIcon(p) { return I(p, <><path d="M7 7h4v4a4 4 0 01-4 4M13 7h4v4a4 4 0 01-4 4" /></>) }
function MembraneBig() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#34d399" strokeWidth="1.7" strokeLinecap="round">
      <circle cx="5" cy="8" r="1.3" /><circle cx="10" cy="8" r="1.3" /><circle cx="15" cy="8" r="1.3" /><circle cx="19" cy="8" r="1.3" />
      <path d="M5 9.3v4M10 9.3v4M15 9.3v4M19 9.3v4" />
      <circle cx="5" cy="16" r="1.3" /><circle cx="10" cy="16" r="1.3" /><circle cx="15" cy="16" r="1.3" /><circle cx="19" cy="16" r="1.3" />
    </svg>
  )
}
