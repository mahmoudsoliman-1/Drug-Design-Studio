import { useEffect, useMemo, useState } from 'react'
import * as api from '../../api.js'

// "Prepare for docking" — resolves each top hub gene to a representative PDB structure
// (ranked for docking suitability), shows the recommendation + alternatives with real
// metadata, and hands the chosen structure off to the Docking module (receptor
// prefetched, box centred on the co-crystallised ligand). AlphaFold model is offered
// when no experimental structure exists.
export default function HubStructures({ hubs, topn = 10, onSendToDocking }) {
  const genes = useMemo(() => (hubs?.ranking || []).slice(0, topn).map((r) => r.gene), [hubs, topn])
  const [state, setState] = useState({ loading: false, data: null, error: '' })

  useEffect(() => {
    if (!genes.length) return
    let alive = true
    setState({ loading: true, data: null, error: '' })
    api.netpharmHubStructures(genes)
      .then((r) => { if (alive) setState({ loading: false, data: r.structures || [], error: r.error || '' }) })
      .catch((e) => { if (alive) setState({ loading: false, data: null, error: String(e.message || e) }) })
    return () => { alive = false }
  }, [genes])

  if (!genes.length) {
    return <Center title="No hub genes yet" sub="Run the analysis first — the top hub genes feed this step." />
  }
  if (state.error && !state.data) return <Center title="Could not resolve structures" sub={state.error} />
  if (!state.data) {
    return <Center spinner title="Resolving representative structures…"
      sub={`Mapping ${genes.length} hub genes → UniProt → ranked PDB entries (RCSB · AlphaFold).`} />
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="text-[14px] font-semibold text-white">Representative structures for docking
          <span className="ml-1 text-[12px] font-normal text-slate-500">· top {state.data.length} hub genes</span></div>
        <div className="text-[11px] text-slate-500">ranked: method · resolution · coverage · bound ligand</div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {state.data.map((s) => <GeneCard key={s.gene} s={s} onSendToDocking={onSendToDocking} />)}
      </div>
    </div>
  )
}

function GeneCard({ s, onSendToDocking }) {
  const [open, setOpen] = useState(false)
  const rec = s.recommended
  return (
    <div className="rounded-xl bg-ink-900/50 p-3 ring-1 ring-ink-700/50">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[15px] font-bold text-white">{s.gene}</span>
          {s.uniprot && <a href={`https://www.uniprot.org/uniprotkb/${s.uniprot}`} target="_blank" rel="noreferrer"
            className="ml-2 text-[11px] font-medium text-violet hover:underline">{s.uniprot}</a>}
          {s.name && <span className="ml-2 truncate text-[11.5px] text-slate-500">{s.name}</span>}
        </div>
      </div>

      {rec ? (
        <div className="mt-2 rounded-lg bg-ink-950/50 p-2.5 ring-1 ring-accent/25">
          <div className="flex flex-wrap items-center gap-2">
            <a href={`https://www.rcsb.org/structure/${rec.pdb_id}`} target="_blank" rel="noreferrer"
              className="text-[16px] font-extrabold tracking-wide text-accent hover:underline">{rec.pdb_id}</a>
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent ring-1 ring-accent/30">recommended</span>
            {rec.method && <Badge>{rec.method}</Badge>}
            {rec.resolution != null && <Badge>{rec.resolution} Å</Badge>}
            {rec.coverage != null && <Badge tone={rec.coverage < 0.3 ? 'warn' : 'ok'}>{Math.round(rec.coverage * 100)}% coverage</Badge>}
            {rec.best_ligand
              ? <Badge tone="lig">ligand {rec.best_ligand.id}</Badge>
              : <Badge tone="warn">apo · no ligand</Badge>}
          </div>
          {rec.title && <div className="mt-1.5 text-[11.5px] text-slate-400">{rec.title}</div>}
          {rec.best_ligand?.name && <div className="mt-0.5 text-[11px] text-slate-500">bound: {rec.best_ligand.name}</div>}
          {rec.coverage != null && rec.coverage < 0.3 && (
            <div className="mt-1.5 rounded-md bg-amber/10 px-2 py-1 text-[10.5px] text-amber ring-1 ring-amber/25">
              Low domain coverage — this entry may be a peptide/complex fragment. Check it fits your target domain, or use the AlphaFold model.
            </div>
          )}
          <div className="mt-2.5 flex items-center gap-2">
            <button onClick={() => onSendToDocking?.({ pdbId: rec.pdb_id, gene: s.gene, ligand: rec.best_ligand?.id || null })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-ink-950 transition hover:brightness-110">
              <SendIcon /> Send to docking
            </button>
            {s.alternatives?.length > 0 && (
              <button onClick={() => setOpen((v) => !v)}
                className="rounded-lg bg-ink-800/70 px-2.5 py-1.5 text-[11.5px] text-slate-300 ring-1 ring-ink-600 transition hover:text-white">
                {open ? 'Hide' : `${s.alternatives.length} alternatives`}
              </button>
            )}
          </div>

          {open && (
            <div className="mt-2 space-y-1.5 border-t border-ink-700/50 pt-2">
              {s.alternatives.map((a) => (
                <div key={a.pdb_id} className="flex flex-wrap items-center gap-2 text-[11px]">
                  <a href={`https://www.rcsb.org/structure/${a.pdb_id}`} target="_blank" rel="noreferrer"
                    className="font-bold text-slate-200 hover:text-accent hover:underline">{a.pdb_id}</a>
                  {a.method && <span className="text-slate-500">{a.method}</span>}
                  {a.resolution != null && <span className="text-slate-500">{a.resolution} Å</span>}
                  {a.coverage != null && <span className="text-slate-500">{Math.round(a.coverage * 100)}%</span>}
                  {a.best_ligand && <span className="text-emerald-400/80">lig {a.best_ligand.id}</span>}
                  <button onClick={() => onSendToDocking?.({ pdbId: a.pdb_id, gene: s.gene, ligand: a.best_ligand?.id || null })}
                    className="ml-auto rounded bg-ink-800 px-2 py-0.5 text-[10.5px] text-accent ring-1 ring-accent/25 hover:bg-ink-700">dock</button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-2 rounded-lg bg-ink-950/50 p-2.5 text-[12px] text-slate-400 ring-1 ring-ink-700/50">
          No experimental PDB for this target.
          {s.alphafold && <> Use the predicted model:{' '}
            <a href={s.alphafold.url} target="_blank" rel="noreferrer" className="font-semibold text-sky hover:underline">{s.alphafold.model_id} (AlphaFold)</a>
            <span className="text-slate-500"> — download and upload it in the Docking module.</span></>}
        </div>
      )}

      {rec && s.alphafold && (
        <div className="mt-1.5 text-[10.5px] text-slate-600">
          Alternative predicted model: <a href={s.alphafold.url} target="_blank" rel="noreferrer" className="text-sky/80 hover:underline">{s.alphafold.model_id}</a>
        </div>
      )}
    </div>
  )
}

function Badge({ children, tone }) {
  const c = tone === 'warn' ? 'bg-amber/10 text-amber ring-amber/25'
    : tone === 'lig' ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/25'
      : 'bg-ink-800 text-slate-300 ring-ink-600'
  return <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ${c}`}>{children}</span>
}
function Center({ title, sub, spinner }) {
  return (
    <div className="grid h-full place-items-center rounded-xl bg-ink-950/40 text-center">
      <div>
        {spinner && <span className="mx-auto mb-3 block h-7 w-7 animate-spin rounded-full border-2 border-violet/30 border-t-violet" />}
        <div className="text-[14px] font-medium text-slate-300">{title}</div>
        <div className="mx-auto mt-1 max-w-md text-[12px] text-slate-500">{sub}</div>
      </div>
    </div>
  )
}
function SendIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" /></svg>
}
