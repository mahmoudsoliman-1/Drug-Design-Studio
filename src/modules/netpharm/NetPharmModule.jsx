import { useState, useEffect, useMemo } from 'react'
import * as api from '../../api.js'
import Logo from '../../components/Logo.jsx'
import DocsModal, { CiteModal } from '../../components/Documentation.jsx'
import NetworkGraph from './NetworkGraph.jsx'
import HubGenes from './HubGenes.jsx'
import VennDiagram from './VennDiagram.jsx'
import DiseaseVenn from './DiseaseVenn.jsx'
import CTPNetwork from './CTPNetwork.jsx'
import KeggFigure from './KeggFigure.jsx'
import GoFigure from './GoFigure.jsx'
import HubStructures from './HubStructures.jsx'
import NetpharmExport from './NetpharmExport.jsx'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LabelList,
} from 'recharts'

const ACCENT = '#a78bfa'
const STEPS = [
  { id: 'disease', label: 'Disease targets', hint: 'Disease-associated genes', icon: VirusIcon },
  { id: 'compound', label: 'Compound targets', hint: 'Predicted drug targets', icon: FlaskIcon },
  { id: 'network', label: 'Network', hint: 'Intersection + PPI map', icon: NetIcon },
  { id: 'hubs', label: 'Hub genes', hint: 'Centrality ranking', icon: HubIcon },
  { id: 'enrichment', label: 'Enrichment', hint: 'GO & KEGG pathways', icon: ChartIcon },
  { id: 'structures', label: 'Structures', hint: 'PDB for docking', icon: StructIcon },
]
const LIBS = [['GO_BP', 'GO · Biological process'], ['GO_MF', 'GO · Molecular function'],
  ['GO_CC', 'GO · Cellular component'], ['KEGG', 'KEGG pathways']]

// keep genes at/above the score cutoff (unscored upload/CTD genes always pass) and,
// when covalent-only is on, only covalent-targetable ones
function filterGenes(list, minScore, covOnly) {
  return (list || []).filter((g) => (!covOnly || g.covalent) && (g.score == null || g.score >= minScore))
}
function fmtScore(s) { return s == null ? '·' : (s <= 1 ? s.toFixed(2) : s.toFixed(1)) }

// The network-pharmacology module: compound × disease → shared targets → PPI network
// → hub genes → enrichment. Online by design (queries Open Targets, ChEMBL, STRING,
// Enrichr). Same shell contract as docking: `onSwitchModules` returns to the hub.
export default function NetPharmModule({ onSwitchModules, onHandoff }) {
  const sendToDocking = (payload) => onHandoff && onHandoff('docking', payload)
  const [step, setStep] = useState('disease')
  const [engine, setEngine] = useState('checking')
  const [docs, setDocs] = useState(false)
  const [cite, setCite] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [error, setError] = useState('')

  const [disease, setDisease] = useState('')
  const [multiDiseaseMode, setMultiDiseaseMode] = useState(false)
  const [diseasesText, setDiseasesText] = useState('')
  const [dSources, setDSources] = useState({ opentargets: true, ctd: false })
  const [dUpload, setDUpload] = useState('')
  const [dLoading, setDLoading] = useState(false)
  const [dResult, setDResult] = useState(null)

  const [compound, setCompound] = useState('')
  const [multiMode, setMultiMode] = useState(false)
  const [compoundsText, setCompoundsText] = useState('')
  const [isSmiles, setIsSmiles] = useState(false)
  const [cSources, setCSources] = useState({ dgidb: true, chembl: true })
  const [cUpload, setCUpload] = useState('')
  const [cLoading, setCLoading] = useState(false)
  const [cResult, setCResult] = useState(null)

  // ranking / covalent selection filters
  const [dMinScore, setDMinScore] = useState(0)
  const [dCovOnly, setDCovOnly] = useState(false)
  const [cMinScore, setCMinScore] = useState(0)
  const [cCovOnly, setCCovOnly] = useState(false)

  const [confidence, setConfidence] = useState(0.4)
  const [centrality, setCentrality] = useState('mcc')
  const [topn, setTopn] = useState(10)
  const [libs, setLibs] = useState({ GO_BP: true, GO_MF: false, GO_CC: false, KEGG: true })

  const [activeJobId, setActiveJobId] = useState(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => { api.health().then(() => setEngine('online')).catch(() => setEngine('offline')) }, [])

  useEffect(() => {
    if (!activeJobId) return
    let stop = false
    async function tick() {
      try {
        const full = await api.getJob(activeJobId)
        if (stop) return
        if (full.status !== 'running') {
          setRunning(false); setActiveJobId(null)
          if (full.status === 'done') { setResult(full.result); setStep('network') }
          else setError(full.error || 'Analysis failed.')
        }
      } catch { /* keep polling */ }
    }
    tick()
    const t = setInterval(tick, 2500)
    return () => { stop = true; clearInterval(t) }
  }, [activeJobId])

  // apply the ranking cutoff + covalent filter, then derive the effective gene sets
  const dEffective = useMemo(() => filterGenes(dResult?.genes, dMinScore, dCovOnly), [dResult, dMinScore, dCovOnly])
  const cEffective = useMemo(() => filterGenes(cResult?.genes, cMinScore, cCovOnly), [cResult, cMinScore, cCovOnly])
  const dSymbols = useMemo(() => dEffective.map((g) => g.gene), [dEffective])
  const cSymbols = useMemo(() => cEffective.map((g) => g.gene), [cEffective])

  const covSet = useMemo(() => {
    const s = new Set()
    for (const g of [...(dResult?.genes || []), ...(cResult?.genes || [])]) if (g.covalent) s.add(g.gene)
    return s
  }, [dResult, cResult])

  // shared targets preview (compound ∩ disease) from the filtered sets
  const shared = useMemo(() => {
    if (!dResult || !cResult) return null
    const ds = new Set(dSymbols)
    return cSymbols.filter((g) => ds.has(g))
  }, [dResult, cResult, dSymbols, cSymbols])
  const sharedCov = useMemo(() => (shared ? shared.filter((g) => covSet.has(g)).length : 0), [shared, covSet])

  async function loadDisease() {
    setError(''); setDLoading(true)
    try {
      const sources = Object.keys(dSources).filter((k) => dSources[k])
      let r
      if (multiDiseaseMode) {
        const diseases = diseasesText.split(/[\n;]+/).map((s) => s.trim()).filter(Boolean)
        r = await api.netpharmDiseaseTargetsMulti({ diseases, sources, uploaded: dUpload })
      } else {
        r = await api.netpharmDiseaseTargets({ disease, sources, uploaded: dUpload })
      }
      setDResult(r)
    } catch (e) { setError(engErr(e)) } finally { setDLoading(false) }
  }
  async function loadCompound() {
    setError(''); setCLoading(true)
    try {
      const sources = Object.keys(cSources).filter((k) => cSources[k])
      let r
      if (multiMode) {
        const compounds = compoundsText.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
        r = await api.netpharmCompoundTargetsMulti({ compounds, isSmiles, sources, uploaded: cUpload })
      } else {
        r = await api.netpharmCompoundTargets({ query: compound, isSmiles, sources, uploaded: cUpload })
      }
      setCResult(r)
    } catch (e) { setError(engErr(e)) } finally { setCLoading(false) }
  }
  function loadCaseStudy() {
    setDisease('triple-negative breast cancer'); setCompound('curcumin')
    setDSources({ opentargets: true, ctd: false }); setCSources({ dgidb: true, chembl: true })
    setDMinScore(0); setCMinScore(0); setDCovOnly(false); setCCovOnly(false); setStep('disease')
  }
  // wipe the whole workspace back to a clean slate for a fresh analysis
  function newRun() {
    setStep('disease'); setError(''); setExportOpen(false)
    setDisease(''); setMultiDiseaseMode(false); setDiseasesText(''); setDUpload(''); setDResult(null); setDLoading(false)
    setDSources({ opentargets: true, ctd: false })
    setCompound(''); setMultiMode(false); setCompoundsText(''); setIsSmiles(false); setCUpload(''); setCResult(null); setCLoading(false)
    setCSources({ dgidb: true, chembl: true })
    setDMinScore(0); setDCovOnly(false); setCMinScore(0); setCCovOnly(false)
    setConfidence(0.4); setCentrality('mcc'); setTopn(10); setLibs({ GO_BP: true, GO_MF: false, GO_CC: false, KEGG: true })
    setActiveJobId(null); setRunning(false); setResult(null)
  }

  async function runAnalysis() {
    setError('')
    if (engine !== 'online') { setError('Engine offline — start the DDS engine.'); return }
    if (!dSymbols.length) { setError('Fetch disease targets first (and relax the filters if all are hidden).'); setStep('disease'); return }
    if (!cSymbols.length) { setError('Fetch compound targets first (and relax the filters if all are hidden).'); setStep('compound'); return }
    if (!shared?.length) { setError('No shared targets between the compound and disease — relax the cutoffs or widen your inputs.'); return }
    setRunning(true)
    try {
      const libraries = Object.keys(libs).filter((k) => libs[k])
      const { job_id } = await api.netpharmRun({
        disease_genes: dSymbols, compound_genes: cSymbols,
        confidence, centrality, topn, libraries,
        label: `${compound || 'compound'} × ${dResult.label || disease || 'disease'}`,
      })
      setActiveJobId(job_id)
    } catch (e) { setError(engErr(e)); setRunning(false) }
  }

  const hasResults = !!result
  const compoundName = cResult?.name || compound
  const title = (compoundName || dResult?.label)
    ? `${compoundName || 'compound'} × ${dResult?.label || disease || 'disease'}`
    : 'Network pharmacology'
  const multiCompounds = useMemo(() => (cResult?.compounds || []).map((c) => c.name), [cResult])
  const geneCompounds = useMemo(() => {
    const m = {}
    for (const g of cResult?.genes || []) if (g.compounds) m[g.gene] = g.compounds
    return m
  }, [cResult])

  return (
    <div className="flex h-full w-full bg-ink-950 text-slate-200">
      {/* ---- left workflow rail ---- */}
      <div className="flex w-[248px] shrink-0 flex-col border-r border-ink-700/60 bg-ink-900/60">
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <Logo size={40} className="rounded-xl glow-accent" />
          <div>
            <div className="text-[15px] font-bold leading-none tracking-tight text-white">Drug Design</div>
            <div className="mt-1 text-[11px] font-medium tracking-wide text-accent">STUDIO · DDS</div>
          </div>
        </div>

        <div className="px-4 pb-2 pt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Workflow</div>
        <nav className="flex flex-col gap-1 px-3">
          {STEPS.map((s, i) => {
            const isActive = step === s.id
            const locked = ['network', 'hubs', 'enrichment', 'structures'].includes(s.id) && !hasResults
            return (
              <button key={s.id} disabled={locked} onClick={() => setStep(s.id)}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition
                  ${isActive ? 'bg-violet/10 ring-1 ring-violet/40' : 'hover:bg-ink-800/70'}
                  ${locked ? 'cursor-not-allowed opacity-40' : ''}`}>
                <div className={`grid h-8 w-8 place-items-center rounded-lg text-[11px] font-bold
                  ${isActive ? 'bg-violet text-ink-950' : 'bg-ink-800 text-slate-400 group-hover:text-slate-200'}`}>
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`text-[13px] font-semibold ${isActive ? 'text-white' : 'text-slate-300'}`}>{s.label}</div>
                  <div className="truncate text-[11px] text-slate-500">{s.hint}</div>
                </div>
                <s.icon className={`h-4 w-4 ${isActive ? 'text-violet' : 'text-slate-600'}`} />
              </button>
            )
          })}
        </nav>

        <div className="mt-auto p-3">
          <button onClick={() => setDocs(true)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-300 transition hover:bg-ink-800/70 hover:text-white">
            <BookIcon className="h-4 w-4 text-violet" />
            <span className="text-[12px] font-medium">Documentation</span>
          </button>
          <button onClick={() => setCite(true)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-300 transition hover:bg-ink-800/70 hover:text-white">
            <QuoteIcon className="h-4 w-4 text-violet" />
            <span className="text-[12px] font-medium">Cite DDS</span>
          </button>
          <div className="mt-1.5 px-2.5 text-[10px] text-slate-600">DDS v2.0.0</div>
        </div>
      </div>

      {/* ---- main column ---- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* top bar */}
        <div className="flex items-center justify-between gap-3 border-b border-ink-700/60 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[15px] font-semibold text-white">
              <span className="h-2 w-2 rounded-full bg-violet" />
              <span className="truncate">{title}</span>
              <span className="text-slate-500">· Network pharmacology</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {dResult ? `${dEffective.length}/${dResult.count} disease genes` : 'no disease genes'} ·{' '}
              {cResult ? `${cEffective.length}/${cResult.count} compound targets` : 'no compound targets'}
              {shared != null && ` · ${shared.length} shared`}
              {shared != null && sharedCov > 0 && <span className="text-amber"> · {sharedCov} covalent</span>}
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <button onClick={newRun} title="Clear the workspace and start a fresh analysis"
              className="inline-flex items-center gap-2 rounded-xl bg-ink-800/70 px-3 py-2 text-[12px] font-medium text-slate-300 ring-1 ring-ink-600 transition hover:bg-ink-700 hover:text-white">
              <NewRunIcon className="h-4 w-4" /> New run
            </button>
            {hasResults && (
              <button onClick={() => setExportOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-accent/15 px-3 py-2 text-[12px] font-semibold text-accent ring-1 ring-accent/40 transition hover:bg-accent/25">
                <ExportIcon className="h-4 w-4" /> Export report
              </button>
            )}
            <ModulesButton onClick={onSwitchModules} />
          </div>
        </div>

        {engine === 'offline' && (
          <div className="border-b border-amber/30 bg-amber/10 px-4 py-2 text-[12px] text-amber">
            Engine offline — start the DDS engine to query the databases.
          </div>
        )}
        {engine === 'online' && (
          <div className="flex items-center gap-2 border-b border-ink-700/40 bg-violet/[0.04] px-4 py-1.5 text-[11px] text-slate-400">
            <GlobeIcon className="h-3.5 w-3.5 text-violet" />
            Online module — queries Open Targets, ChEMBL, STRING and Enrichr live.
          </div>
        )}
        {error && (
          <div className="flex items-center justify-between border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-[12px] text-red-300">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-300/70 hover:text-red-200"><CloseIcon className="h-3.5 w-3.5" /></button>
          </div>
        )}

        {/* content: centre viz + right inspector */}
        <main className="flex min-h-0 flex-1 gap-4 p-4">
          <section className="glass relative flex min-w-0 flex-1 flex-col rounded-2xl p-3">
            <CenterView step={step} dResult={dResult} cResult={cResult} shared={shared}
              dGenes={dEffective} cGenes={cEffective} dCount={dEffective.length}
              compoundLabel={cResult?.name || compound} compounds={multiCompounds} geneCompounds={geneCompounds}
              result={result} running={running} topn={topn} libs={libs} onSendToDocking={sendToDocking} />
          </section>

          <aside className="flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto">
            <button onClick={runAnalysis} disabled={running}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet px-4 py-2.5 text-[14px] font-semibold text-ink-950 shadow-lg transition hover:brightness-110 disabled:opacity-60">
              {running ? <Spinner /> : <PlayIcon className="h-4 w-4" />}
              {running ? 'Running analysis…' : 'Run analysis'}
            </button>
            <StepInspector
              step={step}
              disease={disease} setDisease={setDisease} dSources={dSources} setDSources={setDSources}
              multiDiseaseMode={multiDiseaseMode} setMultiDiseaseMode={setMultiDiseaseMode} diseasesText={diseasesText} setDiseasesText={setDiseasesText}
              dUpload={dUpload} setDUpload={setDUpload} dLoading={dLoading} dResult={dResult} loadDisease={loadDisease}
              dMinScore={dMinScore} setDMinScore={setDMinScore} dCovOnly={dCovOnly} setDCovOnly={setDCovOnly} dCount={dEffective.length}
              compound={compound} setCompound={setCompound} isSmiles={isSmiles} setIsSmiles={setIsSmiles}
              multiMode={multiMode} setMultiMode={setMultiMode} compoundsText={compoundsText} setCompoundsText={setCompoundsText}
              cSources={cSources} setCSources={setCSources} cUpload={cUpload} setCUpload={setCUpload}
              cMinScore={cMinScore} setCMinScore={setCMinScore} cCovOnly={cCovOnly} setCCovOnly={setCCovOnly} cCount={cEffective.length}
              cLoading={cLoading} cResult={cResult} loadCompound={loadCompound}
              shared={shared} sharedCov={sharedCov} confidence={confidence} setConfidence={setConfidence}
              centrality={centrality} setCentrality={setCentrality} topn={topn} setTopn={setTopn}
              libs={libs} setLibs={setLibs} result={result} onRun={runAnalysis} running={running}
              onCaseStudy={loadCaseStudy} />
          </aside>
        </main>
      </div>

      {docs && <DocsModal onClose={() => setDocs(false)} initialModule="netpharm" />}
      {cite && <CiteModal onClose={() => setCite(false)} />}
      {exportOpen && <NetpharmExport compoundLabel={compoundName} diseaseLabel={dResult?.label}
        dResult={dResult} cResult={cResult} shared={shared} result={result}
        params={{ confidence, centrality, topn, libs }} multiCompound={multiMode} multiDisease={multiDiseaseMode}
        onClose={() => setExportOpen(false)} />}
    </div>
  )
}

/* ============================ centre views ============================ */
function CenterView({ step, dResult, cResult, dGenes, cGenes, dCount, shared, result, running, topn, libs, compoundLabel, compounds, geneCompounds, onSendToDocking }) {
  if (step === 'disease') {
    if (dResult?.venn) return <DiseaseCenter dResult={dResult} dGenes={dGenes} />
    return <GeneSetView label={dResult?.label} genes={dGenes} hasResult={!!dResult} accent="#38bdf8" empty="Search a disease to fetch its associated genes." fallbackTitle="Disease targets" />
  }
  if (step === 'compound') return <CompoundCenter cResult={cResult} dResult={dResult} cGenes={cGenes} dCount={dCount} shared={shared} />
  if (running) return <CenterMsg icon={<Spinner big />} text="Running network analysis…" sub="Building the PPI network, ranking hubs and running enrichment." />
  if (!result) return <CenterMsg icon={<NetIcon className="h-8 w-8 text-slate-600" />} text="No analysis yet" sub="Set disease and compound targets, then Run analysis." />
  if (step === 'network') return <NetworkGraph nodes={result.network.nodes} edges={result.network.edges} accent={ACCENT} />
  if (step === 'hubs') return <HubGenes hubs={result.hubs} edges={result.network.edges} topn={topn} />
  if (step === 'enrichment') return <EnrichmentView enrichment={result.enrichment} libs={libs} compoundLabel={compoundLabel} compounds={compounds} geneCompounds={geneCompounds} />
  if (step === 'structures') return <HubStructures hubs={result.hubs} topn={topn} onSendToDocking={onSendToDocking} />
  return null
}

function EnrichmentView({ enrichment, libs, compoundLabel, compounds, geneCompounds }) {
  const [view, setView] = useState('network')
  const goLibs = { GO_BP: libs.GO_BP, GO_MF: libs.GO_MF, GO_CC: libs.GO_CC }
  const keggLibs = { KEGG: libs.KEGG }
  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-1 self-start rounded-lg bg-ink-800/70 p-1">
        <TabBtn on={view === 'network'} onClick={() => setView('network')}>Compound–target–pathway network</TabBtn>
        <TabBtn on={view === 'go'} onClick={() => setView('go')}>GO enrichment analysis</TabBtn>
        <TabBtn on={view === 'kegg'} onClick={() => setView('kegg')}>KEGG pathway enrichment analysis</TabBtn>
      </div>
      <div className="min-h-0 flex-1">
        {view === 'go'
          ? <GoFigure enrichment={enrichment} libs={goLibs} />
          : view === 'kegg'
            ? <KeggFigure enrichment={enrichment} libs={keggLibs} />
            : <CTPNetwork compoundLabel={compoundLabel} compounds={compounds} geneCompounds={geneCompounds} enrichment={enrichment} libs={libs} />}
      </div>
    </div>
  )
}

function CenterMsg({ icon, text, sub }) {
  return (
    <div className="grid h-full w-full place-items-center rounded-xl bg-ink-950/40 text-center">
      <div>
        <div className="mx-auto mb-3 flex justify-center">{icon}</div>
        <div className="text-[14px] font-medium text-slate-300">{text}</div>
        <div className="mx-auto mt-1 max-w-xs text-[12px] text-slate-500">{sub}</div>
      </div>
    </div>
  )
}

function GeneSetView({ label, genes, hasResult, accent, empty, fallbackTitle }) {
  if (!hasResult) return <CenterMsg icon={<FlaskIcon className="h-8 w-8 text-slate-600" />} text={fallbackTitle} sub={empty} />
  const list = genes || []
  const nCov = list.filter((g) => g.covalent).length
  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-baseline gap-2 px-1">
        <span className="text-[14px] font-semibold text-white">{label || fallbackTitle}</span>
        <span className="text-[12px] text-slate-500">· {list.length} genes{nCov > 0 && <span className="text-amber"> · {nCov} covalent</span>} · ranked by score</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-ink-950/40 p-3">
        <div className="flex flex-wrap gap-1.5">
          {list.map((g) => (
            <span key={g.gene} title={g.covalent ? 'covalent-targetable' : undefined}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium"
              style={{ background: accent + '1f', color: accent, boxShadow: g.covalent ? 'inset 0 0 0 1px #fbbf24' : 'none' }}>
              {g.gene}
              {g.score != null && <span className="font-mono opacity-60">{fmtScore(g.score)}</span>}
              {g.n_compounds > 1 && <span className="rounded bg-violet/25 px-1 text-[9px] font-semibold text-violet">×{g.n_compounds}</span>}
              {g.covalent && <BoltIcon className="h-3 w-3 text-amber" />}
            </span>
          ))}
          {!list.length && <span className="text-[12px] text-slate-500">No genes pass the current filters — relax the cutoff or covalent toggle.</span>}
        </div>
      </div>
    </div>
  )
}

function DiseaseCenter({ dResult, dGenes }) {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 rounded-xl bg-ink-950/40 p-3">
        <DiseaseVenn per={dResult.venn.per} common={dResult.venn.common} />
      </div>
      <GeneSetView label={`Common targets · ${dResult.label}`} genes={dGenes} hasResult accent="#2dd4bf" fallbackTitle="Common targets" />
    </div>
  )
}

function CompoundCenter({ cResult, dResult, cGenes, dCount, shared }) {
  if (!cResult) return <CenterMsg icon={<FlaskIcon className="h-8 w-8 text-slate-600" />} text="Compound targets" sub="Enter a compound (name or SMILES) to predict its targets." />
  return (
    <div className="flex h-full flex-col">
      {dResult && shared && (
        <div className="mb-3 rounded-xl bg-ink-950/40 p-3">
          <VennDiagram compoundLabel={cResult.name} diseaseLabel={dResult.label}
            compoundCount={cGenes.length} diseaseCount={dCount} sharedCount={shared.length} />
        </div>
      )}
      <GeneSetView label={cResult.name} genes={cGenes} hasResult accent="#2dd4bf" empty="No targets found." fallbackTitle="Compound targets" />
    </div>
  )
}

function HubChart({ hubs, topn }) {
  const data = (hubs?.ranking || []).slice(0, topn).map((r) => ({ gene: r.gene, score: r.score, degree: r.degree, hub: r.hub }))
  if (!data.length) return <CenterMsg icon={<HubIcon className="h-8 w-8 text-slate-600" />} text="No hub genes" sub="The PPI network had too few connected nodes." />
  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 px-1 text-[14px] font-semibold text-white">Top hub genes <span className="text-[12px] font-normal text-slate-500">· {hubs.method} centrality</span></div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
            <XAxis type="number" domain={[0, 'dataMax']} tick={false} axisLine={false} tickLine={false} height={1} />
            <YAxis type="category" dataKey="gene" width={70} tick={{ fill: '#cbd5e1', fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: 'rgba(167,139,250,0.08)' }}
              contentStyle={{ background: '#0f1729', border: '1px solid #1c2842', borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="score" radius={[0, 4, 4, 0]}>
              {data.map((d, i) => <Cell key={i} fill={d.hub ? '#a78bfa' : '#334768'} />)}
              <LabelList dataKey="degree" position="right" style={{ fill: '#64748b', fontSize: 11 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function EnrichmentCharts({ enrichment, libs }) {
  const results = enrichment?.results || {}
  const selected = LIBS.map(([k]) => k).filter((k) => libs[k] && (results[k] || []).length)
  if (!selected.length) {
    return <CenterMsg icon={<ChartIcon className="h-8 w-8 text-slate-600" />} text="No enrichment terms"
      sub={enrichment?.error || 'Select gene-set libraries and re-run the analysis.'} />
  }
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      {selected.map((k) => {
        const label = LIBS.find(([kk]) => kk === k)[1]
        const data = (results[k] || []).slice(0, 10).map((t) => ({
          term: t.term.length > 34 ? t.term.slice(0, 33) + '…' : t.term,
          value: Math.round((-Math.log10(t.pvalue)) * 100) / 100, count: t.count,
        }))
        return (
          <div key={k} className="rounded-xl bg-ink-950/40 p-3">
            <div className="mb-2 text-[13px] font-semibold text-white">{label}</div>
            <div style={{ height: 22 * data.length + 20 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} layout="vertical" margin={{ left: 8, right: 34, top: 2, bottom: 2 }}>
                  <XAxis type="number" domain={[0, 'dataMax']} tick={false} axisLine={false} tickLine={false} height={1} />
                  <YAxis type="category" dataKey="term" width={200} tick={{ fill: '#cbd5e1', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(167,139,250,0.08)' }}
                    contentStyle={{ background: '#0f1729', border: '1px solid #1c2842', borderRadius: 8, fontSize: 12 }}
                    formatter={(v, _n, p) => [`−log10 p = ${v} · ${p.payload.count} genes`, 'enrichment']} />
                  <Bar dataKey="value" fill="#a78bfa" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ============================ right inspector ============================ */
function StepInspector(p) {
  if (p.step === 'disease') return <DiseasePanel {...p} />
  if (p.step === 'compound') return <CompoundPanel {...p} />
  if (p.step === 'network') return <NetworkPanel {...p} />
  if (p.step === 'hubs') return <HubsPanel {...p} />
  if (p.step === 'enrichment') return <EnrichmentPanel {...p} />
  return null
}

function Panel({ icon, title, children }) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="mb-3 flex items-center gap-2">
        {icon}<span className="text-[14px] font-semibold text-white">{title}</span>
        <span className="ml-auto rounded-full bg-violet/14 px-2 py-0.5 text-[10px] text-violet">online</span>
      </div>
      {children}
    </div>
  )
}

function DiseasePanel({ disease, setDisease, dSources, setDSources, multiDiseaseMode, setMultiDiseaseMode, diseasesText, setDiseasesText, dUpload, setDUpload, dLoading, dResult, loadDisease, dMinScore, setDMinScore, dCovOnly, setDCovOnly, dCount, onCaseStudy }) {
  return (
    <Panel icon={<VirusIcon className="h-4 w-4 text-violet" />} title="Disease targets">
      <button onClick={onCaseStudy}
        className="mb-3 flex w-full items-center gap-2 rounded-lg border border-violet/30 bg-violet/5 px-2.5 py-1.5 text-left text-[11px] text-violet transition hover:bg-violet/10">
        <BeakerIcon className="h-3.5 w-3.5" /> Load validation case · curcumin × triple-negative breast cancer
      </button>
      <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-ink-800/70 p-1">
        <TabBtn on={!multiDiseaseMode} onClick={() => setMultiDiseaseMode(false)}>Single</TabBtn>
        <TabBtn on={multiDiseaseMode} onClick={() => setMultiDiseaseMode(true)}>Multi-disease</TabBtn>
      </div>
      {multiDiseaseMode ? (
        <>
          <label className="block text-[11px] text-slate-400">Diseases — one per line (common targets used)</label>
          <textarea value={diseasesText} onChange={(e) => setDiseasesText(e.target.value)} rows={3}
            placeholder={'breast cancer\nalzheimer disease'}
            className="mt-1 w-full resize-none rounded-lg border border-ink-600 bg-ink-950/60 px-3 py-2 text-[12px] text-white placeholder-slate-600 outline-none focus:border-violet" />
          <button onClick={loadDisease} disabled={dLoading}
            className="mt-2 w-full rounded-lg bg-violet/90 px-3 py-2 text-[12px] font-semibold text-ink-950 hover:bg-violet disabled:opacity-60">
            {dLoading ? 'Fetching…' : 'Fetch all'}
          </button>
          {dResult?.diseases?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {dResult.diseases.map((d) => (
                <span key={d.query} className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-slate-300">{d.label} <span className="text-slate-500">{d.count}</span></span>
              ))}
            </div>
          )}
          {dResult?.venn && (
            <div className="mt-2 rounded-lg bg-accent/10 px-2.5 py-1.5 text-[11.5px] text-accent ring-1 ring-accent/25">
              <span className="font-semibold">{dResult.venn.common} common targets</span> → to the analysis
            </div>
          )}
        </>
      ) : (
      <div className="flex gap-2">
        <input value={disease} onChange={(e) => setDisease(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && loadDisease()}
          placeholder="e.g. Alzheimer disease"
          className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-950/60 px-3 py-2 text-[13px] text-white placeholder-slate-600 outline-none focus:border-violet" />
        <button onClick={loadDisease} disabled={dLoading}
          className="rounded-lg bg-violet/90 px-3 py-2 text-[12px] font-semibold text-ink-950 hover:bg-violet disabled:opacity-60">
          {dLoading ? '…' : 'Fetch'}
        </button>
      </div>
      )}

      <div className="mt-3 text-[11px] text-slate-400">Sources (unioned)</div>
      <div className="mt-1.5 space-y-1.5">
        <SourceRow label="Open Targets" sub="key-free · evidence-scored" on={dSources.opentargets} onClick={() => setDSources((s) => ({ ...s, opentargets: !s.opentargets }))} />
        <SourceRow label="CTD" sub="curated gene–disease" on={dSources.ctd} onClick={() => setDSources((s) => ({ ...s, ctd: !s.ctd }))} />
      </div>

      <label className="mt-3 block text-[11px] text-slate-400">Paste / upload genes (GeneCards, OMIM, DisGeNET, TTD…)</label>
      <textarea value={dUpload} onChange={(e) => setDUpload(e.target.value)} rows={2}
        placeholder="APP, PSEN1, MAPT …"
        className="mt-1 w-full resize-none rounded-lg border border-ink-600 bg-ink-950/60 px-3 py-2 text-[12px] text-white placeholder-slate-600 outline-none focus:border-violet" />

      {dResult && (
        <>
          <div className="mt-4 border-t border-ink-700/60 pt-3">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Min association score</span><span className="font-mono text-slate-300">{dMinScore.toFixed(2)}</span>
            </div>
            <input type="range" min={0} max={0.9} step={0.05} value={dMinScore}
              onChange={(e) => setDMinScore(parseFloat(e.target.value))} className="mt-1 w-full accent-violet" />
            <CovalentToggle on={dCovOnly} onClick={() => setDCovOnly((v) => !v)} n={dResult.covalent_count} />
            <div className="mt-2 text-[11px] text-slate-400">
              <span className="text-white">{dCount}</span> of {dResult.count} genes selected
            </div>
            <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-500">
              {Object.entries(dResult.by_source || {}).map(([k, v]) => <span key={k} className="rounded bg-ink-800 px-1.5 py-0.5">{k}: {v}</span>)}
            </div>
          </div>
        </>
      )}
    </Panel>
  )
}

function CompoundPanel({ compound, setCompound, isSmiles, setIsSmiles, multiMode, setMultiMode, compoundsText, setCompoundsText, cSources, setCSources, cUpload, setCUpload, cMinScore, setCMinScore, cCovOnly, setCCovOnly, cCount, cLoading, cResult, loadCompound, onRun, running }) {
  return (
    <Panel icon={<FlaskIcon className="h-4 w-4 text-violet" />} title="Compound targets">
      <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-ink-800/70 p-1">
        <TabBtn on={!multiMode} onClick={() => setMultiMode(false)}>Single</TabBtn>
        <TabBtn on={multiMode} onClick={() => setMultiMode(true)}>Multi-compound</TabBtn>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-ink-800/70 p-1">
        <TabBtn on={!isSmiles} onClick={() => setIsSmiles(false)}>Name</TabBtn>
        <TabBtn on={isSmiles} onClick={() => setIsSmiles(true)}>SMILES</TabBtn>
      </div>

      {multiMode ? (
        <>
          <label className="block text-[11px] text-slate-400">Compounds — one per line</label>
          <textarea value={compoundsText} onChange={(e) => setCompoundsText(e.target.value)} rows={4}
            placeholder={isSmiles ? 'one SMILES per line…' : 'curcumin\nresveratrol\nquercetin'}
            className="mt-1 w-full resize-none rounded-lg border border-ink-600 bg-ink-950/60 px-3 py-2 text-[12px] text-white placeholder-slate-600 outline-none focus:border-violet" />
          <button onClick={loadCompound} disabled={cLoading}
            className="mt-2 w-full rounded-lg bg-violet/90 px-3 py-2 text-[12px] font-semibold text-ink-950 hover:bg-violet disabled:opacity-60">
            {cLoading ? 'Resolving…' : 'Predict all'}
          </button>
        </>
      ) : (
        <div className="flex gap-2">
          <input value={compound} onChange={(e) => setCompound(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadCompound()}
            placeholder={isSmiles ? 'O=C(O)Cc1ccccc1…' : 'e.g. curcumin'}
            className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-950/60 px-3 py-2 text-[13px] text-white placeholder-slate-600 outline-none focus:border-violet" />
          <button onClick={loadCompound} disabled={cLoading}
            className="rounded-lg bg-violet/90 px-3 py-2 text-[12px] font-semibold text-ink-950 hover:bg-violet disabled:opacity-60">
            {cLoading ? '…' : 'Predict'}
          </button>
        </div>
      )}

      {multiMode && cResult?.compounds?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {cResult.compounds.map((c) => (
            <span key={c.query} className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-slate-300">{c.name} <span className="text-slate-500">{c.count}</span></span>
          ))}
        </div>
      )}

      <div className="mt-3 text-[11px] text-slate-400">Sources (unioned){isSmiles && <span className="ml-1 text-slate-600">· ChEMBL only for SMILES</span>}</div>
      <div className="mt-1.5 space-y-1.5">
        <SourceRow label="DGIdb" sub="curated interactions" on={cSources.dgidb} onClick={() => setCSources((s) => ({ ...s, dgidb: !s.dgidb }))} />
        <SourceRow label="ChEMBL" sub="measured bioactivity" on={cSources.chembl} onClick={() => setCSources((s) => ({ ...s, chembl: !s.chembl }))} />
      </div>

      <label className="mt-3 block text-[11px] text-slate-400">Paste / upload targets (SwissTargetPrediction, TCMSP…)</label>
      <textarea value={cUpload} onChange={(e) => setCUpload(e.target.value)} rows={2}
        placeholder="HDAC1, PTGS2, AKT1 …"
        className="mt-1 w-full resize-none rounded-lg border border-ink-600 bg-ink-950/60 px-3 py-2 text-[12px] text-white placeholder-slate-600 outline-none focus:border-violet" />

      {cResult && (
        <div className="mt-4 border-t border-ink-700/60 pt-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>Min confidence</span><span className="font-mono text-slate-300">{cMinScore.toFixed(2)}</span>
          </div>
          <input type="range" min={0} max={0.9} step={0.05} value={cMinScore} onChange={(e) => setCMinScore(parseFloat(e.target.value))}
            className="mt-1 w-full accent-violet" />
          <CovalentToggle on={cCovOnly} onClick={() => setCCovOnly((v) => !v)} n={cResult.covalent_count} />
          <div className="mt-2 text-[11px] text-slate-400">
            <span className="text-white">{cCount}</span> of {cResult.count} targets selected
            {cResult.shared_by_multi > 0 && <span className="ml-1 text-violet">· {cResult.shared_by_multi} hit by ≥2 compounds</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-500">
            {Object.entries(cResult.by_source || {}).filter(([, v]) => v > 0).map(([k, v]) => <span key={k} className="rounded bg-ink-800 px-1.5 py-0.5">{k}: {v}</span>)}
          </div>
        </div>
      )}
    </Panel>
  )
}

function NetworkPanel({ confidence, setConfidence, shared, sharedCov, result, onRun, running }) {
  const c = result?.counts
  return (
    <Panel icon={<NetIcon className="h-4 w-4 text-violet" />} title="Network">
      {shared != null && (
        <div className="mb-3 rounded-lg bg-ink-950/50 p-2.5 text-[12px] text-slate-300">
          <span className="text-white">{shared.length}</span> shared targets (compound ∩ disease)
          {sharedCov > 0 && <span className="ml-1 text-amber">· {sharedCov} covalent</span>}
        </div>
      )}
      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <span>STRING confidence</span><span className="font-mono text-slate-300">{confidence.toFixed(2)}</span>
      </div>
      <input type="range" min={0.15} max={0.95} step={0.05} value={confidence}
        onChange={(e) => setConfidence(parseFloat(e.target.value))} className="mt-1 w-full accent-violet" />
      <div className="mt-1 text-[10px] text-slate-500">Re-run after changing confidence to rebuild the PPI network.</div>

      {c && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="nodes" value={c.nodes} /><Stat label="edges" value={c.edges} />
          <Stat label="covalent" value={c.covalent ?? 0} />
        </div>
      )}
      <button onClick={onRun} disabled={running}
        className="mt-3 w-full rounded-lg bg-violet px-3 py-2 text-[12px] font-semibold text-ink-950 hover:brightness-110 disabled:opacity-60">
        {running ? 'Running…' : 'Rebuild network'}
      </button>
    </Panel>
  )
}

function HubsPanel({ centrality, setCentrality, topn, setTopn, result }) {
  const ranking = result?.hubs?.ranking || []
  return (
    <Panel icon={<HubIcon className="h-4 w-4 text-violet" />} title="Hub genes">
      <label className="block text-[11px] text-slate-400">Centrality method</label>
      <select value={centrality} onChange={(e) => setCentrality(e.target.value)}
        className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-950/60 px-2 py-2 text-[12px] text-white outline-none focus:border-violet">
        <option value="mcc">MCC (cytoHubba)</option>
        <option value="degree">Degree</option>
        <option value="betweenness">Betweenness</option>
        <option value="closeness">Closeness</option>
      </select>
      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400"><span>Top hubs</span><span className="font-mono text-slate-300">{topn}</span></div>
      <input type="range" min={5} max={30} step={1} value={topn} onChange={(e) => setTopn(parseInt(e.target.value))} className="mt-1 w-full accent-violet" />
      <div className="mt-1 text-[10px] text-slate-500">Re-run to recompute with a different method.</div>

      {!!ranking.length && (
        <div className="mt-3 max-h-52 space-y-1 overflow-y-auto">
          {ranking.slice(0, topn).map((r, i) => (
            <div key={r.gene} className="flex items-center gap-2 text-[12px]">
              <span className="w-4 text-right text-slate-600">{i + 1}</span>
              <span className={`h-2 w-2 rounded-full ${r.hub ? 'bg-violet' : 'bg-ink-600'}`} />
              <span className="text-slate-200">{r.gene}</span>
              <span className="ml-auto font-mono text-slate-500">{r.degree}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

function EnrichmentPanel({ libs, setLibs, result }) {
  const results = result?.enrichment?.results || {}
  return (
    <Panel icon={<ChartIcon className="h-4 w-4 text-violet" />} title="Enrichment">
      <div className="text-[11px] text-slate-400">Gene-set libraries</div>
      <div className="mt-1.5 space-y-1.5">
        {LIBS.map(([k, label]) => (
          <SourceRow key={k} label={label} sub={results[k] ? `${results[k].length} terms` : ''}
            on={libs[k]} onClick={() => setLibs((s) => ({ ...s, [k]: !s[k] }))} />
        ))}
      </div>
      <div className="mt-2 text-[10px] text-slate-500">Enrichr · re-run after changing libraries.</div>
    </Panel>
  )
}

/* ============================ small UI bits ============================ */
function ModulesButton({ onClick }) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl bg-violet/15 px-3 py-2 text-[12px] font-semibold text-violet ring-1 ring-violet/40 transition hover:bg-violet/25">
      <GridIcon className="h-4 w-4" /> Switch Module
    </button>
  )
}
function SourceRow({ label, sub, on, onClick }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition
      ${on ? 'border-violet/40 bg-violet/10' : 'border-ink-700 bg-ink-950/40 hover:border-ink-600'}`}>
      <span className={`grid h-4 w-4 place-items-center rounded ${on ? 'bg-violet text-ink-950' : 'bg-ink-700'}`}>
        {on && <CheckIcon className="h-3 w-3" />}
      </span>
      <span className="min-w-0"><span className="text-[12px] text-slate-200">{label}</span>{sub && <span className="ml-1 text-[10px] text-slate-500">{sub}</span>}</span>
    </button>
  )
}
function CovalentToggle({ on, onClick, n }) {
  return (
    <button onClick={onClick}
      className={`mt-3 flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition
        ${on ? 'border-amber/50 bg-amber/10' : 'border-ink-700 bg-ink-950/40 hover:border-ink-600'}`}>
      <BoltIcon className={`h-4 w-4 ${on ? 'text-amber' : 'text-slate-500'}`} />
      <span className="text-[12px] text-slate-200">Covalent-targetable only</span>
      {n != null && <span className="ml-auto rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-amber">{n}</span>}
    </button>
  )
}
function TabBtn({ on, onClick, children }) {
  return <button onClick={onClick} className={`rounded-md px-2 py-1.5 text-[12px] font-medium transition ${on ? 'bg-violet text-ink-950' : 'text-slate-400 hover:text-slate-200'}`}>{children}</button>
}
function Stat({ label, value }) {
  return <div className="rounded-lg bg-ink-950/50 p-2"><div className="text-[17px] font-semibold text-white">{value}</div><div className="text-[10px] text-slate-500">{label}</div></div>
}
function Spinner({ big }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-violet/30 border-t-violet ${big ? 'h-7 w-7' : 'h-4 w-4'}`} />
}
function engErr(e) {
  const m = String(e?.message || e)
  return m === 'ENGINE_OFFLINE' ? 'Engine offline — start the DDS engine.' : m
}

/* ---- icons ---- */
function I(props, path) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>{path}</svg>
}
function VirusIcon(p) { return I(p, <><circle cx="12" cy="12" r="5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></>) }
function FlaskIcon(p) { return I(p, <><path d="M9 3h6M10 3v6l-5 8a2 2 0 002 3h10a2 2 0 002-3l-5-8V3" /><path d="M7 14h10" /></>) }
function NetIcon(p) { return I(p, <><circle cx="12" cy="5" r="2.2" /><circle cx="5" cy="18" r="2.2" /><circle cx="19" cy="18" r="2.2" /><circle cx="12" cy="12" r="2.2" /><path d="M12 7.2V9.8M10.4 13.4l-3.8 3M13.6 13.4l3.8 3" /></>) }
function StructIcon(p) { return I(p, <><path d="M12 2l8 4.5v9L12 20l-8-4.5v-9L12 2z" /><path d="M12 2v18M4 6.5l8 4.5 8-4.5" /></>) }
function NewRunIcon(p) { return I(p, <><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v5h-5" /></>) }
function HubIcon(p) { return I(p, <><circle cx="12" cy="12" r="3" /><circle cx="12" cy="4" r="1.6" /><circle cx="12" cy="20" r="1.6" /><circle cx="4" cy="8" r="1.6" /><circle cx="20" cy="8" r="1.6" /><circle cx="4" cy="16" r="1.6" /><circle cx="20" cy="16" r="1.6" /><path d="M12 9V5.6M12 15v3.4M9.4 10.6L5.4 8.6M14.6 10.6l4-2M9.4 13.4l-4 2M14.6 13.4l4 2" /></>) }
function ChartIcon(p) { return I(p, <><path d="M4 20V4" /><rect x="7" y="12" width="3" height="6" /><rect x="12" y="8" width="3" height="10" /><rect x="17" y="5" width="3" height="13" /></>) }
function GridIcon(p) { return I(p, <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>) }
function PlayIcon(p) { return I(p, <path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none" />) }
function BoltIcon(p) { return I(p, <path d="M13 2L4.5 13.5H11l-1 8.5L19.5 10H13z" fill="currentColor" stroke="none" />) }
function BeakerIcon(p) { return I(p, <><path d="M9 3h6M10 3v5l-4.5 9a1.5 1.5 0 001.4 2.2h10.2a1.5 1.5 0 001.4-2.2L14 8V3" /><path d="M7.5 14h9" /></>) }
function ArrowRightIcon(p) { return I(p, <path d="M5 12h14M13 6l6 6-6 6" />) }
function ExportIcon(p) { return I(p, <><path d="M12 15V3M8 7l4-4 4 4" /><path d="M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" /></>) }
function BookIcon(p) { return I(p, <><path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z" /><path d="M4 19a2 2 0 012-2h13" /></>) }
function QuoteIcon(p) { return I(p, <><path d="M7 7H4a1 1 0 00-1 1v4a1 1 0 001 1h2v3a1 1 0 01-1 1H4M17 7h-3a1 1 0 00-1 1v4a1 1 0 001 1h2v3a1 1 0 01-1 1h-1" /></>) }
function GlobeIcon(p) { return I(p, <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18" /></>) }
function CheckIcon(p) { return I(p, <path d="M4 12l5 5L20 6" />) }
function CloseIcon(p) { return I(p, <path d="M6 6l12 12M18 6L6 18" />) }
