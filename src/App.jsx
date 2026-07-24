import { useState, useMemo, useEffect, useRef } from 'react'
import MoleculeViewer from './components/MoleculeViewer.jsx'
import InteractionMap2D from './components/InteractionMap2D.jsx'
import ExportModal from './components/ExportModal.jsx'
import Ligand2D from './components/Ligand2D.jsx'
import AgreementGate, { AGREEMENT_VERSION } from './components/Agreement.jsx'
import DocsModal, { DOC_VERSION } from './components/Documentation.jsx'
import { saveFile } from './download.js'
import { LIBRARY, ScreeningLibraryPanel, LibraryCenter, ScreeningResults } from './components/VirtualScreening.jsx'
import * as api from './api.js'
import Logo from './components/Logo.jsx'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
  ScatterChart, Scatter, ZAxis, CartesianGrid, LabelList,
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
const COMP_COLOR = { protein: '#2dd4bf', nucleic: '#a78bfa', ligand: '#f472b6', cofactor: '#fbbf24' }

const DEFAULT_SMILES = 'CC(C)Cc1ccc(cc1)C(C)C(=O)Nc1ncccn1'

export default function App() {
  // null = still checking; true = accepted; false = show the gate. localStorage is a fast
  // optimistic cache; the engine's on-disk marker is the durable, OS-independent source of truth.
  const [agreed, setAgreed] = useState(() => { try { return localStorage.getItem('dds_agreed') === AGREEMENT_VERSION ? true : null } catch { return null } })
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
  const [removedComp, setRemovedComp] = useState([]) // structure-editor: removed component keys
  const [receptorPh, setReceptorPh] = useState(7.4) // pH for receptor protonation (Open Babel)
  const [ligPreview, setLigPreview] = useState({ status: 'idle', data: null, msg: '' }) // live 2D+3D ligand preview

  // covalent docking (geometry-guided): target a reactive residue, rank by warhead reach
  const [covalent, setCovalent] = useState(false)
  const [covResidue, setCovResidue] = useState(null)      // nucleophile key "chain:resn:resi"
  const [covResidues, setCovResidues] = useState([])       // nucleophiles inside the box (from engine)
  const [covResLoading, setCovResLoading] = useState(false)
  const [covOverride, setCovOverride] = useState('auto')   // 'auto' | warhead name
  const [covMaxDist, setCovMaxDist] = useState(3.5)
  const [covMode, setCovMode] = useState('geometry')       // 'geometry' | 'tethered'
  const [covWarheads, setCovWarheads] = useState([])       // warhead catalog for the override menu

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

  // reconcile the licence agreement with the engine's on-disk marker (durable on mac & windows)
  useEffect(() => {
    let ok = true
    api.getAgreement().then((r) => {
      if (!ok) return
      if (r.agreed_version === AGREEMENT_VERSION) {
        setAgreed(true)
        try { localStorage.setItem('dds_agreed', AGREEMENT_VERSION) } catch { /* ignore */ }
      } else {
        // engine hasn't recorded it; if this browser already had it, migrate — else show the gate
        setAgreed((prev) => {
          if (prev === true) { api.setAgreement(AGREEMENT_VERSION).catch(() => {}); return true }
          return false
        })
      }
    }).catch(() => {
      // engine unreachable — fall back to the localStorage cache only
      if (ok) setAgreed((prev) => (prev === true ? true : false))
    })
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

  // warhead catalog (once, for the covalent override menu)
  useEffect(() => {
    if (engine !== 'online') return
    let ok = true
    api.covalentWarheads().then((r) => ok && setCovWarheads(r.warheads || [])).catch(() => {})
    return () => { ok = false }
  }, [engine])

  // nucleophilic residues inside the current box — refreshed when covalent is on
  // and the receptor or grid changes; auto-selects the residue nearest the centre
  useEffect(() => {
    if (!covalent || !receptor?.receptor_id || !box) return
    let cancelled = false
    setCovResLoading(true)
    const t = setTimeout(async () => {
      try {
        const r = await api.covalentResidues(receptor.receptor_id, box)
        if (cancelled) return
        const list = r.residues || []
        setCovResidues(list)
        setCovResidue((cur) => (cur && list.some((n) => n.key === cur) ? cur : (list[0]?.key || null)))
      } catch { if (!cancelled) setCovResidues([]) }
      finally { if (!cancelled) setCovResLoading(false) }
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [covalent, receptor?.receptor_id, box?.center?.x, box?.center?.y, box?.center?.z, box?.size?.x, box?.size?.y, box?.size?.z])

  const activeJob = jobs.find((j) => j.job_id === activeJobId) || null
  // true whenever the awaited job is still running on the server — survives tab/mode
  // navigation (unlike the transient local `running` flag), so the indicators persist
  const isRunning = running || (activeJob != null && activeJob.status === 'running')

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

  // covalent summary shown on the left-panel mode card
  const covSel = covResidues.find((r) => r.key === covResidue) || null
  const covTargetLabel = covSel ? `${covSel.residue} · ${covSel.atom_label}` : null
  const covWarheadLabel = covOverride !== 'auto'
    ? (covWarheads.find((w) => w.name === covOverride)?.label || null)
    : (isScreen ? 'auto per compound' : (ligPreview.data?.warhead?.label || null))

  // uploaded/SMILES ligand placed at the box centre for a pre-docking preview
  const placedLigandPdb = useMemo(
    () => (box && ligPreview.data?.ligand_pdb ? placeLigandInBox(ligPreview.data.ligand_pdb, box.center) : null),
    [ligPreview.data?.ligand_pdb, box?.center?.x, box?.center?.y, box?.center?.z],
  )

  function switchMode(m) {
    setMode(m); setActive('receptor'); setHasResults(false); setRunning(false)
    setDockRes(null); setScreenRes(null); setErrorMsg('')
  }

  async function loadReceptorById(pdbId) {
    setBusy('receptor'); setErrorMsg('')
    try {
      const r = await api.fetchReceptor(pdbId, { keepWaters, keepIons, ph: receptorPh })
      setReceptor({ ...r, name: pdbId.toUpperCase() })
      setBox({ center: { ...r.center }, size: { ...r.box } })
      if (r.native_ligand_smiles) { setLigandSmiles(r.native_ligand_smiles); setLigandFile(null) }
      setCleared(false); setRemovedComp([]); setCovResidue(null); setCovResidues([])
    } catch (e) { setErrorMsg(engErr(e)) } finally { setBusy('') }
  }
  async function loadReceptorFile(file) {
    setBusy('receptor'); setErrorMsg('')
    try {
      const r = await api.uploadReceptor(file, { keepWaters, keepIons, ph: receptorPh })
      setReceptor({ ...r, name: file.name })
      setBox({ center: { ...r.center }, size: { ...r.box } })
      if (r.native_ligand_smiles) { setLigandSmiles(r.native_ligand_smiles); setLigandFile(null) }
      setCleared(false); setRemovedComp([]); setCovResidue(null); setCovResidues([])
    } catch (e) { setErrorMsg(engErr(e)) } finally { setBusy('') }
  }
  function clearReceptor() {
    setReceptor(null); setBox(null); setDockRes(null); setScreenRes(null)
    setHasResults(false); setCleared(true); setActive('receptor'); setErrorMsg(''); setRemovedComp([])
    setCovResidue(null); setCovResidues([])
  }

  // full reset — clear the loaded target, ligand, results and covalent target so the
  // user can start a fresh run/project. Background jobs are kept (available in Jobs).
  function clearWorkspace() {
    clearReceptor()
    setLigandFile(null); setLigandSmiles(DEFAULT_SMILES)
    setCovalent(false); setCovMode('geometry')
    setActiveJob(null); setRunning(false)
  }

  // re-prepare the loaded receptor from its stored structure (waters/ions + removed
  // components), keeping the same receptor_id and the current grid box
  async function reprepareReceptor(kw, ki, remove, ph) {
    if (!receptor?.receptor_id) return
    setBusy('receptor'); setErrorMsg('')
    try {
      const r = await api.reprepReceptor(receptor.receptor_id, { keepWaters: kw, keepIons: ki, remove, ph })
      setReceptor((prev) => ({ ...r, name: prev?.name }))
      setBox((prev) => prev || { center: { ...r.center }, size: { ...r.box } })
    } catch (e) { setErrorMsg(engErr(e)) } finally { setBusy('') }
  }
  function toggleKeepWaters() {
    const next = !keepWaters
    setKeepWaters(next)
    if (receptor) reprepareReceptor(next, keepIons, removedComp, receptorPh)
  }
  function toggleKeepIons() {
    const next = !keepIons
    setKeepIons(next)
    if (receptor) reprepareReceptor(keepWaters, next, removedComp, receptorPh)
  }
  function toggleComponent(key) {
    const next = removedComp.includes(key) ? removedComp.filter((k) => k !== key) : [...removedComp, key]
    setRemovedComp(next)
    reprepareReceptor(keepWaters, keepIons, next, receptorPh)
  }
  function commitReceptorPh(v) {
    setReceptorPh(v)
    if (receptor) reprepareReceptor(keepWaters, keepIons, removedComp, v)
  }

  async function runDocking() {
    setErrorMsg('')
    if (engine !== 'online') { setErrorMsg('Engine offline — start the DDS engine (see banner).'); return }
    if (!receptor || !box) { setErrorMsg('Prepare a receptor first.'); setActive('receptor'); return }
    if (covalent && !covResidue) { setErrorMsg('Select a reactive residue for covalent docking (Binding Site step).'); setActive('site'); return }
    if (isScreen) return runScreening()
    if (!ligandFile && !ligandSmiles.trim()) { setErrorMsg('Provide a ligand (SMILES or file).'); setActive('ligands'); return }
    setRunning(true)
    try {
      const lig = ligandFile ? { ligand_text: ligandFile.text, ligand_fmt: ligandFile.fmt } : { smiles: ligandSmiles.trim() }
      const { job_id } = await api.dock({
        receptor_id: receptor.receptor_id, ...lig, protonate, ph: 7.4,
        center: box.center, size: box.size, scoring, exhaustiveness, num_modes: 9,
        ...covalentPayload(),
        label: `${receptor.name} · ${covalent ? 'covalent ' : ''}docking`,
      })
      setActiveJob(job_id)
    } catch (e) { setErrorMsg(engErr(e)); setRunning(false) }
  }

  // covalent params shared by single docking and screening
  function covalentPayload() {
    if (!covalent) return { covalent: false }
    return {
      covalent: true,
      covalent_residue: covResidue,
      covalent_warhead: covOverride !== 'auto' ? covOverride : null,
      covalent_max_dist: covMaxDist,
      covalent_mode: covMode,
    }
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
        ...covalentPayload(),
        label: `${receptor.name} · ${covalent ? 'covalent ' : ''}screen ${ligs.length}`,
      })
      setActiveJob(job_id)
    } catch (e) { setErrorMsg(engErr(e)); setRunning(false) }
  }

  if (agreed === null) {
    return <div className="grid h-full w-full place-items-center bg-ink-950">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
    </div>
  }
  if (!agreed) {
    return <AgreementGate onAgree={() => {
      try { localStorage.setItem('dds_agreed', AGREEMENT_VERSION) } catch { /* ignore */ }
      api.setAgreement(AGREEMENT_VERSION).catch(() => {})
      setAgreed(true)
    }} />
  }

  return (
    <div className="flex h-full w-full bg-ink-950 text-slate-200">
      <Sidebar active={active} setActive={setActive} hasResults={hasResults}
        steps={steps} mode={mode} switchMode={switchMode}
        cov={{
          enabled: covalent, onToggle: () => setCovalent((v) => !v),
          targetLabel: covTargetLabel, warheadLabel: covWarheadLabel, hasReceptor: !!receptor,
          mode: covMode,
        }} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onRun={runDocking} running={isRunning} isScreen={isScreen} covalent={covalent}
          bestAffinity={hasResults ? bestAffinity : null} receptorName={receptor?.name}
          ligandCount={isScreen ? parseSmilesLibrary(screenSmiles).length : 1} scoring={scoring}
          activeJob={activeJob} runningCount={jobs.filter((j) => j.status === 'running').length}
          onOpenJobs={() => setJobsOpen(true)} onClear={clearWorkspace} hasReceptor={!!receptor || hasResults} />

        {engine === 'offline' && <EngineBanner />}
        {errorMsg && <ErrorBar msg={errorMsg} onClose={() => setErrorMsg('')} />}

        <main className="flex min-h-0 flex-1 gap-4 p-4">
          {active === 'results' && hasResults ? (
            <>
              {isScreen ? <ScreeningResults result={screenRes} receptor={receptor} box={box} scoring={scoring} />
                : <ResultsView result={dockRes} receptorName={receptor?.name} receptor={receptor} ligandSmiles={ligandSmiles} />}
              {aiOpen ? (
                <aside className="flex w-[270px] shrink-0 flex-col gap-4">
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
                          pdb={ligStep ? ligPreview.data.ligand_pdb : (receptor?.display_pdb || null)}
                          empty={ligStep ? false : !receptor} ligResn={ligStep ? 'LIG' : (receptor?.ligand_resn || 'MK1')}
                          box={box} showBox={!ligStep && active === 'site'}
                          overlayLigand={!isScreen && !ligStep && (active === 'site' || active === 'dock') ? placedLigandPdb : null}
                          covalentTarget={!ligStep && covalent && active === 'site' && covSel ? {
                            chain: covSel.chain, resi: covSel.resi, residueLabel: covSel.residue,
                            atomLabel: covSel.atom_label, nuc: [covSel.x, covSel.y, covSel.z],
                          } : null} />
                      )
                    })()}
                  </div>
                  <ViewerFooter receptor={receptor} />
                </section>
              )}

              {/* Inspector */}
              <aside className="flex w-[340px] shrink-0 flex-col gap-4">
                {isScreen && active === 'ligands' ? (
                  <ScreeningLibraryPanel onRun={runDocking} running={isRunning}
                    smiles={screenSmiles} setSmiles={setScreenSmiles}
                    count={parseSmilesLibrary(screenSmiles).length} />
                ) : (
                  <StepPanel active={active} steps={steps} exhaustiveness={exhaustiveness}
                    setExhaustiveness={setExhaustiveness} scoring={scoring} setScoring={setScoring}
                    onRun={runDocking} running={isRunning} isScreen={isScreen}
                    engine={engine} busy={busy} receptor={receptor} box={box} setBox={setBox}
                    ligandSmiles={ligandSmiles} setLigandSmiles={setLigandSmiles}
                    ligandFile={ligandFile} setLigandFile={setLigandFile} onClearLigand={clearLigand} ligPreview={ligPreview}
                    protonate={protonate} setProtonate={setProtonate}
                    keepWaters={keepWaters} onToggleWaters={toggleKeepWaters}
                    keepIons={keepIons} onToggleIons={toggleKeepIons}
                    removedComp={removedComp} onToggleComponent={toggleComponent}
                    receptorPh={receptorPh} onChangePh={setReceptorPh} onCommitPh={commitReceptorPh}
                    onFetchReceptor={loadReceptorById} onUploadReceptor={loadReceptorFile}
                    onClearReceptor={clearReceptor}
                    cov={{
                      enabled: covalent, onToggle: () => setCovalent((v) => !v),
                      residues: covResidues, residue: covResidue, setResidue: setCovResidue,
                      loading: covResLoading, warheads: covWarheads,
                      override: covOverride, setOverride: setCovOverride,
                      maxDist: covMaxDist, setMaxDist: setCovMaxDist,
                      mode: covMode, setMode: setCovMode,
                      detected: ligPreview.data?.warhead, isScreen,
                    }} />
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

// Translate a ligand PDB block so its centroid sits at the grid-box centre — a
// pre-docking placement so the compound appears inside the search box.
function placeLigandInBox(pdbText, center) {
  const lines = (pdbText || '').split('\n')
  const isAtom = (l) => l.startsWith('ATOM') || l.startsWith('HETATM')
  const xyz = (l) => [parseFloat(l.slice(30, 38)), parseFloat(l.slice(38, 46)), parseFloat(l.slice(46, 54))]
  const atoms = lines.filter(isAtom).map(xyz).filter((a) => a.every((v) => !isNaN(v)))
  if (!atoms.length) return pdbText
  const c = atoms.reduce((s, a) => [s[0] + a[0], s[1] + a[1], s[2] + a[2]], [0, 0, 0]).map((v) => v / atoms.length)
  const d = [center.x - c[0], center.y - c[1], center.z - c[2]]
  const f8 = (v) => v.toFixed(3).padStart(8)
  return lines.map((l) => {
    if (!isAtom(l)) return l
    const [x, y, z] = xyz(l)
    if ([x, y, z].some((v) => isNaN(v))) return l
    return l.slice(0, 30) + f8(x + d[0]) + f8(y + d[1]) + f8(z + d[2]) + l.slice(54)
  }).join('\n')
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
function Sidebar({ active, setActive, hasResults, steps, mode, switchMode, cov }) {
  const [cite, setCite] = useState(false)
  const [docs, setDocs] = useState(false)
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

      {/* Covalent mode card */}
      {cov && (
        <div className="mt-2 px-3">
          <CovalentModeCard {...cov} onConfigure={() => setActive('site')} />
        </div>
      )}

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

      <div className="mt-auto p-3">
        <button onClick={() => setDocs(true)}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-300 transition hover:bg-ink-800/70 hover:text-white">
          <DocsIcon className="h-4 w-4 text-accent" />
          <span className="text-[12px] font-medium">Documentation</span>
        </button>
        <button onClick={() => setCite(true)}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-300 transition hover:bg-ink-800/70 hover:text-white">
          <QuoteIcon className="h-4 w-4 text-accent" />
          <span className="text-[12px] font-medium">Cite DDS</span>
        </button>
        <div className="mt-1.5 px-2.5 text-[10px] text-slate-600">DDS {DOC_VERSION}</div>
      </div>

      {cite && <CiteModal onClose={() => setCite(false)} />}
      {docs && <DocsModal onClose={() => setDocs(false)} />}
    </div>
  )
}

// Left-panel covalent switch — sits under Single/Virtual. Turning it on reveals
// the target controls (residue, warhead, distance) in the Binding Site step.
function CovalentModeCard({ enabled, onToggle, targetLabel, warheadLabel, hasReceptor, mode, onConfigure }) {
  return (
    <div className={`rounded-xl border p-2.5 transition ${enabled
      ? 'border-accent/50 bg-accent/[0.07] shadow-[0_0_22px_-8px_rgba(45,212,191,0.65)]'
      : 'border-ink-700/60 bg-ink-800/40'}`}>
      <div className="flex items-center gap-2.5">
        <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition ${enabled ? 'bg-accent text-ink-950' : 'bg-ink-700 text-slate-400'}`}>
          <LinkIcon className="h-4 w-4" />
        </div>
        <button onClick={onToggle} className="min-w-0 flex-1 text-left">
          <div className="text-[12.5px] font-semibold text-white">Covalent docking</div>
          <div className="text-[10px] text-slate-500">{enabled ? (mode === 'tethered' ? 'Bond-restrained · tethered' : 'Geometry-guided') : 'Off · standard docking'}</div>
        </button>
        <button onClick={onToggle} title={enabled ? 'Turn off' : 'Turn on'}
          className={`relative h-[20px] w-[36px] shrink-0 rounded-full transition ${enabled ? 'bg-accent' : 'bg-ink-600'}`}>
          <span className={`absolute top-[2px] h-[16px] w-[16px] rounded-full bg-ink-950 shadow transition-all ${enabled ? 'right-[2px]' : 'left-[2px]'}`} />
        </button>
      </div>
      {enabled && (
        <button onClick={onConfigure}
          className="mt-2 flex w-full items-center gap-2 rounded-lg bg-ink-900/60 px-2.5 py-1.5 text-left ring-1 ring-accent/20 transition hover:ring-accent/40">
          {targetLabel ? (
            <>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-accent">{targetLabel}</span>
              {warheadLabel && <span className="max-w-[96px] shrink-0 truncate text-[9.5px] text-slate-500">{warheadLabel}</span>}
            </>
          ) : (
            <>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
              <span className="min-w-0 flex-1 text-[10.5px] text-amber">{hasReceptor ? 'Pick a residue in Binding Site' : 'Load a receptor to set target'}</span>
              <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            </>
          )}
        </button>
      )}
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
function TopBar({ onRun, running, bestAffinity, isScreen, covalent, receptorName, ligandCount, scoring, activeJob, runningCount, onOpenJobs, onClear, hasReceptor }) {
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
        {hasReceptor && (
          <button onClick={onClear} title="Clear workspace and start a new run, background jobs keep running — track them in Jobs."
            className="flex items-center gap-2 rounded-lg bg-ink-800/70 px-3 py-2 text-[13px] font-medium text-slate-300 transition hover:bg-ink-700 hover:text-white">
            <RefreshIcon className="h-4 w-4" /> New Run
          </button>
        )}
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
          className={`flex items-center gap-2 rounded-xl bg-gradient-to-r from-accent to-accent-dim px-4 py-2 font-semibold text-ink-950 shadow-lg transition hover:brightness-110 disabled:opacity-60 ${covalent ? 'text-[11px]' : 'text-[13px]'}`}>
          {running
            ? <><Spinner /> {covalent ? (isScreen ? 'Covalent screening…' : 'Covalent docking…') : (isScreen ? 'Screening…' : 'Docking…')}</>
            : <><PlayIcon className="h-4 w-4" />
                {covalent ? (isScreen ? 'Run Covalent Screening' : 'Run Covalent Docking') : (isScreen ? 'Run Screening' : 'Run Docking')}
                {covalent && <span className="ml-0.5 font-medium text-ink-950/70">· Vina</span>}
              </>}
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
  removedComp, onToggleComponent, receptorPh, onChangePh, onCommitPh,
  onFetchReceptor, onUploadReceptor, onClearReceptor, cov }) {
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
          <div className="flex items-center gap-2.5 px-1">
            <span className="w-24 shrink-0 text-[11px] text-slate-400">Protonation pH</span>
            <input type="range" min="4" max="9" step="0.5" value={receptorPh}
              onChange={(e) => onChangePh(+e.target.value)}
              onMouseUp={(e) => onCommitPh(+e.target.value)}
              onKeyUp={(e) => onCommitPh(+e.target.value)}
              className="flex-1 accent-accent" />
            <span className="w-9 text-right font-mono text-[11px] text-accent">{Number(receptorPh).toFixed(1)}</span>
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
              {receptor.components?.length > 0 && (
                <div className="mt-2 border-t border-emerald-500/20 pt-2">
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Structure · delete parts as needed</div>
                  <div className="space-y-1">
                    {receptor.components.map((c) => (
                      <div key={c.key} className="flex items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COMP_COLOR[c.kind] || '#64748b' }} />
                        <span className={`text-[11px] ${c.removed ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{c.label}</span>
                        <span className="truncate text-[10px] text-slate-500">{c.detail}</span>
                        <button onClick={() => onToggleComponent(c.key)} title={c.removed ? 'Restore' : 'Delete from structure'}
                          className={`ml-auto flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium ${c.removed ? 'bg-ink-700 text-slate-200 hover:bg-ink-600' : 'bg-red-500/15 text-red-300 hover:bg-red-500/25'}`}>
                          {c.removed ? 'Restore' : <><TrashIcon className="h-3 w-3" /> Remove</>}
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
                    Deletions rebuild the docking structure. The grid box stays put; the Ligand menu is independent.
                  </div>
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
          <p className="text-[11px] leading-relaxed text-slate-400">Search box (Å) · auto-centred on the detected site.</p>
          {box && <AxisTriple label="Center" values={box.center} step={0.5} onChange={setCenter} />}
          {box && <AxisTriple label="Size" values={box.size} step={1} min={6} max={40} onChange={setSize} />}
          {receptor && cov?.enabled && <CovalentCard {...cov} />}
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
            className={`w-full rounded-xl bg-gradient-to-r from-accent to-accent-dim py-2.5 font-semibold text-ink-950 hover:brightness-110 disabled:opacity-50 ${cov?.enabled ? 'text-[12px]' : 'text-[13px]'}`}>
            {running
              ? (isScreen ? 'Screening…' : 'Docking…')
              : cov?.enabled
                ? (isScreen ? 'Run Covalent Screening · Vina' : 'Run Covalent Docking · Vina')
                : (isScreen ? 'Screen library' : 'Run AutoDock Vina')}
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

// Covalent docking controls — lives in the Binding Site step. Pick a reactive
// residue (nucleophiles in the box), auto-detect the ligand's warhead (with an
// override), and set the acceptance distance. Works for docking and screening.
function CovalentCard({ enabled, onToggle, residues, residue, setResidue, loading, warheads,
  override, setOverride, maxDist, setMaxDist, mode, setMode, detected, isScreen }) {
  const sel = (residues || []).find((r) => r.key === residue)
  const tethered = mode === 'tethered'
  return (
    <div className="rounded-xl border border-accent/40 bg-accent/[0.05] p-3">
      <div className="flex items-center gap-2">
        <LinkIcon className="h-4 w-4 text-accent" />
        <span className="text-[12.5px] font-semibold text-white">Covalent target</span>
        <span className="ml-auto rounded-full bg-accent/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">Active</span>
      </div>

      {/* method */}
      <div className="mt-3">
        <div className="mb-1 text-[10.5px] font-medium text-slate-400">Method</div>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-ink-800/80 p-0.5">
          {[['geometry', 'Geometry-guided'], ['tethered', 'Bond-restrained']].map(([id, label]) => (
            <button key={id} onClick={() => setMode(id)}
              className={`rounded-md py-1.5 text-[11px] font-medium transition ${mode === id ? 'bg-accent text-ink-950' : 'text-slate-400 hover:text-slate-200'}`}>
              {label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          {tethered
            ? 'Bond-restrained: the top pose is refined so the warhead forms the covalent bond at its ideal length.'
            : 'Fast: poses are ranked by how close the warhead comes to the residue (no bond enforced).'}
        </p>
      </div>

      <div className="mt-3 space-y-3">
          {/* reactive residue */}
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-medium text-slate-400">
              Reactive residue
              {loading && <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />}
            </div>
            {(residues || []).length === 0 ? (
              <p className="rounded-md bg-amber/10 px-2 py-1.5 text-[10.5px] leading-relaxed text-amber">
                {loading ? 'Scanning the box…' : 'No Cys/Ser/Thr/Lys/Tyr/His inside the box. Widen or recentre the grid.'}
              </p>
            ) : (
              <div className="relative">
                <select value={residue || ''} onChange={(e) => setResidue(e.target.value)}
                  className="w-full appearance-none rounded-lg bg-ink-900 px-3 py-2 font-mono text-[12px] text-slate-200 outline-none ring-1 ring-ink-700 focus:ring-accent/60">
                  {residues.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.residue} · {r.atom_label}{r.dist_to_center != null ? `  (${r.dist_to_center} Å)` : ''}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              </div>
            )}
            {sel && <div className="mt-1 text-[10px] text-slate-500">Nucleophile {sel.atom} ({sel.atom_label}) · chain {sel.chain}</div>}
          </div>

          {/* warhead */}
          <div>
            <div className="mb-1 flex items-center justify-between text-[10.5px] font-medium text-slate-400">
              <span>Warhead</span>
              {override === 'auto' && !isScreen && (detected
                ? <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9.5px] text-emerald-400">auto-detected</span>
                : <span className="rounded bg-amber/15 px-1.5 py-0.5 text-[9.5px] text-amber">none found</span>)}
            </div>
            {override === 'auto' && (
              <div className="mb-1.5 rounded-lg bg-ink-900/70 px-3 py-2 text-[11.5px] ring-1 ring-ink-700">
                {isScreen ? <span className="text-slate-300">Auto-detected per compound</span>
                  : detected ? <span className="font-medium text-amber-300">{detected.label}</span>
                  : <span className="text-slate-500">No electrophilic warhead in this ligand</span>}
              </div>
            )}
            <div className="relative">
              <select value={override} onChange={(e) => setOverride(e.target.value)}
                className="w-full appearance-none rounded-lg bg-ink-900 px-3 py-2 text-[12px] text-slate-200 outline-none ring-1 ring-ink-700 focus:ring-accent/60">
                <option value="auto">Auto-detect warhead</option>
                {(warheads || []).map((w) => <option key={w.name} value={w.name}>{w.label}</option>)}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            </div>
          </div>

          {/* max bond distance — geometry mode only */}
          {!tethered && (
            <div>
              <div className="mb-1 flex items-center justify-between text-[10.5px] font-medium text-slate-400">
                <span>Max bond distance</span>
                <span className="font-mono text-accent">{Number(maxDist).toFixed(1)} Å</span>
              </div>
              <input type="range" min="2.5" max="5" step="0.1" value={maxDist}
                onChange={(e) => setMaxDist(+e.target.value)} className="w-full accent-accent" />
            </div>
          )}

          <p className="border-t border-ink-700/60 pt-2 text-[10px] leading-relaxed text-slate-500">
            {tethered
              ? <>The warhead is tethered to {sel ? `${sel.residue} ${sel.atom_label}` : 'the residue'} at its ideal bond length and the ligand is force-field refined.</>
              : <>Poses are ranked by affinity <span className="text-slate-400">and</span> how closely the warhead reaches {sel ? `${sel.residue} ${sel.atom_label}` : 'the residue'}.</>}
          </p>
      </div>
    </div>
  )
}

// compact X/Y/Z numeric group — replaces three full-width slider rows to save space
function AxisTriple({ label, values, step = 1, min = -999, max = 999, onChange }) {
  const clamp = (v) => Math.min(max, Math.max(min, +v.toFixed(3)))
  return (
    <div>
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">{label} (Å)</div>
      <div className="grid grid-cols-3 gap-2">
        {['x', 'y', 'z'].map((ax) => (
          <div key={ax} className="flex items-center gap-1 rounded-lg bg-ink-900 pl-2 pr-1 py-1 ring-1 ring-ink-700 focus-within:ring-accent/60">
            <span className="text-[10px] font-semibold text-accent/80">{ax.toUpperCase()}</span>
            <input type="number" step={step} min={min} max={max} value={values[ax]}
              onChange={(e) => onChange(ax, +e.target.value)}
              className="no-spinner w-full min-w-0 bg-transparent text-right font-mono text-[12px] text-slate-200 outline-none" />
            <div className="flex shrink-0 flex-col">
              <button tabIndex={-1} onClick={() => onChange(ax, clamp(values[ax] + step))}
                className="grid h-[13px] w-4 place-items-center rounded-sm text-slate-500 hover:bg-ink-700 hover:text-accent">
                <CaretIcon className="h-2.5 w-2.5" dir="up" />
              </button>
              <button tabIndex={-1} onClick={() => onChange(ax, clamp(values[ax] - step))}
                className="grid h-[13px] w-4 place-items-center rounded-sm text-slate-500 hover:bg-ink-700 hover:text-accent">
                <CaretIcon className="h-2.5 w-2.5" dir="down" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CaretIcon({ dir = 'down', ...p }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" {...p}>
      {dir === 'up' ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
    </svg>
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
function ResultsView({ result, receptorName, receptor, ligandSmiles }) {
  const [viewMode, setViewMode] = useState('off') // 'off' (structure only) | '3d' | '2d' — interaction view
  const [exportOpen, setExportOpen] = useState(false)
  const [validateOpen, setValidateOpen] = useState(false)
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
    saveFile(`${(receptorName || 'complex')}_minimized.pdb`, minRes.pdb, 'chemical/x-pdb')
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

  // re-docking validation is only meaningful when the receptor carries a co-crystal
  // ligand (cognate re-docking); the button is hidden otherwise
  // native reference comes from the job result (persisted) or the loaded receptor
  const nativePdb = result?.native_ligand_pdb
  const nativeSmiles = result?.native_ligand_smiles || receptor?.native_ligand_smiles
  const canValidate = !!(nativePdb || receptor?.native_ligand_smiles) && poses.some((p) => p.complex_id)

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-white">Docking Results</h2>
          <p className="text-[11px] text-slate-500">{poses.length} poses · AutoDock Vina · real run</p>
        </div>
        <div className="flex items-center gap-2">
          {canValidate && (
            <button onClick={() => setValidateOpen(true)} title="Compare the docked poses to the co-crystallised ligand"
              className="flex items-center gap-2 rounded-xl bg-emerald-500/15 px-4 py-2 text-[13px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30 transition hover:bg-emerald-500/25">
              <CheckIcon className="h-4 w-4" /> Validate Docking Results
            </button>
          )}
          <button onClick={() => setExportOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-accent to-accent-dim px-4 py-2 text-[13px] font-semibold text-ink-950 shadow-lg hover:brightness-110">
            <ExportIcon className="h-4 w-4" /> Export &amp; Prepare
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Kpi label="Best affinity" value={fmt(best)} unit="kcal/mol" tone="accent" />
        <Kpi label="Ligand efficiency" value={fmt(result?.ligand_efficiency)} unit="kcal/heavy atom" />
        <Kpi label="Poses generated" value={poses.length} unit="modes" />
        <Kpi label="Drug-likeness (QED)" value={props.qed ?? '—'} unit={result?.lipinski_pass ? 'Lipinski ✓' : 'Lipinski ✗'} />
      </div>

      {result?.covalent && <CovalentBanner cov={result.covalent} />}

      <div className="grid grid-cols-4 gap-4">
        <div className="col-span-3 flex flex-col gap-4">
          <div className="glass rounded-2xl p-3">
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <h3 className="min-w-0 truncate text-[13px] font-semibold text-white">
                {viewMode === '2d' ? `Interaction map · Pose ${selNum}` : `Docked Complex · Pose ${selNum}${selPose === 0 ? ' (top)' : ''}`}
              </h3>
              <div className="flex shrink-0 items-center gap-2">
                {sel.covalent && <CovalentChip cov={sel.covalent} />}
                <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Interactions</span>
                <div className="flex rounded-lg bg-ink-800/80 p-0.5">
                  {[['off', 'Off'], ['3d', '3D'], ['2d', '2D']].map(([m, l]) => (
                    <button key={m} onClick={() => setViewMode(m)}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${viewMode === m ? 'bg-ink-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                      {l}
                    </button>
                  ))}
                </div>
                <span className="font-mono text-[12px] text-accent">{fmt(selAff)} kcal/mol</span>
              </div>
            </div>
            {viewMode === '2d' ? (
              <div className="overflow-hidden rounded-xl">
                <InteractionMap2D ligand={ligName} pose={selNum} affinity={selAff} interactions={selInter} ligand2d={result?.ligand_2d}
                  covalentBond={sel.covalent?.mode === 'tethered' && sel.covalent.warhead_atom != null
                    ? { ligAtom: sel.covalent.warhead_atom, residue: sel.covalent.residue, distance: sel.covalent.distance } : null} />
              </div>
            ) : (
              <>
                <div className="h-[360px]">
                  <MoleculeViewer style="cartoon" showLigand spin={false} showInteractions={viewMode === '3d'}
                    pdb={minRes?.pdb || selComplex} ligResn="LIG"
                    covalentTarget={sel.covalent && sel.covalent.nuc_xyz ? {
                      chain: sel.covalent.chain, resi: sel.covalent.nuc_resi, residueLabel: sel.covalent.residue,
                      atomLabel: sel.covalent.atom_label, nuc: sel.covalent.nuc_xyz,
                      warhead: sel.covalent.warhead_xyz, distance: sel.covalent.distance,
                      bonded: sel.covalent.mode === 'tethered',
                    } : null} />
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
              </>
            )}
          </div>

          <div className="glass rounded-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-white">Binding affinity by pose</h3>
              <span className="text-[10px] text-slate-500">click a bar to view that pose{poses.some((p) => p.rmsd_xray != null) ? ' · number = RMSD to X-ray (Å)' : ''}</span>
            </div>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={poses} margin={{ top: 16, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1c2842" vertical={false} />
                  <XAxis dataKey="pose" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={{ stroke: '#1c2842' }} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(45,212,191,0.06)' }} contentStyle={tooltipStyle} />
                  <Bar dataKey="affinity" radius={[4, 4, 0, 0]} cursor="pointer"
                    onClick={(data, index) => selectPose(typeof index === 'number' ? index : poses.findIndex((p) => p.pose === data?.pose))}>
                    {poses.map((p, i) => <Cell key={i} fill={i === selPose ? '#2dd4bf' : '#1c6e63'} />)}
                    <LabelList dataKey="rmsd_xray" content={RmsdBarLabel} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="glass rounded-2xl p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="min-w-0 truncate text-[12.5px] font-semibold text-white">Key interactions <span className="text-[10.5px] font-normal text-slate-500">· pose {selNum}</span></h3>
            </div>
            <div className="max-h-[220px] space-y-1.5 overflow-auto">
              {selInter.length === 0 && <p className="text-[11px] text-slate-500">No close contacts detected in this pose.</p>}
              {selInter.map((it, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: INT_COLORS[it.type] || '#64748b' }} />
                  <span className="shrink-0 font-mono text-[11.5px] text-slate-200">{it.residue}</span>
                  <span className="min-w-0 flex-1 truncate text-[10.5px] text-slate-500">{it.type}</span>
                  <span className="shrink-0 font-mono text-[11px] text-slate-400">{it.distance} Å</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 border-t border-ink-700/60 pt-2 text-[10px]">
              {Object.entries(INT_COLORS).map(([k, v]) => (
                <span key={k} className="flex items-center gap-1 text-slate-400">
                  <span className="h-2 w-2 rounded-full" style={{ background: v }} />{k}
                </span>
              ))}
            </div>
          </div>

          <div className="glass rounded-2xl p-3">
            <h3 className="mb-2 text-[12.5px] font-semibold text-white">Ligand properties</h3>
            <div className="grid grid-cols-2 gap-1.5 text-[11.5px]">
              {[['MW', props.mw], ['logP', props.logp], ['H-donors', props.hbd], ['H-acceptors', props.hba], ['TPSA', props.tpsa], ['Rot. bonds', props.rotatable]].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between rounded-lg bg-ink-800/50 px-2 py-1">
                  <span className="truncate text-slate-500">{k}</span><span className="ml-1 font-mono text-slate-200">{v ?? '—'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {exportOpen && (
        <ExportModal onClose={() => setExportOpen(false)} payload={{
          mode: 'single', target: (receptorName || 'Receptor'), pdb: (receptorName || ''),
          scoring: result?.params?.scoring || 'vina', exhaustiveness: result?.params?.exhaustiveness ?? 16, params: result?.params,
          ligand: ligName, pose: selNum, affinity: selAff, complex_pdb: selComplex,
          poses, interactions: selInter, rows: [{ name: ligName, affinity: best, mw: props.mw, logp: props.logp, qed: props.qed }],
        }} />
      )}

      {validateOpen && (
        <Modal onClose={() => setValidateOpen(false)}>
          <ValidationView poses={poses} nativePdb={nativePdb} nativeSmiles={nativeSmiles}
            ligandSmiles={result?.ligand_smiles || ligandSmiles} receptorId={receptor?.receptor_id}
            initialPose={selPose} ligand={ligName} />
        </Modal>
      )}
    </div>
  )
}

function fmt(v) { return v == null ? '—' : (v < 0 ? '−' + Math.abs(v).toFixed(1) : v.toFixed(1)) }

// small per-pose RMSD label above each affinity bar (cognate re-docking only)
function RmsdBarLabel({ x, y, width, value }) {
  if (value == null) return null
  return <text x={x + width / 2} y={y - 4} textAnchor="middle" fontSize="9" fontWeight="600" fill="#5eead4">{value}</text>
}

// Re-docking validation: pick any pose to see its RMSD + overlay on the co-crystal ligand.
function ValidationView({ poses, nativePdb, nativeSmiles, ligandSmiles, receptorId, initialPose = 0, ligand }) {
  const [idx, setIdx] = useState(Math.min(initialPose, (poses?.length || 1) - 1))
  const [ov, setOv] = useState({ status: 'loading' })
  const sel = poses[idx] || {}
  const covalent = !!(sel.covalent && sel.covalent.mode === 'tethered')

  useEffect(() => {
    let cancel = false
    if (!sel.complex_id) { setOv({ status: 'error', msg: 'No structure available for this pose.' }); return }
    setOv({ status: 'loading' })
    api.validateDocking({ receptor_id: receptorId, complex_id: sel.complex_id, ligand_smiles: ligandSmiles, native_pdb: nativePdb, native_smiles: nativeSmiles })
      .then((r) => { if (!cancel) setOv({ status: 'ok', data: r }) })
      .catch((e) => { const m = String(e?.message || e); if (!cancel) setOv({ status: 'error', msg: m === 'ENGINE_OFFLINE' ? 'Engine offline — start the DDS engine.' : m }) })
    return () => { cancel = true }
  }, [idx])

  const rmsd = ov.data?.rmsd ?? sel.rmsd_xray
  return (
    <div className="flex flex-col">
      <div className="border-b border-ink-700/60 px-5 py-3 pr-14">
        <h3 className="text-[14px] font-semibold text-white">Docking validation · re-docking RMSD</h3>
        <p className="text-[11px] text-slate-500">{ligand} vs co-crystallised ligand · pick a pose to compare</p>
      </div>
      <div className="p-4">
        {/* pose selector — each shows the affinity and RMSD to the crystal ligand */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {poses.map((p, i) => (
            <button key={i} onClick={() => setIdx(i)}
              className={`flex flex-col items-start rounded-lg px-2.5 py-1.5 text-left ring-1 transition ${i === idx ? 'bg-accent/15 ring-accent/40' : 'bg-ink-800/60 ring-ink-700/60 hover:bg-ink-700'}`}>
              <span className={`text-[11px] font-semibold ${i === idx ? 'text-white' : 'text-slate-300'}`}>Pose {p.pose}</span>
              <span className="text-[9.5px] text-slate-400"><span className="font-mono">{fmt(p.affinity)}</span> · {p.rmsd_xray != null ? <span className="font-mono text-accent">{p.rmsd_xray} Å</span> : '—'}</span>
            </button>
          ))}
        </div>

        {ov.status === 'loading' && (
          <div className="grid h-[420px] place-items-center text-slate-400">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
          </div>
        )}
        {ov.status === 'error' && (
          <div className="grid h-[300px] place-items-center px-8 text-center">
            <div>
              <div className="text-[13px] font-medium text-amber">{ov.msg}</div>
              <div className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-slate-500">Validation compares each docked pose with the co-crystallised ligand (cognate re-docking).</div>
            </div>
          </div>
        )}
        {ov.status === 'ok' && ov.data && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <div className="flex items-baseline gap-2 rounded-xl bg-accent/10 px-4 py-2 ring-1 ring-accent/30">
                <span className="text-[11px] text-slate-400">Heavy-atom RMSD · Pose {sel.pose}</span>
                <span className="font-mono text-[18px] font-bold text-accent">{rmsd} Å</span>
              </div>
              <span className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${rmsd <= 2 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
                {rmsd <= 2 ? '✓ reproduces the crystal pose (< 2 Å)' : '⚠ deviates from the crystal pose (> 2 Å)'}
              </span>
              <div className="flex items-center gap-3 text-[11px] text-slate-300">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: '#22c55e' }} /> Native (crystal)</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: '#e879f9' }} /> Docked</span>
              </div>
              <span className="ml-auto text-[10px] text-slate-500">{ov.data.matched_atoms}/{ov.data.n_atoms} atoms · {ov.data.method}</span>
            </div>
            <div className="h-[440px] overflow-hidden rounded-xl">
              <MoleculeViewer pdb={ov.data.overlay_pdb} ligResn="LIG" style="cartoon" showLigand spin={false} />
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-slate-500">
              Receptor (cartoon) with the docked pose (magenta) superimposed on the co-crystallised ligand (green). Use the PNG button at the top-right of the viewer to download.{covalent ? ' Covalent (tethered) pose compared via common-substructure alignment.' : ''}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// Covalent summary banner for the docking results header
function CovalentBanner({ cov }) {
  const ok = cov.compatible
  const tethered = cov.mode === 'tethered'
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-2.5 text-[12px] ${ok ? 'border-accent/30 bg-accent/[0.06]' : 'border-amber/30 bg-amber/[0.06]'}`}>
      <span className="flex items-center gap-1.5 font-semibold text-white"><LinkIcon className="h-3.5 w-3.5 text-accent" /> Covalent docking</span>
      <span className="rounded-full bg-ink-800/80 px-2 py-0.5 text-[10px] font-medium text-slate-300">{tethered ? 'Bond-restrained' : 'Geometry-guided'}</span>
      <span className="text-slate-400">Target <span className="font-mono text-slate-200">{cov.residue} {cov.atom_label}</span></span>
      {cov.warhead && <span className="text-slate-400">Warhead <span className="text-amber-300">{cov.warhead}</span></span>}
      {tethered && cov.moved != null && <span className="text-slate-400">Warhead pulled <span className="font-mono text-slate-200">{cov.moved} Å</span></span>}
      {cov.best_distance != null && (
        <span className={`ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[12px] font-semibold ${ok ? 'bg-accent/15 text-accent' : 'bg-amber/15 text-amber'}`}>
          {ok ? '✓' : '⚠'} {tethered ? 'bond' : 'warhead reach'} {cov.best_distance} Å
          <span className="font-sans text-[10px] font-normal text-slate-400">{tethered ? (cov.target ? `/ ${cov.target} Å ideal` : '') : `/ ${cov.max_dist} Å cutoff`}</span>
        </span>
      )}
      {cov.best_distance == null && <span className="ml-auto text-[11px] text-amber">no warhead detected in ligand</span>}
    </div>
  )
}

// Compact per-pose covalent distance chip
function CovalentChip({ cov }) {
  if (cov.distance == null) return <span className="rounded-md bg-amber/15 px-2 py-1 text-[10px] font-medium text-amber">no reach</span>
  const ok = cov.compatible
  return (
    <span className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium ${ok ? 'bg-accent/15 text-accent' : 'bg-amber/15 text-amber'}`}
      title={`Warhead → ${cov.residue} ${cov.atom_label}`}>
      <LinkIcon className="h-3 w-3" /> {cov.distance} Å
    </span>
  )
}

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
const CITATION = 'Mahmoud E Soliman, Drug Design Studio (DDS): An all-in-one Cross-Platform for Covalent/Non-Covalent Docking, Covalent Binders Virtual Screening and Protein-Ligand interaction analysis - Under Review'
const CITATION_BIBTEX = `@article{soliman2026dds,
  author  = {Soliman, Mahmoud E.},
  title   = {Drug Design Studio (DDS): An All-in-One Cross-Platform for Covalent/Non-Covalent Docking, Covalent Binders Virtual Screening and Protein-Ligand Interaction Analysis},
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
function LinkIcon(p) { return I(p, <><path d="M9 15l6-6M10.5 6.5l1-1a4 4 0 015.66 5.66l-1.5 1.5M13.5 17.5l-1 1a4 4 0 01-5.66-5.66l1.5-1.5" /></>) }
function ChevronDownIcon(p) { return I(p, <><path d="M6 9l6 6 6-6" /></>) }
function ChevronRightIcon(p) { return I(p, <><path d="M9 6l6 6-6 6" /></>) }
function RefreshIcon(p) { return I(p, <><path d="M3 12a9 9 0 0115.5-6.4L21 8M21 3v5h-5M21 12a9 9 0 01-15.5 6.4L3 16M3 21v-5h5" /></>) }
function DocsIcon(p) { return I(p, <><path d="M4 5a2 2 0 012-2h12v16H6a2 2 0 00-2 2zM8 3v16M11 7h4M11 10h4" /></>) }
