import { useState, useEffect, useMemo, useRef } from 'react'
import * as api from '../../api.js'
import Logo from '../../components/Logo.jsx'
import DocsModal, { CiteModal } from '../../components/Documentation.jsx'
import { RawFigure } from '../qsar/FigExport.jsx'
import { saveFile } from '../../download.js'
import NanoViewer from './NanoViewer.jsx'
import NanoInteractionMap2D from './NanoInteractionMap2D.jsx'

// Nano Bio-Pharmaceutical Modelling — DDS 4.0. A simple, reliable, force-field
// (MMFF94) tool that (A) models how 2–3 drugs associate for co-formulation, and
// (B) how a drug (or the drug–drug assembly) sits in/on a common pharmaceutical
// nanocarrier. Guided 3-step workflow mirroring the other DDS modules. Amber accent.
const N = '#fb923c'

const STEPS = [
  { id: 'compounds', label: 'Compounds', hint: 'Add 1–3 drugs (SMILES)', icon: FlaskIcon },
  { id: 'carrier', label: 'Carrier', hint: 'Cyclodextrin · polymer · lipid', icon: CarrierIcon },
  { id: 'result', label: 'Result', hint: '3D pose · energy · contacts', icon: ViewIcon },
]

const PRESETS = [
  { label: 'Curcumin + piperine', hint: 'drug–drug co-formulation',
    smiles: ['O=C(/C=C/c1ccc(O)c(OC)c1)CC(=O)/C=C/c1ccc(O)c(OC)c1', 'O=C(/C=C/C=C/c1ccc2OCOc2c1)N1CCCCC1'] },
  { label: 'Ibuprofen', hint: 'single drug', smiles: ['CC(C)Cc1ccc(C(C)C(=O)O)cc1'] },
  { label: 'Glutathione (tripeptide)', hint: 'peptide cargo · loaded as SMILES',
    smiles: ['NC(CCC(=O)NC(CS)C(=O)NCC(=O)O)C(=O)O'] },
]

// Guest SMILES + carrier for each benchmark case — a built-in fallback so a validation case
// loads into the workspace even if the running engine predates the validation_list fields.
const VCASE_DEFAULTS = {
  ibuprofen_betaCD: { smiles: 'CC(C)Cc1ccc(C(C)C(=O)O)cc1', carrier: 'beta_cyclodextrin' },
  nitrophenol_alphaCD: { smiles: 'Oc1ccc([N+](=O)[O-])cc1', carrier: 'alpha_cyclodextrin' },
  doxorubicin_GO: { smiles: 'COc1cccc2c1C(=O)c1c(O)c3c(c(O)c1C2=O)C[C@@](O)(C(=O)CO)C[C@@H]3O[C@H]1C[C@H](N)[C@H](O)[C@H](C)O1', carrier: 'graphene_oxide' },
}

// Prefer a common drug name; otherwise "Compound N (molecular formula)".
function legendFor(id, i) {
  if (id && id.name) return id.name
  return `Compound ${i + 1}${id && id.formula ? ` (${id.formula})` : ''}`
}

export default function NanoBioModule({ onSwitchModules }) {
  const [step, setStep] = useState('compounds')
  const [docs, setDocs] = useState(false)
  const [cite, setCite] = useState(false)
  const [error, setError] = useState('')

  const [compounds, setCompounds] = useState([])       // [{smiles}]
  const [smi, setSmi] = useState('')
  const [carrier, setCarrier] = useState(null)         // carrier id | null (drug–drug only)
  const [ratio, setRatio] = useState('1:1')            // guest:host stoichiometry (drug:carrier)
  const [thoroughness, setThoroughness] = useState('balanced')  // quick | balanced | thorough
  const [solvent, setSolvent] = useState('water')      // water (implicit) | gas
  const [carriers, setCarriers] = useState([])
  const [vcases, setVcases] = useState([])

  const [jobId, setJobId] = useState(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)           // { kind:'run', ... } | { kind:'validation', ... }
  const [livePdb, setLivePdb] = useState(null)         // live complex frame while modelling

  // caches for previews
  const [compoundSvg, setCompoundSvg] = useState(null) // 2D grid SVG of the loaded compounds
  const [drawErr, setDrawErr] = useState(false)        // true if the 2D depiction could not be produced
  const [carrierPdb, setCarrierPdb] = useState(null)   // 3D PDB of the selected carrier
  const [identities, setIdentities] = useState([])     // [{name, formula}] per compound

  // viewer options
  const [spin, setSpin] = useState(true)
  const [surface, setSurface] = useState(true)
  const [view, setView] = useState('loaded')           // 'loaded' | 'assembly' (which structure)
  const [resultView, setResultView] = useState('3d')   // '3d' | '3dint' | '2dint'
  const [compoundView, setCompoundView] = useState('2d')

  const smilesKey = compounds.map((c) => c.smiles).join('|')

  // load catalogs once
  useEffect(() => {
    api.nanoCarriers().then((d) => setCarriers(d.carriers || [])).catch(() => {})
    api.nanoValidationCases().then((d) => setVcases(d.cases || [])).catch(() => {})
  }, [])

  // (re)draw the 2D depiction whenever the compound set changes. The offline RDKit draw
  // runs FIRST with fallback labels so the view never hangs on the online name lookup;
  // names are then resolved in the background (best-effort) and the labels upgraded.
  useEffect(() => {
    setCompoundSvg(null); setIdentities([]); setDrawErr(false)
    if (!compounds.length) return
    const smiles = compounds.map((c) => c.smiles)
    if (smiles.some((s) => !s)) { setDrawErr(true); return }   // nothing to draw (missing structure)
    let stop = false
    const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
    ;(async () => {
      try {                                                    // offline draw — never let it hang the view
        const d = await Promise.race([api.nanoDepict(smiles, smiles.map((_, i) => legendFor(null, i))), timeout(10000)])
        if (stop) return
        if (d.error || !d.svg) setDrawErr(true); else setCompoundSvg(d.svg)
      } catch { if (!stop) setDrawErr(true) }
      let ids = []
      try { ids = (await Promise.race([api.nanoIdentify(smiles), timeout(6000)])).items || [] } catch { /* offline/slow */ }
      if (stop || !ids.length) return
      setIdentities(ids)
      try {
        const d2 = await api.nanoDepict(smiles, smiles.map((_, i) => legendFor(ids[i], i)))
        if (!stop && !d2.error && d2.svg) setCompoundSvg(d2.svg)
      } catch { /* ignore */ }
    })()
    return () => { stop = true }
  }, [smilesKey])

  // fetch the carrier 3D structure when one is selected
  useEffect(() => {
    setCarrierPdb(null)
    if (!carrier) return
    let stop = false
    api.nanoStructure({ carrier }).then((d) => { if (!stop) setCarrierPdb(d.error ? null : d.pdb) }).catch(() => {})
    return () => { stop = true }
  }, [carrier])

  // poll the run job
  useEffect(() => {
    if (!jobId) return
    let stop = false
    const tick = async () => {
      try {
        const full = await api.getJob(jobId)
        if (stop) return
        if (full.status === 'running') {
          if (full.preview) setLivePdb(full.preview)   // live minimisation frame
        } else {
          setRunning(false); setJobId(null); setLivePdb(null)
          if (full.status === 'done') {
            setResult({ kind: 'run', ...full.result })
            setView(full.result.loaded ? 'loaded' : 'assembly'); setResultView('3d')
            setStep('result')
          } else setError(full.error || 'run failed')
        }
      } catch (e) {
        if (!stop) { setRunning(false); setJobId(null); setError(String(e.message || e)) }
      }
    }
    const t = setInterval(tick, 500); tick()
    return () => { stop = true; clearInterval(t) }
  }, [jobId])

  const carrierMeta = useMemo(() => carriers.find((c) => c.id === carrier) || null, [carriers, carrier])
  const canRun = compounds.length >= 1 && (carrier || compounds.length >= 2)

  function addCompound() {
    const s = smi.trim()
    if (!s) return
    if (compounds.length >= 3) { setError('Up to 3 compounds — co-formulation is modelled for small mixtures.'); return }
    setCompounds((c) => [...c, { smiles: s }]); setSmi(''); setError('')
  }
  function loadPreset(p) {
    setCompounds(p.smiles.map((s) => ({ smiles: s }))); setError(''); setStep('carrier')
  }
  function run() {
    if (!canRun) return
    setError(''); setResult(null); setLivePdb(null); setRunning(true)
    api.nanoRun({ compounds: compounds.map((c) => c.smiles), carrier, n_poses: 8,
      ratio: carrier ? ratio : '1:1', thoroughness, solvent,
      label: 'Nano · ' + (carrierMeta ? carrierMeta.name : 'drug–drug') + (carrier && ratio !== '1:1' ? ' · ' + ratio : '') })
      .then((d) => setJobId(d.job_id))
      .catch((e) => { setRunning(false); setError(String(e.message || e)) })
  }
  // Load a benchmark case into the workspace exactly like a manual run — guest + carrier
  // previewed and the validation protocol (implicit water, Balanced, 1:1) pre-set — landing
  // on the Carrier step ready to press Run, rather than running blindly to a result.
  function loadValidationCase(v) {
    const d = VCASE_DEFAULTS[v.id] || {}
    const smiles = v.guest_smiles || d.smiles
    const carrier = v.carrier || d.carrier
    if (!smiles) { setError('Could not load this benchmark case.'); return }
    setError(''); setResult(null)
    setCompounds([{ smiles }])
    setCarrier(carrier)
    setSolvent('water'); setThoroughness('balanced'); setRatio('1:1')   // validation protocol
    setStep('carrier')
  }
  function newRun() {
    setCompounds([]); setCarrier(null); setRatio('1:1'); setResult(null); setJobId(null); setRunning(false); setError(''); setStep('compounds')
  }
  const METHOD_TEXT = {
    quick: '1 conformer · fastest', balanced: '2 conformers · recommended', thorough: '5 conformers · most thorough',
  }

  const title = result
    ? (result.kind === 'validation' ? result.name : (carrierMeta ? `Loaded on ${carrierMeta.name}` : 'Drug–drug assembly'))
    : 'New model'

  return (
    <div className="flex h-full w-full bg-ink-950 text-slate-200">
      {/* rail */}
      <div className="flex w-[248px] shrink-0 flex-col border-r border-ink-700/60 bg-ink-900/60">
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <Logo size={40} className="rounded-xl" />
          <div>
            <div className="text-[15px] font-bold leading-none tracking-tight text-white">Drug Design</div>
            <div className="mt-1 text-[11px] font-medium tracking-wide" style={{ color: N }}>STUDIO · DDS</div>
          </div>
        </div>
        <div className="px-4 pb-2 pt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Workflow</div>
        <nav className="flex flex-col gap-1 px-3">
          {STEPS.map((s, i) => {
            const active = step === s.id
            const dis = (s.id === 'carrier' && compounds.length < 1) || (s.id === 'result' && !result)
            return (
              <button key={s.id} disabled={dis} onClick={() => setStep(s.id)}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${active ? '' : 'hover:bg-ink-800/70'} ${dis ? 'cursor-not-allowed opacity-40' : ''}`}
                style={active ? { background: 'rgba(251,146,60,0.10)', boxShadow: 'inset 0 0 0 1px rgba(251,146,60,0.35)' } : {}}>
                <div className="grid h-8 w-8 place-items-center rounded-lg text-[11px] font-bold"
                  style={active ? { background: N, color: '#2a1503' } : { background: '#1b2436', color: '#94a3b8' }}>{i + 1}</div>
                <div className="min-w-0 flex-1">
                  <div className={`text-[13px] font-semibold ${active ? 'text-white' : 'text-slate-300'}`}>{s.label}</div>
                  <div className="truncate text-[11px] text-slate-500">{s.hint}</div>
                </div>
                <s.icon className="h-4 w-4" color={active ? N : '#475569'} />
              </button>
            )
          })}
        </nav>
        <div className="mt-auto p-3">
          <button onClick={() => setDocs(true)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-300 transition hover:bg-ink-800/70 hover:text-white">
            <BookIcon className="h-4 w-4" color={N} /><span className="text-[12px] font-medium">Documentation</span>
          </button>
          <button onClick={() => setCite(true)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-300 transition hover:bg-ink-800/70 hover:text-white">
            <QuoteIcon className="h-4 w-4" color={N} /><span className="text-[12px] font-medium">Cite DDS</span>
          </button>
          <div className="mt-1.5 px-2.5 text-[10px] text-slate-600">DDS v4.1 · Nano</div>
        </div>
      </div>

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-ink-700/60 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[15px] font-semibold text-white">
              <span className="h-2 w-2 rounded-full" style={{ background: N }} />
              <span className="truncate">{title}</span>
              <span className="text-slate-500">· Nano bio-pharmaceutics</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">Co-formulation &amp; nanocarrier loading</div>
          </div>
          <div className="flex items-center gap-2.5">
            {result && (
              <ExportMenu result={result} carrierMeta={carrierMeta} />
            )}
            <button onClick={newRun} className="inline-flex items-center gap-2 rounded-xl bg-ink-800/70 px-3 py-2 text-[12px] font-medium text-slate-300 ring-1 ring-ink-600 transition hover:bg-ink-700 hover:text-white">
              <NewIcon className="h-4 w-4" /> New model
            </button>
            <button onClick={onSwitchModules} className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold ring-1 transition"
              style={{ background: 'rgba(251,146,60,0.12)', color: '#fdba74', borderColor: 'rgba(251,146,60,0.4)' }}>
              <GridIcon className="h-4 w-4" /> Switch Module
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 border-b border-ink-700/40 px-4 py-1.5 text-[11px] text-slate-400" style={{ background: 'rgba(251,146,60,0.05)' }}>
          <GlobeIcon className="h-3.5 w-3.5" color={N} /> Runs fully offline.
        </div>
        {error && (
          <div className="flex items-center justify-between border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-[12px] text-red-300">
            <span>{error}</span><button onClick={() => setError('')} className="text-red-300/70 hover:text-red-200">✕</button>
          </div>
        )}

        <main className="flex min-h-0 flex-1 gap-4 p-4">
          <section className="glass relative flex min-w-0 flex-1 flex-col rounded-2xl p-3">
            <Center step={step} running={running} compounds={compounds} carriers={carriers} carrier={carrier}
              result={result} view={view} spin={spin} surface={surface} resultView={resultView} carrierMeta={carrierMeta}
              compoundSvg={compoundSvg} drawErr={drawErr} carrierPdb={carrierPdb} compoundView={compoundView} smilesKey={smilesKey}
              identities={identities} ratio={ratio} onPickCarrier={setCarrier} livePdb={livePdb} />
          </section>
          <aside className="flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto">
            {step === 'carrier' && (
              <button onClick={run} disabled={!canRun || running}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#fb923c] px-4 py-2.5 text-[14px] font-semibold text-[#2a1503] shadow-lg transition hover:brightness-110 disabled:opacity-60">
                {running ? <Spinner /> : <PlayIcon className="h-4 w-4" />}
                {running ? 'Modelling…' : 'Run modelling'}
              </button>
            )}
            <Setup step={step} smi={smi} setSmi={setSmi} addCompound={addCompound} compounds={compounds}
              setCompounds={setCompounds} presets={PRESETS} loadPreset={loadPreset} identities={identities}
              vcases={vcases} loadValidationCase={loadValidationCase} running={running}
              carrier={carrier} setCarrier={setCarrier} carriers={carriers} carrierMeta={carrierMeta} canRun={canRun}
              ratio={ratio} setRatio={setRatio}
              thoroughness={thoroughness} setThoroughness={setThoroughness} solvent={solvent} setSolvent={setSolvent} methodText={METHOD_TEXT}
              result={result} view={view} setView={setView} spin={spin} setSpin={setSpin}
              surface={surface} setSurface={setSurface} resultView={resultView} setResultView={setResultView}
              compoundView={compoundView} setCompoundView={setCompoundView} />
          </aside>
        </main>
      </div>

      {docs && <DocsModal onClose={() => setDocs(false)} initialModule="nano" />}
      {cite && <CiteModal onClose={() => setCite(false)} />}
    </div>
  )
}

/* ================================ center ================================ */
function Center(props) {
  const { step, running, result } = props
  // during a run stay on the carrier preview (the carrier/complex keeps moving in 3D)
  if (step === 'compounds') return <CompoundsView {...props} />
  if (step === 'carrier') return <CarrierView {...props} />
  if (step === 'result') return result ? <ResultView {...props} /> : <Msg title="No model yet" sub="Add compounds and run a model." />
  return null
}

/* ---------- compounds ---------- */
function CompoundsView({ compounds, compoundView, compoundSvg, drawErr, smilesKey, identities }) {
  if (!compounds.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-2xl" style={{ background: 'rgba(251,146,60,0.12)' }}>
          <FlaskIcon className="h-7 w-7" color={N} />
        </div>
        <h2 className="mt-4 text-[18px] font-semibold text-white">Add your compounds</h2>
        <p className="mt-2 max-w-md text-[13px] leading-relaxed text-slate-400">
          Paste 1–3 drug SMILES on the right and each is drawn here in 2D and 3D. Two or three compounds are first
          assembled together (co-formulation); the single drug or the assembly is then loaded onto a nanocarrier in the
          next step. Or load a preset / a validation case to see it in action.
        </p>
      </div>
    )
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-semibold text-white">{compounds.length} compound{compounds.length > 1 ? 's' : ''} · {compoundView === '2d' ? '2D structures' : '3D structures'}</div>
        {compounds.length >= 2 && <span className="rounded-md px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: 'rgba(251,146,60,0.12)', color: '#fdba74' }}>will be co-formulated</span>}
      </div>
      {compoundView === '2d'
        ? (compoundSvg
            ? <div className="min-h-0 flex-1 overflow-auto rounded-xl bg-white/[0.03] p-2"><RawFigure svg={compoundSvg} name="DDS_nano_compounds_2D" /></div>
            : drawErr
              ? <Msg title="Structure preview unavailable" sub="Could not draw this compound. Switch to the 3D view, or re-enter the structure." />
              : <Msg spinner title="Drawing structures…" sub="Rendering 2D structures." />)
        : <Compound3DGrid key={smilesKey} compounds={compounds} identities={identities} />}
    </div>
  )
}

function Compound3DGrid({ compounds, identities = [] }) {
  const [pdbs, setPdbs] = useState({})
  useEffect(() => {
    let stop = false
    compounds.forEach((c) => {
      api.nanoStructure({ smiles: c.smiles }).then((d) => { if (!stop && !d.error) setPdbs((m) => ({ ...m, [c.smiles]: d.pdb })) }).catch(() => {})
    })
    return () => { stop = true }
  }, [compounds])
  return (
    <div className="grid min-h-0 flex-1 gap-3 overflow-auto" style={{ gridTemplateColumns: `repeat(${Math.min(compounds.length, 3)}, minmax(0, 1fr))` }}>
      {compounds.map((c, i) => (
        <div key={i} className="flex min-h-[220px] flex-col rounded-xl bg-ink-950/60 ring-1 ring-ink-700/60">
          <div className="flex items-center gap-2 px-2.5 pt-2 text-[11px] text-slate-400">
            <span className="grid h-5 w-5 place-items-center rounded text-[10px] font-bold" style={{ background: 'rgba(251,146,60,0.15)', color: '#fdba74' }}>{i + 1}</span>
            <span className="truncate font-medium text-slate-300">{legendFor(identities[i], i)}</span>
          </div>
          <div className="min-h-0 flex-1">
            {pdbs[c.smiles] ? <NanoViewer models={[{ pdb: pdbs[c.smiles], scheme: 'orangeCarbon' }]} spin surface={false} /> : <Msg spinner title="" sub="" />}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------- carrier ---------- */
function CarrierView({ compounds, carrier, carrierMeta, carrierPdb, compoundSvg, ratio, running, livePdb }) {
  const isNone = carrier === null
  const live = running && livePdb                    // live minimisation frame of the complex
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-white">
        {isNone ? 'Drug–drug co-formulation (no carrier)' : (live ? `Modelling · ${carrierMeta?.name || 'carrier'}` : `Preview · ${carrierMeta?.name || 'carrier'}`)}
        {carrierMeta?.cavity && <span className="rounded-md px-1.5 py-0.5 text-[9.5px] font-semibold" style={{ background: 'rgba(251,146,60,0.15)', color: '#fdba74' }}>CAVITY</span>}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <div className="relative flex min-h-0 flex-col rounded-xl bg-ink-950/60 ring-1 ring-ink-700/60">
          <div className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{live ? 'Complex (3D · minimising live)' : isNone ? 'Compounds (3D)' : 'Carrier (3D)'}</div>
          <div className="min-h-0 flex-1">
            {live
              ? <NanoViewer models={[{ pdb: livePdb, element: true }]} spin surface={false} />
              : isNone
                ? <CompoundsAssemblyPreview compounds={compounds} />
                : (carrierPdb ? <NanoViewer models={[{ pdb: carrierPdb, thin: true, scheme: 'cyanCarbon' }]} spin surface={!running && !!carrierMeta?.cavity} /> : <Msg spinner title="Loading carrier…" sub="" />)}
          </div>
          {running && (
            <div className="pointer-events-none absolute left-3 top-8 flex items-center gap-2 rounded-lg bg-ink-950/85 px-3 py-2 ring-1 ring-amber-500/40">
              <Spinner /><span className="text-[12px] font-semibold text-white">{live ? 'Minimising the complex…' : 'Modelling…'}</span>
            </div>
          )}
        </div>
        <div className="flex min-h-0 flex-col rounded-xl bg-white/[0.03] ring-1 ring-ink-700/60">
          <div className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Compounds (2D)</div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {compoundSvg ? <RawFigure svg={compoundSvg} name="DDS_nano_compounds_2D" /> : <Msg spinner title="" sub="" />}
          </div>
        </div>
      </div>
      <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: 'rgba(251,146,60,0.08)', color: '#fdba74' }}>
        {running
          ? 'Building and minimising the complex with MMFF94 — the result appears when the run converges.'
          : isNone
            ? `${compounds.length} compound${compounds.length > 1 ? 's' : ''} will be assembled together — press Run modelling.`
            : `${compounds.length} compound${compounds.length > 1 ? 's' : ''}${compounds.length >= 2 ? ' (assembled)' : ''} will be loaded onto ${carrierMeta?.name} at a ${ratio} drug:carrier ratio. Press Run modelling.`}
      </div>
    </div>
  )
}

function CompoundsAssemblyPreview({ compounds }) {
  const [pdbs, setPdbs] = useState([])
  useEffect(() => {
    let stop = false
    Promise.all(compounds.map((c) => api.nanoStructure({ smiles: c.smiles }).then((d) => d.error ? null : d.pdb).catch(() => null)))
      .then((r) => { if (!stop) setPdbs(r.filter(Boolean)) })
    return () => { stop = true }
  }, [compounds])
  if (!pdbs.length) return <Msg spinner title="" sub="" />
  return <NanoViewer models={pdbs.map((p, i) => ({ pdb: p, scheme: ['orangeCarbon', 'magentaCarbon', 'cyanCarbon'][i % 3] }))} spin surface={false} />
}

/* ---------- result ---------- */
function ResultView({ result, view, spin, surface, resultView, carrierMeta, compounds, compoundSvg, identities = [] }) {
  const isVal = result.kind === 'validation'
  const loaded = result.loaded || null
  const assembly = result.assembly || null

  let models
  if (isVal) {
    models = [{ pdb: result.carrier_pdb, thin: true, scheme: 'cyanCarbon' }, { pdb: result.guest_pdb, scheme: 'orangeCarbon' }]
  } else if (view === 'assembly' && assembly) {
    models = (assembly.component_pdbs || []).map((p, i) => ({ pdb: p, scheme: ['orangeCarbon', 'magentaCarbon', 'cyanCarbon'][i % 3] }))
  } else if (loaded) {
    models = [{ pdb: loaded.carrier_pdb, thin: true, scheme: 'cyanCarbon' }, { pdb: loaded.guest_pdb, scheme: 'orangeCarbon' }]
  } else if (assembly) {
    models = (assembly.component_pdbs || []).map((p, i) => ({ pdb: p, scheme: ['orangeCarbon', 'magentaCarbon', 'cyanCarbon'][i % 3] }))
  } else models = []

  const onGuestGuest = view === 'assembly' && !isVal
  const showCavitySurface = surface && (isVal || (view === 'loaded' && carrierMeta?.cavity))
  const prof = isVal ? result.interactions : (onGuestGuest ? assembly?.interactions : loaded?.interactions)
  const dE = isVal ? result.interaction_energy : (view === 'assembly' ? assembly?.interaction_energy : loaded?.interaction_energy)
  const inside = isVal ? result.inside_fraction : (view === 'loaded' ? loaded?.inside_fraction : null)
  const guestSmiles = isVal ? [result.guest_smiles] : (compounds || []).map((c) => c.smiles)
  const ratio = loaded?.ratio && loaded.ratio !== '1:1' && view === 'loaded' ? loaded.ratio : null
  const perGuest = ratio ? loaded.interaction_energy_per_guest : null
  const note = view === 'loaded' ? loaded?.note : null
  const map2d = isVal ? result.map2d : (onGuestGuest ? assembly?.map2d : loaded?.map2d)
  const terms = isVal ? result.energy_terms : (onGuestGuest ? assembly?.energy_terms : loaded?.energy_terms)
  const solvent = result.solvent || 'water'
  const method = isVal ? result.method : loaded?.method
  const guestName = isVal ? result.guest : (onGuestGuest ? legendFor(identities[0], 0) : ((compounds || []).length > 1 ? 'Drug assembly' : 'Guest drug'))
  const mapCaption = onGuestGuest ? 'spheres = partner-drug atoms · centre = compound 1' : 'spheres = carrier atoms · centre = guest drug'
  const mapSubtitle = [onGuestGuest ? 'co-formulation' : (isVal ? result.host : carrierMeta?.name), dE != null ? `ΔE ${dE.toFixed(1)} kcal/mol` : null, ratio].filter(Boolean).join(' · ')
  const coulomb = isVal ? result.coulomb : (onGuestGuest ? assembly?.coulomb : loaded?.coulomb)
  const complexPdb = isVal ? result.complex_pdb : (onGuestGuest ? assembly?.complex_pdb : loaded?.complex_pdb)
  const coulModels = (coulomb && complexPdb) ? [...models.map((m) => ({ ...m, thin: true })), { pdb: complexPdb, potential: true }] : models

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {isVal && (
        <div className="flex items-start gap-3 rounded-xl px-3 py-2.5 ring-1"
          style={{ background: result.reproduced ? 'rgba(34,197,94,0.08)' : 'rgba(251,146,60,0.08)', borderColor: result.reproduced ? 'rgba(34,197,94,0.35)' : 'rgba(251,146,60,0.35)' }}>
          <span className="mt-0.5 text-[15px]">{result.reproduced ? '✓' : '≈'}</span>
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold text-white">
              {result.reproduced ? 'Reproduced — guest included in the cavity with a favourable interaction' : 'Partial — check the pose'}
            </div>
            <div className="mt-0.5 text-[11.5px] leading-snug text-slate-400">{result.expected}</div>
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2.5">
        <Kpi label={onGuestGuest ? 'Drug–drug ΔE' : 'Interaction energy'} value={dE != null ? dE.toFixed(1) : '—'}
          unit={ratio ? `kcal/mol · ${perGuest?.toFixed(1)}/guest` : `kcal/mol · ${solvent === 'water' ? 'implicit water' : 'gas phase'}`} />
        <Kpi label={ratio ? 'Stoichiometry (drug:carrier)' : 'Guest inside cavity'}
          value={ratio || (inside != null ? Math.round(inside * 100) + '%' : '—')}
          unit={ratio ? `${loaded.n_guest} drug · ${loaded.n_host} carrier` : (inside != null ? 'buried' : 'surface')} />
        <Kpi label="Contacts" value={prof ? (prof.counts.hbond + prof.counts.hydrophobic + prof.counts.pi) : '—'} unit="H-bond · vdW · π" />
      </div>
      {terms && <EnergyBreakdown terms={terms} solvent={solvent} method={method} />}
      {note && (
        <div className="rounded-lg px-3 py-2 text-[11.5px]" style={{ background: 'rgba(251,146,60,0.08)', color: '#fdba74' }}>{note}</div>
      )}

      {resultView === '2dint'
        ? (map2d
            ? <div className="min-h-0 flex-1 rounded-xl bg-ink-950/40 ring-1 ring-ink-700/60"><NanoInteractionMap2D guest={guestName} subtitle={mapSubtitle} interactions={map2d.contacts} structure2d={map2d.guest2d} caption={mapCaption} /></div>
            : <Interactions2D guestSmiles={guestSmiles} prof={prof} />)
        : resultView === 'coul'
          ? (
            <div className="relative min-h-0 flex-1 rounded-xl bg-ink-950/60 ring-1 ring-ink-700/60">
              <NanoViewer models={coulModels} coulomb={coulomb} spin={spin} exportName="coulombic" />
              <CoulombLegend onGuestGuest={onGuestGuest} />
            </div>
          )
          : (
          <div className="relative min-h-0 flex-1 rounded-xl bg-ink-950/60 ring-1 ring-ink-700/60">
            <NanoViewer models={models} spin={spin} surface={showCavitySurface} showInteractions={resultView === '3dint'} />
            <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-2 text-[10.5px]">
              <Legend color="#fb923c" label={onGuestGuest ? 'compound 1' : 'guest (drug)'} />
              {onGuestGuest ? <Legend color="#f0abfc" label="compound 2" /> : <Legend color="#67e8f9" label="carrier" />}
              {resultView === '3dint' && <><Legend color="#34d399" label="H-bond" /><Legend color="#fbbf24" label="hydrophobic" /></>}
            </div>
          </div>
        )}
    </div>
  )
}

// 2D interaction panel: guest structure(s) + the explicit contact list.
function Interactions2D({ guestSmiles, prof }) {
  const [svg, setSvg] = useState(null)
  const key = (guestSmiles || []).join('|')
  useEffect(() => {
    setSvg(null)
    if (!key) return
    let stop = false
    api.nanoDepict(guestSmiles, guestSmiles.map((_, i) => guestSmiles.length > 1 ? `Compound ${i + 1}` : 'Guest'))
      .then((d) => { if (!stop) setSvg(d.error ? null : d.svg) }).catch(() => {})
    return () => { stop = true }
  }, [key])
  const hb = prof?.hbond || [], hy = prof?.hydrophobic || [], pi = prof?.pi || []
  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
      <div className="min-h-0 overflow-auto rounded-xl bg-white/[0.03] p-2 ring-1 ring-ink-700/60">
        {svg ? <RawFigure svg={svg} name="DDS_nano_guest_2D" /> : <Msg spinner title="" sub="" />}
      </div>
      <div className="min-h-0 overflow-auto rounded-xl bg-ink-900/40 p-3 ring-1 ring-ink-700/60">
        <div className="mb-2 flex flex-wrap gap-1.5 text-[11px]">
          <Tag n={prof?.counts.hbond || 0} label="H-bonds" color="#34d399" />
          <Tag n={prof?.counts.hydrophobic || 0} label="hydrophobic" color="#fbbf24" />
          <Tag n={prof?.counts.pi || 0} label="π–π" color="#a78bfa" />
        </div>
        {(hb.length + hy.length + pi.length) === 0
          ? <div className="text-[12px] text-slate-500">No close contacts detected for this pose.</div>
          : (
            <div className="space-y-2.5 text-[11.5px]">
              {hb.length > 0 && <ContactList title="Hydrogen bonds" color="#34d399" rows={hb.map((c) => `guest ${c.guest_atom} · host ${c.host_atom} — ${c.distance} Å`)} />}
              {hy.length > 0 && <ContactList title="Hydrophobic contacts" color="#fbbf24" rows={hy.map((c) => `guest ${c.guest_atom} · host ${c.host_atom} — ${c.distance} Å`)} />}
              {pi.length > 0 && <ContactList title="π–π stacking" color="#a78bfa" rows={pi.map((c) => `ring centroids — ${c.distance} Å`)} />}
            </div>
          )}
      </div>
    </div>
  )
}
function ContactList({ title, color, rows }) {
  return (
    <div>
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide" style={{ color }}>{title}</div>
      <div className="space-y-0.5 font-mono text-slate-300">{rows.map((r, i) => <div key={i}>{r}</div>)}</div>
    </div>
  )
}

/* ================================ setup (right) ================================ */
function Setup(props) {
  const { step } = props
  if (step === 'compounds') return <CompoundSetup {...props} />
  if (step === 'carrier') return <CarrierSetup {...props} />
  if (step === 'result') return <ResultSetup {...props} />
  return null
}

function CompoundSetup({ smi, setSmi, addCompound, compounds, setCompounds, presets, loadPreset, vcases, loadValidationCase, running, compoundView, setCompoundView, identities = [] }) {
  return (
    <>
      <Panel title="Add a compound">
        <input value={smi} onChange={(e) => setSmi(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addCompound()}
          placeholder="Paste SMILES…"
          className="w-full rounded-lg bg-ink-950 px-3 py-2 font-mono text-[12px] text-slate-200 ring-1 ring-ink-600 focus:outline-none focus:ring-2"
          style={{ '--tw-ring-color': N }} />
        <button onClick={addCompound} disabled={!smi.trim() || compounds.length >= 3}
          className="mt-2 w-full rounded-lg px-3 py-2 text-[12.5px] font-semibold transition disabled:opacity-50"
          style={{ background: N, color: '#2a1503' }}>Add compound ({compounds.length}/3)</button>
        {compounds.length > 0 && (
          <>
            <div className="mt-3 flex gap-1.5">
              {[['2d', '2D'], ['3d', '3D']].map(([k, l]) => (
                <button key={k} onClick={() => setCompoundView(k)}
                  className="flex-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition"
                  style={compoundView === k ? { background: N, color: '#2a1503' } : { background: 'rgba(15,23,42,0.6)', color: '#94a3b8' }}>{l} view</button>
              ))}
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              {compounds.map((c, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-ink-900/50 px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11.5px] font-semibold text-slate-200">{legendFor(identities[i], i)}</div>
                    <div className="truncate font-mono text-[10px] text-slate-500">{c.smiles}</div>
                  </div>
                  <button onClick={() => setCompounds((cs) => cs.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-300">✕</button>
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>
      <Panel title="Presets">
        <div className="flex flex-col gap-1.5">
          {presets.map((p) => (
            <button key={p.label} onClick={() => loadPreset(p)}
              className="flex flex-col rounded-lg bg-ink-900/50 px-3 py-2 text-left ring-1 ring-ink-700/60 transition hover:bg-ink-800/60">
              <span className="text-[12.5px] font-semibold text-slate-200">{p.label}</span>
              <span className="text-[11px] text-slate-500">{p.hint}</span>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Validation / Benchmarking cases">
        <div className="flex flex-col gap-1.5">
          {vcases.map((v) => (
            <button key={v.id} onClick={() => loadValidationCase(v)}
              className="flex flex-col rounded-lg bg-ink-900/50 px-3 py-2 text-left ring-1 ring-ink-700/60 transition hover:bg-ink-800/60">
              <span className="text-[12px] font-semibold text-slate-200">{v.name}</span>
              <span className="text-[11px] text-slate-500">{v.guest} · {v.host}</span>
            </button>
          ))}
        </div>
      </Panel>
    </>
  )
}

const RATIOS = [
  ['1:1', 'One drug in one carrier — the default and most common inclusion complex.'],
  ['1:2', 'One drug capped by two carriers — for elongated guests bridging two hosts.'],
  ['2:1', 'Two drugs on one carrier — co-inclusion (large cavity) or surface loading.'],
]

function CarrierSetup({ carriers, carrier, setCarrier, compounds, ratio, setRatio, thoroughness, setThoroughness, solvent, setSolvent, methodText }) {
  return (
    <>
      {carrier && (
        <Panel title="Stoichiometry · drug : carrier">
          <div className="flex gap-1.5">
            {RATIOS.map(([k]) => (
              <button key={k} onClick={() => setRatio(k)}
                className="flex-1 rounded-lg px-3 py-1.5 text-[13px] font-bold transition"
                style={ratio === k ? { background: N, color: '#2a1503' } : { background: 'rgba(15,23,42,0.6)', color: '#94a3b8' }}>{k}</button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-slate-500">{RATIOS.find(([k]) => k === ratio)?.[1]}</p>
        </Panel>
      )}
      <Panel title="Solvent model">
        <div className="flex gap-1.5">
          {[['water', 'Implicit water'], ['gas', 'Gas phase']].map(([k, l]) => (
            <button key={k} onClick={() => setSolvent(k)}
              className="flex-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition"
              style={solvent === k ? { background: N, color: '#2a1503' } : { background: 'rgba(15,23,42,0.6)', color: '#94a3b8' }}>{l}</button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-slate-500">
          {solvent === 'water'
            ? 'Distance-dependent dielectric screening (ε=4·r) + a SASA hydrophobic term — a simple implicit-solvent correction (GB/SA-style).'
            : 'Unscreened gas-phase MMFF interaction energy (the raw force-field value).'}
        </p>
      </Panel>
      <Panel title="Search thoroughness">
        <div className="flex gap-1.5">
          {['quick', 'balanced', 'thorough'].map((k) => (
            <button key={k} onClick={() => setThoroughness(k)}
              className="flex-1 rounded-lg px-2 py-1.5 text-[11.5px] font-semibold capitalize transition"
              style={thoroughness === k ? { background: N, color: '#2a1503' } : { background: 'rgba(15,23,42,0.6)', color: '#94a3b8' }}>{k}</button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-slate-500">
          {methodText[thoroughness]} — scales the number of guest conformers and the random-restart + basin-hopping search budget. More thorough = slower but explores more of the landscape. Minimisation always runs to convergence.
        </p>
      </Panel>
      <Panel title="Choose a nanocarrier">
        <div className="flex flex-col gap-1.5">
          <button onClick={() => setCarrier(null)}
            className="flex flex-col rounded-lg px-3 py-2 text-left ring-1 transition"
            style={carrier === null ? { background: 'rgba(251,146,60,0.10)', boxShadow: 'inset 0 0 0 1.5px ' + N } : { background: 'rgba(15,23,42,0.5)' }}>
            <span className="text-[12.5px] font-semibold text-white">None — drug–drug only</span>
            <span className="text-[11px] text-slate-400">Model just the co-formulation{compounds.length < 2 ? ' (needs ≥2 compounds)' : ''}.</span>
          </button>
          {carriers.map((c) => {
            const sel = carrier === c.id
            return (
              <button key={c.id} onClick={() => setCarrier(c.id)}
                className="flex flex-col rounded-lg px-3 py-2 text-left ring-1 transition hover:bg-ink-800/60"
                style={sel ? { background: 'rgba(251,146,60,0.10)', boxShadow: 'inset 0 0 0 1.5px ' + N } : { background: 'rgba(15,23,42,0.5)' }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-white">{c.name}</span>
                  {c.cavity && <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: 'rgba(251,146,60,0.15)', color: '#fdba74' }}>CAVITY</span>}
                </div>
                <span className="text-[11px] text-slate-500">{c.type}</span>
              </button>
            )
          })}
        </div>
      </Panel>
    </>
  )
}

function ResultSetup({ result, view, setView, spin, setSpin, surface, setSurface, resultView, setResultView, carrierMeta, onReplay, hasTrajectory }) {
  const isVal = result?.kind === 'validation'
  const hasAssembly = !isVal && result?.assembly
  const hasLoaded = !isVal && result?.loaded
  const cavity = isVal || carrierMeta?.cavity
  const is3D = resultView !== '2dint'
  const hasCoulomb = !!(isVal ? result?.coulomb : (view === 'assembly' && hasAssembly ? result.assembly.coulomb : result?.loaded?.coulomb))
  const VIEW_TABS = [['3d', '3D structure'], ['3dint', '3D interactions'], ['2dint', '2D interactions'],
    ...(hasCoulomb ? [['coul', 'Coulombic map']] : [])]
  return (
    <>
      {hasTrajectory && (
        <button onClick={onReplay}
          className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold ring-1 transition"
          style={{ background: 'rgba(251,146,60,0.12)', color: '#fdba74', borderColor: 'rgba(251,146,60,0.4)' }}>
          <PlayIcon className="h-4 w-4" /> Replay formation
        </button>
      )}
      <Panel title="View">
        <div className="flex flex-col gap-1.5">
          {VIEW_TABS.map(([k, l]) => (
            <button key={k} onClick={() => setResultView(k)}
              className="rounded-lg px-3 py-1.5 text-left text-[12px] font-semibold transition"
              style={resultView === k ? { background: N, color: '#2a1503' } : { background: 'rgba(15,23,42,0.6)', color: '#94a3b8' }}>{l}</button>
          ))}
        </div>
      </Panel>
      {hasAssembly && hasLoaded && is3D && (
        <Panel title="Structure">
          <div className="flex gap-1.5">
            {[['loaded', 'On carrier'], ['assembly', 'Drug–drug']].map(([k, l]) => (
              <button key={k} onClick={() => setView(k)}
                className="flex-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition"
                style={view === k ? { background: N, color: '#2a1503' } : { background: 'rgba(15,23,42,0.6)', color: '#94a3b8' }}>{l}</button>
            ))}
          </div>
        </Panel>
      )}
      {is3D && (
        <Panel title="Display">
          <Toggle label="Spin" on={spin} onChange={setSpin} />
          {cavity && view !== 'assembly' && <Toggle label="Cavity surface" on={surface} onChange={setSurface} />}
          <p className="mt-1.5 text-[10.5px] leading-snug text-slate-500">Use the <b>Export PNG</b> button on the viewer for images; the top-bar <b>Export</b> menu saves structures (PDB) and a report.</p>
        </Panel>
      )}
      <Panel title="Notes">
        <p className="text-[11px] leading-snug text-slate-500">
          The MMFF94 interaction energy is reported under the selected solvent model (implicit water or gas phase). Whole
          liposomes and nanoparticles are represented by a fragment model. See the Documentation for interpretation and
          validation.
        </p>
      </Panel>
    </>
  )
}

/* ================================ export menu ================================ */
function ExportMenu({ result, carrierMeta }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  const isVal = result.kind === 'validation'
  const src = isVal ? result : (result.loaded || {})
  const complexPdb = src.complex_pdb, carrierPdbStr = src.carrier_pdb, guestPdb = src.guest_pdb
  const asmPdb = !isVal ? result.assembly?.pdb : null
  const items = [
    complexPdb && ['Complex (PDB)', () => saveFile('DDS_nano_complex.pdb', complexPdb, 'chemical/x-pdb')],
    carrierPdbStr && ['Carrier (PDB)', () => saveFile('DDS_nano_carrier.pdb', carrierPdbStr, 'chemical/x-pdb')],
    guestPdb && ['Guest (PDB)', () => saveFile('DDS_nano_guest.pdb', guestPdb, 'chemical/x-pdb')],
    asmPdb && ['Assembly (PDB)', () => saveFile('DDS_nano_assembly.pdb', asmPdb, 'chemical/x-pdb')],
    ['Report (HTML / print)', () => exportReport(result, carrierMeta)],
  ].filter(Boolean)
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold ring-1 transition"
        style={{ background: 'rgba(251,146,60,0.15)', color: '#fdba74', borderColor: 'rgba(251,146,60,0.4)' }}>
        <ExportIcon className="h-4 w-4" /> Export ▾
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg bg-ink-900 py-1 text-[12px] shadow-xl ring-1 ring-ink-600">
          {items.map(([l, fn]) => (
            <button key={l} onClick={() => { fn(); setOpen(false) }} className="block w-full px-3 py-1.5 text-left text-slate-300 hover:bg-ink-800 hover:text-white">{l}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function exportReport(result, carrierMeta) {
  const html = buildNanoReport(result, carrierMeta)
  const w = window.open('', '_blank')
  if (!w) { saveFile('DDS_nano_report.html', html, 'text/html;charset=utf-8'); return }
  w.document.write(html); w.document.close()
  setTimeout(() => { try { w.focus(); w.print() } catch { /* manual */ } }, 400)
}

function buildNanoReport(result, carrierMeta) {
  const isVal = result.kind === 'validation'
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const src = isVal ? result : (result.loaded || {})
  const asm = !isVal ? result.assembly : null
  const prof = isVal ? result.interactions : (result.loaded?.interactions || null)
  const inside = isVal ? result.inside_fraction : result.loaded?.inside_fraction
  const carrierName = isVal ? result.host : (result.carrier?.name || (carrierMeta && carrierMeta.name) || '—')
  const dE = isVal ? result.interaction_energy : result.loaded?.interaction_energy
  const ratio = !isVal ? result.loaded?.ratio : '1:1'
  const perGuest = !isVal ? result.loaded?.interaction_energy_per_guest : null
  const note = !isVal ? result.loaded?.note : null
  const compounds = isVal ? [result.guest_smiles] : (result.compounds || [])
  const terms = isVal ? result.energy_terms : result.loaded?.energy_terms
  const method = isVal ? result.method : result.loaded?.method
  const solvent = result.solvent === 'gas' ? 'Gas phase' : 'Implicit water'
  const termRows = terms ? [['van der Waals', terms.vdw], ['Electrostatic', terms.electrostatic], ['Non-polar (hydrophobic)', terms.nonpolar], ['Gas-phase interaction', terms.gas_phase], ['Implicit-water interaction', terms.implicit_water], ['Solvation energy', terms.solvation]]
    .map(([k, v]) => `<tr><th>${k}</th><td>${v} kcal/mol</td></tr>`).join('') : ''
  const methodRows = method ? [['Conformer engine', method.conformer_engine], ['Conformers', method.conformers], ['Search method', method.search_method], ['Random-restart seeds / conformer', method.scan_seeds_per_conformer], ['Refinement', method.refined_seeds != null ? `${method.refined_seeds} seeds × ${method.mc_steps_per_refined_seed} Monte-Carlo steps` : null], ['Force field', method.force_field], ['Minimisation', method.minimization], ['Pose selection', method.selection], ['Solvent model', method.solvent_model], ['Thoroughness', method.thoroughness]]
    .filter(([, v]) => v != null)
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('') : ''
  const contactRows = (arr, kind) => (arr || []).map((c) => `<tr><td>${kind}</td><td>${esc(c.guest_atom || 'ring')}</td><td>${esc(c.host_atom || 'ring')}</td><td>${esc(c.distance)}</td></tr>`).join('')
  const rows = prof ? contactRows(prof.hbond, 'H-bond') + contactRows(prof.hydrophobic, 'Hydrophobic') + contactRows(prof.pi, 'π–π') : ''
  return `<!doctype html><html><head><meta charset="utf-8"><title>DDS Nano report</title>
<style>
  body{font:13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;max-width:820px;margin:32px auto;padding:0 24px}
  h1{font-size:20px;margin:0 0 2px} h2{font-size:14px;margin:22px 0 8px;color:#c2410c;border-bottom:1px solid #fed7aa;padding-bottom:4px}
  .sub{color:#64748b;margin:0 0 16px} table{border-collapse:collapse;width:100%;font-size:12px} th,td{border:1px solid #e2e8f0;padding:5px 8px;text-align:left}
  th{background:#fff7ed} .kpi{display:inline-block;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;margin:0 8px 8px 0}
  .kpi b{display:block;font-size:18px} code{background:#f1f5f9;padding:1px 5px;border-radius:4px;font-size:11px}
  .note{background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px 12px;color:#7c2d12;font-size:12px;margin-top:18px}
  @media print{body{margin:0}}
</style></head><body>
<h1>Drug Design Studio (DDS) 4.0 — Nano Bio-Pharmaceutical Modelling</h1>
<p class="sub">${isVal ? 'Validation case: ' + esc(result.name) : 'Co-formulation &amp; nanocarrier loading report'}</p>
<h2>Summary</h2>
<div>
  <span class="kpi"><b>${dE != null ? Number(dE).toFixed(1) : '—'}</b>Interaction energy (kcal/mol)</span>
  <span class="kpi"><b>${inside != null ? Math.round(inside * 100) + '%' : '—'}</b>Guest inside cavity</span>
  <span class="kpi"><b>${prof ? prof.counts.hbond + prof.counts.hydrophobic + prof.counts.pi : '—'}</b>Contacts (H-bond·vdW·π)</span>
</div>
<h2>System</h2>
<table><tbody>
  <tr><th>Compound(s)</th><td>${compounds.map((s) => `<code>${esc(s)}</code>`).join(' &nbsp; ') || '—'}</td></tr>
  <tr><th>Carrier</th><td>${esc(carrierName)}</td></tr>
  <tr><th>Solvent model</th><td>${esc(solvent)}</td></tr>
  ${ratio ? `<tr><th>Stoichiometry (drug:carrier)</th><td>${esc(ratio)}</td></tr>` : ''}
  ${perGuest != null && ratio && ratio !== '1:1' ? `<tr><th>Interaction energy per guest</th><td>${Number(perGuest).toFixed(1)} kcal/mol</td></tr>` : ''}
  ${asm ? `<tr><th>Drug–drug assembly ΔE</th><td>${Number(asm.interaction_energy).toFixed(1)} kcal/mol</td></tr>` : ''}
  ${isVal ? `<tr><th>Reproduced</th><td>${result.reproduced ? 'Yes — guest included with a favourable interaction' : 'Partial'}</td></tr>` : ''}
  ${note ? `<tr><th>Note</th><td>${esc(note)}</td></tr>` : ''}
</tbody></table>
${termRows ? `<h2>Energy decomposition</h2><table><tbody>${termRows}</tbody></table>` : ''}
${methodRows ? `<h2>Method &amp; parameters</h2><table><tbody>${methodRows}</tbody></table>` : ''}
${rows ? `<h2>Interaction profile</h2><table><thead><tr><th>Type</th><th>Guest atom</th><th>Host atom</th><th>Distance (Å)</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
<div class="note"><b>Method &amp; scope.</b> 3D structures were generated by distance-geometry embedding, the geometry of association located by a deterministic global search (a geometry-aware random-restart scan refined by basin-hopping / Monte-Carlo minimisation), and each assembly minimised with the MMFF94 force field including inter-fragment non-bonded terms. The reported interaction energy is a molecular-mechanics value under the selected solvent model (${solvent}; the implicit-water option adds distance-dependent dielectric screening, ε=4r, plus a SASA non-polar term) — a reproducible, physics-based score that ranks and correlates with binding affinity (validated against experimental cyclodextrin binding data), rather than an absolute binding free energy or a loading capacity. Whole liposomes/nanoparticles are represented by a single representative fragment.</div>
<h2>Computational methods&nbsp;<span style="color:#b45309">*</span></h2>
<p>Drug Design Studio (DDS) 4.0<sup>1&ndash;4</sup> was used to build the drug&ndash;nanocarrier / drug&ndash;drug model, assemble the nanocomplex, set the search, stoichiometry and solvent parameters, and perform the interaction-energy computations and analyses reported here. Guest conformers were generated by distance-geometry embedding and force-field optimisation; the most favourable geometry of association with the carrier was located by a deterministic global search — a geometry-aware random-restart scan refined by basin-hopping (Monte-Carlo) minimisation; every pose was energy-minimised with a molecular-mechanics force field retaining inter-fragment non-bonded terms; and the interaction energy was evaluated under the selected ${esc(solvent.toLowerCase())} model and decomposed into van der Waals, electrostatic and non-polar contributions.</p>
<p style="font-size:11px;color:#64748b"><b>*</b> This computational-methods section is provided as a guidance template only; please rewrite and adapt it in your own words for your manuscript.</p>
<h2>References</h2>
<ol style="font-size:11px;line-height:1.6;color:#475569;padding-left:18px;margin-top:6px">
  <li>Mahmoud E. Soliman. Drug Design Studio (DDS): An all-in-one cross-platform for covalent/non-covalent docking, covalent binders virtual screening and protein&ndash;ligand interaction analysis. <i>(Under review).</i></li>
  <li>Mahmoud E. Soliman. Drug Design Suite (DDS) 2.0: A Unified Platform for Network Pharmacology Integrated with Docking and Virtual Screening Workflow for Covalent/Non-Covalent Binders. <i>(Under review).</i></li>
  <li>Mahmoud E. Soliman. Drug Design Studio (DDS) 3.0: A Streamlined QSAR, 3D-QSAR and Pharmacophore Modelling Platform Coupling Ligand-Based Activity Prediction to Covalent and Non-Covalent Structure-Based Discovery. <i>(Under review).</i></li>
  <li>Mahmoud E. Soliman. Drug Design Studio (DDS) 4.0: A Nanopharmaceutical Simulation Platform for Automated Modelling of Drug&ndash;Nanocarrier Encapsulation and Drug&ndash;Drug Complexation. <i>(Under review).</i></li>
</ol>
</body></html>`
}

/* ================================ small components ================================ */
function Panel({ title, children }) {
  return (
    <div className="rounded-2xl bg-ink-900/40 p-3.5 ring-1 ring-ink-700/50">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</div>
      {children}
    </div>
  )
}
function Kpi({ label, value, unit }) {
  return (
    <div className="rounded-xl bg-ink-900/50 px-3 py-2.5 ring-1 ring-ink-700/60">
      <div className="text-[10.5px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 font-mono text-[19px] font-bold leading-none text-white">{value}</div>
      <div className="mt-1 text-[10px] text-slate-500">{unit}</div>
    </div>
  )
}
function Tag({ n, label, color }) {
  return <span className="rounded-md px-2 py-0.5 font-semibold" style={{ background: color + '22', color }}>{n} {label}</span>
}
// energy decomposition strip + a Method popover with the exact protocol/parameters
function EnergyBreakdown({ terms, solvent, method }) {
  const [open, setOpen] = useState(false)
  const chips = solvent === 'water'
    ? [['van der Waals', terms.vdw], ['electrostatic', terms.electrostatic], ['non-polar (hydrophobic)', terms.nonpolar], ['solvation', terms.solvation]]
    : [['van der Waals', terms.vdw], ['electrostatic', terms.electrostatic], ['gas-phase total', terms.gas_phase]]
  return (
    <div className="relative flex flex-wrap items-center gap-1.5 rounded-lg bg-ink-900/40 px-2.5 py-2 ring-1 ring-ink-700/50 text-[11px]">
      <span className="mr-1 font-semibold uppercase tracking-wide text-slate-500">Energy terms</span>
      {chips.map(([l, v]) => (
        <span key={l} className="rounded-md bg-ink-800/70 px-2 py-0.5">
          <span className="text-slate-400">{l} </span><span className="font-mono font-semibold" style={{ color: v <= 0 ? '#6ee7b7' : '#fca5a5' }}>{v > 0 ? '+' : ''}{v}</span>
        </span>
      ))}
      <span className="text-slate-500">kcal/mol</span>
      {method && (
        <button onClick={() => setOpen((o) => !o)} className="ml-auto rounded-md px-2 py-0.5 font-semibold ring-1 transition"
          style={{ color: '#fdba74', borderColor: 'rgba(251,146,60,0.4)', background: 'rgba(251,146,60,0.1)' }}>Method ▾</button>
      )}
      {open && method && (
        <div className="absolute right-0 top-full z-20 mt-1 w-[320px] rounded-lg bg-ink-900 p-3 text-[11px] leading-relaxed shadow-xl ring-1 ring-ink-600">
          <div className="mb-1.5 text-[12px] font-semibold text-white">Method &amp; parameters</div>
          {[['Conformer engine', method.conformer_engine], ['Conformers', method.conformers],
            ['Search method', method.search_method], ['Random-restart seeds / conformer', method.scan_seeds_per_conformer],
            ['Refinement', method.refined_seeds != null ? `${method.refined_seeds} seeds × ${method.mc_steps_per_refined_seed} MC steps` : null],
            ['Force field', method.force_field], ['Minimisation', method.minimization],
            ['Pose selection', method.selection], ['Solvent model', method.solvent_model],
            ['Thoroughness', method.thoroughness]].filter(([, v]) => v != null).map(([k, v]) => (
            <div key={k} className="flex gap-2 border-t border-ink-700/50 py-1 first:border-t-0">
              <span className="w-[38%] shrink-0 text-slate-500">{k}</span><span className="text-slate-300">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
function Legend({ color, label }) {
  return (
    <span className="flex items-center gap-1 rounded bg-ink-950/70 px-1.5 py-0.5 text-slate-300">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} /> {label}
    </span>
  )
}

// Overlay for the Coulombic potential map: the red→white→blue scale bar plus the
// host/guest backbone key. Kept scientifically explicit — classical, not QM.
function CoulombLegend({ onGuestGuest }) {
  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-2 flex flex-col gap-1.5 text-[10.5px]">
      <div className="flex items-center gap-2">
        <Legend color="#fb923c" label={onGuestGuest ? 'compound 1' : 'guest (drug)'} />
        {onGuestGuest ? <Legend color="#f0abfc" label="compound 2" /> : <Legend color="#67e8f9" label="carrier" />}
      </div>
      <div className="flex items-center gap-2 rounded bg-ink-950/75 px-2 py-1 text-slate-300 ring-1 ring-ink-700/60" style={{ maxWidth: 'fit-content' }}>
        <span>− (electron-rich)</span>
        <span className="h-2 w-24 rounded-full" style={{ background: 'linear-gradient(90deg,#e0202f,#f5f5f5,#2060e0)' }} />
        <span>+ (electron-poor)</span>
        <span className="ml-1 text-slate-500">Coulombic potential · MMFF94 charges · ε = 4r</span>
      </div>
    </div>
  )
}
function Toggle({ label, on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-[12.5px] text-slate-300">
      <span>{label}</span>
      <span className="relative h-5 w-9 rounded-full transition" style={{ background: on ? N : '#334155' }}>
        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: on ? '18px' : '2px' }} />
      </span>
    </button>
  )
}
function Msg({ title, sub, spinner }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      {spinner && <Spinner big />}
      {title && <h2 className="mt-4 text-[17px] font-semibold text-white">{title}</h2>}
      {sub && <p className="mt-2 max-w-md text-[13px] leading-relaxed text-slate-400">{sub}</p>}
    </div>
  )
}
function Spinner({ big }) {
  return <svg className={`animate-spin ${big ? 'h-8 w-8' : 'h-4 w-4'}`} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke={N} strokeWidth="2.5" strokeOpacity="0.25" /><path d="M12 3a9 9 0 019 9" stroke={N} strokeWidth="2.5" strokeLinecap="round" /></svg>
}

/* ================================ icons ================================ */
function I(props, path) {
  const { color, ...rest } = props
  return <svg viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...rest}>{path}</svg>
}
function FlaskIcon(p) { return I(p, <><path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3" /><path d="M7.5 15h9" /></>) }
function CarrierIcon(p) { return I(p, <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.2" /></>) }
function ViewIcon(p) { return I(p, <><circle cx="12" cy="12" r="2.5" /><path d="M12 4.5c-4.5 0-7.5 3.5-8.5 7.5C4.5 16 7.5 19.5 12 19.5s7.5-3.5 8.5-7.5C19.5 8 16.5 4.5 12 4.5z" /></>) }
function BookIcon(p) { return I(p, <><path d="M4 5.5A1.5 1.5 0 015.5 4H18v15H5.5A1.5 1.5 0 004 20.5z" /><path d="M18 4v15" /></>) }
function QuoteIcon(p) { return I(p, <><path d="M7 7h4v4c0 2.5-1.5 4-4 4M13 7h4v4c0 2.5-1.5 4-4 4" /></>) }
function NewIcon(p) { return I(p, <><path d="M12 5v14M5 12h14" /></>) }
function GridIcon(p) { return I(p, <><rect x="4" y="4" width="6" height="6" rx="1.2" /><rect x="14" y="4" width="6" height="6" rx="1.2" /><rect x="4" y="14" width="6" height="6" rx="1.2" /><rect x="14" y="14" width="6" height="6" rx="1.2" /></>) }
function GlobeIcon(p) { return I(p, <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.5 2.5 14.5 0 17M12 3.5c-2.5 2.5-2.5 14.5 0 17" /></>) }
function PlayIcon(p) { return I(p, <path d="M7 5l12 7-12 7z" />) }
function ExportIcon(p) { return I(p, <><path d="M12 15V3M8 7l4-4 4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></>) }
