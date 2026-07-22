import { useState, useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid,
} from 'recharts'
import InteractionMap2D from './InteractionMap2D.jsx'
import ExportModal from './ExportModal.jsx'
import Ligand2D from './Ligand2D.jsx'
import MoleculeViewer from './MoleculeViewer.jsx'
import * as api from '../api.js'
import { saveFile } from '../download.js'

/* ------------------------------------------------------------------ */
/*  Virtual Screening — dock a library of ligands vs one target,      */
/*  then rank by predicted binding affinity.                          */
/*  Mock library stands in for real Vina batch output.                */
/* ------------------------------------------------------------------ */

export const LIBRARY = [
  { id: 'VS-001', smiles: 'CC(C)(C)NC(=O)C1CC2CCCCC2CN1Cc1ccccc1', affinity: -10.4, mw: 492, logp: 3.8, hbd: 3, hba: 7, qed: 0.72 },
  { id: 'VS-002', smiles: 'O=C(Nc1ccc(F)cc1)c1cncc(-c2ccncc2)c1', affinity: -10.1, mw: 468, logp: 2.9, hbd: 2, hba: 6, qed: 0.81 },
  { id: 'VS-003', smiles: 'COc1ccc2[nH]c(-c3ccc(Cl)cc3)nc2c1', affinity: -9.9, mw: 451, logp: 4.1, hbd: 1, hba: 5, qed: 0.77 },
  { id: 'VS-004', smiles: 'CCN(CC)CCNC(=O)c1cc2cc(Br)ccc2n1CC(=O)N', affinity: -9.6, mw: 503, logp: 5.2, hbd: 4, hba: 8, qed: 0.58 },
  { id: 'VS-005', smiles: 'CC(C)Cc1ccc(cc1)C(C)C(=O)Nc1ncccn1', affinity: -9.4, mw: 421, logp: 2.9, hbd: 2, hba: 5, qed: 0.83 },
  { id: 'VS-006', smiles: 'Cc1ccc(cc1)S(=O)(=O)N1CCN(CC1)c1ccccn1', affinity: -9.1, mw: 389, logp: 3.4, hbd: 1, hba: 4, qed: 0.79 },
  { id: 'VS-007', smiles: 'O=C(O)c1ccc(cc1)Nc1nc(nc2ccccc12)N1CCOCC1', affinity: -8.9, mw: 446, logp: 3.0, hbd: 3, hba: 6, qed: 0.74 },
  { id: 'VS-008', smiles: 'NC(=O)c1cccc(c1)-c1ccc2ncccc2c1', affinity: -8.7, mw: 372, logp: 2.2, hbd: 2, hba: 5, qed: 0.86 },
  { id: 'VS-009', smiles: 'Fc1ccc(cc1)C1=NN(C(=O)C1)c1ccccc1', affinity: -8.5, mw: 410, logp: 3.9, hbd: 1, hba: 4, qed: 0.71 },
  { id: 'VS-010', smiles: 'CCCCn1c(=O)c2c(ncn2C)n(C)c1=O.OC(=O)c1ccccc1', affinity: -8.3, mw: 534, logp: 4.8, hbd: 5, hba: 9, qed: 0.49 },
  { id: 'VS-011', smiles: 'COc1cc(ccc1O)C=CC(=O)Nc1ccncc1', affinity: -8.0, mw: 398, logp: 2.6, hbd: 2, hba: 5, qed: 0.80 },
  { id: 'VS-012', smiles: 'OC1CCN(CC1)C(=O)c1ccc2[nH]ccc2c1', affinity: -7.8, mw: 356, logp: 1.9, hbd: 3, hba: 6, qed: 0.77 },
  { id: 'VS-013', smiles: 'Clc1ccc(cc1)-c1noc(n1)C1CCCCC1', affinity: -7.5, mw: 432, logp: 4.5, hbd: 0, hba: 3, qed: 0.63 },
  { id: 'VS-014', smiles: 'Cn1cnc2c1c(=O)n(C)c(=O)n2C', affinity: -7.2, mw: 301, logp: 1.4, hbd: 1, hba: 3, qed: 0.88 },
  { id: 'VS-015', smiles: 'CCCCCCc1ccc(cc1)C(=O)Nc1ccc(cc1)C(F)(F)F', affinity: -6.9, mw: 478, logp: 5.6, hbd: 2, hba: 6, qed: 0.44 },
  { id: 'VS-016', smiles: 'OCc1ccc(cc1)-c1cnn(c1)C', affinity: -6.6, mw: 344, logp: 2.8, hbd: 1, hba: 4, qed: 0.82 },
  { id: 'VS-017', smiles: 'NCCc1c[nH]c2ccc(O)cc12', affinity: -6.3, mw: 289, logp: 0.9, hbd: 4, hba: 5, qed: 0.75 },
  { id: 'VS-018', smiles: 'OC(=O)CCCCC(=O)Nc1ccc(cc1)S(N)(=O)=O', affinity: -5.9, mw: 512, logp: 3.2, hbd: 6, hba: 11, qed: 0.38 },
]

const DEFAULT_SMILES = LIBRARY.slice(0, 6).map((l) => `${l.smiles}  ${l.id}`).join('\n')

function lipinski(l) {
  const violations = (l.mw > 500 ? 1 : 0) + (l.logp > 5 ? 1 : 0) + (l.hbd > 5 ? 1 : 0) + (l.hba > 10 ? 1 : 0)
  return violations <= 1
}

const RESIDUE_POOL = [
  ['ASP25', 'H-bond'], ['ASP29', 'H-bond'], ['GLY27', 'H-bond'], ['ILE50', 'Hydrophobic'],
  ['ILE84', 'Hydrophobic'], ['ARG8', 'Salt bridge'], ['PHE53', 'π-stacking'], ['VAL82', 'Hydrophobic'],
  ['THR26', 'H-bond'], ['LEU23', 'Hydrophobic'],
]

function mockInteractions(idx) {
  const n = 4 + (idx % 3)
  return Array.from({ length: n }, (_, i) => {
    const [residue, type] = RESIDUE_POOL[(idx * 3 + i) % RESIDUE_POOL.length]
    const distance = +(2.6 + ((idx + i) % 6) * 0.3).toFixed(1)
    return { residue, type, distance }
  })
}

/* ================================================================== */
/*  Inspector panel — bulk SMILES library input                       */
/* ================================================================== */
export function ScreeningLibraryPanel({ onRun, running, count = 0, smiles, setSmiles }) {
  return (
    <div className="glass flex flex-col rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <LayersIcon className="h-4 w-4 text-accent" />
        <h2 className="text-[14px] font-semibold text-white">Compound Library</h2>
        <span className="ml-auto rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent">{count}</span>
      </div>

      <div className="mt-4 space-y-3">
        <div className="rounded-lg bg-ink-800/60 p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-400">Paste SMILES (one per line)</span>
            <span className="font-mono text-[10px] text-slate-600">SMILES  ID</span>
          </div>
          <textarea rows={8} value={smiles} onChange={(e) => setSmiles(e.target.value)}
            className="w-full resize-none rounded-md bg-ink-900 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-slate-200 outline-none ring-1 ring-ink-700 focus:ring-accent/60" />
        </div>

        <div className="rounded-lg bg-ink-800/40 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
          Each compound is prepared with RDKit + Meeko and docked with AutoDock Vina, then ranked by affinity. Larger libraries take longer.
        </div>

        <button onClick={onRun} disabled={running || count === 0}
          className="w-full rounded-xl bg-gradient-to-r from-accent to-accent-dim py-2.5 text-[13px] font-semibold text-ink-950 hover:brightness-110 disabled:opacity-60">
          {running ? 'Screening…' : `Screen ${count} compound${count === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  )
}

function exportRankedCsv(rows, target) {
  const cols = ['rank', 'id', 'smiles', 'affinity_kcal_mol', 'mw', 'logp', 'hbd', 'hba', 'qed', 'lipinski']
  const esc = (v) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [cols.join(',')]
  rows.forEach((r, i) => {
    lines.push([i + 1, r.id, r.smiles, r.affinity, r.mw, r.logp, r.hbd, r.hba, r.qed, r.lipinski_pass ? 'pass' : 'flag'].map(esc).join(','))
  })
  saveFile(`${(target || 'screening').replace(/\s+/g, '_')}_screening.csv`, lines.join('\n'), 'text/csv;charset=utf-8')
}

function parseLib(text) {
  return (text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => {
    const p = l.split(/\s+/)
    return { smiles: p[0], id: p[1] || `L-${String(i + 1).padStart(3, '0')}` }
  })
}

/* ================================================================== */
/*  Center — loaded compound table (pre-run)                          */
/* ================================================================== */
export function LibraryCenter({ smiles }) {
  const rows = parseLib(smiles)
  return (
    <section className="glass flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-3">
        <div>
          <h3 className="text-[14px] font-semibold text-white">Compound Library</h3>
          <p className="text-[11px] text-slate-500">{rows.length} ligand{rows.length === 1 ? '' : 's'} queued for docking</p>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg bg-ink-800/70 px-2.5 py-1.5 text-[11px] text-slate-400">
          <span className="h-2 w-2 rounded-full bg-emerald-400" /> Ready to screen
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-ink-900/80 backdrop-blur">
            <tr className="text-[10px] uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">ID</th>
              <th className="px-3 py-2 font-medium">SMILES</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => (
              <tr key={l.id + i} className="border-t border-ink-800/60 text-[12px] hover:bg-ink-800/40">
                <td className="px-3 py-2 font-mono text-slate-600">{i + 1}</td>
                <td className="px-3 py-2 font-medium text-slate-200">{l.id}</td>
                <td className="max-w-[420px] truncate px-3 py-2 font-mono text-[11px] text-slate-500" title={l.smiles}>{l.smiles}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* ================================================================== */
/*  Rankings dashboard (post-run)                                     */
/* ================================================================== */
export function ScreeningResults({ result, receptor, box, scoring }) {
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [map2D, setMap2D] = useState(null)
  const [view3D, setView3D] = useState(null)   // {id, affinity, pdb}
  const [busy3D, setBusy3D] = useState(null)    // id being loaded

  async function open3D(l) {
    if (!l.complex_id) return
    setBusy3D(l.id)
    try {
      const r = await api.getComplex(l.complex_id)
      setView3D({ id: l.id, affinity: l.affinity, pdb: r.complex_pdb })
    } catch (e) { /* ignore */ } finally { setBusy3D(null) }
  }

  const all = (result?.results || []).filter((r) => r.affinity != null)
  const ranked = useMemo(() => [...all].sort((a, b) => a.affinity - b.affinity), [result])
  const strongCut = -8.5
  const target = receptor?.name || 'Receptor'

  const rows = ranked
    .filter((l) => (filter === 'druglike' ? l.lipinski_pass : filter === 'strong' ? l.affinity <= strongCut : true))
    .filter((l) => l.id.toLowerCase().includes(query.toLowerCase()) || (l.smiles || '').toLowerCase().includes(query.toLowerCase()))

  const hist = useMemo(() => {
    const bins = [-13, -12, -11, -10, -9, -8, -7, -6, -5, -4]
    return bins.slice(0, -1).map((lo, i) => {
      const hi = bins[i + 1]
      return { range: `${lo}`, count: ranked.filter((l) => l.affinity >= lo && l.affinity < hi).length }
    })
  }, [ranked])

  const top5 = ranked.slice(0, 5)
  const hitRate = ranked.length ? Math.round((ranked.filter((l) => l.affinity <= strongCut).length / ranked.length) * 100) : 0

  if (!ranked.length) {
    return <div className="grid flex-1 place-items-center text-slate-500">No successful screening results.</div>
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto">
      {/* toolbar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-white">Screening Rankings</h2>
          <p className="text-[11px] text-slate-500">{target} · {ranked.length} compounds · {scoring || 'vina'} scoring · real Vina runs</p>
        </div>
        <button onClick={() => setExportOpen(true)}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-accent to-accent-dim px-4 py-2 text-[13px] font-semibold text-ink-950 shadow-lg hover:brightness-110">
          <ExportIcon className="h-4 w-4" /> Export &amp; Prepare
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <Kpi label="Compounds screened" value={ranked.length} unit="ligands" />
        <Kpi label="Top hit" value={ranked[0].affinity} unit="kcal/mol" tone="accent" />
        <Kpi label="Hit rate" value={`${hitRate}%`} unit={`≤ ${strongCut}`} />
        <Kpi label="Drug-like" value={ranked.filter((l) => l.lipinski_pass).length} unit="pass Lipinski" />
      </div>

      {/* Top-5 hits with real 2D structures */}
      <div className="grid grid-cols-5 gap-3">
        {top5.map((l, i) => (
          <Podium key={l.id} rank={i + 1} ligand={l}
            on2D={l.ligand_2d ? () => setMap2D(l) : null}
            on3D={l.complex_id ? () => open3D(l) : null}
            busy={busy3D === l.id} />
        ))}
      </div>

      {/* distribution */}
      <div className="grid grid-cols-1 gap-4">
        <div className="glass rounded-2xl p-4">
          <h3 className="mb-1 text-[13px] font-semibold text-white">Affinity distribution</h3>
          <p className="mb-2 text-[11px] text-slate-500">Compounds per kcal/mol bin</p>
          <div className="h-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hist} margin={{ top: 6, right: 8, bottom: 0, left: -22 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1c2842" vertical={false} />
                <XAxis dataKey="range" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={{ stroke: '#1c2842' }} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip cursor={{ fill: 'rgba(45,212,191,0.06)' }} contentStyle={tooltipStyle} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {hist.map((h, i) => (
                    <Cell key={i} fill={+h.range <= strongCut ? '#2dd4bf' : '#1c6e63'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Ranked table */}
      <div className="glass rounded-2xl p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h3 className="text-[13px] font-semibold text-white">Ranked hits</h3>
          <div className="flex rounded-lg bg-ink-800/80 p-0.5">
            {[['all', 'All'], ['strong', 'Strong binders'], ['druglike', 'Drug-like']].map(([id, label]) => (
              <button key={id} onClick={() => setFilter(id)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition
                  ${filter === id ? 'bg-ink-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>{label}</button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-ink-900 px-2.5 py-1.5 ring-1 ring-ink-700">
            <SearchIcon className="h-3.5 w-3.5 text-slate-500" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by ID / SMILES"
              className="w-44 bg-transparent text-[12px] text-slate-200 outline-none placeholder:text-slate-600" />
          </div>
          <button onClick={() => exportRankedCsv(ranked, target)}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-ink-800/70 px-3 py-1.5 text-[11px] text-slate-300 hover:bg-ink-700 hover:text-white">
            <ExportIcon className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>

        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-ink-700/60 text-[10px] uppercase tracking-wider text-slate-500">
              <th className="pb-2 font-medium">Rank</th>
              <th className="pb-2 font-medium">Compound</th>
              <th className="pb-2 font-medium">Affinity</th>
              <th className="pb-2 font-medium">Score</th>
              <th className="pb-2 font-medium">MW</th>
              <th className="pb-2 font-medium">logP</th>
              <th className="pb-2 font-medium">QED</th>
              <th className="pb-2 font-medium">Lipinski</th>
              <th className="pb-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const rank = ranked.indexOf(l) + 1
              const scorePct = Math.round(((l.affinity - ranked[ranked.length - 1].affinity) / (ranked[0].affinity - ranked[ranked.length - 1].affinity)) * 100)
              return (
                <tr key={l.id} className="border-b border-ink-800/60 text-[12px] hover:bg-ink-800/40">
                  <td className="py-2.5">
                    <span className={`inline-grid h-6 w-6 place-items-center rounded-md font-mono text-[11px] font-bold
                      ${rank <= 3 ? 'bg-accent/20 text-accent' : 'text-slate-500'}`}>{rank}</span>
                  </td>
                  <td className="py-2.5">
                    <div className="font-medium text-slate-200">{l.id}</div>
                    <div className="max-w-[200px] truncate font-mono text-[10px] text-slate-600" title={l.smiles}>{l.smiles}</div>
                  </td>
                  <td className="py-2.5 font-mono font-semibold text-accent">{l.affinity}</td>
                  <td className="py-2.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-700">
                        <span className="block h-full rounded-full bg-gradient-to-r from-accent-dim to-accent" style={{ width: `${scorePct}%` }} />
                      </span>
                    </span>
                  </td>
                  <td className="py-2.5 font-mono text-slate-400">{l.mw}</td>
                  <td className="py-2.5 font-mono text-slate-400">{l.logp}</td>
                  <td className="py-2.5 font-mono text-slate-400">{l.qed}</td>
                  <td className="py-2.5">
                    {l.lipinski_pass
                      ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">Pass</span>
                      : <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">Flag</span>}
                  </td>
                  <td className="py-2.5 text-right">
                    <span className="inline-flex gap-1.5">
                      {l.ligand_2d && (
                        <button onClick={() => setMap2D(l)}
                          className="rounded-md bg-ink-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-ink-700 hover:text-white">2D</button>
                      )}
                      {l.complex_id && (
                        <button onClick={() => open3D(l)} disabled={busy3D === l.id}
                          className="rounded-md bg-ink-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-ink-700 hover:text-white disabled:opacity-40">{busy3D === l.id ? '…' : '3D'}</button>
                      )}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="mt-2 px-1 text-[11px] text-slate-600">
          Showing {rows.length} of {ranked.length} compounds{result?.n_fail ? ` · ${result.n_fail} failed to prepare` : ''}
        </div>
      </div>

      {map2D && (
        <Modal onClose={() => setMap2D(null)}>
          <InteractionMap2D ligand={map2D.id} pose={1} affinity={map2D.affinity}
            interactions={map2D.interactions || []} ligand2d={map2D.ligand_2d} />
        </Modal>
      )}

      {view3D && (
        <Modal onClose={() => setView3D(null)}>
          <div className="flex flex-col">
            <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-3 pr-14">
              <div>
                <h3 className="text-[14px] font-semibold text-white">3D Interactions · {view3D.id}</h3>
                <p className="text-[11px] text-slate-500">{view3D.affinity} kcal/mol · docked complex · H-bonds &amp; contacts</p>
              </div>
            </div>
            <div className="p-4">
              <div className="h-[520px]">
                <MoleculeViewer pdb={view3D.pdb} ligResn="LIG" showInteractions style="cartoon" showLigand spin={false} />
              </div>
            </div>
          </div>
        </Modal>
      )}

      {exportOpen && (
        <ExportModal onClose={() => setExportOpen(false)} payload={{
          mode: 'screen', target, pdb: target,
          scoring: result?.params?.scoring || scoring || 'vina', exhaustiveness: result?.params?.exhaustiveness ?? 8, params: result?.params,
          ligand: ranked[0].id, pose: 1, affinity: ranked[0].affinity, interactions: [],
          rows: ranked.map((l) => ({ name: l.id, affinity: l.affinity, mw: l.mw, logp: l.logp, qed: l.qed })),
          screenRows: ranked.slice(0, 10).map((l) => ({ id: l.id, affinity: l.affinity, complex_id: l.complex_id })),
        }} />
      )}
    </div>
  )
}

/* ------------------------------ pieces ------------------------------ */

function Podium({ rank, ligand, on2D, on3D, busy }) {
  const medals = ['from-amber-300 to-amber-500', 'from-slate-300 to-slate-400', 'from-orange-400 to-orange-600']
  const isTop = rank <= 3
  return (
    <div className="glass relative flex flex-col rounded-2xl p-3">
      <div className="flex items-center justify-between">
        <span className={`grid h-7 w-7 place-items-center rounded-lg text-[12px] font-bold
          ${isTop ? `bg-gradient-to-br ${medals[rank - 1]} text-ink-950` : 'bg-ink-700 text-slate-300'}`}>{rank}</span>
        <span className="font-mono text-[15px] font-bold text-accent">{ligand.affinity}</span>
      </div>
      <div className="mt-2 grid h-24 place-items-center overflow-hidden rounded-xl bg-white ring-1 ring-ink-700/60">
        {ligand.ligand_2d ? <Ligand2D ligand2d={ligand.ligand_2d} width={200} height={96} /> : <MoleculeGlyph seed={ligand.id} />}
      </div>
      <div className="mt-2 truncate text-[13px] font-semibold text-white">{ligand.id}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-slate-500">
        <span>MW {ligand.mw}</span><span>·</span><span>logP {ligand.logp}</span><span>·</span><span>QED {ligand.qed}</span>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <button onClick={on2D} disabled={!on2D}
          className="rounded-lg bg-accent/10 py-1.5 text-[11px] font-semibold text-accent ring-1 ring-accent/30 hover:bg-accent/20 disabled:opacity-40">2D</button>
        <button onClick={on3D} disabled={!on3D || busy}
          className="rounded-lg bg-violet/10 py-1.5 text-[11px] font-semibold text-violet ring-1 ring-violet/30 hover:bg-violet/20 disabled:opacity-40">{busy ? '…' : '3D'}</button>
      </div>
    </div>
  )
}

function MoleculeGlyph({ seed }) {
  // deterministic little skeletal doodle so each hit looks distinct
  const h = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0)
  const rot = h % 90
  return (
    <svg width="80" height="52" viewBox="0 0 80 52" fill="none" stroke="#5eead4" strokeWidth="1.6" style={{ transform: `rotate(${rot}deg)` }}>
      <polygon points="24,12 34,6 44,12 44,24 34,30 24,24" />
      <line x1="44" y1="12" x2="56" y2="8" />
      <line x1="56" y1="8" x2="66" y2="16" />
      <line x1="24" y1="24" x2="14" y2="30" />
      <circle cx="66" cy="16" r="3.5" fill="#0b1220" />
      <circle cx="14" cy="30" r="3.5" fill="#0b1220" />
    </svg>
  )
}

function Modal({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/80 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="glass relative max-h-[92vh] w-full max-w-5xl overflow-auto rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose}
          className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-lg bg-ink-800/80 text-slate-400 hover:bg-ink-700 hover:text-white">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        {children}
      </div>
    </div>
  )
}

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

function MiniStat({ label, value }) {
  return (
    <div className="rounded-lg bg-ink-800/50 py-2">
      <div className="font-mono text-[15px] font-bold text-slate-100">{value}</div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  )
}

const tooltipStyle = { background: '#0f1729', border: '1px solid #2a3757', borderRadius: 8, fontSize: 12, color: '#e2e8f0' }

/* icons */
function LayersIcon(p) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 2l9 5-9 5-9-5z" /><path d="M3 12l9 5 9-5M3 17l9 5 9-5" /></svg> }
function UploadIcon(p) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 16V4M8 8l4-4 4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg> }
function ExportIcon(p) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 15V3M8 7l4-4 4 4M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" /></svg> }
function SearchIcon(p) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg> }
