import JSZip from 'jszip'
import { saveFile } from '../../download.js'

// Export the whole network-pharmacology run: a print-ready PDF report (all sections
// with explanations, methods and references) and a .zip of CSV tables for every
// analysis (compound / disease libraries, intersections, PPI, hub genes, enrichment).
const LIB_NAMES = { GO_BP: 'GO — Biological process', GO_MF: 'GO — Molecular function', GO_CC: 'GO — Cellular component', KEGG: 'KEGG pathways' }

export default function NetpharmExport({ compoundLabel, diseaseLabel, dResult, cResult, shared, result, params, multiCompound, multiDisease, onClose }) {
  const title = `${compoundLabel || 'compound'} × ${diseaseLabel || 'disease'}`
  const slug = title.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-ink-700 bg-ink-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <div className="text-[15px] font-semibold text-white">Export report &amp; data</div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><CloseIcon /></button>
        </div>
        <div className="mb-4 text-[12px] text-slate-500">{title}</div>

        <button onClick={() => openReport({ title, compoundLabel, diseaseLabel, dResult, cResult, shared, result, params, multiCompound, multiDisease })}
          className="mb-2 flex w-full items-center gap-3 rounded-xl border border-ink-600 bg-ink-850 p-3 text-left transition hover:border-violet/50 hover:bg-ink-800">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-violet/15 text-violet"><DocIcon /></div>
          <div>
            <div className="text-[13px] font-semibold text-white">Report (PDF)</div>
            <div className="text-[11px] text-slate-500">Full report — tables, summaries, methods, references. Opens print → Save as PDF.</div>
          </div>
        </button>

        <button onClick={() => downloadZip({ slug, compoundLabel, diseaseLabel, dResult, cResult, shared, result, params, multiCompound, multiDisease })}
          className="flex w-full items-center gap-3 rounded-xl border border-ink-600 bg-ink-850 p-3 text-left transition hover:border-accent/50 hover:bg-ink-800">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent"><ZipIcon /></div>
          <div>
            <div className="text-[13px] font-semibold text-white">Data (CSV · .zip)</div>
            <div className="text-[11px] text-slate-500">Every table as a CSV (opens in Excel): target libraries, intersections, PPI, hub genes, enrichment.</div>
          </div>
        </button>
      </div>
    </div>
  )
}

/* ----------------------------- CSV bundle ----------------------------- */
function csv(headers, rows) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
  return [headers.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
}

async function downloadZip(d) {
  const zip = new JSZip()
  const { dResult, cResult, shared, result, params } = d

  // compound targets
  if (cResult?.genes) {
    const multi = d.multiCompound
    const head = ['gene', 'confidence', 'covalent', 'source'].concat(multi ? ['n_compounds', 'compounds'] : [])
    zip.file('01_compound_targets.csv', csv(head, cResult.genes.map((g) =>
      [g.gene, g.score ?? '', g.covalent ? 'yes' : 'no', g.source || ''].concat(multi ? [g.n_compounds ?? '', (g.compounds || []).join('; ')] : []))))
    if (multi && cResult.compounds) zip.file('01b_per_compound_counts.csv', csv(['compound', 'chembl_id', 'targets'], cResult.compounds.map((c) => [c.name, c.chembl_id || '', c.count])))
  }
  // disease targets
  if (dResult?.genes) {
    zip.file('02_disease_targets.csv', csv(['gene', 'association_score', 'covalent'], dResult.genes.map((g) => [g.gene, g.score ?? '', g.covalent ? 'yes' : 'no'])))
    if (d.multiDisease && dResult.venn) {
      zip.file('02b_disease_intersection.csv', csv(['disease', 'total_targets'], dResult.venn.per.map((p) => [p.label, p.total]).concat([['COMMON (all diseases)', dResult.venn.common]])))
    }
  }
  // shared / common compound-disease targets
  if (shared?.length) zip.file('03_shared_compound_disease_targets.csv', csv(['gene'], shared.map((g) => [g])))
  // pipeline outputs
  if (result) {
    if (result.hubs?.ranking) zip.file('04_hub_genes.csv', csv(['rank', 'gene', 'centrality_score', 'degree', 'is_hub'],
      result.hubs.ranking.map((r, i) => [i + 1, r.gene, r.score, r.degree, r.hub ? 'yes' : 'no'])))
    if (result.network?.edges) zip.file('05_ppi_edges.csv', csv(['source', 'target', 'string_score'],
      result.network.edges.map((e) => [e.data.source, e.data.target, e.data.score])))
    if (result.network?.nodes) zip.file('06_ppi_nodes.csv', csv(['gene', 'degree', 'is_hub', 'covalent'],
      result.network.nodes.map((n) => [n.data.id, n.data.degree, n.data.hub ? 'yes' : 'no', n.data.covalent ? 'yes' : 'no'])))
    const enr = result.enrichment?.results || {}
    let idx = 7
    for (const [k, rows] of Object.entries(enr)) {
      if (!rows?.length) continue
      zip.file(`${String(idx).padStart(2, '0')}_enrichment_${k}.csv`, csv(['term', 'p_value', 'adj_p_value', 'combined_score', 'overlap_count', 'overlap_genes'],
        rows.map((t) => [t.term, t.pvalue, t.adj_pvalue, t.combined, t.count, (t.genes || []).join('; ')])))
      idx++
    }
  }
  // run parameters
  zip.file('00_run_info.csv', csv(['parameter', 'value'], [
    ['compound(s)', d.compoundLabel || ''], ['disease(s)', d.diseaseLabel || ''],
    ['mode', `${d.multiCompound ? 'multi-compound (union)' : 'single compound'} · ${d.multiDisease ? 'multi-disease (intersection)' : 'single disease'}`],
    ['STRING confidence', params?.confidence], ['centrality', params?.centrality], ['top hubs', params?.topn],
    ['enrichment libraries', Object.keys(params?.libs || {}).filter((x) => params.libs[x]).join('; ')],
    ['shared targets (compound ∩ disease)', shared?.length ?? ''],
    ['PPI nodes', result?.counts?.nodes ?? ''], ['PPI edges', result?.counts?.edges ?? ''],
    ['generated', new Date().toISOString()],
  ]))

  const blob = await zip.generateAsync({ type: 'blob' })
  saveFile(`DDS_netpharm_${d.slug}.zip`, blob)
}

/* ----------------------------- PDF report ----------------------------- */
function openReport(d) {
  const html = buildReport(d)
  if (typeof window !== 'undefined' && window.pywebview && window.pywebview.api) return saveFile(`DDS_netpharm_${d.slug}.html`, html, 'text/html;charset=utf-8')  // native app: save via bridge
  const w = window.open('', '_blank')
  if (!w) return saveFile(`DDS_netpharm_${d.slug}.html`, html, 'text/html;charset=utf-8')
  w.document.open(); w.document.write(html); w.document.close()
  setTimeout(() => { try { w.focus(); w.print() } catch { /* user can print manually */ } }, 400)
}

function tbl(headers, rows) {
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((c) => `<td>${c == null ? '' : c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
}

function buildReport(d) {
  const { dResult, cResult, shared, result, params } = d
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const date = new Date().toLocaleString()
  const libs = Object.keys(params?.libs || {}).filter((x) => params.libs[x])
  const sec = []

  sec.push(`<h2>1. Summary</h2><p>This report describes a network-pharmacology analysis linking
    <b>${esc(d.compoundLabel)}</b> to <b>${esc(d.diseaseLabel)}</b>. Compound targets and disease-associated
    genes were assembled, their shared targets identified, a protein–protein interaction (PPI) network
    constructed, hub genes ranked, and functional enrichment computed. ${result ? `The intersection yielded
    <b>${result.counts.shared}</b> shared targets, a PPI network of <b>${result.counts.nodes}</b> nodes and
    <b>${result.counts.edges}</b> edges, and the top hub genes below.` : ''}</p>`)

  sec.push(`<h2>2. Methods &amp; protocol</h2>
    <p>Drug Design Studio (DDS)<sup>10&ndash;12</sup> was used to retrieve and assemble the compound and disease targets, identify their shared targets, construct and analyse the protein&ndash;protein interaction network, rank the hub genes, and perform the functional enrichment analysis reported here.</p>
    <p><b>Compound targets.</b> ${d.multiCompound ? 'Multiple compounds were queried and their predicted/known targets <b>pooled (union)</b>, each target tagged with the number of compounds engaging it.' : 'Targets were retrieved for the compound.'}
    Targets came from DGIdb (curated drug–gene interactions) and ChEMBL (measured bioactivity), mapped to a 0–1 confidence and de-duplicated to official gene symbols.</p>
    <p><b>Disease targets.</b> ${d.multiDisease ? 'Multiple diseases were queried and their <b>common (intersection)</b> genes taken as the disease target set (shared/comorbid mechanism).' : 'Disease-associated genes were retrieved and ranked by association score.'}
    Sources: Open Targets (evidence-scored) and CTD, unioned with any user-supplied list.</p>
    <p><b>Network &amp; hubs.</b> Shared targets (compound ∩ disease) were submitted to STRING (confidence ≥ ${params?.confidence ?? '0.4'}) to build the PPI network; hub genes were ranked by ${esc(params?.centrality || 'MCC')} centrality (cytoHubba-style) using NetworkX.</p>
    <p><b>Enrichment.</b> Gene-set over-representation was computed with Enrichr for: ${libs.map((l) => esc(LIB_NAMES[l] || l)).join(', ') || '—'}.</p>
    <p style="color:#555"><i>All computations are illustrative of the software's output; results reflect the state of the underlying public databases at ${esc(date)}.</i></p>`)

  // disease
  if (dResult) {
    let extra = ''
    if (d.multiDisease && dResult.venn) {
      extra = `<p>Diseases and their target counts (intersection = common to all):</p>${
        tbl(['Disease', 'Targets'], dResult.venn.per.map((p) => [esc(p.label), p.total]).concat([[`<b>Common</b>`, `<b>${dResult.venn.common}</b>`]]))}`
    }
    sec.push(`<h2>3. Disease targets</h2><p><b>${dResult.count}</b> disease-associated genes${d.multiDisease ? ' (common across the selected diseases)' : ''}, of which <b>${dResult.covalent_count}</b> are covalent-targetable. Top by association score:</p>${extra}
      ${tbl(['#', 'Gene', 'Association score', 'Covalent'], dResult.genes.slice(0, 30).map((g, i) => [i + 1, esc(g.gene), g.score ?? '—', g.covalent ? '⚡' : '']))}`)
  }
  // compound
  if (cResult) {
    let extra = ''
    if (d.multiCompound && cResult.compounds) {
      extra = `<p>Per-compound target counts (pooled by union; ${cResult.shared_by_multi} targets hit by ≥2 compounds):</p>${
        tbl(['Compound', 'Targets'], cResult.compounds.map((c) => [esc(c.name), c.count]))}`
    }
    sec.push(`<h2>4. Compound targets</h2><p><b>${cResult.count}</b> ${d.multiCompound ? 'pooled ' : ''}compound targets, <b>${cResult.covalent_count}</b> covalent-targetable. Top by confidence:</p>${extra}
      ${tbl(['#', 'Gene', 'Confidence', d.multiCompound ? '# compounds' : 'Source', 'Covalent'].filter(Boolean),
        cResult.genes.slice(0, 30).map((g, i) => [i + 1, esc(g.gene), g.score ?? '—', d.multiCompound ? (g.n_compounds ?? '') : esc(g.source || ''), g.covalent ? '⚡' : '']))}`)
  }
  // shared
  if (shared?.length) {
    sec.push(`<h2>5. Shared targets (compound ∩ disease)</h2><p><b>${shared.length}</b> targets are shared between the compound and disease sets — the candidate therapeutic targets carried into the network analysis.</p>
      <p class="genes">${shared.map(esc).join(', ')}</p>`)
  }
  // hubs
  if (result?.hubs?.ranking?.length) {
    sec.push(`<h2>6. Hub genes (${esc(result.hubs.method)} centrality)</h2><p>Hub genes are the most topologically central nodes in the PPI network — the most likely key regulators for further study.</p>
      ${tbl(['Rank', 'Gene', 'Centrality score', 'Degree', 'Hub'], result.hubs.ranking.slice(0, Math.max(15, params?.topn || 15)).map((r, i) => [i + 1, esc(r.gene), r.score, r.degree, r.hub ? '★' : '']))}`)
  }
  // enrichment
  const enr = result?.enrichment?.results || {}
  const enrSecs = Object.entries(enr).filter(([, rows]) => rows?.length)
  if (enrSecs.length) {
    sec.push(`<h2>7. Functional enrichment</h2>` + enrSecs.map(([k, rows]) =>
      `<h3>${esc(LIB_NAMES[k] || k)}</h3>${tbl(['Term', 'p-value', 'Adj. p', 'Combined', 'Genes'],
        rows.slice(0, 12).map((t) => [esc(t.term), fmtP(t.pvalue), fmtP(t.adj_pvalue), Math.round(t.combined), t.count]))}`).join(''))
  }

  sec.push(`<h2>References</h2><ol class="refs">
    <li>Hopkins AL. Network pharmacology: the next paradigm in drug discovery. <i>Nat Chem Biol</i> 2008;4:682–90.</li>
    <li>Ochoa D, et al. The Open Targets Platform. <i>Nucleic Acids Res</i> 2023;51:D1353–9.</li>
    <li>Davis AP, et al. Comparative Toxicogenomics Database (CTD). <i>Nucleic Acids Res</i> 2023;51:D1257–62.</li>
    <li>Freshour SL, et al. Drug–Gene Interaction Database (DGIdb 4.0). <i>Nucleic Acids Res</i> 2021;49:D1144–51.</li>
    <li>Zdrazil B, et al. The ChEMBL Database in 2023. <i>Nucleic Acids Res</i> 2024;52:D1180–92.</li>
    <li>Szklarczyk D, et al. STRING v12. <i>Nucleic Acids Res</i> 2023;51:D638–46.</li>
    <li>Chin CH, et al. cytoHubba: identifying hub objects and sub-networks. <i>BMC Syst Biol</i> 2014;8(S4):S11.</li>
    <li>Hagberg AA, et al. Exploring network structure with NetworkX. <i>Proc. SciPy</i> 2008:11–15.</li>
    <li>Kuleshov MV, et al. Enrichr. <i>Nucleic Acids Res</i> 2016;44:W90–7.</li>
    <li>Mahmoud E. Soliman. Drug Design Studio (DDS): An all-in-one cross-platform for covalent/non-covalent docking, covalent binders virtual screening and protein–ligand interaction analysis. <i>(Under review).</i></li>
    <li>Mahmoud E. Soliman. Drug Design Suite (DDS) 2.0: A Unified Platform for Network Pharmacology Integrated with Docking and Virtual Screening Workflow for Covalent/Non-Covalent Binders. <i>(Under review).</i></li>
    <li>Mahmoud E. Soliman. Drug Design Studio (DDS) 3.0: A Streamlined QSAR, 3D-QSAR and Pharmacophore Modelling Platform Coupling Ligand-Based Activity Prediction to Covalent and Non-Covalent Structure-Based Discovery. <i>(Under review).</i></li>
  </ol>`)

  return `<!doctype html><html><head><meta charset="utf-8"><title>Network Pharmacology Report — ${esc(d.title)}</title>
  <style>
    @page{margin:18mm}
    body{font:13px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a2233;max-width:820px;margin:0 auto;padding:24px}
    h1{font-size:22px;color:#0f766e;margin:0 0 2px}
    .sub{color:#64748b;font-size:12px;margin-bottom:18px}
    h2{font-size:16px;color:#0f766e;border-bottom:1px solid #dbe3ea;padding-bottom:4px;margin:22px 0 8px}
    h3{font-size:13px;color:#334155;margin:12px 0 4px}
    p{margin:6px 0}
    table{border-collapse:collapse;width:100%;font-size:11.5px;margin:6px 0 10px}
    th,td{border:1px solid #dbe3ea;padding:4px 7px;text-align:left}
    th{background:#eef4f3;color:#0f766e}
    tr:nth-child(even) td{background:#f7fafb}
    .genes{font-size:11px;color:#334155;word-spacing:2px}
    .refs li{margin:3px 0;font-size:11.5px}
    .guidance{background:#fef9ec;border:1px solid #f4d488;border-left:4px solid #d99a1c;border-radius:6px;padding:10px 14px;margin:14px 0 4px;font-size:12px;color:#7a5a10}
    @media print{body{padding:0}a{color:inherit}}
  </style></head><body>
    <h1>Network Pharmacology Report</h1>
    <div class="sub">${esc(d.title)} · generated ${esc(date)} · Drug Design Studio (DDS)</div>
    <div class="guidance"><b>Note:</b> This report is intended as guidance for your write-up. Please do not copy it verbatim — rephrase the findings in your own words.</div>
    ${sec.join('\n')}
  </body></html>`
}

function fmtP(p) { if (p == null) return ''; const n = Number(p); return n < 0.001 ? n.toExponential(1) : n.toFixed(3) }

function CloseIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg> }
function DocIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg> }
function ZipIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2z" /><path d="M12 3v4M12 9v2M12 13v2M12 17v2" /></svg> }
