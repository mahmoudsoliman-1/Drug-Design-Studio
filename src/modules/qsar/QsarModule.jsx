import { useState, useEffect, useMemo, useRef } from 'react'
import * as api from '../../api.js'
import Logo from '../../components/Logo.jsx'
import DocsModal, { CiteModal } from '../../components/Documentation.jsx'
import { ExportMenu, RawFigure } from './FigExport.jsx'
import { saveFile } from '../../download.js'

// QSAR / 3D-QSAR & Pharmacophore module — ligand-based modelling from RDKit +
// scikit-learn (fast, offline, reliable). Guided 5-step workflow mirroring the
// other DDS modules, ending in a prospective design (DMTA) step. Sky accent.
const S = '#38bdf8'

const STEPS = [
  { id: 'dataset', label: 'Dataset', hint: 'ChEMBL · test case · paste', icon: DataIcon },
  { id: 'descriptors', label: 'Descriptors', hint: '2D · 3D · pharmacophore', icon: DescIcon },
  { id: 'model', label: 'Model', hint: 'Train + cross-validate', icon: ModelIcon },
  { id: 'validate', label: 'Validation', hint: 'Q²/AUC · Y-scramble · AD', icon: CheckIcon },
  { id: 'design', label: 'Design', hint: 'Enumerate · predict · rank', icon: DesignIcon },
]
const DESCRIPTORS = [['morgan', 'Morgan / ECFP4 fingerprint'], ['rdkit2d', 'RDKit 2D descriptors'],
  ['maccs', 'MACCS keys'], ['desc3d', '3D-QSAR (alignment-free)'], ['pharm2d', 'Pharmacophore fingerprint']]
const ALGOS = [['rf', 'Random Forest'], ['gbm', 'Gradient Boosting'], ['svm', 'Support Vector Machine'], ['pls', 'PLS regression']]
// common medicinal-chemistry substituents (label → attachment-fragment SMILES)
const RGROUP_PALETTE = [
  ['H', '[H]'], ['F', 'F'], ['Cl', 'Cl'], ['Br', 'Br'], ['Me', 'C'], ['Et', 'CC'],
  ['iPr', 'C(C)C'], ['cPr', 'C1CC1'], ['CF₃', 'C(F)(F)F'], ['OMe', 'OC'], ['OH', 'O'],
  ['NH₂', 'N'], ['CN', 'C#N'], ['NO₂', '[N+](=O)[O-]'], ['Ph', 'c1ccccc1'], ['Py', 'c1ccncc1'],
  ['CO₂H', 'C(=O)O'], ['CONH₂', 'C(=O)N'],
]
const EX_SCAFFOLD = 'O=C(N[*:1])c1ccc([*:2])cc1'

// Parse an uploaded CSV/TSV/space file into {smiles, y, task}. Detects the
// delimiter, an optional header row, and the SMILES + activity columns by name
// (falling back to first column = SMILES, last numeric column = activity).
function parseTable(text) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim())
  if (!lines.length) return { smiles: [], y: [], task: 'regression' }
  const delim = lines[0].includes('\t') ? '\t' : (lines[0].includes(';') && !lines[0].includes(',')) ? ';' : lines[0].includes(',') ? ',' : /\s{2,}|\s/
  const rows = lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, '')))
  const isNum = (x) => x !== '' && x != null && !isNaN(parseFloat(x))
  const nameRe = /smiles|smile|structure|canonical/i
  const valRe = /value|activ|pic50|pki|pkd|pchembl|ic50|ec50|\bki\b|label|class|measured|solub|logs|potency|\by\b|pec50/i
  const first = rows[0]
  const headerLike = first.some((c) => nameRe.test(c) || valRe.test(c)) || !first.some(isNum)
  let smi = 0, val = first.length - 1
  if (headerLike) {
    const si = first.findIndex((c) => nameRe.test(c)); if (si >= 0) smi = si
    const vi = first.findIndex((c) => valRe.test(c)); if (vi >= 0) val = vi
  }
  if (val === smi) val = smi === first.length - 1 ? Math.max(0, first.length - 2) : first.length - 1
  const data = headerLike ? rows.slice(1) : rows
  const extract = (si, vi) => {
    const s = [], y = []
    for (const r of data) {
      if (r.length <= Math.max(si, vi)) continue
      const v = parseFloat(r[vi])
      if (r[si] && !isNaN(v)) { s.push(r[si]); y.push(v) }
    }
    return { s, y }
  }
  let { s: smiles, y } = extract(smi, val)
  if (!smiles.length && data.length) {                    // fallback: last numeric column
    const probe = data[0]
    for (let i = probe.length - 1; i >= 0; i--) {
      if (i !== smi && isNum(probe[i])) { ({ s: smiles, y } = extract(smi, i)); break }
    }
  }
  return { smiles, y, task: new Set(y).size <= 2 ? 'classification' : 'regression' }
}

export default function QsarModule({ onSwitchModules, onHandoff }) {
  const [step, setStep] = useState('dataset')
  const [cite, setCite] = useState(false)
  const [docs, setDocs] = useState(false)
  const [report, setReport] = useState(false)
  const [error, setError] = useState('')

  const [dataset, setDataset] = useState(null)     // {name, task, smiles[], y[]}
  const [loading, setLoading] = useState('')
  const [chembl, setChembl] = useState('')
  const [pasteText, setPasteText] = useState('')

  const [descriptor, setDescriptor] = useState('morgan')
  const [algo, setAlgo] = useState('rf')
  const [split, setSplit] = useState('random')

  const [jobId, setJobId] = useState(null)
  const [building, setBuilding] = useState(false)
  const [result, setResult] = useState(null)

  // ---- design (DMTA) state ----
  const [mode, setMode] = useState('enumerate')          // 'enumerate' | 'list'
  const [scaffold, setScaffold] = useState('')
  const [rgroups, setRgroups] = useState({})             // { "1": [smi,...], ... }
  const [listText, setListText] = useState('CCO\nc1ccccc1O\nCC(=O)Oc1ccccc1C(=O)O')
  const [design, setDesign] = useState(null)

  const task = dataset?.task || 'regression'
  const positions = useMemo(() => {
    const s = new Set(); let m
    const re = /\[\*:(\d+)\]/g
    while ((m = re.exec(scaffold))) s.add(m[1])
    return [...s].sort((a, b) => +a - +b)
  }, [scaffold])
  const cleanRgroups = useMemo(() => {
    const o = {}; positions.forEach((p) => { o[p] = (rgroups[p] && rgroups[p].length) ? rgroups[p] : ['[H]'] })
    return o
  }, [positions, rgroups])
  const nAnalogs = useMemo(() => positions.reduce((n, p) => n * cleanRgroups[p].length, 1), [positions, cleanRgroups])

  // poll the build job
  useEffect(() => {
    if (!jobId) return
    let stop = false
    async function tick() {
      try {
        const full = await api.getJob(jobId)
        if (stop) return
        if (full.status !== 'running') {
          setBuilding(false); setJobId(null)
          if (full.status === 'done') { setResult(full.result); setStep('validate') }
          else setError(full.error || 'Model building failed.')
        }
      } catch { /* keep polling */ }
    }
    tick(); const t = setInterval(tick, 2000)
    return () => { stop = true; clearInterval(t) }
  }, [jobId])

  async function loadTestCase(name) {
    setLoading(name); setError('')
    try { const d = await api.qsarTestCase(name); setDataset(d); setStep('dataset') }
    catch (e) { setError(String(e.message || e)) } finally { setLoading('') }
  }
  async function fetchChembl() {
    if (!chembl.trim()) return
    setLoading('chembl'); setError('')
    try {
      const d = await api.qsarChembl({ target: chembl.trim(), activity_type: 'IC50', limit: 1500 })
      if (d.error) setError(d.error); else { setDataset({ ...d, name: chembl.trim(), target: d.target, source: 'chembl' }); setStep('dataset') }
    } catch (e) { setError(String(e.message || e)) } finally { setLoading('') }
  }
  function loadPaste() {
    const smiles = [], y = []
    for (const ln of pasteText.split('\n')) {
      const parts = ln.trim().split(/[,\s\t]+/)
      if (parts.length >= 2 && !isNaN(parseFloat(parts[parts.length - 1]))) {
        smiles.push(parts.slice(0, -1).join('')); y.push(parseFloat(parts[parts.length - 1]))
      }
    }
    if (smiles.length < 20) { setError('Need ≥20 rows of "SMILES,value".'); return }
    const uniq = new Set(y)
    setDataset({ name: 'pasted data', task: uniq.size <= 2 ? 'classification' : 'regression', smiles, y })
    setStep('dataset')
  }
  function uploadData(file) {
    if (!file) return
    setError('')
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const { smiles, y, task } = parseTable(String(reader.result))
        if (smiles.length < 20) { setError(`Found only ${smiles.length} valid "SMILES + value" rows — need ≥20. Check that the file has a SMILES column and a numeric activity column.`); return }
        setDataset({ name: file.name.replace(/\.[^.]+$/, ''), task, smiles, y })
        setStep('dataset')
      } catch (e) { setError('Could not read file: ' + (e.message || e)) }
    }
    reader.onerror = () => setError('Could not read the file.')
    reader.readAsText(file)
  }
  async function build() {
    if (!dataset) return
    setBuilding(true); setError(''); setResult(null); setDesign(null)
    try {
      const { job_id } = await api.qsarBuild({
        smiles: dataset.smiles, y: dataset.y, task, algo, descriptor, split, cv: 5, y_scramble: true,
      })
      setJobId(job_id)
    } catch (e) { setBuilding(false); setError(String(e.message || e)) }
  }
  async function runDesign() {
    if (!result?.model_id) return
    setLoading('design'); setError(''); setDesign(null)
    try {
      const payload = { model_id: result.model_id, max_n: 400 }
      if (mode === 'list') payload.smiles = listText.split('\n').map((s) => s.trim()).filter(Boolean)
      else { payload.scaffold = scaffold; payload.rgroups = cleanRgroups }
      const r = await api.qsarDesign(payload)
      if (r.error) setError(r.error); else setDesign(r)
    } catch (e) { setError(String(e.message || e)) } finally { setLoading('') }
  }
  function toggleRgroup(pos, smi) {
    setRgroups((prev) => {
      const cur = prev[pos] || []
      return { ...prev, [pos]: cur.includes(smi) ? cur.filter((x) => x !== smi) : [...cur, smi] }
    })
  }
  function loadExample() {
    setScaffold(EX_SCAFFOLD)
    setRgroups({ '1': ['C', 'CC', 'C(C)C'], '2': ['F', 'Cl', 'OC', 'C(F)(F)F', '[H]'] })
  }
  // target hint only when the dataset came from a ChEMBL target fetch
  const targetHint = dataset?.source === 'chembl' ? `${dataset.name}${dataset.target ? ` (${dataset.target})` : ''}` : null
  // Tier-1 hand-off: send the top-ranked designed candidates to the Docking module
  // as a virtual-screening library (the user supplies the receptor there).
  function sendToDocking() {
    if (!onHandoff || !design?.analogs?.length) return
    const top = design.analogs.slice(0, 15).map((r) => ({ smiles: r.smiles, id: `cand${r.rank}` }))
    onHandoff('docking', { screen: true, ligands: top, targetHint })
  }
  function newRun() {
    setStep('dataset'); setDataset(null); setResult(null); setDesign(null); setJobId(null)
    setBuilding(false); setError(''); setChembl(''); setPasteText(''); setScaffold(''); setRgroups({})
  }

  const title = dataset ? `${dataset.name} · ${dataset.smiles.length} cpds` : 'New QSAR model'

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
        <div className="px-4 pb-2 pt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Workflow</div>
        <nav className="flex flex-col gap-1 px-3">
          {STEPS.map((s, i) => {
            const active = step === s.id
            const locked = ['descriptors', 'model', 'validate', 'design'].includes(s.id) && !dataset
            const lockedV = s.id === 'design' && !result
            const dis = locked || lockedV
            return (
              <button key={s.id} disabled={dis} onClick={() => setStep(s.id)}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${active ? '' : 'hover:bg-ink-800/70'} ${dis ? 'cursor-not-allowed opacity-40' : ''}`}
                style={active ? { background: 'rgba(56,189,248,0.10)', boxShadow: 'inset 0 0 0 1px rgba(56,189,248,0.35)' } : {}}>
                <div className="grid h-8 w-8 place-items-center rounded-lg text-[11px] font-bold"
                  style={active ? { background: S, color: '#04202e' } : { background: '#1b2436', color: '#94a3b8' }}>{i + 1}</div>
                <div className="min-w-0 flex-1">
                  <div className={`text-[13px] font-semibold ${active ? 'text-white' : 'text-slate-300'}`}>{s.label}</div>
                  <div className="truncate text-[11px] text-slate-500">{s.hint}</div>
                </div>
                <s.icon className="h-4 w-4" color={active ? S : '#475569'} />
              </button>
            )
          })}
        </nav>
        <div className="mt-auto p-3">
          <button onClick={() => setDocs(true)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-300 transition hover:bg-ink-800/70 hover:text-white">
            <BookIcon className="h-4 w-4" color={S} /><span className="text-[12px] font-medium">Documentation</span>
          </button>
          <button onClick={() => setCite(true)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-300 transition hover:bg-ink-800/70 hover:text-white">
            <QuoteIcon className="h-4 w-4" color={S} /><span className="text-[12px] font-medium">Cite DDS</span>
          </button>
          <div className="mt-1.5 px-2.5 text-[10px] text-slate-600">DDS v4.0.0 · QSAR</div>
        </div>
      </div>

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-ink-700/60 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[15px] font-semibold text-white">
              <span className="h-2 w-2 rounded-full" style={{ background: S }} />
              <span className="truncate">{title}</span>
              <span className="text-slate-500">· QSAR / 3D-QSAR</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">Ligand-based modelling · RDKit + scikit-learn · {task}</div>
          </div>
          <div className="flex items-center gap-2.5">
            <button onClick={newRun} className="inline-flex items-center gap-2 rounded-xl bg-ink-800/70 px-3 py-2 text-[12px] font-medium text-slate-300 ring-1 ring-ink-600 transition hover:bg-ink-700 hover:text-white">
              <NewIcon className="h-4 w-4" /> New run
            </button>
            {result && (
              <button onClick={() => setReport(true)} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold ring-1 transition"
                style={{ background: 'rgba(56,189,248,0.15)', color: '#7dd3fc', borderColor: 'rgba(56,189,248,0.4)' }}>
                <ExportIcon className="h-4 w-4" /> Export report
              </button>
            )}
            <button onClick={onSwitchModules} className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold ring-1 transition"
              style={{ background: 'rgba(56,189,248,0.12)', color: '#7dd3fc', borderColor: 'rgba(56,189,248,0.4)' }}>
              <GridIcon className="h-4 w-4" /> Switch Module
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 border-b border-ink-700/40 bg-sky-500/[0.05] px-4 py-1.5 text-[11px] text-slate-400">
          <GlobeIcon className="h-3.5 w-3.5" color={S} /> Ligand-based QSAR · descriptors &amp; models run locally (RDKit + scikit-learn); ChEMBL fetch queries the database online.
        </div>
        {error && (
          <div className="flex items-center justify-between border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-[12px] text-red-300">
            <span>{error}</span><button onClick={() => setError('')} className="text-red-300/70 hover:text-red-200">✕</button>
          </div>
        )}

        <main className="flex min-h-0 flex-1 gap-4 p-4">
          <section className="glass relative flex min-w-0 flex-1 flex-col rounded-2xl p-3">
            <Center step={step} dataset={dataset} result={result} task={task} building={building}
              design={design} onLoadTest={loadTestCase} loading={loading}
              onSendToDocking={onHandoff ? sendToDocking : null} targetHint={targetHint} />
          </section>
          <aside className="flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto">
            {step === 'model' && (
              <button onClick={build} disabled={building || !dataset}
                className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-semibold shadow-lg transition disabled:opacity-60"
                style={{ background: S, color: '#04202e' }}>
                {building ? <Spinner /> : <PlayIcon className="h-4 w-4" />} {building ? 'Training…' : 'Build model'}
              </button>
            )}
            {step === 'design' && (
              <button onClick={runDesign} disabled={loading === 'design' || !result || (mode === 'enumerate' && !positions.length)}
                className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-semibold shadow-lg transition disabled:opacity-60"
                style={{ background: S, color: '#04202e' }}>
                {loading === 'design' ? <Spinner /> : <PlayIcon className="h-4 w-4" />}
                {loading === 'design' ? 'Scoring…' : mode === 'enumerate' ? `Enumerate & rank (${nAnalogs})` : 'Score & rank'}
              </button>
            )}
            <Setup step={step} dataset={dataset} loading={loading}
              chembl={chembl} setChembl={setChembl} fetchChembl={fetchChembl} onLoadTest={loadTestCase}
              pasteText={pasteText} setPasteText={setPasteText} loadPaste={loadPaste} uploadData={uploadData}
              descriptor={descriptor} setDescriptor={setDescriptor} algo={algo} setAlgo={setAlgo}
              split={split} setSplit={setSplit} task={task} result={result}
              mode={mode} setMode={setMode} scaffold={scaffold} setScaffold={setScaffold}
              positions={positions} rgroups={rgroups} toggleRgroup={toggleRgroup}
              listText={listText} setListText={setListText} loadExample={loadExample} nAnalogs={nAnalogs} />
          </aside>
        </main>
      </div>

      {docs && <DocsModal onClose={() => setDocs(false)} initialModule="qsar" />}
      {cite && <CiteModal onClose={() => setCite(false)} />}
      {report && <ReportModal dataset={dataset} result={result} task={task} descriptor={descriptor} algo={algo} design={design} onClose={() => setReport(false)} />}
    </div>
  )
}

/* ================================ center ================================ */
function Center({ step, dataset, result, task, building, design, onLoadTest, loading, onSendToDocking, targetHint }) {
  if (building) return <Msg spinner title="Training &amp; validating model…" sub="Featurizing, cross-validating and running the Y-scramble control. This runs as a background job." />
  if (step === 'dataset' && !dataset) return <DatasetEmpty onLoadTest={onLoadTest} loading={loading} />
  if (step === 'dataset' && dataset) return <DatasetPreview dataset={dataset} />
  if (step === 'descriptors') return <StageInfo title="Molecular descriptors"
    sub="Each molecule is turned into a numerical descriptor vector. Morgan/ECFP fingerprints are the fast, reliable default; RDKit 2D descriptors, alignment-free 3D-QSAR descriptors and pharmacophore fingerprints are also available. Choose on the right, then go to Model." />
  if (step === 'model') return <StageInfo title="Train &amp; cross-validate"
    sub="A machine-learning model (Random Forest by default) is trained on 80% of the data with 5-fold cross-validation, then evaluated on a held-out 20% test set. Choose the algorithm and split on the right and press Build model." />
  if (step === 'validate') return result ? <Validation result={result} task={task} /> : <Msg title="No model yet" sub="Build a model first." />
  if (step === 'design') return <DesignView design={design} task={task} loading={loading === 'design'} onSendToDocking={onSendToDocking} targetHint={targetHint} />
  return null
}

function DatasetEmpty({ onLoadTest, loading }) {
  return (
    <div className="grid h-full place-items-center rounded-xl bg-ink-950/40 text-center">
      <div className="max-w-md">
        <div className="text-[15px] font-semibold text-slate-300">Load a dataset to begin</div>
        <div className="mx-auto mt-1 text-[12px] text-slate-500">Fetch a target's bioactivities from ChEMBL, paste your own SMILES + activity, or load a reproducibility test case.</div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button onClick={() => onLoadTest('esol')} disabled={!!loading}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold ring-1"
            style={{ background: 'rgba(56,189,248,0.15)', color: '#7dd3fc', borderColor: 'rgba(56,189,248,0.4)' }}>
            <BeakerIcon className="h-4 w-4" /> Test case · ESOL (solubility)
          </button>
          <button onClick={() => onLoadTest('bbbp')} disabled={!!loading}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold ring-1"
            style={{ background: 'rgba(56,189,248,0.15)', color: '#7dd3fc', borderColor: 'rgba(56,189,248,0.4)' }}>
            <BeakerIcon className="h-4 w-4" /> Test case · BBBP (classification)
          </button>
        </div>
      </div>
    </div>
  )
}
function DatasetPreview({ dataset }) {
  const ys = dataset.y
  const [showStruct, setShowStruct] = useState(false)
  const [dep, setDep] = useState(null)
  const stats = useMemo(() => {
    const n = ys.length, mn = Math.min(...ys), mx = Math.max(...ys), mean = ys.reduce((a, b) => a + b, 0) / n
    return { n, mn, mx, mean }
  }, [ys])
  useEffect(() => {
    if (!showStruct) return
    let stop = false
    const n = Math.min(12, dataset.smiles.length)
    const legends = dataset.smiles.slice(0, n).map((_, i) => `${dataset.y[i].toFixed(2)}`)
    api.qsarDepict({ smiles: dataset.smiles.slice(0, n), legends, pharmacophore: false, per_row: 4 })
      .then((d) => { if (!stop) setDep(d.svg || null) }).catch(() => { if (!stop) setDep(null) })
    return () => { stop = true }
  }, [showStruct, dataset])
  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="text-[14px] font-semibold text-white">{dataset.name} <span className="text-[12px] font-normal text-slate-500">· {dataset.task}</span></div>
        <div className="flex gap-1">
          {[['table', 'Table'], ['struct', 'Structures']].map(([k, lbl]) => (
            <button key={k} onClick={() => setShowStruct(k === 'struct')} className={`rounded-lg px-2.5 py-1 text-[11px] ring-1 ${(k === 'struct') === showStruct ? 'text-white' : 'text-slate-400 ring-ink-700'}`}
              style={(k === 'struct') === showStruct ? { background: 'rgba(56,189,248,0.12)', borderColor: 'rgba(56,189,248,0.5)' } : {}}>{lbl}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <Stat label="molecules" value={stats.n} />
        <Stat label="activity min" value={stats.mn.toFixed(2)} />
        <Stat label="activity max" value={stats.mx.toFixed(2)} />
        <Stat label="mean" value={stats.mean.toFixed(2)} />
      </div>
      {showStruct ? (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl bg-ink-950/40 p-2 ring-1 ring-ink-700/50">
          {dep ? <div className="rounded-lg bg-white p-2"><RawFigure svg={dep} name="DDS_QSAR_dataset_structures" /></div>
            : <div className="grid h-40 place-items-center text-[12px] text-slate-500"><span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500/30 border-t-sky-400" /></div>}
          <div className="mt-1.5 px-1 text-[10.5px] text-slate-500">First {Math.min(12, dataset.smiles.length)} molecules · legend shows the measured activity value.</div>
        </div>
      ) : (
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl bg-ink-950/40 p-2 ring-1 ring-ink-700/50">
        <table className="w-full text-[11.5px]">
          <thead className="sticky top-0 bg-ink-850 text-slate-400"><tr><th className="px-2 py-1.5 text-left">SMILES</th><th className="px-2 py-1.5 text-right">activity</th></tr></thead>
          <tbody>{dataset.smiles.slice(0, 60).map((s, i) => (
            <tr key={i} className="border-t border-ink-800/50"><td className="px-2 py-1 font-mono text-[10.5px] text-slate-300">{s.length > 48 ? s.slice(0, 47) + '…' : s}</td><td className="px-2 py-1 text-right text-slate-300">{dataset.y[i].toFixed(2)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      )}
    </div>
  )
}
function StageInfo({ title, sub }) {
  return <div className="grid h-full place-items-center rounded-xl bg-ink-950/40 text-center"><div className="max-w-lg"><div className="text-[15px] font-semibold text-slate-200">{title}</div><div className="mx-auto mt-2 text-[12.5px] leading-relaxed text-slate-400">{sub}</div></div></div>
}

/* wraps any <svg> figure in a white card with an export menu */
function FigCard({ name, children }) {
  const ref = useRef(null)
  return (
    <div className="relative rounded-xl bg-white p-2 ring-1 ring-ink-700/50">
      <div className="absolute right-2 top-2 z-10"><ExportMenu svgRef={ref} name={name} /></div>
      {children(ref)}
    </div>
  )
}

function Validation({ result, task }) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      <div className="px-1 text-[14px] font-semibold text-white">Model validation <span className="text-[12px] font-normal text-slate-500">· {result.algo?.toUpperCase()} · {result.descriptor} · {result.split} split · n={result.n_total}</span></div>
      {task === 'regression' ? (
        <>
          <div className="grid grid-cols-5 gap-2">
            <Stat label="Q² (CV)" value={result.Q2?.toFixed(2)} good={result.Q2 > 0.5} />
            <Stat label="R² test" value={result.R2_test?.toFixed(2)} good={result.R2_test > 0.5} />
            <Stat label="RMSE" value={result.RMSE_test?.toFixed(2)} />
            <Stat label="MAE" value={result.MAE_test?.toFixed(2)} />
            <Stat label="Y-scr Q²" value={result.Yscramble_Q2_mean?.toFixed(2)} good={result.Yscramble_Q2_mean < 0.2} />
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <FigCard name="DDS_QSAR_predicted_vs_observed">{(ref) => <Scatter innerRef={ref} obs={result.obs} pred={result.pred} />}</FigCard>
            <ADbox result={result} />
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-5 gap-2">
            <Stat label="AUC (CV)" value={result.AUC_cv?.toFixed(2)} good={result.AUC_cv > 0.7} />
            <Stat label="AUC test" value={result.AUC_test?.toFixed(2)} good={result.AUC_test > 0.7} />
            <Stat label="accuracy" value={result.accuracy?.toFixed(2)} />
            <Stat label="MCC" value={result.MCC?.toFixed(2)} />
            <Stat label="Y-scr AUC" value={result.Yscramble_AUC_mean?.toFixed(2)} good={Math.abs(result.Yscramble_AUC_mean - 0.5) < 0.1} />
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <FigCard name="DDS_QSAR_ROC">{(ref) => <ROC innerRef={ref} obs={result.obs} proba={result.proba} auc={result.AUC_test} />}</FigCard>
            <ADbox result={result} extra={<div className="mt-2 text-[11px] text-slate-400">sensitivity {(result.sensitivity * 100).toFixed(0)}% · specificity {(result.specificity * 100).toFixed(0)}%</div>} />
          </div>
        </>
      )}
    </div>
  )
}
function ADbox({ result, extra }) {
  return (
    <div className="rounded-xl bg-ink-950/40 p-3 ring-1 ring-ink-700/50">
      <div className="text-[12.5px] font-semibold text-white">Reliability checks</div>
      <div className="mt-2 space-y-1.5 text-[11.5px] text-slate-400">
        <div className="flex justify-between"><span>Applicability domain (test in-domain)</span><span className="font-mono text-slate-300">{(result.AD_fraction_in * 100).toFixed(0)}%</span></div>
        <div className="flex justify-between"><span>Y-scramble control</span><span className="font-mono text-slate-300">{result.task === 'regression' ? `Q²=${result.Yscramble_Q2_mean?.toFixed(2)}` : `AUC=${result.Yscramble_AUC_mean?.toFixed(2)}`}</span></div>
        {extra}
      </div>
      {result.importance && (
        <div className="mt-3"><div className="text-[11px] font-semibold text-slate-300">Top descriptors</div>
          <div className="mt-1 space-y-1">{result.importance.slice(0, 6).map((f, i) => (
            <div key={i} className="flex items-center gap-2"><span className="w-28 truncate text-[10.5px] text-slate-400">{f.name}</span>
              <span className="h-1.5 flex-1 rounded-full" style={{ background: `linear-gradient(90deg, ${S} ${f.value / result.importance[0].value * 100}%, #1b2436 0)` }} /></div>
          ))}</div></div>
      )}
    </div>
  )
}

/* ------------------------------- design (DMTA) ------------------------------- */
function DesignView({ design, task, loading, onSendToDocking, targetHint }) {
  const rows = design?.analogs || []
  const [pharm, setPharm] = useState(true)
  const [dep, setDep] = useState(null)
  const [depLegend, setDepLegend] = useState([])
  const [depBusy, setDepBusy] = useState(false)
  useEffect(() => {
    if (!rows.length) { setDep(null); return }
    let stop = false; setDepBusy(true)
    const top = rows.slice(0, 12)
    const legends = top.map((r) => `#${r.rank}  ${r.prediction}  ${r.in_domain ? 'in' : 'out'}`)
    api.qsarDepict({ smiles: top.map((r) => r.smiles), legends, pharmacophore: pharm, per_row: 4 })
      .then((d) => { if (!stop) { setDep(d.svg || null); setDepLegend(d.legend || []) } })
      .catch(() => { if (!stop) setDep(null) })
      .finally(() => { if (!stop) setDepBusy(false) })
    return () => { stop = true }
  }, [design, pharm]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Msg spinner title="Enumerating &amp; scoring analogs…" sub="Building each candidate, predicting its activity and computing drug-likeness." />
  if (!design) return <StageInfo title="Prospective design — the DMTA loop"
    sub="Design candidate analogs before you synthesize them. On the right, either enumerate a scaffold with R-group variations, or paste a list of candidate SMILES. DDS predicts each one with your validated model, flags whether it is inside the applicability domain, adds drug-likeness, and ranks them so the best compounds to make rise to the top." />
  const best = rows[0]
  const label = task === 'regression' ? 'predicted activity' : 'predicted P(active)'
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="text-[14px] font-semibold text-white">Design ranking <span className="text-[12px] font-normal text-slate-500">· {design.mode === 'enumerate' ? 'enumerated library' : 'scored list'} · ranked by {label}</span></div>
        {onSendToDocking && (
          <button onClick={onSendToDocking} title="Send the top-ranked candidates to the Docking module as a virtual-screening library"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold ring-1 transition"
            style={{ background: 'rgba(56,189,248,0.15)', color: '#7dd3fc', borderColor: 'rgba(56,189,248,0.45)' }}>
            <SendIcon className="h-4 w-4" /> Send top {Math.min(15, rows.length)} to Docking
          </button>
        )}
      </div>
      {onSendToDocking && targetHint && (
        <div className="rounded-lg bg-sky-500/[0.07] px-3 py-1.5 text-[11px] text-slate-400 ring-1 ring-sky-500/20">
          Suggested target: <span className="font-semibold text-sky-300">{targetHint}</span> — this model was built from its ChEMBL bioactivities. In Docking, load this protein's structure (fetch a PDB or resolve it via the Network Pharmacology module) to screen the candidates against it.
        </div>
      )}
      <div className="grid grid-cols-4 gap-2">
        <Stat label="analogs scored" value={design.n} />
        <Stat label="in-domain" value={design.n_in_domain} good={design.n_in_domain > 0} />
        <Stat label="Lipinski-OK" value={design.n_lipinski} />
        <Stat label="best predicted" value={best ? best.prediction : '—'} good />
      </div>
      {design.truncated && <div className="rounded-lg bg-amber/10 px-3 py-1.5 text-[11px] text-amber ring-1 ring-amber/30">Library capped at {design.n_combos} analogs — narrow the R-groups to enumerate the full set.</div>}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <FigCard name="DDS_QSAR_design_space">{(ref) => <DesignScatter innerRef={ref} rows={rows} task={task} />}</FigCard>
        <FigCard name="DDS_QSAR_top_candidates">{(ref) => <RankBar innerRef={ref} rows={rows} task={task} />}</FigCard>
      </div>
      {/* 2D structures of the top candidates, with pharmacophore-feature highlighting */}
      <div className="rounded-xl bg-ink-950/40 p-3 ring-1 ring-ink-700/50">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[13px] font-semibold text-white">Top candidates · 2D structures <span className="text-[11px] font-normal text-slate-500">(legend under each: #rank · predicted · domain)</span></div>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-400">
            <input type="checkbox" checked={pharm} onChange={(e) => setPharm(e.target.checked)} className="accent-sky-400" /> pharmacophore features
          </label>
        </div>
        {depBusy ? <div className="grid h-40 place-items-center text-[12px] text-slate-500"><span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500/30 border-t-sky-400" /></div>
          : dep ? <div className="rounded-lg bg-white p-2 ring-1 ring-ink-700/50"><RawFigure svg={dep} name="DDS_QSAR_top_structures" /></div>
            : <div className="grid h-24 place-items-center text-[12px] text-slate-500">No structures to draw.</div>}
        {pharm && depLegend.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {depLegend.map((l) => (
              <span key={l.label} className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span className="h-3 w-3 rounded-sm" style={{ background: l.color }} /> {l.label}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-0 rounded-xl bg-ink-950/40 p-2 ring-1 ring-ink-700/50">
        <table className="w-full text-[11.5px]">
          <thead className="sticky top-0 bg-ink-850 text-slate-400"><tr>
            <th className="px-2 py-1.5 text-left">#</th><th className="px-2 py-1.5 text-left">SMILES</th>
            <th className="px-2 py-1.5 text-right">{task === 'regression' ? 'pred.' : 'P(act)'}</th>
            <th className="px-2 py-1.5 text-right">domain</th><th className="px-2 py-1.5 text-right">MW</th>
            <th className="px-2 py-1.5 text-right">logP</th><th className="px-2 py-1.5 text-center">Ro5</th><th className="px-2 py-1.5 text-center">make</th>
          </tr></thead>
          <tbody>{rows.slice(0, 60).map((r) => {
            const pick = r.rank <= 8 && r.in_domain && r.lipinski_ok
            return (
              <tr key={r.rank} className="border-t border-ink-800/50" style={pick ? { background: 'rgba(56,189,248,0.06)' } : {}}>
                <td className="px-2 py-1 text-slate-500">{r.rank}</td>
                <td className="px-2 py-1 font-mono text-[10.5px] text-slate-300">{r.smiles.length > 40 ? r.smiles.slice(0, 39) + '…' : r.smiles}</td>
                <td className="px-2 py-1 text-right font-semibold" style={{ color: S }}>{r.prediction}</td>
                <td className="px-2 py-1 text-right text-[11px]">{r.in_domain ? <span className="text-emerald-400">in</span> : <span className="text-amber">out</span>}</td>
                <td className="px-2 py-1 text-right text-slate-400">{r.mw ?? '—'}</td>
                <td className="px-2 py-1 text-right text-slate-400">{r.logp ?? '—'}</td>
                <td className="px-2 py-1 text-center text-[11px]">{r.lipinski_ok ? <span className="text-emerald-400">✓</span> : <span className="text-amber">✕</span>}</td>
                <td className="px-2 py-1 text-center">{pick ? <span style={{ color: S }}>★</span> : ''}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
      <div className="px-1 text-[10.5px] text-slate-500">★ = top-ranked, in-domain, drug-like candidates prioritised for synthesis. Predictions outside the applicability domain (out) are extrapolations — treat with caution.</div>
    </div>
  )
}

/* ------------------------------- plots ------------------------------- */
function Scatter({ obs, pred, innerRef }) {
  const W = 420, H = 380, m = 52
  const all = [...obs, ...pred]; const lo = Math.floor(Math.min(...all)) - 0.5, hi = Math.ceil(Math.max(...all)) + 0.5
  const X = (v) => m + ((v - lo) / (hi - lo)) * (W - m - 16), Y = (v) => (H - m) - ((v - lo) / (hi - lo)) * (H - m - 16)
  return (
    <svg ref={innerRef} viewBox={`0 0 ${W} ${H}`} width="100%" xmlns="http://www.w3.org/2000/svg" fontFamily="Inter, sans-serif">
      <rect width={W} height={H} fill="#fff" />
      <line x1={X(lo)} y1={Y(lo)} x2={X(hi)} y2={Y(hi)} stroke="#94a3b8" strokeDasharray="4 4" />
      {obs.map((o, i) => <circle key={i} cx={X(o)} cy={Y(pred[i])} r="4" fill="#0284c7" fillOpacity="0.6" stroke="#fff" strokeWidth="0.5" />)}
      <line x1={m} y1={H - m} x2={W - 16} y2={H - m} stroke="#cbd5e1" /><line x1={m} y1="16" x2={m} y2={H - m} stroke="#cbd5e1" />
      <text x={(m + W - 16) / 2} y={H - 12} textAnchor="middle" fontSize="12" fontWeight="600" fill="#334155">observed activity</text>
      <text x="16" y={(16 + H - m) / 2} textAnchor="middle" fontSize="12" fontWeight="600" fill="#334155" transform={`rotate(-90 16 ${(16 + H - m) / 2})`}>predicted activity</text>
      <text x={W - 20} y="26" textAnchor="end" fontSize="11" fontWeight="700" fill="#0369a1">predicted vs observed (test set)</text>
    </svg>
  )
}
function ROC({ obs, proba, auc, innerRef }) {
  const W = 420, H = 380, m = 52
  const pts = useMemo(() => {
    const pairs = obs.map((o, i) => [proba[i], o]).sort((a, b) => b[0] - a[0])
    const P = obs.filter((o) => o === 1).length, N = obs.length - P
    let tp = 0, fp = 0; const r = [[0, 0]]
    for (const [, o] of pairs) { if (o === 1) tp++; else fp++; r.push([fp / (N || 1), tp / (P || 1)]) }
    return r
  }, [obs, proba])
  const X = (v) => m + v * (W - m - 16), Y = (v) => (H - m) - v * (H - m - 16)
  return (
    <svg ref={innerRef} viewBox={`0 0 ${W} ${H}`} width="100%" xmlns="http://www.w3.org/2000/svg" fontFamily="Inter, sans-serif">
      <rect width={W} height={H} fill="#fff" />
      <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} stroke="#94a3b8" strokeDasharray="4 4" />
      <polyline points={pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ')} fill="none" stroke="#0284c7" strokeWidth="2.4" />
      <line x1={m} y1={H - m} x2={W - 16} y2={H - m} stroke="#cbd5e1" /><line x1={m} y1="16" x2={m} y2={H - m} stroke="#cbd5e1" />
      <text x={(m + W - 16) / 2} y={H - 12} textAnchor="middle" fontSize="12" fontWeight="600" fill="#334155">false positive rate</text>
      <text x="16" y={(16 + H - m) / 2} textAnchor="middle" fontSize="12" fontWeight="600" fill="#334155" transform={`rotate(-90 16 ${(16 + H - m) / 2})`}>true positive rate</text>
      <text x={W - 20} y="26" textAnchor="end" fontSize="11" fontWeight="700" fill="#0369a1">ROC · AUC = {auc?.toFixed(2)}</text>
    </svg>
  )
}
// design-space: predicted activity (x) vs molecular weight (y); colour = applicability domain, fill = Lipinski
function DesignScatter({ rows, task, innerRef }) {
  const W = 440, H = 380, m = 54
  const av = rows.map((r) => r.prediction), mw = rows.map((r) => r.mw || 0)
  const ax0 = Math.min(...av), ax1 = Math.max(...av), my0 = Math.min(...mw), my1 = Math.max(...mw)
  const px = (v) => m + (ax1 > ax0 ? (v - ax0) / (ax1 - ax0) : 0.5) * (W - m - 18)
  const py = (v) => (H - m) - (my1 > my0 ? (v - my0) / (my1 - my0) : 0.5) * (H - m - 20)
  return (
    <svg ref={innerRef} viewBox={`0 0 ${W} ${H}`} width="100%" xmlns="http://www.w3.org/2000/svg" fontFamily="Inter, sans-serif">
      <rect width={W} height={H} fill="#fff" />
      <line x1={m} y1={H - m} x2={W - 18} y2={H - m} stroke="#cbd5e1" /><line x1={m} y1="16" x2={m} y2={H - m} stroke="#cbd5e1" />
      {rows.map((r, i) => {
        const c = r.in_domain ? '#0284c7' : '#d97706'
        return <circle key={i} cx={px(r.prediction)} cy={py(r.mw || 0)} r={r.rank === 1 ? 7 : 5}
          fill={r.lipinski_ok ? c : 'none'} stroke={c} strokeWidth={r.lipinski_ok ? 0.6 : 1.8} fillOpacity="0.72" />
      })}
      <text x={(m + W - 18) / 2} y={H - 12} textAnchor="middle" fontSize="12" fontWeight="600" fill="#334155">{task === 'regression' ? 'predicted activity' : 'predicted P(active)'}  →  more potent</text>
      <text x="15" y={(16 + H - m) / 2} textAnchor="middle" fontSize="12" fontWeight="600" fill="#334155" transform={`rotate(-90 15 ${(16 + H - m) / 2})`}>molecular weight</text>
      <text x={W - 20} y="24" textAnchor="end" fontSize="11" fontWeight="700" fill="#0369a1">design space</text>
      {/* legend */}
      <g fontSize="9.5" fill="#475569">
        <circle cx={m + 6} cy="22" r="4" fill="#0284c7" fillOpacity="0.72" /><text x={m + 14} y="25">in-domain</text>
        <circle cx={m + 78} cy="22" r="4" fill="none" stroke="#d97706" strokeWidth="1.6" /><text x={m + 86} y="25">out / Ro5 fail</text>
      </g>
    </svg>
  )
}
// horizontal bars: top-15 candidates by predicted activity, coloured by domain
function RankBar({ rows, task, innerRef }) {
  const top = rows.slice(0, 15)
  const W = 440, rowH = 21, top0 = 40, m = 150
  const H = top0 + top.length * rowH + 34
  const vs = top.map((r) => r.prediction), lo = Math.min(0, ...vs), hi = Math.max(...vs, 0.001)
  const bx = (v) => m + ((v - lo) / (hi - lo)) * (W - m - 46)
  return (
    <svg ref={innerRef} viewBox={`0 0 ${W} ${H}`} width="100%" xmlns="http://www.w3.org/2000/svg" fontFamily="Inter, sans-serif">
      <rect width={W} height={H} fill="#fff" />
      <text x={m} y="22" fontSize="11" fontWeight="700" fill="#0369a1">top candidates · {task === 'regression' ? 'predicted activity' : 'P(active)'}</text>
      {top.map((r, i) => {
        const y = top0 + i * rowH, c = r.in_domain ? '#0284c7' : '#d97706'
        const smi = r.smiles.length > 22 ? r.smiles.slice(0, 21) + '…' : r.smiles
        return (
          <g key={i}>
            <text x={m - 6} y={y + rowH / 2 + 3} textAnchor="end" fontSize="9" fontFamily="monospace" fill="#475569">{smi}</text>
            <rect x={m} y={y + 3} width={Math.max(1, bx(r.prediction) - m)} height={rowH - 7} rx="2" fill={c} fillOpacity={r.lipinski_ok ? 0.85 : 0.4} />
            <text x={bx(r.prediction) + 4} y={y + rowH / 2 + 3} fontSize="9" fontWeight="600" fill="#334155">{r.prediction}</text>
          </g>
        )
      })}
      <line x1={m} y1={top0} x2={m} y2={H - 26} stroke="#cbd5e1" />
    </svg>
  )
}

/* ------------------------------- setup ------------------------------- */
function Setup(p) {
  const { step } = p
  return (
    <div className="rounded-2xl bg-ink-900/50 p-3.5 ring-1 ring-ink-700/50">
      <div className="mb-2 text-[13px] font-semibold text-white">{STEPS.find((s) => s.id === step)?.label}</div>
      {step === 'dataset' && (
        <div className="space-y-3">
          <Field label="Fetch by target (ChEMBL)">
            <div className="flex gap-1.5">
              <input value={p.chembl} onChange={(e) => p.setChembl(e.target.value)} placeholder="e.g. EGFR or CHEMBL203"
                className="min-w-0 flex-1 rounded-lg bg-ink-950/60 px-3 py-2 text-[12px] text-white ring-1 ring-ink-700 placeholder:text-slate-600" />
              <button onClick={p.fetchChembl} disabled={p.loading === 'chembl'} className="rounded-lg px-3 py-2 text-[12px] font-semibold" style={{ background: S, color: '#04202e' }}>{p.loading === 'chembl' ? '…' : 'Fetch'}</button>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-1.5">
            <button onClick={() => p.onLoadTest('esol')} className="rounded-lg bg-ink-800/70 px-2 py-2 text-[11px] text-slate-300 ring-1 ring-ink-600 hover:text-white">Test · ESOL</button>
            <button onClick={() => p.onLoadTest('bbbp')} className="rounded-lg bg-ink-800/70 px-2 py-2 text-[11px] text-slate-300 ring-1 ring-ink-600 hover:text-white">Test · BBBP</button>
          </div>
          <Field label="Upload your own data (CSV / TSV)">
            <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-ink-800/70 px-3 py-2 text-[11.5px] text-slate-300 ring-1 ring-ink-600 transition hover:bg-ink-700 hover:text-white">
              <UploadIcon className="h-4 w-4" /> Choose CSV / TSV file
              <input type="file" accept=".csv,.tsv,.txt,.smi" className="hidden"
                onChange={(e) => { p.uploadData(e.target.files && e.target.files[0]); e.target.value = '' }} />
            </label>
            <div className="mt-1 text-[10px] text-slate-500">A SMILES column + a numeric activity column (e.g. pIC50 / pKi / measured value). Header auto-detected.</div>
          </Field>
          <Field label="Or paste  SMILES,value  (one per line)">
            <textarea value={p.pasteText} onChange={(e) => p.setPasteText(e.target.value)} rows={4} placeholder="CCO,-0.77&#10;c1ccccc1,2.13"
              className="w-full rounded-lg bg-ink-950/60 px-3 py-2 font-mono text-[11px] text-white ring-1 ring-ink-700 placeholder:text-slate-600" />
            <button onClick={p.loadPaste} className="mt-1.5 w-full rounded-lg bg-ink-800/70 px-3 py-1.5 text-[11.5px] text-slate-300 ring-1 ring-ink-600 hover:text-white">Load pasted data</button>
          </Field>
        </div>
      )}
      {step === 'descriptors' && (
        <div className="space-y-2">
          <div className="text-[11px] text-slate-400">Descriptor / fingerprint:</div>
          {DESCRIPTORS.map(([k, lbl]) => (
            <button key={k} onClick={() => p.setDescriptor(k)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] ring-1 transition ${p.descriptor === k ? 'text-white' : 'text-slate-300 ring-ink-700 hover:bg-ink-800/60'}`}
              style={p.descriptor === k ? { background: 'rgba(56,189,248,0.12)', borderColor: 'rgba(56,189,248,0.5)' } : {}}>
              <span className="grid h-4 w-4 place-items-center rounded-full ring-1" style={{ borderColor: p.descriptor === k ? S : '#475569' }}>{p.descriptor === k && <span className="h-2 w-2 rounded-full" style={{ background: S }} />}</span>{lbl}
            </button>
          ))}
          <div className="pt-1 text-[10.5px] text-slate-500">3D descriptors embed a conformer (slower); Morgan is the fast reliable default.</div>
        </div>
      )}
      {step === 'model' && (
        <div className="space-y-3">
          <Field label="Algorithm">
            <select value={p.algo} onChange={(e) => p.setAlgo(e.target.value)} className="w-full rounded-lg bg-ink-950/60 px-3 py-2 text-[12px] text-white ring-1 ring-ink-700">
              {ALGOS.filter(([k]) => !(k === 'pls' && p.task === 'classification')).map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
            </select>
          </Field>
          <Field label="Train/test split">
            <div className="flex gap-1.5">
              {[['random', 'Random'], ['scaffold', 'Scaffold']].map(([k, lbl]) => (
                <button key={k} onClick={() => p.setSplit(k)} className={`flex-1 rounded-lg px-2 py-1.5 text-[12px] ring-1 ${p.split === k ? 'text-white' : 'text-slate-400 ring-ink-700'}`} style={p.split === k ? { background: 'rgba(56,189,248,0.12)', borderColor: 'rgba(56,189,248,0.5)' } : {}}>{lbl}</button>
              ))}
            </div>
          </Field>
          <div className="space-y-1 text-[11px] text-slate-400">
            <Row k="Task" v={p.task} /><Row k="Descriptor" v={p.descriptor} /><Row k="Cross-validation" v="5-fold" /><Row k="Y-scramble" v="on" />
          </div>
        </div>
      )}
      {step === 'validate' && p.result && <div className="text-[11.5px] text-slate-400">Model trained. Metrics and plots are shown in the workspace (each figure has its own PNG/SVG export). Go to <b className="text-slate-300">Design</b> to prospectively score new molecules, or <b className="text-slate-300">Export report</b> for the full write-up.</div>}
      {step === 'design' && (
        <div className="space-y-3">
          {!p.result && <div className="rounded-lg bg-amber/10 px-3 py-2 text-[11px] text-amber ring-1 ring-amber/30">Build and validate a model first.</div>}
          <div className="flex gap-1.5">
            {[['enumerate', 'Enumerate'], ['list', 'Score a list']].map(([k, lbl]) => (
              <button key={k} onClick={() => p.setMode(k)} className={`flex-1 rounded-lg px-2 py-1.5 text-[12px] ring-1 ${p.mode === k ? 'text-white' : 'text-slate-400 ring-ink-700'}`} style={p.mode === k ? { background: 'rgba(56,189,248,0.12)', borderColor: 'rgba(56,189,248,0.5)' } : {}}>{lbl}</button>
            ))}
          </div>
          {p.mode === 'enumerate' ? (
            <>
              <Field label="Scaffold (mark positions [*:1], [*:2] …)">
                <textarea value={p.scaffold} onChange={(e) => p.setScaffold(e.target.value)} rows={2} placeholder={EX_SCAFFOLD}
                  className="w-full rounded-lg bg-ink-950/60 px-3 py-2 font-mono text-[11px] text-white ring-1 ring-ink-700 placeholder:text-slate-600" />
                <button onClick={p.loadExample} className="mt-1.5 w-full rounded-lg bg-ink-800/70 px-3 py-1.5 text-[11px] text-slate-300 ring-1 ring-ink-600 hover:text-white">Load example scaffold</button>
              </Field>
              {p.positions.length === 0 && <div className="text-[10.5px] text-slate-500">Add attachment points like <span className="font-mono">[*:1]</span> to your scaffold to define R-group positions.</div>}
              {p.positions.map((pos) => (
                <div key={pos}>
                  <div className="mb-1 text-[11px] text-slate-400">R<sub>{pos}</sub> substituents <span className="text-slate-600">({(p.rgroups[pos] || []).length || 1})</span></div>
                  <div className="flex flex-wrap gap-1">
                    {RGROUP_PALETTE.map(([lbl, smi]) => {
                      const on = (p.rgroups[pos] || []).includes(smi)
                      return <button key={lbl} onClick={() => p.toggleRgroup(pos, smi)}
                        className={`rounded-md px-2 py-1 text-[10.5px] ring-1 transition ${on ? 'text-white' : 'text-slate-400 ring-ink-700 hover:bg-ink-800/60'}`}
                        style={on ? { background: 'rgba(56,189,248,0.15)', borderColor: 'rgba(56,189,248,0.5)' } : {}}>{lbl}</button>
                    })}
                  </div>
                </div>
              ))}
              {p.positions.length > 0 && <div className="rounded-lg bg-ink-950/40 px-3 py-1.5 text-[11px] text-slate-400 ring-1 ring-ink-700/50">→ <b className="text-slate-200">{p.nAnalogs}</b> analog{p.nAnalogs === 1 ? '' : 's'} to enumerate</div>}
            </>
          ) : (
            <Field label="Candidate SMILES (one per line)">
              <textarea value={p.listText} onChange={(e) => p.setListText(e.target.value)} rows={7} className="w-full rounded-lg bg-ink-950/60 px-3 py-2 font-mono text-[11px] text-white ring-1 ring-ink-700" />
            </Field>
          )}
        </div>
      )}
    </div>
  )
}

function ReportModal({ dataset, result, task, descriptor, algo, design, onClose }) {
  function gen() {
    const M = task === 'regression'
      ? `Q²(CV) = ${result.Q2?.toFixed(2)}; R²(test) = ${result.R2_test?.toFixed(2)}; RMSE = ${result.RMSE_test?.toFixed(2)}; MAE = ${result.MAE_test?.toFixed(2)}; Y-scramble Q² = ${result.Yscramble_Q2_mean?.toFixed(2)}`
      : `AUC(CV) = ${result.AUC_cv?.toFixed(2)}; AUC(test) = ${result.AUC_test?.toFixed(2)}; accuracy = ${result.accuracy?.toFixed(2)}; MCC = ${result.MCC?.toFixed(2)}; sensitivity = ${result.sensitivity?.toFixed(2)}; specificity = ${result.specificity?.toFixed(2)}; Y-scramble AUC = ${result.Yscramble_AUC_mean?.toFixed(2)}`
    const imp = (result.importance || []).slice(0, 8).map((f) => f.name).join(', ')
    let designHtml = ''
    if (design && design.analogs?.length) {
      const rows = design.analogs.slice(0, 15).map((r) => `<tr><td>${r.rank}</td><td style="font-family:monospace;font-size:11px">${r.smiles}</td><td>${r.prediction}</td><td>${r.in_domain ? 'in' : 'out'}</td><td>${r.mw ?? ''}</td><td>${r.logp ?? ''}</td><td>${r.lipinski_ok ? '✓' : '✕'}</td></tr>`).join('')
      designHtml = `<h2>4. Prospective design (DMTA)</h2>
        <p>${design.mode === 'enumerate' ? `A virtual library was enumerated from the supplied scaffold and R-group variations (${design.n_combos} combinations)` : `A list of ${design.n} candidate molecules was scored`}. Each candidate was predicted with the validated model, flagged for applicability domain, and scored for drug-likeness (Lipinski rule-of-five). Of ${design.n} scored analogs, ${design.n_in_domain} lie inside the applicability domain and ${design.n_lipinski} pass the rule-of-five. The top-ranked, in-domain, drug-like candidates are prioritised for synthesis.</p>
        <table><thead><tr><th>#</th><th>SMILES</th><th>${task === 'regression' ? 'predicted' : 'P(active)'}</th><th>domain</th><th>MW</th><th>logP</th><th>Ro5</th></tr></thead><tbody>${rows}</tbody></table>`
    }
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>DDS QSAR Report</title><style>
      body{font:13px/1.6 Arial;max-width:820px;margin:24px auto;color:#1a2233;padding:0 16px}
      h1{color:#0369a1;font-size:22px} h2{color:#0369a1;border-bottom:1px solid #e5eaf0;padding-bottom:4px;margin-top:22px}
      table{border-collapse:collapse;width:100%;margin:8px 0;font-size:12px} th,td{border:1px solid #d6dbe4;padding:4px 8px;text-align:left}
      th{background:#eef2f7} .note{background:#fff8e1;border:1px solid #f0d98a;border-radius:6px;padding:10px 14px;color:#5b4a00;font-size:12px}
    </style></head><body>
      <h1>QSAR / 3D-QSAR Model &amp; Design Report</h1>
      <div>Drug Design Studio (DDS) 4.0 · ligand-based modelling (RDKit + scikit-learn)</div>
      <p class="note">This report is intended as guidance for your write-up. Please do not copy it verbatim — rephrase the findings in your own words, and review every predicted candidate before committing to synthesis.</p>
      <h2>1. Dataset</h2><p>${dataset.name} — ${dataset.smiles.length} molecules · task: ${task}.</p>
      <h2>2. Model</h2><p>Descriptor: ${descriptor}; algorithm: ${algo.toUpperCase()}; split: ${result.split}; 5-fold cross-validation; train ${result.n_train} / test ${result.n_test} molecules.${imp ? ` Most influential descriptors: ${imp}.` : ''}</p>
      <h2>3. Validation</h2><p>${M}</p><p>Applicability domain: ${(result.AD_fraction_in * 100).toFixed(0)}% of the external test set lies inside the model's domain. The Y-scramble control (response randomisation) confirms the model is not chance-correlated.</p>
      ${designHtml}
      <h2>${design ? '5' : '4'}. Computational methods</h2>
      <p>Drug Design Studio (DDS)<sup>1&ndash;3</sup> was used to assemble and standardise the dataset, compute the molecular descriptors, train and validate the QSAR model${design ? ', and prospectively design and prioritise candidate molecules' : ''} reported here.</p>
      <p>Molecules were standardised (largest organic fragment, sanitised) and featurised with RDKit<sup>4</sup>; a ${algo.toUpperCase()} model was trained with scikit-learn<sup>5</sup> using an 80:20 ${result.split} train/test split and 5-fold cross-validation. Model validity was assessed by cross-validated ${task === 'regression' ? 'Q²' : 'ROC-AUC'}, external-test metrics, a Y-scrambling control and a k-nearest-neighbour applicability-domain estimate. ${design ? 'Prospective candidates were scored with the validated model and ranked by predicted activity, with applicability-domain and rule-of-five annotations.' : ''}</p>
      <h2>${design ? '6' : '5'}. References</h2>
      <ol style="font-size:11px;line-height:1.6;color:#475569;padding-left:18px;margin-top:6px">
        <li>Mahmoud E. Soliman. Drug Design Studio (DDS): An all-in-one cross-platform for covalent/non-covalent docking, covalent binders virtual screening and protein&ndash;ligand interaction analysis. <i>(Under review).</i></li>
        <li>Mahmoud E. Soliman. Drug Design Suite (DDS) 2.0: A Unified Platform for Network Pharmacology Integrated with Docking and Virtual Screening Workflow for Covalent/Non-Covalent Binders. <i>(Under review).</i></li>
        <li>Mahmoud E. Soliman. Drug Design Studio (DDS) 3.0: A Streamlined QSAR, 3D-QSAR and Pharmacophore Modelling Platform Coupling Ligand-Based Activity Prediction to Covalent and Non-Covalent Structure-Based Discovery. <i>(Under review).</i></li>
        <li>Landrum G, <i>et al.</i> RDKit: Open-source cheminformatics. https://www.rdkit.org</li>
        <li>Pedregosa F, <i>et al.</i> Scikit-learn: Machine learning in Python. <i>J Mach Learn Res.</i> 2011;12:2825&ndash;2830.</li>
      </ol>
      </body></html>`
    if (typeof window !== 'undefined' && window.pywebview && window.pywebview.api) { saveFile('DDS_qsar_report.html', html, 'text/html;charset=utf-8'); return }  // native app: save via bridge
    const w = window.open('', '_blank')
    if (!w) { saveFile('DDS_qsar_report.html', html, 'text/html;charset=utf-8'); return }
    w.document.write(html); w.document.close(); w.print()
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/80 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-ink-900 p-5 ring-1 ring-ink-700" onClick={(e) => e.stopPropagation()}>
        <div className="text-[15px] font-bold text-white">Export QSAR report</div>
        <div className="mt-1 text-[12px] text-slate-400">A comprehensive report: dataset, model settings, full validation statistics{design ? ', and the prospective design ranking' : ''}. Figures are exported individually from each plot's own menu.</div>
        <div className="mt-4 flex gap-2">
          <button onClick={gen} className="flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold" style={{ background: S, color: '#04202e' }}>Generate PDF</button>
          <button onClick={onClose} className="rounded-lg bg-ink-800 px-3 py-2 text-[13px] text-slate-300 ring-1 ring-ink-600">Close</button>
        </div>
      </div>
    </div>
  )
}

/* small bits + icons */
function Stat({ label, value, good }) { return <div className="rounded-lg bg-ink-900/60 p-2 text-center ring-1 ring-ink-700/50"><div className="text-[14px] font-bold" style={{ color: good == null ? '#fff' : good ? '#34d399' : '#fbbf24' }}>{value ?? '—'}</div><div className="mt-0.5 text-[9px] uppercase tracking-wide text-slate-500">{label}</div></div> }
function Field({ label, children }) { return <div><div className="mb-1 text-[11px] text-slate-400">{label}</div>{children}</div> }
function Row({ k, v }) { return <div className="flex items-center justify-between rounded-md bg-ink-950/40 px-2.5 py-1.5"><span className="text-slate-400">{k}</span><span className="font-medium text-slate-300">{v}</span></div> }
function Msg({ title, sub, spinner }) { return <div className="grid h-full place-items-center rounded-xl bg-ink-950/40 text-center"><div>{spinner && <span className="mx-auto mb-3 block h-7 w-7 animate-spin rounded-full border-2 border-sky-500/30 border-t-sky-400" />}<div className="text-[14px] font-medium text-slate-300">{title}</div><div className="mx-auto mt-1 max-w-md text-[12px] text-slate-500">{sub}</div></div></div> }
function Spinner() { return <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-950/40 border-t-ink-950" /> }
function I(p, ch) { return <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke={p.color || 'currentColor'} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={p.className}>{ch}</svg> }
function DataIcon(p) { return I(p, <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>) }
function DescIcon(p) { return I(p, <><rect x="3" y="4" width="7" height="7" rx="1" /><rect x="14" y="4" width="7" height="7" rx="1" /><rect x="3" y="15" width="7" height="5" rx="1" /><rect x="14" y="15" width="7" height="5" rx="1" /></>) }
function ModelIcon(p) { return I(p, <><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><path d="M8 6h8M7 8l4 8M17 8l-4 8" /></>) }
function CheckIcon(p) { return I(p, <><path d="M20 6L9 17l-5-5" /></>) }
function DesignIcon(p) { return I(p, <><path d="M12 2l2.5 5 5.5.8-4 3.9.9 5.5L12 20l-4.9 2.6.9-5.5-4-3.9 5.5-.8z" /></>) }
function BeakerIcon(p) { return I(p, <><path d="M6 3h12M8 3v6l-4 9a1.5 1.5 0 001.4 2h13.2a1.5 1.5 0 001.4-2l-4-9V3" /><path d="M6.5 15h11" /></>) }
function ExportIcon(p) { return I(p, <><path d="M12 15V3M8 7l4-4 4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></>) }
function UploadIcon(p) { return I(p, <><path d="M12 3v12M8 7l4-4 4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></>) }
function GridIcon(p) { return I(p, <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>) }
function NewIcon(p) { return I(p, <><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v5h-5" /></>) }
function PlayIcon(p) { return I(p, <path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none" />) }
function QuoteIcon(p) { return I(p, <><path d="M7 7h4v4a4 4 0 01-4 4M13 7h4v4a4 4 0 01-4 4" /></>) }
function BookIcon(p) { return I(p, <><path d="M4 5a2 2 0 012-2h12v16H6a2 2 0 00-2 2zM8 3v16" /></>) }
function SendIcon(p) { return I(p, <><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" /></>) }
function GlobeIcon(p) { return I(p, <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18" /></>) }
