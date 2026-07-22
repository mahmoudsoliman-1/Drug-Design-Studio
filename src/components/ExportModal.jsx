import { useState } from 'react'
import JSZip from 'jszip'
import * as api from '../api.js'

/* ------------------------------------------------------------------ */
/*  Export & Prepare dialog                                            */
/*  - Report  : self-contained HTML report (tables + plots) / print    */
/*  - Structures : docked-complex PDB, receptor, ligand (real files)   */
/*  - MD-Ready : Amber / CHARMM / GROMACS preparation packages          */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: 'report', label: 'Report', icon: DocIcon, hint: 'Tables & plots' },
  { id: 'structures', label: 'Structures', icon: CubeIcon, hint: 'PDB complex & poses' },
  { id: 'md', label: 'MD-Ready Systems', icon: AtomIcon, hint: 'Amber · CHARMM · GROMACS' },
]

// force-field presets per engine
const MD_ENGINES = {
  amber: {
    label: 'Amber', ext: 'tleap.in',
    proteinFF: ['ff19SB', 'ff14SB'], ligandFF: ['GAFF2', 'GAFF'],
    water: ['OPC', 'TIP3P', 'TIP4P-Ew'], produces: 'complex.prmtop · complex.inpcrd',
  },
  charmm: {
    label: 'CHARMM', ext: 'prep.str',
    proteinFF: ['CHARMM36m'], ligandFF: ['CGenFF'],
    water: ['TIP3P'], produces: 'complex.psf · complex.crd',
  },
  gromacs: {
    label: 'GROMACS', ext: 'prep.sh',
    proteinFF: ['CHARMM36m', 'AMBER99SB-ILDN'], ligandFF: ['GAFF (acpype)', 'CGenFF'],
    water: ['TIP3P', 'SPC/E'], produces: 'topol.top · conf.gro · ligand.itp',
  },
}

export default function ExportModal({ onClose, payload }) {
  const meta = {
    target: 'HIV-1 Protease', pdb: '1HSG', scoring: 'vina', exhaustiveness: 16,
    ligand: 'Ligand-042', pose: 1, affinity: -9.8,
    poses: [], interactions: [], rows: [], mode: 'single', ...payload,
  }

  const [tab, setTab] = useState('report')
  const [busy, setBusy] = useState('')

  // report options
  const [reportFmt, setReportFmt] = useState('html')
  const [sections, setSections] = useState({ summary: true, poses: true, interactions: true, screening: meta.mode === 'screen', methods: true })

  // structure options
  const [struct, setStruct] = useState({ complex: true, receptor: false, ligand: false })

  // md options
  const [engine, setEngine] = useState('amber')
  const [md, setMd] = useState({ proteinFF: 'ff19SB', ligandFF: 'GAFF2', water: 'OPC', padding: 12, ions: true, conc: 0.15 })
  const [mdPick, setMdPick] = useState('__top__') // screen: compound id | '__top__' | '__top5__'

  function pickEngine(e) {
    setEngine(e)
    const cfg = MD_ENGINES[e]
    setMd((m) => ({ ...m, proteinFF: cfg.proteinFF[0], ligandFF: cfg.ligandFF[0], water: cfg.water[0] }))
  }

  async function run(kind) {
    setBusy(kind)
    try {
      if (kind === 'report') {
        const html = buildReportHTML(meta, sections)
        if (reportFmt === 'print') openPrint(html)
        else downloadText(`${meta.target.replace(/\s+/g, '_')}_DDS_report.html`, html, 'text/html')
      } else if (kind === 'structures') {
        await exportStructures(meta, struct)
      } else if (kind === 'md') {
        await exportMdPackage(engine, meta, md, mdPick)
      }
    } catch (e) {
      alert('Export failed: ' + e.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/80 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="glass relative flex h-[560px] w-full max-w-3xl overflow-hidden rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-lg bg-ink-800/80 text-slate-400 hover:bg-ink-700 hover:text-white">✕</button>

        {/* rail */}
        <div className="flex w-52 shrink-0 flex-col border-r border-ink-700/60 bg-ink-900/50 p-3">
          <div className="px-2 py-2">
            <div className="text-[14px] font-semibold text-white">Export &amp; Prepare</div>
            <div className="mt-0.5 text-[11px] text-slate-500">{meta.target} · {meta.pdb}</div>
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition
                  ${tab === t.id ? 'bg-accent/10 ring-1 ring-accent/40' : 'hover:bg-ink-800/70'}`}>
                <t.icon className={`h-4 w-4 ${tab === t.id ? 'text-accent' : 'text-slate-500'}`} />
                <div className="min-w-0">
                  <div className={`text-[12.5px] font-medium ${tab === t.id ? 'text-white' : 'text-slate-300'}`}>{t.label}</div>
                  <div className="truncate text-[10.5px] text-slate-500">{t.hint}</div>
                </div>
              </button>
            ))}
          </div>
          <div className="mt-auto rounded-lg bg-ink-800/40 p-2.5 text-[10px] leading-relaxed text-slate-500">
            Reproducible outputs — every file records the docking parameters used.
          </div>
        </div>

        {/* content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto p-5">
            {tab === 'report' && (
              <Section title="Results report" desc="A formatted document with the ranked poses, interactions and plots.">
                <FieldRow label="Format">
                  <Segmented value={reportFmt} onChange={setReportFmt}
                    options={[{ v: 'html', l: 'HTML file' }, { v: 'print', l: 'Print / PDF' }]} />
                </FieldRow>
                <div className="mt-3 text-[11px] font-medium text-slate-400">Include sections</div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {[
                    ['summary', 'Summary & KPIs'], ['poses', 'Ranked poses table'],
                    ['interactions', 'Key interactions'], ['screening', 'Screening leaderboard'],
                    ['methods', 'Methods & parameters'],
                  ].map(([k, l]) => (
                    <Check key={k} label={l} checked={sections[k]} onClick={() => setSections((s) => ({ ...s, [k]: !s[k] }))} />
                  ))}
                </div>
                <Note>Self-contained document — includes the methods &amp; parameters used, for reproducibility.</Note>
              </Section>
            )}

            {tab === 'structures' && meta.mode === 'screen' && (
              <Section title="Docked structures" desc="Real docked complexes from your screening run.">
                <div className="rounded-lg bg-ink-800/50 px-3 py-2.5 text-[12px] leading-relaxed text-slate-300">
                  Exports the <span className="font-semibold text-slate-100">docked complex</span> (receptor + best pose) for the
                  <span className="font-semibold text-slate-100"> top {Math.min(5, (meta.screenRows || []).length)} hits</span> — one PDB per compound.
                </div>
                <FileCheck label="Also export receptor-only PDB" sub="receptor.pdb" checked={struct.receptor} onClick={() => setStruct((s) => ({ ...s, receptor: !s.receptor }))} />
                <Note>Each file carries REMARK provenance (engine, scoring, compound id, affinity).</Note>
              </Section>
            )}

            {tab === 'structures' && meta.mode !== 'screen' && (
              <Section title="Docked structures" desc="Coordinate files for the top-scoring pose of the docked complex.">
                <div className="space-y-2">
                  <FileCheck label="Docked complex (receptor + ligand)" sub={`${safe(meta.target)}_complex.pdb`} checked={struct.complex} onClick={() => setStruct((s) => ({ ...s, complex: !s.complex }))} />
                  <FileCheck label="Receptor only" sub="receptor.pdb" checked={struct.receptor} onClick={() => setStruct((s) => ({ ...s, receptor: !s.receptor }))} />
                  <FileCheck label="Ligand only" sub="ligand.pdb" checked={struct.ligand} onClick={() => setStruct((s) => ({ ...s, ligand: !s.ligand }))} />
                </div>
                <Note>Real docked pose from your run. Each PDB carries REMARK provenance (engine, scoring, affinity).</Note>
              </Section>
            )}

            {tab === 'md' && (
              <Section title="MD-ready system" desc="Generates a self-contained preparation package (.zip) for your simulation engine.">
                {meta.mode === 'screen' && (
                  <div className="mb-3">
                    <div className="mb-1 text-[11px] text-slate-400">Prepare for</div>
                    <select value={mdPick} onChange={(e) => setMdPick(e.target.value)}
                      className="w-full rounded-md bg-ink-900 px-2.5 py-1.5 text-[12px] text-slate-200 outline-none ring-1 ring-ink-700 focus:ring-accent/60">
                      <option value="__top__">Top hit only</option>
                      <option value="__top5__">Top 5 hits (one folder each)</option>
                      {(meta.screenRows || []).map((r) => (
                        <option key={r.id} value={r.id}>{r.id} · {r.affinity} kcal/mol</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex gap-2">
                  {Object.entries(MD_ENGINES).map(([k, cfg]) => (
                    <button key={k} onClick={() => pickEngine(k)}
                      className={`flex-1 rounded-xl border px-3 py-2.5 text-left transition
                        ${engine === k ? 'border-accent/60 bg-accent/10' : 'border-ink-700 bg-ink-800/40 hover:border-ink-600'}`}>
                      <div className={`text-[13px] font-semibold ${engine === k ? 'text-white' : 'text-slate-300'}`}>{cfg.label}</div>
                      <div className="mt-0.5 font-mono text-[9.5px] text-slate-500">{cfg.produces}</div>
                    </button>
                  ))}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Select label="Protein force field" value={md.proteinFF} options={MD_ENGINES[engine].proteinFF} onChange={(v) => setMd((m) => ({ ...m, proteinFF: v }))} />
                  <Select label="Ligand force field" value={md.ligandFF} options={MD_ENGINES[engine].ligandFF} onChange={(v) => setMd((m) => ({ ...m, ligandFF: v }))} />
                  <Select label="Water model" value={md.water} options={MD_ENGINES[engine].water} onChange={(v) => setMd((m) => ({ ...m, water: v }))} />
                  <Field label="Box padding (Å)">
                    <input type="number" value={md.padding} min={8} max={20}
                      onChange={(e) => setMd((m) => ({ ...m, padding: +e.target.value }))}
                      className="w-full rounded-md bg-ink-900 px-2.5 py-1.5 font-mono text-[12px] text-slate-200 outline-none ring-1 ring-ink-700 focus:ring-accent/60" />
                  </Field>
                </div>
                <div className="mt-3 flex items-center gap-4">
                  <Check label="Neutralise & add ions" checked={md.ions} onClick={() => setMd((m) => ({ ...m, ions: !m.ions }))} />
                  {md.ions && (
                    <div className="flex items-center gap-2 text-[11px] text-slate-400">
                      <span>conc.</span>
                      <input type="number" step="0.05" value={md.conc} onChange={(e) => setMd((m) => ({ ...m, conc: +e.target.value }))}
                        className="w-16 rounded-md bg-ink-900 px-2 py-1 font-mono text-[11px] text-slate-200 outline-none ring-1 ring-ink-700 focus:ring-accent/60" />
                      <span>M NaCl</span>
                    </div>
                  )}
                </div>
                <Note>Downloads a <span className="font-mono text-slate-300">.zip</span> containing the docked <span className="font-mono text-slate-300">complex.pdb</span>, <span className="font-mono text-slate-300">receptor.pdb</span>, <span className="font-mono text-slate-300">ligand.pdb</span>, the <span className="font-mono text-slate-300">{MD_ENGINES[engine].ext}</span> script and a README. Run the script with the external tools (e.g., antechamber + tleap) to produce the final topology ({MD_ENGINES[engine].produces}); DDS does not run those tools itself.</Note>
              </Section>
            )}
          </div>

          {/* footer action */}
          <div className="flex items-center justify-between border-t border-ink-700/60 px-5 py-3">
            <div className="text-[11px] text-slate-500">
              {tab === 'report' && (reportFmt === 'print' ? 'Opens a print view — save as PDF' : 'Downloads a self-contained .html')}
              {tab === 'structures' && (meta.mode === 'screen'
                ? `Top ${Math.min(5, (meta.screenRows || []).length)} docked complexes${struct.receptor ? ' + receptor' : ''}`
                : `${Object.values(struct).filter(Boolean).length} file(s) selected`)}
              {tab === 'md' && `${MD_ENGINES[engine].label} package (.zip)${meta.mode === 'screen' ? (mdPick === '__top5__' ? ' · top 5' : mdPick === '__top__' ? ' · top hit' : ` · ${mdPick}`) : ''}`}
            </div>
            <button onClick={() => run(tab)} disabled={!!busy}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-accent to-accent-dim px-4 py-2 text-[13px] font-semibold text-ink-950 hover:brightness-110 disabled:opacity-60">
              {busy ? 'Preparing…' : <><DownloadIcon /> {tab === 'report' ? 'Generate report' : tab === 'structures' ? 'Export structures' : 'Export package'}</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------ UI atoms ---------------------------- */
function Section({ title, desc, children }) {
  return (
    <div>
      <h3 className="text-[14px] font-semibold text-white">{title}</h3>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">{desc}</p>
      <div className="mt-4">{children}</div>
    </div>
  )
}
function FieldRow({ label, children }) {
  return <div className="flex items-center gap-3"><span className="w-20 text-[12px] text-slate-400">{label}</span>{children}</div>
}
function Field({ label, children }) {
  return <div><div className="mb-1 text-[11px] text-slate-400">{label}</div>{children}</div>
}
function Segmented({ value, onChange, options }) {
  return (
    <div className="flex rounded-lg bg-ink-800/80 p-0.5">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)}
          className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition ${value === o.v ? 'bg-ink-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>{o.l}</button>
      ))}
    </div>
  )
}
function Select({ label, value, options, onChange }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md bg-ink-900 px-2.5 py-1.5 text-[12px] text-slate-200 outline-none ring-1 ring-ink-700 focus:ring-accent/60">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </Field>
  )
}
function Check({ label, checked, onClick }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 text-left">
      <span className={`grid h-4 w-4 place-items-center rounded ${checked ? 'bg-accent' : 'bg-ink-700 ring-1 ring-ink-600'}`}>
        {checked && <svg className="h-3 w-3 text-ink-950" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M4 12l5 5L20 6" /></svg>}
      </span>
      <span className={`text-[12px] ${checked ? 'text-slate-200' : 'text-slate-500'}`}>{label}</span>
    </button>
  )
}
function FileCheck({ label, sub, checked, onClick }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${checked ? 'border-accent/50 bg-accent/5' : 'border-ink-700 bg-ink-800/30 hover:border-ink-600'}`}>
      <span className={`grid h-4 w-4 place-items-center rounded ${checked ? 'bg-accent' : 'bg-ink-700 ring-1 ring-ink-600'}`}>
        {checked && <svg className="h-3 w-3 text-ink-950" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M4 12l5 5L20 6" /></svg>}
      </span>
      <div className="min-w-0">
        <div className={`text-[12.5px] font-medium ${checked ? 'text-slate-100' : 'text-slate-300'}`}>{label}</div>
        <div className="font-mono text-[10.5px] text-slate-500">{sub}</div>
      </div>
    </button>
  )
}
function Note({ children }) {
  return <div className="mt-4 flex gap-2 rounded-lg bg-ink-800/40 p-3 text-[11px] leading-relaxed text-slate-400"><InfoIcon /> <span>{children}</span></div>
}

/* ------------------------------ generators -------------------------- */
function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function openPrint(html) {
  const w = window.open('', '_blank')
  if (!w) { alert('Please allow pop-ups to use Print / PDF.'); return }
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 400)
}

function safe(s) { return String(s || 'structure').replace(/\s+/g, '_') }

function pdbHeader(meta, what, extra = {}) {
  return [
    `REMARK   1 ${what}`,
    `REMARK   1 Generated by Drug Design Studio (DDS)`,
    `REMARK   1 Docking engine  : AutoDock Vina 1.2.x   scoring: ${meta.scoring}`,
    `REMARK   1 Receptor        : ${meta.target}`,
    `REMARK   1 Ligand          : ${extra.ligand || meta.ligand}`,
    `REMARK   1 Binding affinity: ${extra.affinity != null ? extra.affinity : meta.affinity} kcal/mol`,
  ].join('\n') + '\n'
}

const strip = (pdb) => pdb.replace(/END\s*$/i, '').trimEnd()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function exportStructures(meta, struct) {
  if (meta.mode === 'screen') {
    const rows = (meta.screenRows || []).filter((r) => r.complex_id).slice(0, 5)
    if (!rows.length) throw new Error('no docked complexes available — re-run the screen')
    for (const r of rows) {
      const { complex_pdb } = await api.getComplex(r.complex_id)
      downloadText(`${safe(meta.target)}_${r.id}_complex.pdb`,
        pdbHeader(meta, 'DOCKED COMPLEX (receptor + ligand)', { ligand: r.id, affinity: r.affinity }) + strip(complex_pdb) + '\nEND\n',
        'chemical/x-pdb')
      await wait(180) // let the browser process each download
    }
    if (struct.receptor) {
      const { complex_pdb } = await api.getComplex(rows[0].complex_id)
      const rec = complex_pdb.split('\n').filter((l) => l.startsWith('ATOM') || l.startsWith('TER')).join('\n')
      downloadText(`${safe(meta.target)}_receptor.pdb`, pdbHeader(meta, 'RECEPTOR') + rec + '\nEND\n', 'chemical/x-pdb')
    }
    return
  }

  // single docking — use the real docked complex from the run
  const pdb = meta.complex_pdb
  if (!pdb) throw new Error('no docked complex available')
  const lines = pdb.split('\n')
  const isProtein = (l) => l.startsWith('ATOM')
  const isLigand = (l) => l.startsWith('HETATM') && l.slice(17, 20).trim() === 'LIG'
  const base = `${safe(meta.target)}_${safe(meta.ligand)}`
  if (struct.complex) {
    downloadText(`${base}_complex.pdb`, pdbHeader(meta, 'DOCKED COMPLEX (receptor + ligand)') +
      lines.filter((l) => isProtein(l) || isLigand(l) || l.startsWith('TER')).join('\n') + '\nEND\n', 'chemical/x-pdb')
  }
  if (struct.receptor) {
    downloadText(`${base}_receptor.pdb`, pdbHeader(meta, 'RECEPTOR') +
      lines.filter((l) => isProtein(l) || l.startsWith('TER')).join('\n') + '\nEND\n', 'chemical/x-pdb')
  }
  if (struct.ligand) {
    downloadText(`${base}_ligand.pdb`, pdbHeader(meta, 'LIGAND') + lines.filter(isLigand).join('\n') + '\nEND\n', 'chemical/x-pdb')
  }
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

async function exportMdPackage(engine, meta, md, pick) {
  const cfg = MD_ENGINES[engine]
  const zip = new JSZip()

  function addFiles(folder, complexPdb, ligName, affinity) {
    const lines = complexPdb.split('\n')
    const isProt = (l) => l.startsWith('ATOM')
    const isLig = (l) => l.startsWith('HETATM') && l.slice(17, 20).trim() === 'LIG'
    const m = { ...meta, ligand: ligName, affinity }
    const hdr = (what) => pdbHeader(m, what, { ligand: ligName, affinity })
    folder.file('complex.pdb', hdr('DOCKED COMPLEX (receptor + ligand)') + lines.filter((l) => isProt(l) || isLig(l) || l.startsWith('TER')).join('\n') + '\nEND\n')
    folder.file('receptor.pdb', hdr('RECEPTOR') + lines.filter((l) => isProt(l) || l.startsWith('TER')).join('\n') + '\nEND\n')
    folder.file('ligand.pdb', hdr('LIGAND') + lines.filter(isLig).join('\n') + '\nEND\n')
    folder.file(cfg.ext, buildMDScript(engine, m, md))
    folder.file('README.txt', mdReadme(engine, m, md, ligName, affinity))
  }

  if (meta.mode === 'screen') {
    const rows = meta.screenRows || []
    if (!rows.length) throw new Error('no docked complexes available — re-run the screen')
    let targets
    if (pick === '__top5__') targets = rows.slice(0, 5)
    else if (pick === '__top__') targets = [rows[0]]
    else targets = [rows.find((r) => r.id === pick) || rows[0]]
    for (const r of targets) {
      const { complex_pdb } = await api.getComplex(r.complex_id)
      const folder = targets.length > 1 ? zip.folder(r.id) : zip
      addFiles(folder, complex_pdb, r.id, r.affinity)
    }
  } else {
    if (!meta.complex_pdb) throw new Error('no docked complex available')
    addFiles(zip, meta.complex_pdb, meta.ligand, meta.affinity)
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  const suffix = meta.mode === 'screen' ? (pick === '__top5__' ? '_top5' : pick === '__top__' ? '' : `_${pick}`) : ''
  downloadBlob(`${safe(meta.target)}_${engine}_MD${suffix}.zip`, blob)
}

function mdReadme(engine, meta, md, ligName, affinity) {
  const cfg = MD_ENGINES[engine]
  const head = [
    `Drug Design Studio (DDS) — ${cfg.label} MD preparation package`,
    `==============================================================`,
    ``,
    `Target      : ${meta.target}`,
    `Ligand      : ${ligName}`,
    `Binding dG  : ${affinity} kcal/mol   (AutoDock Vina, ${meta.scoring})`,
    `Protein FF  : ${md.proteinFF}    Ligand FF: ${md.ligandFF}    Water: ${md.water}`,
    `Box padding : ${md.padding} A     Ions: ${md.ions ? `neutralise + ${md.conc} M NaCl` : 'none'}`,
    ``,
    `Files`,
    `-----`,
    `  complex.pdb   docked complex (receptor + ligand) — input for setup`,
    `  receptor.pdb  protein only`,
    `  ligand.pdb    docked ligand only (for parameterisation)`,
    `  ${cfg.ext}   ${cfg.label} preparation script`,
    ``,
    `NOTE: DDS does not run the external MD tools. Run the script yourself`,
    `(with the tools installed) to produce the final topology: ${cfg.produces}.`,
    `Set the ligand NET CHARGE in the parameterisation step (currently 0).`,
    ``,
  ]
  const steps = {
    amber: [
      `Steps (requires AmberTools):`,
      `  1. antechamber -i ligand.pdb -fi pdb -o ligand.mol2 -fo mol2 -c bcc -nc 0 -at ${md.ligandFF.toLowerCase()}`,
      `  2. parmchk2 -i ligand.mol2 -f mol2 -o ligand.frcmod`,
      `  3. tleap -f ${cfg.ext}      ->  complex.prmtop, complex.inpcrd`,
    ],
    gromacs: [
      `Steps (requires GROMACS + acpype):`,
      `  1. bash ${cfg.ext}          ->  topol.top, conf.gro, ligand.itp`,
    ],
    charmm: [
      `Steps (requires CHARMM + CGenFF):`,
      `  1. Obtain ligand.str from CGenFF (charmm-gui.org or the cgenff program)`,
      `  2. Run the ${cfg.ext} stream in CHARMM  ->  complex.psf, complex.crd`,
    ],
  }
  return head.concat(steps[engine] || []).join('\n') + '\n'
}

function buildMDScript(engine, meta, md) {
  const charge = 0
  const banner = [
    `# ${MD_ENGINES[engine].label} system preparation — Drug Design Studio (DDS)`,
    `# Target ${meta.target} (${meta.pdb})  |  Ligand ${meta.ligand}  |  dG ${meta.affinity} kcal/mol`,
    `# Protein FF: ${md.proteinFF}   Ligand FF: ${md.ligandFF}   Water: ${md.water}   Box pad: ${md.padding} A`,
    '',
  ].join('\n')

  if (engine === 'amber') {
    const ffmap = { ff19SB: 'protein.ff19SB', ff14SB: 'protein.ff14SB' }
    const watmap = { OPC: 'water.opc', TIP3P: 'water.tip3p', 'TIP4P-Ew': 'water.tip4pew' }
    const box = { OPC: 'OPCBOX', TIP3P: 'TIP3PBOX', 'TIP4P-Ew': 'TIP4PEWBOX' }[md.water]
    return banner + [
      '# 1) Parameterise the ligand (run first, in a shell; set -nc to the ligand net charge):',
      `#    antechamber -i ligand.pdb -fi pdb -o ligand.mol2 -fo mol2 -c bcc -nc ${charge} -at ${md.ligandFF.toLowerCase()}`,
      '#    parmchk2 -i ligand.mol2 -f mol2 -o ligand.frcmod',
      '',
      '# 2) tleap  ->  tleap -f this_file',
      `source leaprc.${ffmap[md.proteinFF]}`,
      `source leaprc.${md.ligandFF.toLowerCase()}`,
      `source leaprc.${watmap[md.water]}`,
      'loadamberparams ligand.frcmod',
      'LIG = loadmol2 ligand.mol2',
      `complex = loadpdb complex.pdb`,
      `solvateOct complex ${box} ${md.padding}.0`,
      md.ions ? `addIonsRand complex Na+ 0 Cl- 0` : '# (ions skipped)',
      'saveamberparm complex complex.prmtop complex.inpcrd',
      'savepdb complex complex_solvated.pdb',
      'quit',
      '',
    ].join('\n')
  }

  if (engine === 'gromacs') {
    const ff = md.proteinFF === 'CHARMM36m' ? 'charmm36-jul2022' : 'amber99sb-ildn'
    const wat = md.water === 'TIP3P' ? 'tip3p' : 'spce'
    return banner + [
      '#!/bin/bash',
      'set -e',
      '# 1) protein topology',
      `gmx pdb2gmx -f receptor.pdb -o protein.gro -water ${wat} -ff ${ff}`,
      '# 2) ligand parameters (set -n to the ligand net charge)',
      md.ligandFF.startsWith('GAFF')
        ? `acpype -i ligand.pdb -c bcc -n 0 -o gmx   # -> ligand_GMX.itp / .gro`
        : `# convert CGenFF stream to GROMACS with cgenff_charmm2gmx.py`,
      '# 3) assemble complex, box, solvate, ions',
      `gmx editconf -f complex.gro -o box.gro -c -d ${(md.padding / 10).toFixed(1)} -bt dodecahedron`,
      `gmx solvate -cp box.gro -cs spc216.gro -o solv.gro -p topol.top`,
      md.ions
        ? `gmx grompp -f ions.mdp -c solv.gro -p topol.top -o ions.tpr -maxwarn 1\n` +
          `echo SOL | gmx genion -s ions.tpr -o ions.gro -p topol.top -neutral -conc ${md.conc}`
        : '# (ions skipped)',
      'echo "System ready: topol.top / ions.gro"',
      '',
    ].join('\n')
  }

  // charmm
  return banner + [
    `* CHARMM preparation stream`,
    `* protein: ${md.proteinFF}   ligand: ${md.ligandFF}   water: ${md.water}`,
    '*',
    '! 1) obtain ligand topology/parameters from CGenFF (charmm-gui.org or cgenff)',
    '!    -> ligand.str',
    'read rtf   card name top_all36_prot.rtf',
    'read param card flex name par_all36m_prot.prm',
    'stream ligand.str',
    `open read card unit 10 name complex.pdb`,
    'read sequence pdb unit 10',
    'generate COMP first NTER last CTER setup',
    '! 2) solvate + neutralise (convsolv / genion equivalent)',
    `! box padding ${md.padding} A, ${md.water} water${md.ions ? `, ${md.conc} M NaCl` : ''}`,
    'write psf card name complex.psf',
    'write coor card name complex.crd',
    'stop',
    '',
  ].join('\n')
}

// Detailed, publication-ready methodology with numbered references.
function methodsHTML(meta) {
  const p = meta.params || {}
  const scoring = meta.scoring || p.scoring || 'vina'
  const scoringName = scoring === 'vinardo' ? 'Vinardo' : 'Vina'
  const exh = meta.exhaustiveness ?? p.exhaustiveness ?? 16
  const nModes = p.num_modes ?? (meta.poses ? meta.poses.length : 9)
  const c = p.center, s = p.size
  const box = (c && s)
    ? `a grid box of ${s.x}&thinsp;&times;&thinsp;${s.y}&thinsp;&times;&thinsp;${s.z}&nbsp;&Aring; centred at (${c.x}, ${c.y}, ${c.z})`
    : `a grid box enclosing the binding site`
  const ph = p.ph ?? 7.4
  const protonated = p.protonate === false
    ? `used in the protonation state provided`
    : `assigned protonation states appropriate to a physiological pH of ${ph} using the Open Babel pK<sub>a</sub> model<sup>3</sup>`
  const screening = meta.mode === 'screen'

  const R = [
    'Soliman ME. Drug Design Studio (DDS): a robust, cross-platform graphical interface for molecular docking, virtual screening and protein&ndash;ligand interaction analysis. <i>J Comput Chem.</i> 2026 (under review).',
    'Berman HM, Westbrook J, Feng Z, <i>et al.</i> The Protein Data Bank. <i>Nucleic Acids Res.</i> 2000;28:235&ndash;242.',
    "O'Boyle NM, Banck M, James CA, <i>et al.</i> Open Babel: An open chemical toolbox. <i>J Cheminform.</i> 2011;3:33.",
    'Gasteiger J, Marsili M. Iterative partial equalization of orbital electronegativity &mdash; a rapid access to atomic charges. <i>Tetrahedron.</i> 1980;36:3219&ndash;3228.',
    'Halgren TA. Merck molecular force field. I. Basis, form, scope, parameterization, and performance of MMFF94. <i>J Comput Chem.</i> 1996;17:490&ndash;519.',
    'Trott O, Olson AJ. AutoDock Vina: improving the speed and accuracy of docking with a new scoring function, efficient optimization, and multithreading. <i>J Comput Chem.</i> 2010;31:455&ndash;461.',
    'Eberhardt J, Santos-Martins D, Tillack AF, Forli S. AutoDock Vina 1.2.0: new docking methods, expanded force field, and Python bindings. <i>J Chem Inf Model.</i> 2021;61:3891&ndash;3898.',
    'Quiroga R, Villarreal MA. Vinardo: a scoring function based on AutoDock Vina improves scoring, docking, and virtual screening. <i>PLoS One.</i> 2016;11:e0155183.',
  ]

  const para = (body) => `<p style="font-size:12px;line-height:1.75;color:#334155;margin:8px 0">${body}</p>`

  const intro = para(
    `Drug Design Studio (DDS)<sup>1</sup> was used as the graphical interface for system preparation, docking, and analysis of the ${screening ? 'virtual-screening' : 'molecular-docking'} calculations. The three-dimensional structure of <b>${meta.target}</b>${meta.pdb ? ` (Protein Data Bank<sup>2</sup> entry <code>${meta.pdb}</code>)` : ''} was used as the receptor. Crystallographic waters and heteroatoms were removed (unless explicitly retained), polar hydrogen atoms were added, and Gasteiger&ndash;Marsili partial atomic charges<sup>4</sup> were assigned using Open Babel<sup>3</sup>. The prepared receptor was converted to the AutoDock PDBQT format and treated as rigid throughout docking.`)

  const ligand = para(
    `Ligands were processed with RDKit and ${protonated}. A three-dimensional conformer was generated with the ETKDG distance-geometry algorithm and energy-minimised with the Merck Molecular Force Field (MMFF94)<sup>5</sup>. Rotatable bonds and Gasteiger&ndash;Marsili charges<sup>4</sup> were assigned, and the ligand was converted to PDBQT format.`)

  const dock = para(
    `Docking was performed with <b>AutoDock Vina 1.2.5</b><sup>6,7</sup> employing the <b>${scoringName}</b> scoring function${scoring === 'vinardo' ? '<sup>8</sup>' : ''}. The search space was defined as ${box}. An exhaustiveness of <b>${exh}</b> was used and up to <b>${nModes}</b> binding modes were generated. Poses were ranked by their predicted binding free energy (kcal&thinsp;mol<sup>&minus;1</sup>)${screening ? '' : ', and the top-ranked pose was retained for interaction analysis'}.`)

  const screen = screening ? para(
    `Each of the ${p.n_ligands || 'library'} compounds was prepared and docked independently under identical parameters, and compounds were ranked by their best predicted binding affinity. Drug-likeness was assessed using Lipinski's rule of five and the quantitative estimate of drug-likeness (QED).`) : ''

  const inter = para(
    `Interactions between the top-ranked pose and the receptor were identified geometrically from the three-dimensional coordinates: hydrogen bonds were assigned for polar donor&ndash;acceptor (N/O&middot;&middot;&middot;N/O) distances of 2.4&ndash;3.5&nbsp;&Aring;, salt bridges for oppositely charged groups within 4.0&nbsp;&Aring;, and hydrophobic contacts for carbon&ndash;carbon distances &le;&nbsp;4.0&nbsp;&Aring;.`)

  const refs = `<h2>References</h2><ol style="font-size:11px;line-height:1.6;color:#475569;padding-left:18px;margin-top:6px">${R.map((r) => `<li style="margin:3px 0">${r}</li>`).join('')}</ol>`

  const disclaimer = `<p style="font-size:10.5px;color:#94a3b8;font-style:italic;margin-top:16px;border-top:1px dashed #e2e8f0;padding-top:8px">
    * This computational methods section is provided as a <b>guidance template only</b>. Please rewrite and adapt it in your own
    words to reflect the specifics of your own study before including it in any publication &mdash; do not copy it verbatim.</p>`

  return `<h2>Computational methods&nbsp;<span style="color:#0f766e">*</span></h2>${intro}${ligand}${dock}${screen}${inter}${refs}${disclaimer}`
}

function buildReportHTML(meta, sections) {
  const A = '#0d9488'
  const poses = meta.poses || []
  const rows = meta.rows || []
  const inter = meta.interactions || []
  const maxAff = Math.min(...(poses.length ? poses.map((p) => p.affinity) : [-10]))

  const bar = poses.length ? `
    <svg width="640" height="200" viewBox="0 0 640 200" xmlns="http://www.w3.org/2000/svg" style="max-width:100%">
      ${poses.map((p, i) => {
        const h = (p.affinity / maxAff) * 150
        const x = 30 + i * (580 / poses.length)
        const w = 580 / poses.length - 10
        return `<rect x="${x}" y="${170 - h}" width="${w}" height="${h}" rx="3" fill="${i === 0 ? A : '#5eead4'}"/>
          <text x="${x + w / 2}" y="185" font-size="10" text-anchor="middle" fill="#64748b">${p.pose}</text>
          <text x="${x + w / 2}" y="${165 - h}" font-size="9" text-anchor="middle" fill="#334155">${p.affinity}</text>`
      }).join('')}
      <text x="12" y="20" font-size="10" fill="#94a3b8">kcal/mol</text>
    </svg>` : ''

  const style = `
    <style>
      *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;color:#0f172a;margin:0;padding:40px;max-width:820px;margin:auto}
      h1{font-size:22px;margin:0 0 2px} h2{font-size:15px;margin:28px 0 10px;color:#0f766e;border-bottom:2px solid #ccfbf1;padding-bottom:4px}
      .sub{color:#64748b;font-size:12px} .author{color:#94a3b8;font-size:11px;margin-top:6px}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px} th{text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;padding:6px 8px}
      td{padding:6px 8px;border-bottom:1px solid #f1f5f9} .kpis{display:flex;gap:14px;margin-top:10px;flex-wrap:wrap}
      .kpi{border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;min-width:130px} .kpi .v{font-size:20px;font-weight:700;color:${A}} .kpi .l{font-size:11px;color:#64748b}
      .best{color:${A};font-weight:600} code{background:#f1f5f9;padding:1px 5px;border-radius:4px;font-size:11px}
      @media print{body{padding:0}}
    </style>`

  const summary = sections.summary ? `
    <h2>Summary</h2>
    <div class="kpis">
      <div class="kpi"><div class="v">${meta.affinity}</div><div class="l">Best affinity (kcal/mol)</div></div>
      <div class="kpi"><div class="v">${poses.length || '—'}</div><div class="l">Poses generated</div></div>
      <div class="kpi"><div class="v">${rows.length || 1}</div><div class="l">Compounds</div></div>
      <div class="kpi"><div class="v">${meta.scoring}</div><div class="l">Scoring function</div></div>
    </div>
    ${bar ? `<h2>Binding affinity by pose</h2>${bar}` : ''}` : ''

  const posesTbl = sections.poses && poses.length ? `
    <h2>Ranked poses</h2>
    <table><thead><tr><th>Pose</th><th>Affinity (kcal/mol)</th><th>RMSD l.b.</th><th>RMSD u.b.</th></tr></thead><tbody>
    ${poses.map((p) => `<tr><td>${p.pose}</td><td class="${p.pose === 1 ? 'best' : ''}">${p.affinity}</td><td>${p.rmsd_lb ?? '—'}</td><td>${p.rmsd_ub ?? '—'}</td></tr>`).join('')}
    </tbody></table>` : ''

  const interTbl = sections.interactions && inter.length ? `
    <h2>Key interactions</h2>
    <table><thead><tr><th>Residue</th><th>Type</th><th>Distance (Å)</th></tr></thead><tbody>
    ${inter.map((it) => `<tr><td>${it.residue}</td><td>${it.type}</td><td>${it.distance}</td></tr>`).join('')}
    </tbody></table>` : ''

  const screenTbl = sections.screening && rows.length ? `
    <h2>Virtual screening leaderboard</h2>
    <table><thead><tr><th>Rank</th><th>Compound</th><th>Affinity</th><th>MW</th><th>logP</th><th>QED</th></tr></thead><tbody>
    ${rows.map((c, i) => `<tr><td>${i + 1}</td><td>${c.name}</td><td class="${i === 0 ? 'best' : ''}">${c.affinity}</td><td>${c.mw ?? '—'}</td><td>${c.logp ?? '—'}</td><td>${c.qed ?? '—'}</td></tr>`).join('')}
    </tbody></table>` : ''

  const methods = sections.methods ? methodsHTML(meta) : ''

  return `<!doctype html><html><head><meta charset="utf-8"><title>${meta.target} — DDS Report</title>${style}</head>
  <body>
    <h1>${meta.target} — Docking Report</h1>
    <div class="sub">PDB ${meta.pdb} · ${meta.mode === 'screen' ? 'Virtual screening' : 'Single docking'} · engine AutoDock Vina (${meta.scoring})</div>
    ${summary}${posesTbl}${interTbl}${screenTbl}${methods}
    <div class="author" style="margin-top:30px;border-top:1px solid #e2e8f0;padding-top:10px">Generated by Drug Design Studio (DDS)</div>
  </body></html>`
}

/* ------------------------------ icons ------------------------------- */
function DocIcon(p) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h6" /></svg> }
function CubeIcon(p) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 3v18M4 7.5l8 4.5 8-4.5" /></svg> }
function AtomIcon(p) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><circle cx="12" cy="12" r="2" /><ellipse cx="12" cy="12" rx="10" ry="4.5" /><ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(60 12 12)" /><ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(120 12 12)" /></svg> }
function DownloadIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3M8 11l4 4 4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg> }
function InfoIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.8" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg> }
