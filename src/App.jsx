import { useState, useMemo, useEffect, useRef } from 'react'
import MoleculeViewer from './components/MoleculeViewer.jsx'
import InteractionMap2D from './components/InteractionMap2D.jsx'
import ExportModal from './components/ExportModal.jsx'
import Ligand2D from './components/Ligand2D.jsx'
import AgreementGate, { AGREEMENT_VERSION } from './components/Agreement.jsx'
import { LIBRARY, ScreeningLibraryPanel, LibraryCenter, ScreeningResults } from './components/VirtualScreening.jsx'
import * as api from './api.js'
import Logo from './components/Logo.jsx'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
  ScatterChart, Scatter, ZAxis, CartesianGrid,
} from 'recharts'

/* ------------------------------------------------------------------ */
/*  Mock data — stands in for real Vina output until the engine is wired */
/* ------------------------------------------------------------------ */
const POSES = [
  { pose: 1, affinity: -9.8, rmsd_lb: 0.0, rmsd_ub: 0.0, efficiency: -0.42 },
  { pose: 2, affinity: -9.2, rmsd_lb: 1.9, rmsd_ub: 2.7, efficiency: -0.39 },
  { pose: 3, affinity: -8.9, rmsd_lb: 2.1, rmsd_ub: 3.4, efficiency: -0.38 },
  { pose: 4, affinity: -8.4, rmsd_lb: 2.8, rmsd_ub: 4.1, efficiency: -0.36 },
  { pose: 5, affinity: -8.1, rmsd_lb: 3.2, rmsd_ub: 5.0, efficiency: -0.34 },
  { pose: 6, affinity: -7.7, rmsd_lb: 3.9, rmsd_ub: 6.2, efficiency: -0.33 },
  { pose: 7, affinity: -7.3, rmsd_lb: 4.4, rmsd_ub: 7.1, efficiency: -0.31 },
  { pose: 8, affinity: -6.9, rmsd_lb: 5.1, rmsd_ub: 8.0, efficiency: -0.29 },
]

const INTERACTIONS = [
  { residue: 'ASP25', type: 'H-bond', distance: 2.8 },
  { residue: 'ASP29', type: 'H-bond', distance: 3.1 },
  { residue: 'ILE50', type: 'Hydrophobic', distance: 3.8 },
  { residue: 'GLY27', type: 'H-bond', distance: 3.0 },
  { residue: 'ILE84', type: 'Hydrophobic', distance: 4.0 },
  { residue: 'ARG8', type: 'Salt bridge', distance: 3.4 },
  { residue: 'PHE53', type: 'π-stacking', distance: 4.2 },
]

const SCREEN = [
  { name: 'Ligand-042', affinity: -9.8, mw: 421, logp: 2.9, qed: 0.81 },
  { name: 'Ligand-118', affinity: -9.5, mw: 389, logp: 3.4, qed: 0.74 },
  { name: 'Ligand-007', affinity: -9.1, mw: 452, logp: 2.1, qed: 0.69 },
  { name: 'Ligand-233', affinity: -8.7, mw: 366, logp: 3.9, qed: 0.66 },
  { name: 'Ligand-091', affinity: -8.3, mw: 478, logp: 4.6, qed: 0.52 },
]

const STEPS_SINGLE = [
  { id: 'receptor', label: 'Receptor', icon: ProteinIcon, hint: 'Load & prepare protein' },
  { id: 'ligands', label: 'Ligand', icon: FlaskIcon, hint: 'Import & prep compound' },
  { id: 'site', label: 'Binding Site', icon: BoxIcon, hint: 'Define search grid' },
  { id: 'dock', label: 'Dock', icon: PlayIcon, hint: 'Run AutoDock Vina' },
  { id: 'results', label: 'Results', icon: ChartIcon, hint: 'Analyze & visualize' },
]

const STEPS_SCREEN = [
  { id: 'receptor', label: 'Target', icon: ProteinIcon, hint: 'Load & prepare protein' },
  { id: 'ligands', label: 'Library', icon: FlaskIcon, hint: 'Load SMILES library' },
  { id: 'site', label: 'Binding Site', icon: BoxIcon, hint: 'Define search grid' },
  { id: 'dock', label: 'Screen', icon: PlayIcon, hint: 'Batch-dock all ligands' },
  { id: 'results', label: 'Rankings', icon: ChartIcon, hint: 'Rank hits by affinity' },
]

const INT_COLORS = { 'H-bond': '#2dd4bf', 'Hydrophobic': '#fbbf24', 'Salt bridge': '#a78bfa', 'π-stacking': '#f472b6' }

const DEFAULT_SMILES = 'CC(C)Cc1ccc(cc1)C(C)C(=O)Nc1ncccn1'

export default function App() {
  const [agreed, setAgreed] = useState(() => { try { return localStorage.getItem('dds_agreed') === AGREEMENT_VERSION } catch { return false } })
  const [aiOpen, setAiOpen] = useState(true) // AI Insights open by default; user can close per session
  const [mode, setMode] = useState('single') // 'single' | 'screen'
  const [active, setActive] = useState('receptor')
  const [viewStyle, setViewStyle] = useState('cartoon')
  const [showLigand, setShowLigand] = useState(true)
  const [spin, setSpin] = useState(false)
  const [showInter, setShowInter] = useState(false)
  const [exhaustiveness, setExhaustiveness] = useState(16)
  const [scoring, setScoring] = useState('vina')
  const [running, setRunning] = useState(false)
  const [hasResults, setHasResults] = useState(false)

  // real engine state
  const [engine, setEngine] = useState('checking')  // checking | online | offline
  const [receptor, setReceptor] = useState(null)     // prepared-receptor metadata from the engine
  const [box, setBox] = useState(null)               // {center:{x,y,z}, size:{x,y,z}}
  const [ligandSmiles, setLigandSmiles] = useState(DEFAULT_SMILES)
  const [ligandFile, setLigandFile] = useState(null) // {text, fmt, name}
  const [protonate, setProtonate] = useState(true)
  const [keepWaters, setKeepWaters] = useState(false)
  const [keepIons, setKeepIons] = useState(false)
  const [screenSmiles, setScreenSmiles] = useState(LIBRARY.slice(0, 8).map((l) => `${l.smiles}  ${l.id}`).join('\n'))
  const [busy, setBusy] = useState('')               // '' | 'receptor'
  const [errorMsg, setErrorMsg] = useState('')
  const [dockRes, setDockRes] = useState(null)
  const [screenRes, setScreenRes] = useState(null)
  const [cleared, setCleared] = useState(false)
  const [ligRemoved, setLigRemoved] = useState(false) // hide co-crystal ligand from workspace (box stays put)
  const [receptorSrc, setReceptorSrc] = useState(null) // {kind:'id',id} | {kind:'file',file} — for live re-prep on waters/ions toggle
  const [ligPreview, setLigPreview] = useState({ status: 'idle', data: null, msg: '' }) // live 2D+3D ligand preview

  // background jobs
  const [jobs, setJobs] = useState([])
  const [jobsOpen, setJobsOpen] = useState(false)
  const [activeJobId, setActiveJobId] = useState(() => { try { return localStorage.getItem('dds_active_job') || null } catch { return null } })
  const activeRef = useRef(activeJobId)
  function setActiveJob(id) {
    activeRef.current = id
    setActiveJobId(id)
    try { id ? localStorage.setItem('dds_active_job', id) : localStorage.removeItem('dds_active_job') } catch {}
  }

  useEffect(() => {
    let ok = true
    api.health().then(() => ok && setEngine('online')).catch(() => ok && setEngine('offline'))
    if (activeRef.current) setRunning(true)
    return () => { ok = false }
  }, [])

  // poll the engine for job status/results — survives refresh & navigation
  useEffect(() => {
    if (engine !== 'online') return
    let stop = false
    async function tick() {
      try {
        const { jobs: list } = await api.listJobs()
        if (stop) return
        setJobs(list)
        const cur = activeRef.current
        if (cur) {
          const aj = list.find((j) => j.job_id === cur)
          if (aj && aj.status !== 'running') {
            setActiveJob(null)
            const full = await api.getJob(cur)
            if (full.status === 'done') {
              if (full.kind === 'dock') { setDockRes(full.result); setMode('single') }
              else { setScreenRes(full.result); setMode('screen') }
              setHasResults(true); setActive('results')
            } else if (full.status === 'error') {
              setErrorMsg(full.error || 'Job failed.')
            }
            setRunning(false)
          }
        }
      } catch { /* engine hiccup — keep polling */ }
    }
    tick()
    const t = setInterval(tick, 2500)
    return () => { stop = true; clearInterval(t) }
  }, [engine])

  // live ligand preview (2D depiction + 3D conformer) whenever the SMILES/file changes
  useEffect(() => {
    const hasInput = !!ligandFile || !!(ligandSmiles && ligandSmiles.trim())
    if (!hasInput) { setLigPreview({ status: 'idle', data: null, msg: '' }); return }
    let cancelled = false
    setLigPreview((p) => ({ ...p, status: 'loading' }))
    const t = setTimeout(async () => {
      try {
        const payload = ligandFile ? { ligand_text: ligandFile.text, ligand_fmt: ligandFile.fmt } : { smiles: ligandSmiles.trim() }
        const r = await api.previewLigand(payload)
        if (cancelled) return
        setLigPreview({ status: 'ok', data: r, msg: '' })
      } catch (e) {
        if (cancelled) return
        const off = String(e?.message || e) === 'ENGINE_OFFLINE'
        setLigPreview({ status: 'error', data: null, msg: off ? 'Engine offline — preview unavailable.' : 'Could not parse this structure.' })
      }
    }, 350)
    return () => { cancelled = true; clearTimeout(t) }
  }, [ligandSmiles, ligandFile])

  const activeJob = jobs.find((j) => j.job_id === activeJobId) || null

  async function openJob(summary) {
    if (summary.status !== 'done') return
    const full = await api.getJob(summary.job_id)
    if (full.kind === 'dock') { setDockRes(full.result); setMode('single') }
    else { setScreenRes(full.result); setMode('screen') }
    setHasResults(true); setActive('results'); setJobsOpen(false)
  }
  async function removeJob(id) {
    await api.deleteJob(id).catch(() => {})
    setJobs((js) => js.filter((j) => j.job_id !== id))
    if (activeRef.current === id) { setActiveJob(null); setRunning(false) }
  }

  const isScreen = mode === 'screen'
  const steps = isScreen ? STEPS_SCREEN : STEPS_SINGLE
  const bestAffinity = isScreen ? screenRes?.results?.[0]?.affinity : dockRes?.best_affinity

  function switchMode(m) {
    setMode(m); setActive('receptor'); setHasResults(false); setRunning(false)
    setDockRes(null); setScreenRes(null); setErrorMsg('')
  }

  async function loadReceptorById(pdbId) {
    setBusy('receptor'); setErrorMsg('')
    try {
      const r = await api.fetchReceptor(pdbId, { keepWaters, keepIons })
      setReceptor({ ...r, name: pdbId.toUpperCase() })
      setReceptorSrc({ kind: 'id', id: pdbId })
      setBox({ center: { ...r.center }, size: { ...r.box } })
      if (r.native_ligand_smiles) { setLigandSmiles(r.native_ligand_smiles); setLigandFile(null) }
      setCleared(false); setLigRemoved(false)
    } catch (e) { setErrorMsg(engErr(e)) } finally { setBusy('') }
  }
  async function loadReceptorFile(file) {
    setBusy('receptor'); setErrorMsg('')
    try {
      const r = await api.uploadReceptor(file, { keepWaters, keepIons })
      setReceptor({ ...r, name: file.name })
      setReceptorSrc({ kind: 'file', file })
      setBox({ center: { ...r.center }, size: { ...r.box } })
      if (r.native_ligand_smiles) { setLigandSmiles(r.native_ligand_smiles); setLigandFile(null) }
      setCleared(false); setLigRemoved(false)
    } catch (e) { setErrorMsg(engErr(e)) } finally { setBusy('') }
  }
  function clearReceptor() {
    setReceptor(null); setBox(null); setDockRes(null); setScreenRes(null)
    setHasResults(false); setCleared(true); setActive('receptor'); setErrorMsg(''); setLigRemoved(false)
    setReceptorSrc(null)
  }

  // re-prepare the already-loaded receptor with new waters/ions flags, keeping the current grid box
  async function reprepareReceptor(kw, ki) {
    if (!receptorSrc) return
    setBusy('receptor'); setErrorMsg('')
    try {
      const r = receptorSrc.kind === 'id'
        ? await api.fetchReceptor(receptorSrc.id, { keepWaters: kw, keepIons: ki })
        : await api.uploadReceptor(receptorSrc.file, { keepWaters: kw, keepIons: ki })
      setReceptor({ ...r, name: receptorSrc.kind === 'id' ? receptorSrc.id.toUpperCase() : receptorSrc.file.name })
      setBox((prev) => prev || { center: { ...r.center }, size: { ...r.box } }) // preserve user's box
    } catch (e) { setErrorMsg(engErr(e)) } finally { setBusy('') }
  }
  function toggleKeepWaters() {
    const next = !keepWaters
    setKeepWaters(next)
    if (receptorSrc) reprepareReceptor(next, keepIons)
  }
  function toggleKeepIons() {
    const next = !keepIons
    setKeepIons(next)
    if (receptorSrc) reprepareReceptor(keepWaters, next)
  }

  async function runDocking() {
    setErrorMsg('')
    if (engine !== 'online') { setErrorMsg('Engine offline — start the DDS engine (see banner).'); return }
    if (!receptor || !box) { setErrorMsg('Prepare a receptor first.'); setActive('receptor'); return }
    if (isScreen) return runScreening()
    if (!ligandFile && !ligandSmiles.trim()) { setErrorMsg('Provide a ligand (SMILES or file).'); setActive('ligands'); return }
    setRunning(true)
    try {
      const lig = ligandFile ? { ligand_text: ligandFile.text, ligand_fmt: ligandFile.fmt } : { smiles: ligandSmiles.trim() }
      const { job_id } = await api.dock({
        receptor_id: receptor.receptor_id, ...lig, protonate, ph: 7.4,
        center: box.center, size: box.size, scoring, exhaustiveness, num_modes: 9,
        label: `${receptor.name} · docking`,
      })
      setActiveJob(job_id)
    } catch (e) { setErrorMsg(engErr(e)); setRunning(false) }
  }

  function clearLigand() { setLigandSmiles(''); setLigandFile(null) }

  async function runScreening() {
    const ligs = parseSmilesLibrary(screenSmiles)
    if (!ligs.length) { setErrorMsg('Add at least one SMILES to the library.'); setActive('ligands'); return }
    setRunning(true)
    try {
      const { job_id } = await api.screen({
        receptor_id: receptor.receptor_id, ligands: ligs,
        center: box.center, size: box.size, scoring, exhaustiveness: Math.min(exhaustiveness, 8),
        label: `${receptor.name} · screen ${ligs.length}`,
      })
      setActiveJob(job_id)
    } catch (e) { setErrorMsg(engErr(e)); setRunning(false) }
  }

  if (!agreed) {
    return <AgreementGate onAgree={() => {
      try { localStorage.setItem('dds_agreed', AGREEMENT_VERSION) } catch { /* ignore */ }
      setAgreed(true)
    }} />
  }

  return (
    <div className="flex h-full w-full bg-ink-950 text-slate-200">
      <Sidebar active={active} setActive={setActive} hasResults={hasResults}
        steps={steps} mode={mode} switchMode={switchMode} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onRun={runDocking} running={running} isScreen={isScreen}
          bestAffinity={hasResults ? bestAffinity : null} receptorName={receptor?.name}
          ligandCount={isScreen ? parseSmilesLibrary(screenSmiles).length : 1} scoring={scoring}
          activeJob={activeJob} runningCount={jobs.filter((j) => j.status === 'running').length}
          onOpenJobs={() => setJobsOpen(true)} />

        {engine === 'offline' && <EngineBanner />}
        {errorMsg && <ErrorBar msg={errorMsg} onClose={() => setErrorMsg('')} />}

        <main className="flex min-h-0 flex-1 gap-4 p-4">
          {active === 'results' && hasResults ? (
            <>
              {isScreen ? <ScreeningResults result={screenRes} receptor={receptor} box={box} scoring={scoring} />
                : <ResultsView result={dockRes} receptorName={receptor?.name} />}
              {aiOpen ? (
                <aside className="flex w-[340px] shrink-0 flex-col gap-4">
                  <AiPanel active="results" mode={mode} receptor={receptor} box={box}
                    ligProps={dockRes?.properties} ligandSmiles={ligandSmiles} dockRes={dockRes} screenRes={screenRes}
                    onClose={() => setAiOpen(false)} />
                </aside>
              ) : (
                <button onClick={() => setAiOpen(true)}
                  title="Show AI Insights"
                  className="group flex shrink-0 flex-col items-center gap-2 self-start rounded-xl bg-violet/10 px-2 py-3 text-violet ring-1 ring-violet/25 transition hover:bg-violet/20">
                  <SparkIcon className="h-4 w-4" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide [writing-mode:vertical-rl] rotate-180">AI Insights</span>
                </button>
              )}
            </>
          ) : (
            <>
              {isScreen && active === 'ligands' ? (
                <LibraryCenter smiles={screenSmiles} />
              ) : (
                <section className="glass relative flex min-w-0 flex-1 flex-col rounded-2xl p-3">
                  <ViewerToolbar
                    viewStyle={viewStyle} setViewStyle={setViewStyle}
                    showLigand={showLigand} setShowLigand={setShowLigand}
                    spin={spin} setSpin={setSpin}
                    showInter={showInter} setShowInter={setShowInter}
                  />
                  <div className="relative mt-3 min-h-0 flex-1">
                    {(() => {
                      const ligStep = active === 'ligands' && ligPreview.status === 'ok' && ligPreview.data?.ligand_pdb
                      return (
                        <MoleculeViewer style={viewStyle} showLigand={ligStep ? true : showLigand} spin={spin}
                          showInteractions={ligStep ? false : showInter}
                          pdb={ligStep ? ligPreview.data.ligand_pdb
                            : (receptor ? (ligRemoved ? stripLigand(receptor.display_pdb, receptor.ligand_resn) : receptor.display_pdb) : null)}
                          empty={ligStep ? false : !receptor} ligResn={ligStep ? 'LIG' : (receptor?.ligand_resn || 'MK1')}
                          box={box} showBox={!ligStep && active === 'site'} />
                      )
                    })()}
                  </div>
                  <ViewerFooter receptor={receptor} />
                </section>
              )}

              {/* Inspector */}
              <aside className="flex w-[340px] shrink-0 flex-col gap-4">
                {isScreen && active === 'ligands' ? (
                  <ScreeningLibraryPanel onRun={runDocking} running={running}
                    smiles={screenSmiles} setSmiles={setScreenSmiles}
                    count={parseSmilesLibrary(screenSmiles).length} />
                ) : (
                  <StepPanel active={active} steps={steps} exhaustiveness={exhaustiveness}
                    setExhaustiveness={setExhaustiveness} scoring={scoring} setScoring={setScoring}
                    onRun={runDocking} running={running} isScreen={isScreen}
                    engine={engine} busy={busy} receptor={receptor} box={box} setBox={setBox}
                    ligandSmiles={ligandSmiles} setLigandSmiles={setLigandSmiles}
                    ligandFile={ligandFile} setLigandFile={setLigandFile} onClearLigand={clearLigand} ligPreview={ligPreview}
                    protonate={protonate} setProtonate={setProtonate}
                    keepWaters={keepWaters} onToggleWaters={toggleKeepWaters}
                    keepIons={keepIons} onToggleIons={toggleKeepIons}
                    ligRemoved={ligRemoved} onToggleLig={() => setLigRemoved((v) => !v)}
                    onFetchReceptor={loadReceptorById} onUploadReceptor={loadReceptorFile}
                    onClearReceptor={clearReceptor} />
                )}
                <AiPanel active={active} mode={mode} receptor={receptor} box={box}
                  ligProps={ligPreview.data?.properties || dockRes?.properties}
                  ligandSmiles={ligandSmiles} dockRes={dockRes} screenRes={screenRes} />
              </aside>
            </>
          )}
        </main>
      </div>

      {jobsOpen && <JobsPanel jobs={jobs} activeJobId={activeJobId} onClose={() => setJobsOpen(false)}
        onOpen={openJob} onDelete={removeJob} />}
    </div>
  )
}

function JobsPanel({ jobs, activeJobId, onClose, onOpen, onDelete }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/80 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="glass relative flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-3.5">
          <div>
            <h3 className="text-[14px] font-semibold text-white">Jobs</h3>
            <p className="text-[11px] text-slate-500">Runs continue in the engine even if you refresh or navigate.</p>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg bg-ink-800/80 text-slate-400 hover:bg-ink-700 hover:text-white"><CloseIcon className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {jobs.length === 0 && <div className="grid place-items-center py-12 text-[12px] text-slate-500">No jobs yet.</div>}
          <div className="flex flex-col gap-2">
            {jobs.map((j) => (
              <div key={j.job_id} className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 ${j.job_id === activeJobId ? 'border-accent/40 bg-accent/5' : 'border-ink-700/60 bg-ink-800/30'}`}>
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-800">
                  {j.kind === 'screen' ? <LayersIcon className="h-4 w-4 text-violet" /> : <TargetIcon className="h-4 w-4 text-accent" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium text-slate-200">{j.label}</div>
                  <div className="text-[11px] text-slate-500">
                    {j.status === 'running' && <span className="text-accent">Running{j.progress?.total > 1 ? ` · ${j.progress.done}/${j.progress.total}` : '…'}</span>}
                    {j.status === 'done' && <span className="text-emerald-400">Done{j.best_affinity != null ? ` · best ${j.best_affinity} kcal/mol` : ''}</span>}
                    {j.status === 'error' && <span className="text-red-400">Failed · {j.error}</span>}
                  </div>
                </div>
                {j.status === 'running' && <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />}
                {j.status === 'done' && <button onClick={() => onOpen(j)} className="shrink-0 rounded-lg bg-accent/10 px-3 py-1.5 text-[11px] font-semibold text-accent ring-1 ring-accent/30 hover:bg-accent/20">View</button>}
                <button onClick={() => onDelete(j.job_id)} title="Delete" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-ink-700 hover:text-red-300"><TrashIcon className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function engErr(e) {
  const m = String(e?.message || e)
  return m === 'ENGINE_OFFLINE' ? 'Cannot reach the DDS engine. Is it running on port 8765?' : m
}

// remove the co-crystal ligand's atom records from a PDB (grid box is stored
// separately, so its centre stays put even after the ligand is removed)
function stripLigand(pdb, resn) {
  if (!pdb || !resn) return pdb
  return pdb.split('\n')
    .filter((l) => !((l.startsWith('HETATM') || l.startsWith('ATOM')) && l.slice(17, 20).trim() === resn))
    .join('\n')
}

function parseSmilesLibrary(text) {
  return (text || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line, i) => {
    const parts = line.split(/\s+/)
    return { smiles: parts[0], id: parts[1] || `L-${String(i + 1).padStart(3, '0')}` }
  })
}

function EngineBanner() {
  return (
    <div className="flex items-center gap-3 border-b border-amber/30 bg-amber/10 px-5 py-2.5 text-[12px] text-amber">
      <span className="font-semibold">Engine offline.</span>
      <span className="text-amber/90">Start it: <code className="rounded bg-ink-900/60 px-1.5 py-0.5 font-mono text-[11px]">cd ~/Desktop/"Drug Design Suite DDS"/engine &amp;&amp; source .venv/bin/activate &amp;&amp; python -m uvicorn app:app --port 8765</code></span>
    </div>
  )
}

function ErrorBar({ msg, onClose }) {
  return (
    <div className="flex items-center gap-3 border-b border-red-500/30 bg-red-500/10 px-5 py-2.5 text-[12px] text-red-300">
      <span className="font-semibold">Error</span><span className="min-w-0 flex-1 truncate">{msg}</span>
      <button onClick={onClose} className="rounded px-2 py-0.5 text-red-300 hover:bg-red-500/20">✕</button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Sidebar                                                            */
/* ------------------------------------------------------------------ */
function Sidebar({ active, setActive, hasResults, steps, mode, switchMode }) {
  const [cite, setCite] = useState(false)
  return (
    <div className="flex w-[248px] shrink-0 flex-col border-r border-ink-700/60 bg-ink-900/60">
      <div className="flex items-center gap-3 px-5 py-5">
        <Logo size={40} className="rounded-xl glow-accent" />
        <div>
          <div className="text-[15px] font-bold leading-none tracking-tight text-white">Drug Design</div>
          <div className="mt-1 text-[11px] font-medium tracking-wide text-accent">STUDIO · DDS</div>
        </div>
      </div>

      {/* Mode switch */}
      <div className="px-3">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink-800/70 p-1">
          <ModeTab active={mode === 'single'} onClick={() => switchMode('single')} icon={TargetIcon} label="Single" sub="Docking" />
          <ModeTab active={mode === 'screen'} onClick={() => switchMode('screen')} icon={LayersIcon} label="Virtual" sub="Screening" />
        </div>
      </div>

      <div className="px-4 pb-2 pt-4 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Workflow</div>
      <nav className="flex flex-col gap-1 px-3">
        {steps.map((s, i) => {
          const isActive = active === s.id
          const disabled = s.id === 'results' && !hasResults
          return (
            <button key={s.id} disabled={disabled}
              onClick={() => setActive(s.id)}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition
                ${isActive ? 'bg-accent/10 ring-1 ring-accent/40' : 'hover:bg-ink-800/70'}
                ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}>
              <div className={`grid h-8 w-8 place-items-center rounded-lg text-[11px] font-bold
                ${isActive ? 'bg-accent text-ink-950' : 'bg-ink-800 text-slate-400 group-hover:text-slate-200'}`}>
                {i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className={`text-[13px] font-semibold ${isActive ? 'text-white' : 'text-slate-300'}`}>{s.label}</div>
                <div className="truncate text-[11px] text-slate-500">{s.hint}</div>
              </div>
              <s.icon className={`h-4 w-4 ${isActive ? 'text-accent' : 'text-slate-600'}`} />
            </button>
          )
        })}
      </nav>

      <div className="mt-auto p-4">
        <button onClick={() => setCite(true)}
          className="flex w-full items-center gap-2.5 rounded-xl bg-ink-800/60 px-3 py-2.5 text-left ring-1 ring-ink-700/60 transition hover:bg-ink-800 hover:ring-accent/40">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-accent/15">
            <QuoteIcon className="h-4 w-4 text-accent" />
          </div>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-slate-200">Cite DDS</div>
            <div className="text-[10px] text-slate-500">How to cite this software</div>
          </div>
        </button>
      </div>

      {cite && <CiteModal onClose={() => setCite(false)} />}
    </div>
  )
}

function ModeTab({ active, onClick, icon: Icon, label, sub }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition
        ${active ? 'bg-accent/15 ring-1 ring-accent/40' : 'hover:bg-ink-700/60'}`}>
      <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-accent' : 'text-slate-500'}`} />
      <div className="min-w-0 leading-tight">
        <div className={`text-[11px] font-semibold ${active ? 'text-white' : 'text-slate-300'}`}>{label}</div>
        <div className="text-[9px] text-slate-500">{sub}</div>
      </div>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/*  Top bar                                                            */
/* ------------------------------------------------------------------ */
function TopBar({ onRun, running, bestAffinity, isScreen, receptorName, ligandCount, scoring, activeJob, runningCount, onOpenJobs }) {
  return (
    <header className="flex items-center gap-4 border-b border-ink-700/60 bg-ink-900/40 px-5 py-3">
      <div className="flex items-center gap-2.5">
        <div className="relative h-2 w-2 rounded-full bg-accent pulse-dot" />
        <div>
          <div className="text-[13px] font-semibold text-white">
            {receptorName || 'No receptor loaded'} · {isScreen ? 'Virtual Screening' : 'Docking'}
          </div>
          <div className="text-[11px] text-slate-500">
            {receptorName ? `${receptorName} · ` : ''}{isScreen ? `${ligandCount} compounds` : '1 ligand'} · {scoring} scoring
          </div>
        </div>
      </div>

      {isScreen && (
        <span className="ml-1 flex items-center gap-1.5 rounded-full bg-violet/15 px-2.5 py-1 text-[10px] font-semibold text-violet ring-1 ring-violet/30">
          <LayersIcon className="h-3 w-3" /> Screening mode
        </span>
      )}

      {bestAffinity != null && (
        <div className="ml-1 flex items-center gap-2 rounded-lg bg-accent/10 px-3 py-1.5 ring-1 ring-accent/30">
          <span className="text-[11px] text-slate-400">{isScreen ? 'Top hit' : 'Best'}</span>
          <span className="font-mono text-[13px] font-semibold text-accent">{bestAffinity} kcal/mol</span>
        </div>
      )}

      {running && (
        <div className="ml-1 flex items-center gap-2 rounded-lg bg-accent/10 px-3 py-1.5 ring-1 ring-accent/30">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
          <span className="text-[11px] font-medium text-accent">
            {activeJob?.kind === 'screen' && activeJob?.progress?.total > 1
              ? `Screening ${activeJob.progress.done}/${activeJob.progress.total}`
              : 'Running…'}
          </span>
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button onClick={onOpenJobs} title="View jobs"
          className="flex items-center gap-2 rounded-lg bg-ink-800/70 px-3 py-2 text-[13px] font-medium text-slate-300 transition hover:bg-ink-700 hover:text-white">
          <JobsIcon className="h-4 w-4" />
          Jobs
          {runningCount > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold text-accent">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />{runningCount}
            </span>
          )}
        </button>
        <button data-testid="btn-run" onClick={onRun} disabled={running}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-accent to-accent-dim px-4 py-2 text-[13px] font-semibold text-ink-950 shadow-lg transition hover:brightness-110 disabled:opacity-60">
          {running
            ? <><Spinner /> {isScreen ? 'Screening…' : 'Docking…'}</>
            : <><PlayIcon className="h-4 w-4" /> {isScreen ? 'Run Screening' : 'Run Docking'}</>}
        </button>
      </div>
    </header>
  )
}

/* ------------------------------------------------------------------ */
/*  Viewer toolbar / overlays                                         */
/* ------------------------------------------------------------------ */
function ViewerToolbar({ viewStyle, setViewStyle, showLigand, setShowLigand, spin, setSpin, showInter, setShowInter }) {
  const styles = [
    { id: 'cartoon', label: 'Cartoon' },
    { id: 'surface', label: 'Surface' },
    { id: 'stick', label: 'Sticks' },
  ]
  return (
    <div className="flex items-center gap-2">
      <div className="flex rounded-lg bg-ink-800/80 p-0.5">
        {styles.map((s) => (
          <button key={s.id} onClick={() => setViewStyle(s.id)}
            className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition
              ${viewStyle === s.id ? 'bg-ink-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>
            {s.label}
          </button>
        ))}
      </div>
      <Toggle active={showLigand} onClick={() => setShowLigand((v) => !v)} label="Ligand" />
      {setShowInter && <Toggle active={showInter} onClick={() => setShowInter((v) => !v)} label="3D interactions" />}
      <Toggle active={spin} onClick={() => setSpin((v) => !v)} label="Spin" />
      <div className="ml-auto flex items-center gap-1.5 rounded-lg bg-ink-800/60 px-2.5 py-1.5 text-[11px] text-slate-400">
        <span className="h-2 w-2 rounded-full bg-accent" /> Receptor
        <span className="ml-2 h-2 w-2 rounded-full bg-fuchsia-400" /> Ligand
      </div>
    </div>
  )
}

function ViewerFooter({ receptor }) {
  return (
    <div className="mt-2 flex items-center gap-4 px-1 text-[11px] text-slate-500">
      <span>Drag to rotate · Scroll to zoom · Right-drag to pan</span>
      <span className="ml-auto font-mono">
        {receptor ? `${receptor.name} · ${receptor.n_atoms} atoms · ${receptor.n_residues} residues` : 'no receptor loaded'}
      </span>
    </div>
  )
}

function GridOverlay({ box }) {
  const size = box?.size || { x: 22, y: 22, z: 22 }
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="relative h-52 w-52 rounded-lg border-2 border-dashed border-accent/70"
        style={{ boxShadow: '0 0 60px -10px rgba(45,212,191,0.4) inset' }}>
        <span className="absolute -top-6 left-0 rounded bg-accent px-2 py-0.5 font-mono text-[10px] font-semibold text-ink-950">
          search box · {size.x}×{size.y}×{size.z} Å
        </span>
        {['−top-1 −left-1', '−top-1 −right-1', '−bottom-1 −left-1', '−bottom-1 −right-1'].map((c, i) => (
          <span key={i} className="absolute h-2 w-2 rounded-full bg-accent"
            style={{
              top: i < 2 ? -4 : 'auto', bottom: i >= 2 ? -4 : 'auto',
              left: i % 2 === 0 ? -4 : 'auto', right: i % 2 === 1 ? -4 : 'auto',
            }} />
        ))}
      </div>
    </div>
  )
}

function DockingOverlay({ label = 'Running AutoDock Vina' }) {
  return (
    <div className="absolute inset-0 grid place-items-center rounded-xl bg-ink-950/70 backdrop-blur-sm">
      <div className="w-72 text-center">
        <div className="mx-auto mb-4 h-12 w-12">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-accent/20 border-t-accent" />
        </div>
        <div className="text-[13px] font-semibold text-white">{label}</div>
        <div className="mt-1 text-[11px] text-slate-400">Real AutoDock Vina run · this may take a moment</div>
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-accent to-accent-dim" />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Step / parameter panel                                            */
/* ------------------------------------------------------------------ */
function StepPanel({ active, steps, exhaustiveness, setExhaustiveness, scoring, setScoring, onRun, running, isScreen,
  engine, busy, receptor, box, setBox, ligandSmiles, setLigandSmiles, ligandFile, setLigandFile, onClearLigand, ligPreview,
  protonate, setProtonate, keepWaters, onToggleWaters, keepIons, onToggleIons,
  ligRemoved, onToggleLig, onFetchReceptor, onUploadReceptor, onClearReceptor }) {
  const meta = (steps || STEPS_SINGLE).find((s) => s.id === active) || STEPS_SINGLE[0]
  const [pdbId, setPdbId] = useState('1HSG')
  const fileRef = useState(null)[0]

  function setCenter(axis, v) { setBox((b) => ({ ...b, center: { ...b.center, [axis]: v } })) }
  function setSize(axis, v) { setBox((b) => ({ ...b, size: { ...b.size, [axis]: v } })) }

  return (
    <div className="glass flex flex-col rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <meta.icon className="h-4 w-4 text-accent" />
        <h2 className="text-[14px] font-semibold text-white">{meta.label}</h2>
        {engine === 'online' && <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> engine</span>}
      </div>

      {active === 'receptor' && (
        <div className="mt-4 space-y-3">
          <label className="grid cursor-pointer place-items-center rounded-xl border-2 border-dashed border-ink-600 bg-ink-800/30 px-4 py-5 text-center transition hover:border-accent/50 hover:bg-accent/5">
            <UploadIcon className="mb-2 h-6 w-6 text-slate-500" />
            <div className="text-[12px] font-medium text-slate-300">Upload receptor</div>
            <div className="mt-0.5 text-[11px] text-slate-500">PDB file</div>
            <input type="file" accept=".pdb,.ent" className="hidden"
              onChange={(e) => e.target.files[0] && onUploadReceptor(e.target.files[0])} />
          </label>
          <div className="flex gap-2">
            <input value={pdbId} onChange={(e) => setPdbId(e.target.value)} placeholder="PDB ID (e.g. 1HSG)"
              className="min-w-0 flex-1 rounded-lg bg-ink-900 px-3 py-2 font-mono text-[12px] text-slate-200 outline-none ring-1 ring-ink-700 focus:ring-accent/60" />
            <button onClick={() => onFetchReceptor(pdbId)} disabled={busy === 'receptor'}
              className="rounded-lg bg-ink-700 px-3 py-2 text-[12px] font-medium text-slate-200 hover:bg-ink-600 disabled:opacity-50">
              {busy === 'receptor' ? '…' : 'Fetch'}
            </button>
          </div>
          <div className="flex gap-4 px-1">
            <Check label="Retain waters" checked={keepWaters} onClick={onToggleWaters} />
            <Check label="Retain ions" checked={keepIons} onClick={onToggleIons} />
          </div>
          {receptor ? (
            <div className="rounded-lg bg-emerald-500/10 p-3 text-[11px] ring-1 ring-emerald-500/30">
              <div className="flex items-center gap-1.5">
                <span className="flex items-center gap-1.5 font-semibold text-emerald-400"><CheckIcon className="h-3.5 w-3.5" /> {receptor.name} prepared</span>
                <button onClick={onClearReceptor} title="Remove target"
                  className="ml-auto flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-1 text-[10px] font-medium text-red-300 hover:bg-red-500/25">
                  <TrashIcon className="h-3 w-3" /> Remove
                </button>
              </div>
              <div className="mt-1 text-slate-400">
                {receptor.n_atoms} atoms · {receptor.n_residues} residues{receptor.detected_ligands?.length ? ` · site from ${receptor.detected_ligands[0]}` : ''}
                {receptor.kept_waters ? ` · +${receptor.n_waters} waters` : ''}{receptor.kept_ions ? ` · +${receptor.n_ions} ions` : ''}
              </div>
              {receptor.ligand_resn && (
                <div className="mt-2 flex items-center gap-1.5 border-t border-emerald-500/20 pt-2">
                  <FlaskIcon className="h-3 w-3 text-fuchsia-400" />
                  <span className="text-slate-300">Co-crystal ligand <span className="font-mono text-fuchsia-300">{receptor.ligand_resn}</span></span>
                  <button onClick={onToggleLig}
                    className={`ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium ${ligRemoved ? 'bg-ink-700 text-slate-200 hover:bg-ink-600' : 'bg-red-500/15 text-red-300 hover:bg-red-500/25'}`}>
                    {ligRemoved ? 'Restore' : <><TrashIcon className="h-3 w-3" /> Remove</>}
                  </button>
                </div>
              )}
              {receptor.ligand_resn && (
                <div className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
                  {ligRemoved ? 'Ligand hidden — grid box stays centred on its original position.' : 'Grid box is centred here; removing the ligand keeps the box in place.'}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg bg-ink-800/40 px-3 py-2 text-[11px] text-slate-500">Waters/ions removed (unless retained above), polar H added at pH 7.4, Gasteiger charges, rigid PDBQT — automatic.</div>
          )}
        </div>
      )}

      {active === 'ligands' && (
        <div className="mt-4 space-y-3">
          {ligandFile ? (
            <div className="flex items-center gap-2 rounded-lg bg-accent/10 p-3 text-[11px] ring-1 ring-accent/30">
              <FlaskIcon className="h-4 w-4 text-accent" />
              <div className="min-w-0 flex-1"><div className="truncate font-medium text-slate-200">{ligandFile.name}</div><div className="text-slate-500 uppercase">{ligandFile.fmt} file</div></div>
              <button onClick={onClearLigand} title="Remove ligand" className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-ink-700 hover:text-red-300"><TrashIcon className="h-3.5 w-3.5" /></button>
            </div>
          ) : (
            <>
              <div className="rounded-lg bg-ink-800/60 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-slate-400">Ligand SMILES</span>
                  {ligandSmiles && (
                    <button onClick={onClearLigand} title="Delete this ligand"
                      className="flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-300 hover:bg-red-500/25">
                      <TrashIcon className="h-3 w-3" /> Remove
                    </button>
                  )}
                </div>
                <input value={ligandSmiles} onChange={(e) => setLigandSmiles(e.target.value)}
                  className="mt-1.5 w-full rounded-md bg-ink-900 px-2.5 py-1.5 font-mono text-[12px] text-slate-200 outline-none ring-1 ring-ink-700 focus:ring-accent/60" />
              </div>
              <label className="grid cursor-pointer place-items-center rounded-xl border-2 border-dashed border-ink-600 bg-ink-800/30 px-4 py-4 text-center transition hover:border-accent/50 hover:bg-accent/5">
                <UploadIcon className="mb-1.5 h-5 w-5 text-slate-500" />
                <div className="text-[12px] font-medium text-slate-300">…or upload a ligand file</div>
                <div className="mt-0.5 text-[11px] text-slate-500">SDF · MOL2 · MOL · PDB</div>
                <input type="file" accept=".sdf,.mol2,.mol,.pdb" className="hidden"
                  onChange={(e) => { const f = e.target.files[0]; if (f) { const fmt = f.name.split('.').pop().toLowerCase(); const rd = new FileReader(); rd.onload = () => setLigandFile({ text: rd.result, fmt, name: f.name }); rd.readAsText(f) } }} />
              </label>
            </>
          )}
          <LigandPreview preview={ligPreview} />
          <Check label="Assign protonation at physiological pH (7.4)" checked={protonate} onClick={() => setProtonate((v) => !v)} />
          <div className="rounded-lg bg-ink-800/40 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
            Prepared with RDKit + Meeko: 3D conformer (ETKDG) + MMFF optimization{protonate ? ', pH-based protonation' : ''}, then PDBQT with rotatable bonds.
          </div>
        </div>
      )}

      {active === 'site' && (
        <div className="mt-4 space-y-3">
          {!receptor && <p className="rounded-lg bg-amber/10 px-3 py-2 text-[11px] text-amber">Load a receptor first to set the box.</p>}
          <p className="text-[12px] leading-relaxed text-slate-400">Search box (Å). Auto-centred on the detected site; adjust as needed.</p>
          {box && ['x', 'y', 'z'].map((ax) => (
            <NumRow key={'c' + ax} label={`Center ${ax.toUpperCase()}`} value={box.center[ax]} step={0.5}
              onChange={(v) => setCenter(ax, v)} />
          ))}
          {box && ['x', 'y', 'z'].map((ax) => (
            <NumRow key={'s' + ax} label={`Size ${ax.toUpperCase()}`} value={box.size[ax]} step={1} min={6} max={40}
              onChange={(v) => setSize(ax, v)} />
          ))}
        </div>
      )}

      {active === 'dock' && (
        <div className="mt-4 space-y-4">
          <div>
            <div className="mb-1.5 flex justify-between text-[12px]"><span className="text-slate-400">Scoring function</span></div>
            <div className="flex rounded-lg bg-ink-800/80 p-0.5">
              {['vina', 'vinardo'].map((s) => (
                <button key={s} onClick={() => setScoring(s)}
                  className={`flex-1 rounded-md py-1.5 text-[11px] font-medium capitalize transition
                    ${scoring === s ? 'bg-ink-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>{s}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex justify-between text-[12px]">
              <span className="text-slate-400">Exhaustiveness</span>
              <span className="font-mono text-accent">{exhaustiveness}</span>
            </div>
            <input type="range" min="1" max="32" value={exhaustiveness}
              onChange={(e) => setExhaustiveness(+e.target.value)} className="w-full accent-accent" />
            <div className="mt-1 flex justify-between text-[10px] text-slate-600"><span>Fast</span><span>Thorough</span></div>
          </div>
          <button onClick={onRun} disabled={running || !receptor}
            className="w-full rounded-xl bg-gradient-to-r from-accent to-accent-dim py-2.5 text-[13px] font-semibold text-ink-950 hover:brightness-110 disabled:opacity-50">
            {running ? (isScreen ? 'Screening…' : 'Docking…') : (isScreen ? 'Screen library' : 'Run AutoDock Vina')}
          </button>
          {!receptor && <p className="text-center text-[11px] text-slate-500">Load a receptor to enable docking.</p>}
        </div>
      )}
    </div>
  )
}

// Live 2D preview of the current ligand — driven by the engine's real RDKit
// depiction (fetched in App). Confirms the ligand parsed & loaded.
function LigandPreview({ preview }) {
  const { status, data, msg } = preview || { status: 'idle' }
  if (status === 'idle') return null
  const p = data?.properties
  return (
    <div className="rounded-lg border border-ink-700/60 bg-ink-800/40 p-2">
      <div className="mb-1.5 flex items-center gap-1.5 px-1">
        <span className="text-[11px] font-semibold text-slate-400">Ligand preview</span>
        {status === 'loading' && <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />}
        {status === 'ok' && <span className="flex items-center gap-1 text-[10px] text-emerald-400"><CheckIcon className="h-3 w-3" /> loaded</span>}
        {status === 'error' && <span className="text-[10px] text-red-400">invalid</span>}
      </div>
      {status === 'error' ? (
        <div className="px-1 pb-1 text-[11px] text-red-300">{msg}</div>
      ) : (
        <>
          <div className="grid h-[150px] place-items-center overflow-hidden rounded-md bg-white">
            {data?.ligand_2d ? <Ligand2D ligand2d={data.ligand_2d} width={300} height={150} />
              : <span className="text-[11px] text-slate-400">rendering…</span>}
          </div>
          {p && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 px-1 text-[10px] text-slate-400">
              <span className="font-mono text-slate-300">{p.formula}</span>
              <span>MW {p.mw}</span><span>logP {p.logp}</span>
              <span>HBD {p.hbd}</span><span>HBA {p.hba}</span><span>QED {p.qed}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function NumRow({ label, value, onChange, step = 1, min = -999, max = 999 }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 text-[12px] text-slate-400">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(+e.target.value)} className="flex-1 accent-accent" />
      <input type="number" step={step} value={value} onChange={(e) => onChange(+e.target.value)}
        className="w-16 rounded-md bg-ink-900 px-2 py-1 text-right font-mono text-[11px] text-slate-200 outline-none ring-1 ring-ink-700 focus:ring-accent/60" />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  AI panel                                                          */
/* ------------------------------------------------------------------ */
// Real AI insights via the engine → Groq (Llama). Context (receptor, box,
// ligand props, docking/screening results) is sent so answers are grounded.
const AI_ACTIONS = {
  receptor: [['Assess pocket', 'pocket']],
  ligands: [['Drug-likeness', 'druglikeness'], ['Predict ADMET', 'admet']],
  site: [['Assess box', 'box']],
  dock: [['Explain binding', 'explain'], ['Suggest analogs', 'analogs']],
  results: [['Explain binding', 'explain'], ['Predict ADMET', 'admet'], ['Suggest analogs', 'analogs']],
}

function AiPanel({ active, mode, receptor, box, ligProps, ligandSmiles, dockRes, screenRes, onClose }) {
  const [enabled, setEnabled] = useState(null) // null unknown | true | false
  const [loading, setLoading] = useState(false)
  const [text, setText] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    let ok = true
    api.aiStatus().then((s) => ok && setEnabled(!!s.enabled)).catch(() => ok && setEnabled(false))
    return () => { ok = false }
  }, [])

  function buildContext() {
    return {
      step: active, mode,
      receptor: receptor ? {
        name: receptor.name, n_atoms: receptor.n_atoms, n_residues: receptor.n_residues,
        ligand_resn: receptor.ligand_resn, detected_ligands: receptor.detected_ligands,
        kept_waters: receptor.kept_waters, kept_ions: receptor.kept_ions,
      } : null,
      box: box ? { center: box.center, size: box.size } : null,
      ligand_smiles: ligandSmiles || null,
      ligand_properties: ligProps || null,
      docking: dockRes ? {
        best_affinity: dockRes.best_affinity, ligand_efficiency: dockRes.ligand_efficiency,
        lipinski_pass: dockRes.lipinski_pass, properties: dockRes.properties,
        poses: dockRes.poses, interactions: dockRes.interactions,
      } : null,
      screening: screenRes ? {
        n_ok: screenRes.n_ok,
        top: (screenRes.results || []).slice(0, 5).map((r) => ({ id: r.id, smiles: r.smiles, affinity: r.affinity, qed: r.qed, mw: r.mw, logp: r.logp })),
      } : null,
    }
  }

  async function ask(action) {
    setLoading(true); setErr(''); setText('')
    try {
      const r = await api.aiInsight({ action, context: buildContext() })
      setText(r.text || '')
    } catch (e) {
      const m = String(e?.message || e)
      setErr(m === 'ENGINE_OFFLINE' ? 'Engine offline.'
        : /not configured/i.test(m) ? 'Add GROQ_API_KEY to the engine to enable AI.'
        : m)
    } finally { setLoading(false) }
  }

  const actions = AI_ACTIONS[active] || AI_ACTIONS.results
  return (
    <div className="glass flex flex-1 flex-col rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <div className="grid h-6 w-6 place-items-center rounded-md bg-violet/15">
          <SparkIcon className="h-3.5 w-3.5 text-violet" />
        </div>
        <h2 className="text-[13px] font-semibold text-white">AI Insights</h2>
        <div className="ml-auto flex items-center gap-1.5">
          {enabled === false
            ? <span className="rounded-full bg-amber/15 px-2 py-0.5 text-[9px] font-medium text-amber">NO KEY</span>
            : <span className="rounded-full bg-violet/15 px-2 py-0.5 text-[9px] font-medium text-violet">OPTIONAL</span>}
          {onClose && (
            <button onClick={onClose} title="Hide AI Insights"
              className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-ink-700 hover:text-white">
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 min-h-[72px] rounded-xl bg-violet/5 p-3 ring-1 ring-violet/20">
        {loading ? (
          <div className="flex items-center gap-2 text-[12px] text-slate-400">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-violet/30 border-t-violet" /> Thinking…
          </div>
        ) : err ? (
          <p className="text-[12px] leading-relaxed text-amber">{err}</p>
        ) : text ? (
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-slate-300">{text}</p>
        ) : (
          <p className="text-[12px] leading-relaxed text-slate-500">
            {enabled === false
              ? 'AI is off — no API key set on the engine.'
              : 'Grounded on your current session data. Pick an action below to generate an insight.'}
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {actions.map(([label, action]) => (
          <button key={action} onClick={() => ask(action)} disabled={loading || enabled === false}
            className="rounded-lg bg-ink-800/70 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-ink-700 hover:text-white disabled:opacity-40">
            {label}
          </button>
        ))}
      </div>

      <div className="mt-auto flex items-center gap-2 pt-3 text-[10px] text-slate-600">
        <InfoIcon className="h-3 w-3" /> Runs online via Groq · optional
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Results dashboard                                                 */
/* ------------------------------------------------------------------ */
function ResultsView({ result, receptorName }) {
  const [map2D, setMap2D] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [inter3D, setInter3D] = useState(true)
  const [minMode, setMinMode] = useState('pocket')
  const [minBusy, setMinBusy] = useState(false)
  const [minRes, setMinRes] = useState(null) // {pdb, energy_before, energy_after}
  const [selPose, setSelPose] = useState(0) // which docked pose is shown in the viewer

  function selectPose(i) { setSelPose(i); setMinRes(null) } // reset any minimized overlay on switch

  async function runMinimize() {
    setMinBusy(true)
    try {
      const r = await api.minimize({ complex_id: sel.complex_id, complex_pdb: sel.complex_id ? undefined : selComplex, mode: minMode, forcefield: 'uff', steps: 500 })
      setMinRes(r)
    } catch (e) { /* surfaced below */ setMinRes({ error: String(e.message || e) }) } finally { setMinBusy(false) }
  }
  function downloadMin() {
    if (!minRes?.pdb) return
    const blob = new Blob([minRes.pdb], { type: 'chemical/x-pdb' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = `${(receptorName || 'complex')}_minimized.pdb`; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const poses = result?.poses || []
  const props = result?.properties || {}
  const best = result?.best_affinity
  const scatterData = useMemo(() => poses.map((p) => ({ x: p.rmsd_ub, y: p.affinity, z: 100 })), [poses])
  const ligName = props.formula || 'Ligand'

  // selected pose (falls back to top-level fields for older results without per-pose data)
  const sel = poses[selPose] || {}
  const selComplex = sel.complex_pdb || result?.complex_pdb
  const selInter = sel.interactions || result?.interactions || []
  const selAff = sel.affinity ?? best
  const selNum = sel.pose ?? (selPose + 1)

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-white">Docking Results</h2>
          <p className="text-[11px] text-slate-500">{poses.length} poses · AutoDock Vina · real run</p>
        </div>
        <button onClick={() => setExportOpen(true)}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-accent to-accent-dim px-4 py-2 text-[13px] font-semibold text-ink-950 shadow-lg hover:brightness-110">
          <ExportIcon className="h-4 w-4" /> Export &amp; Prepare
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Kpi label="Best affinity" value={fmt(best)} unit="kcal/mol" tone="accent" />
        <Kpi label="Ligand efficiency" value={fmt(result?.ligand_efficiency)} unit="kcal/heavy atom" />
        <Kpi label="Poses generated" value={poses.length} unit="modes" />
        <Kpi label="Drug-likeness (QED)" value={props.qed ?? '—'} unit={result?.lipinski_pass ? 'Lipinski ✓' : 'Lipinski ✗'} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 flex flex-col gap-4">
          <div className="glass rounded-2xl p-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <h3 className="text-[13px] font-semibold text-white">
                Docked Complex · Pose {selNum}{selPose === 0 ? ' (top)' : ''}
              </h3>
              <div className="flex items-center gap-2">
                <Toggle active={inter3D} onClick={() => setInter3D((v) => !v)} label="3D interactions" />
                <span className="font-mono text-[12px] text-accent">{fmt(selAff)} kcal/mol</span>
              </div>
            </div>
            <div className="h-[300px]">
              <MoleculeViewer style="cartoon" showLigand spin={false} showInteractions={inter3D}
                pdb={minRes?.pdb || selComplex} ligResn="LIG" />
            </div>
            {/* quick geometry cleanup / minimization */}
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-ink-700/60 px-1 pt-2">
              <span className="text-[11px] font-medium text-slate-400">Cleanup</span>
              <select value={minMode} onChange={(e) => setMinMode(e.target.value)}
                className="rounded-md bg-ink-900 px-2 py-1 text-[11px] text-slate-200 outline-none ring-1 ring-ink-700 focus:ring-accent/60">
                <option value="ligand">Ligand only</option>
                <option value="pocket">Ligand + pocket</option>
                <option value="complex">Whole complex</option>
              </select>
              <button onClick={runMinimize} disabled={minBusy}
                className="flex items-center gap-1.5 rounded-lg bg-violet/15 px-2.5 py-1 text-[11px] font-semibold text-violet ring-1 ring-violet/30 hover:bg-violet/25 disabled:opacity-50">
                {minBusy ? 'Minimizing…' : 'Energy-minimize'}
              </button>
              {minRes?.pdb && (
                <>
                  <span className="font-mono text-[11px] text-emerald-400">ΔE {fmt(minRes.energy_after - minRes.energy_before)} ({minRes.energy_before}→{minRes.energy_after})</span>
                  <button onClick={downloadMin} className="rounded-md bg-ink-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-ink-700 hover:text-white">Download PDB</button>
                  <button onClick={() => setMinRes(null)} className="text-[11px] text-slate-500 hover:text-slate-300">reset</button>
                </>
              )}
              {minRes?.error && <span className="text-[11px] text-red-400">{minRes.error}</span>}
              <span className="ml-auto text-[10px] text-slate-600">UFF · geometric cleanup, not rigorous MM</span>
            </div>
          </div>

          <div className="glass rounded-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-white">Binding affinity by pose</h3>
              <span className="text-[10px] text-slate-500">click a bar to view that pose</span>
            </div>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={poses} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1c2842" vertical={false} />
                  <XAxis dataKey="pose" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={{ stroke: '#1c2842' }} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(45,212,191,0.06)' }} contentStyle={tooltipStyle} />
                  <Bar dataKey="affinity" radius={[4, 4, 0, 0]} cursor="pointer"
                    onClick={(data, index) => selectPose(typeof index === 'number' ? index : poses.findIndex((p) => p.pose === data?.pose))}>
                    {poses.map((p, i) => <Cell key={i} fill={i === selPose ? '#2dd4bf' : '#1c6e63'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="glass rounded-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-white">Key interactions <span className="text-[11px] font-normal text-slate-500">· pose {selNum}</span></h3>
              <button onClick={() => setMap2D(true)}
                className="flex items-center gap-1.5 rounded-lg bg-accent/10 px-2.5 py-1.5 text-[11px] font-semibold text-accent ring-1 ring-accent/30 hover:bg-accent/20">
                <MapIcon className="h-3.5 w-3.5" /> 2D diagram
              </button>
            </div>
            <div className="max-h-[190px] space-y-2 overflow-auto">
              {selInter.length === 0 && <p className="text-[11px] text-slate-500">No close contacts detected in this pose.</p>}
              {selInter.map((it, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: INT_COLORS[it.type] || '#64748b' }} />
                  <span className="font-mono text-[12px] text-slate-200">{it.residue}</span>
                  <span className="text-[11px] text-slate-500">{it.type}</span>
                  <span className="ml-auto font-mono text-[11px] text-slate-400">{it.distance} Å</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 border-t border-ink-700/60 pt-3 text-[10px]">
              {Object.entries(INT_COLORS).map(([k, v]) => (
                <span key={k} className="flex items-center gap-1.5 text-slate-400">
                  <span className="h-2 w-2 rounded-full" style={{ background: v }} />{k}
                </span>
              ))}
            </div>
          </div>

          <div className="glass rounded-2xl p-4">
            <h3 className="mb-1 text-[13px] font-semibold text-white">Ligand properties</h3>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
              {[['MW', props.mw], ['logP', props.logp], ['H-donors', props.hbd], ['H-acceptors', props.hba], ['TPSA', props.tpsa], ['Rot. bonds', props.rotatable]].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between rounded-lg bg-ink-800/50 px-2.5 py-1.5">
                  <span className="text-slate-500">{k}</span><span className="font-mono text-slate-200">{v ?? '—'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {map2D && (
        <Modal onClose={() => setMap2D(false)}>
          <InteractionMap2D ligand={ligName} pose={selNum} affinity={selAff} interactions={selInter} ligand2d={result?.ligand_2d} />
        </Modal>
      )}

      {exportOpen && (
        <ExportModal onClose={() => setExportOpen(false)} payload={{
          mode: 'single', target: (receptorName || 'Receptor'), pdb: (receptorName || ''),
          scoring: result?.params?.scoring || 'vina', exhaustiveness: result?.params?.exhaustiveness ?? 16, params: result?.params,
          ligand: ligName, pose: selNum, affinity: selAff, complex_pdb: selComplex,
          poses, interactions: selInter, rows: [{ name: ligName, affinity: best, mw: props.mw, logp: props.logp, qed: props.qed }],
        }} />
      )}
    </div>
  )
}

function fmt(v) { return v == null ? '—' : (v < 0 ? '−' + Math.abs(v).toFixed(1) : v.toFixed(1)) }

function Modal({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/80 p-6 backdrop-blur-sm"
      onClick={onClose}>
      <div className="glass relative max-h-[92vh] w-full max-w-5xl overflow-auto rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose}
          className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-lg bg-ink-800/80 text-slate-400 hover:bg-ink-700 hover:text-white">
          <CloseIcon className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Cite DDS                                                          */
/* ------------------------------------------------------------------ */
const CITATION = 'Mahmoud E. Soliman, Drug Design Studio (DDS): a robust, cross-platform graphical interface for molecular docking, virtual screening and protein–ligand interaction analysis, Journal of Computational Chemistry, 2026 (under review).'
const CITATION_BIBTEX = `@article{soliman2026dds,
  author  = {Soliman, Mahmoud E.},
  title   = {Drug Design Studio (DDS): A Robust, Cross-Platform Graphical Interface for Molecular Docking, Virtual Screening and Protein--Ligand Interaction Analysis},
  journal = {Journal of Computational Chemistry},
  year    = {2026},
  note    = {Under review}
}`

function CiteModal({ onClose }) {
  const [copied, setCopied] = useState('')
  function copy(text, which) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(which)
      setTimeout(() => setCopied(''), 1800)
    })
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/80 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="glass relative w-full max-w-xl overflow-hidden rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose}
          className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-lg bg-ink-800/80 text-slate-400 hover:bg-ink-700 hover:text-white">
          <CloseIcon className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3 border-b border-ink-700/60 px-6 py-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent/15">
            <QuoteIcon className="h-5 w-5 text-accent" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-white">Cite Drug Design Studio</h3>
            <p className="text-[11px] text-slate-500">If DDS supported your research, please cite it.</p>
          </div>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Reference</span>
              <CopyBtn active={copied === 'ref'} onClick={() => copy(CITATION, 'ref')} />
            </div>
            <div className="rounded-xl bg-ink-900/70 p-4 text-[13px] leading-relaxed text-slate-200 ring-1 ring-ink-700/60">
              {CITATION}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">BibTeX</span>
              <CopyBtn active={copied === 'bib'} onClick={() => copy(CITATION_BIBTEX, 'bib')} />
            </div>
            <pre className="overflow-auto rounded-xl bg-ink-900/70 p-4 font-mono text-[11.5px] leading-relaxed text-slate-300 ring-1 ring-ink-700/60">{CITATION_BIBTEX}</pre>
          </div>
        </div>
      </div>
    </div>
  )
}

function CopyBtn({ active, onClick }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition
        ${active ? 'bg-accent/15 text-accent' : 'bg-ink-800/70 text-slate-300 hover:bg-ink-700 hover:text-white'}`}>
      {active ? <><CheckIcon className="h-3.5 w-3.5" /> Copied</> : <><CopyIcon className="h-3.5 w-3.5" /> Copy</>}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/*  Small UI atoms                                                    */
/* ------------------------------------------------------------------ */
const tooltipStyle = { background: '#0f1729', border: '1px solid #2a3757', borderRadius: 8, fontSize: 12, color: '#e2e8f0' }

function Kpi({ label, value, unit, tone }) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className={`font-mono text-2xl font-bold ${tone === 'accent' ? 'text-accent' : 'text-white'}`}>{value}</span>
        <span className="text-[11px] text-slate-500">{unit}</span>
      </div>
    </div>
  )
}

function Toggle({ active, onClick, label }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition
        ${active ? 'bg-accent/15 text-accent ring-1 ring-accent/40' : 'bg-ink-800/80 text-slate-400 hover:text-slate-200'}`}>
      <span className={`h-2 w-2 rounded-full ${active ? 'bg-accent' : 'bg-slate-600'}`} />{label}
    </button>
  )
}

function Check({ label, checked, onClick }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 text-left">
      <span className={`grid h-4 w-4 place-items-center rounded ${checked ? 'bg-accent' : 'bg-ink-700 ring-1 ring-ink-600'}`}>
        {checked && <CheckIcon className="h-3 w-3 text-ink-950" />}
      </span>
      <span className={`text-[12px] ${checked ? 'text-slate-200' : 'text-slate-400'}`}>{label}</span>
    </button>
  )
}

function IconButton({ children, title }) {
  return (
    <button title={title} className="grid h-9 w-9 place-items-center rounded-lg bg-ink-800/70 text-slate-400 transition hover:bg-ink-700 hover:text-white">
      {children}
    </button>
  )
}

function DropZone({ label, sub }) {
  return (
    <div className="grid place-items-center rounded-xl border-2 border-dashed border-ink-600 bg-ink-800/30 px-4 py-6 text-center transition hover:border-accent/50 hover:bg-accent/5">
      <UploadIcon className="mb-2 h-6 w-6 text-slate-500" />
      <div className="text-[12px] font-medium text-slate-300">{label}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>
    </div>
  )
}

function FetchRow() {
  return (
    <div className="flex gap-2">
      <input placeholder="PDB ID (e.g. 1HSG)" defaultValue="1HSG"
        className="min-w-0 flex-1 rounded-lg bg-ink-900 px-3 py-2 font-mono text-[12px] text-slate-200 outline-none ring-1 ring-ink-700 focus:ring-accent/60" />
      <button className="rounded-lg bg-ink-700 px-3 py-2 text-[12px] font-medium text-slate-200 hover:bg-ink-600">Fetch</button>
    </div>
  )
}

function PrepCheck({ label, on }) {
  const [checked, setChecked] = useState(!!on)
  return (
    <button onClick={() => setChecked((v) => !v)} className="flex w-full items-center gap-2.5 text-left">
      <span className={`grid h-4 w-4 place-items-center rounded ${checked ? 'bg-accent' : 'bg-ink-700 ring-1 ring-ink-600'}`}>
        {checked && <CheckIcon className="h-3 w-3 text-ink-950" />}
      </span>
      <span className={`text-[12px] ${checked ? 'text-slate-200' : 'text-slate-500'}`}>{label}</span>
    </button>
  )
}

function SliderRow({ label, value, unit }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 text-[12px] text-slate-400">{label}</span>
      <input type="range" min="0" max="40" defaultValue={value} className="flex-1 accent-accent" />
      <span className="w-14 text-right font-mono text-[12px] text-slate-300">{value}{unit && ` ${unit}`}</span>
    </div>
  )
}

function Spinner() {
  return <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-950/30 border-t-ink-950" />
}

/* ------------------------------------------------------------------ */
/*  Icons (inline, stroke-based)                                      */
/* ------------------------------------------------------------------ */
function I(props, path) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>{path}</svg>
}
function HexIcon(p) { return I(p, <><path d="M12 2l8.66 5v10L12 22l-8.66-5V7z" fill="currentColor" stroke="none" /></>) }
function ProteinIcon(p) { return I(p, <><circle cx="7" cy="8" r="2.5" /><circle cx="17" cy="9" r="2.5" /><circle cx="12" cy="16" r="2.5" /><path d="M9 9.5l6 .5M15.5 11l-2.5 3M9.3 10l1.7 4.5" /></>) }
function FlaskIcon(p) { return I(p, <><path d="M9 3h6M10 3v6l-5 8a2 2 0 002 3h10a2 2 0 002-3l-5-8V3" /><path d="M7 14h10" /></>) }
function BoxIcon(p) { return I(p, <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 3v18M4 7.5l8 4.5 8-4.5" /></>) }
function PlayIcon(p) { return I(p, <><path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none" /></>) }
function ChartIcon(p) { return I(p, <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>) }
function SparkIcon(p) { return I(p, <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="currentColor" stroke="none" /></>) }
function ExportIcon(p) { return I(p, <><path d="M12 15V3M8 7l4-4 4 4M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" /></>) }
function GearIcon(p) { return I(p, <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 00-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 00-1.7-1l-.4-2.6h-4l-.4 2.6a7 7 0 00-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 000 2l-2 1.6 2 3.4 2.4-1a7 7 0 001.7 1l.4 2.6h4l.4-2.6a7 7 0 001.7-1l2.4 1 2-3.4-2-1.6a7 7 0 00.1-1z" /></>) }
function UploadIcon(p) { return I(p, <><path d="M12 16V4M8 8l4-4 4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></>) }
function CheckIcon(p) { return I(p, <><path d="M4 12l5 5L20 6" /></>) }
function InfoIcon(p) { return I(p, <><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></>) }
function MapIcon(p) { return I(p, <><circle cx="12" cy="12" r="2.2" /><circle cx="5" cy="6" r="1.8" /><circle cx="19" cy="7" r="1.8" /><circle cx="6" cy="18" r="1.8" /><circle cx="18" cy="17" r="1.8" /><path d="M10.2 11l-3.7-3.7M13.8 11.2l3.6-3M11 13.8l-3.6 3M13.4 13.4l3.2 2.4" /></>) }
function CloseIcon(p) { return I(p, <><path d="M6 6l12 12M18 6L6 18" /></>) }
function TargetIcon(p) { return I(p, <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>) }
function LayersIcon(p) { return I(p, <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5M3 17l9 5 9-5" /></>) }
function QuoteIcon(p) { return I(p, <><path d="M7 7H4a1 1 0 00-1 1v4a1 1 0 001 1h2v3a1 1 0 01-1 1H4M17 7h-3a1 1 0 00-1 1v4a1 1 0 001 1h2v3a1 1 0 01-1 1h-1" /></>) }
function CopyIcon(p) { return I(p, <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 012-2h8" /></>) }
function TrashIcon(p) { return I(p, <><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13a2 2 0 002 2h8a2 2 0 002-2l1-13M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" /></>) }
function JobsIcon(p) { return I(p, <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M7 13h6M7 16h9" /></>) }
