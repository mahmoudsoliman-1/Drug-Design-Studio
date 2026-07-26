import { useState } from 'react'
import Logo from './Logo.jsx'

/* ------------------------------------------------------------------ */
/*  In-app documentation — module-tabbed, scrollable panel. Each DDS   */
/*  module (Docking & VS, Network pharmacology, QSAR) has its own tab   */
/*  with overview, install, protocols/methods, quick start, references. */
/* ------------------------------------------------------------------ */

export const DOC_VERSION = 'v2.0.0'

export const CITATION = 'Mahmoud E. Soliman. Drug Design Studio (DDS): An all-in-one cross-platform for covalent/non-covalent docking, covalent binders virtual screening and protein–ligand interaction analysis. (Under review).'
export const CITATION2 = 'Mahmoud E. Soliman. Drug Design Suite (DDS) 2.0: A Unified Platform for Network Pharmacology Integrated with Docking and Virtual Screening Workflow for Covalent/Non-Covalent Binders. (Under review).'

const TONE = {
  teal:    { bg: 'bg-accent/15',        text: 'text-accent',        ring: 'ring-accent/30' },
  violet:  { bg: 'bg-violet/15',        text: 'text-violet',        ring: 'ring-violet/30' },
  amber:   { bg: 'bg-amber/15',         text: 'text-amber',         ring: 'ring-amber/30' },
  emerald: { bg: 'bg-emerald-500/15',   text: 'text-emerald-400',   ring: 'ring-emerald-500/30' },
  sky:     { bg: 'bg-sky-500/15',       text: 'text-sky-400',       ring: 'ring-sky-500/30' },
  rose:    { bg: 'bg-rose-500/15',      text: 'text-rose-400',      ring: 'ring-rose-500/30' },
}

const MODULES = [
  ['docking', 'Docking & VS', false],
  ['netpharm', 'Network pharmacology', false],
  ['qsar', 'QSAR — coming soon', true],
]

const MODULE_SECTIONS = {
  docking: [
    ['about', 'Overview'], ['features', 'Capabilities'], ['install', 'Installation'],
    ['theory', 'System setup'], ['docking', 'Docking'], ['covalent', 'Covalent docking'],
    ['tutorial', 'Tutorial'], ['export', 'Export & MD'], ['cite', 'Cite DDS'],
  ],
  netpharm: [
    ['np-about', 'Overview'], ['np-install', 'Installation'], ['np-protocols', 'Protocols'],
    ['np-methods', 'Methods'], ['np-multi', 'Multi-modes'], ['np-viz', 'Networks & export'],
    ['np-docking', 'Structures → Docking'], ['np-quick', 'Quick start'], ['cite', 'Cite DDS'],
  ],
  qsar: [],
}

export default function DocsModal({ onClose, initialModule = 'docking' }) {
  const [mod, setMod] = useState(initialModule)
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const sections = MODULE_SECTIONS[mod] || []
  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-ink-950/85 p-4 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div className="glass relative flex max-h-[93vh] w-full max-w-[780px] flex-col overflow-hidden rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-center gap-3 border-b border-ink-700/60 bg-ink-900/70 px-5 py-3.5">
          <Logo size={34} className="rounded-lg glow-accent" />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold leading-none text-white">Drug Design Studio</div>
            <div className="mt-1 text-[11px] font-medium text-accent">Documentation · {DOC_VERSION}</div>
          </div>
          <button onClick={onClose} title="Close" className="grid h-8 w-8 place-items-center rounded-lg bg-ink-800/80 text-slate-400 hover:bg-ink-700 hover:text-white"><X /></button>
        </div>

        {/* module tabs */}
        <div className="flex gap-1 border-b border-ink-700/60 bg-ink-900/60 px-4 py-2">
          {MODULES.map(([id, label, disabled]) => (
            <button key={id} disabled={disabled} onClick={() => !disabled && setMod(id)}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${mod === id ? 'bg-accent/15 text-accent ring-1 ring-accent/30' : disabled ? 'cursor-not-allowed text-slate-600' : 'text-slate-300 hover:bg-ink-800/70'}`}>{label}</button>
          ))}
        </div>

        {/* table of contents */}
        {sections.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-ink-700/60 bg-ink-900/40 px-5 py-2.5">
            {sections.map(([id, label]) => (
              <button key={id} onClick={() => go(`doc-${id}`)}
                className="rounded-full bg-ink-800/70 px-2.5 py-1 text-[10.5px] font-medium text-slate-300 transition hover:bg-accent/15 hover:text-accent">{label}</button>
            ))}
          </div>
        )}

        {/* body */}
        <div className="min-h-0 flex-1 space-y-9 overflow-auto px-5 py-5">
          {mod === 'docking' && <DockingDocs />}
          {mod === 'netpharm' && <NetpharmDocs />}
          {mod === 'qsar' && <QsarDocs />}
        </div>
      </div>
    </div>
  )
}

/* ============================= DOCKING & VS ============================= */
function DockingDocs() {
  return (
    <>
      <div className="rounded-2xl bg-gradient-to-br from-accent/15 via-ink-800/40 to-violet/10 p-5 ring-1 ring-accent/20">
        <div className="flex items-center gap-3">
          <Logo size={44} className="rounded-xl glow-accent" />
          <div>
            <div className="text-[18px] font-bold text-white">Docking &amp; Virtual Screening</div>
            <div className="mt-0.5 text-[12px] leading-snug text-slate-400">Covalent &amp; non-covalent docking, virtual screening and protein–ligand interaction analysis.</div>
          </div>
        </div>
      </div>

      <Section id="doc-about" tone="teal" icon={<Book />} title="What is DDS?" sub="A single, offline window from structure to annotated result">
        <p>DDS unifies the entire structure-based design workflow — receptor and ligand preparation, binding-site definition, docking (non-covalent <b>and</b> covalent), and two- and three-dimensional interaction analysis — inside one elegant, fully offline desktop application. It wraps a curated suite of trusted open-source engines behind a clean interface, so no command-line expertise is required and no data ever leaves your machine.</p>
        <Callout tone="teal"><b>Design philosophy.</b> DDS is deliberately built around a focused, well-chosen set of features that serve one purpose exceptionally well: setting up, running and analysing docking and virtual-screening campaigns with ease — while standardized exports connect the results to advanced downstream analyses.</Callout>
      </Section>

      <Section id="doc-features" tone="violet" icon={<Spark />} title="Capabilities" sub="Everything from a single ligand to a full covalent library">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Feat tone="teal" icon={<Target />} title="Molecular docking" desc="AutoDock Vina 1.2.5 with Vina and Vinardo scoring; ranked poses with per-pose interactions." />
          <Feat tone="violet" icon={<Layers />} title="Virtual screening" desc="Batch-dock SMILES libraries; rank hits with drug-likeness (Lipinski / QED) filters." />
          <Feat tone="emerald" icon={<Link />} title="Covalent docking &amp; screening" desc="Automatic warhead perception + reactive-residue targeting; geometry-guided and tethered protocols." />
          <Feat tone="amber" icon={<Flask />} title="Automated preparation" desc="Receptor (waters/ions, pH protonation, chain/cofactor editing) and ligand (3D, protonation) prep." />
          <Feat tone="sky" icon={<Chart />} title="Interaction analysis" desc="Publication-quality 2D and 3D interaction diagrams with PNG / SVG export." />
          <Feat tone="rose" icon={<Beaker />} title="MD-ready exports" desc="One-click, simulation-ready exports for AMBER, CHARMM and GROMACS." />
          <Feat tone="emerald" icon={<Check />} title="Docking validation" desc="Re-dock a co-crystal ligand and instantly see the RMSD and a 3D overlay of the docked pose on the native crystal structure — downloadable as an image." />
        </div>
        <p className="text-[11.5px] text-slate-400">Additional tools: pose energy-minimization (UFF / MMFF94), optional AI insights, and robust background jobs that survive navigation and refreshes.</p>
      </Section>

      <Section id="doc-install" tone="sky" icon={<Download />} title="Installation" sub="Native installers · everything runs locally">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card tone="sky" title="macOS (.dmg)"><Steps items={['Download the DDS .dmg and open it.', 'Drag Drug Design Studio into Applications.', 'First launch: right-click the app → Open (to bypass the unidentified-developer prompt).']} /></Card>
          <Card tone="sky" title="Windows (.exe)"><Steps items={['Download the DDS Setup .exe and run it.', 'Follow the installer; launch from the Start menu.', 'The first launch can take up to a minute while Windows scans the app.']} /></Card>
        </div>
        <Callout tone="emerald"><b>Fully offline &amp; private.</b> DDS bundles its own local engine (AutoDock Vina + Python toolchain). All docking calculations run on your computer; nothing is uploaded. Only the optional AI insights make an outbound request.</Callout>
      </Section>

      <Section id="doc-theory" tone="amber" icon={<Cpu />} title="System setup — theory &amp; protocol" sub="How DDS prepares the receptor, site and ligand">
        <Block n="1" title="Receptor preparation">Crystallographic waters and heteroatoms are removed (unless explicitly retained). Polar hydrogens are added and the protonation states of titratable residues are assigned at a user-chosen <b>pH</b> using the Open Babel pK<sub>a</sub> model, then Gasteiger–Marsili partial charges are applied and the receptor is written as a rigid PDBQT. A structure editor lets you delete individual chains, cofactors, nucleic-acid fragments or the co-crystal ligand before preparation.</Block>
        <Block n="2" title="Binding-site definition">The search grid is auto-centred on the detected co-crystal ligand (or the receptor centroid). Box centre and size (X/Y/Z, in Å) are fully adjustable, and the box is rendered live in 3D.</Block>
        <Block n="3" title="Ligand preparation">Ligands (SMILES or SDF / MOL2 / MOL / PDB) are parsed with RDKit, embedded to a 3D conformer with the ETKDG algorithm, optimised with MMFF94, protonated at physiological pH, and converted to PDBQT with rotatable bonds via Meeko. A live 2D + 3D preview confirms correct parsing.</Block>
      </Section>

      <Section id="doc-docking" tone="teal" icon={<Play />} title="Docking" sub="AutoDock Vina — Vina &amp; Vinardo scoring">
        <p>Docking is performed with <b>AutoDock Vina 1.2.5</b>. Choose between the <b>Vina</b> (default) and <b>Vinardo</b> scoring functions, and set the <b>exhaustiveness</b> to trade speed against thoroughness. Vina returns multiple binding modes ranked by predicted binding free energy (kcal·mol⁻¹); DDS builds a full protein–ligand complex and detects interactions for every pose so you can switch between them.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card tone="teal" title="Interaction detection">Hydrogen bonds (polar N/O···N/O, 2.4–3.5 Å), salt bridges (opposite charges ≤ 4.0 Å) and hydrophobic contacts (C···C ≤ 4.0 Å) are assigned geometrically from the 3D coordinates.</Card>
          <Card tone="teal" title="Pose cleanup">An optional UFF / MMFF94 energy-minimization relieves steric clashes in the ligand, pocket or whole complex — a light geometric relaxation, not a rigorous MM simulation.</Card>
        </div>
        <Callout tone="emerald"><b>Validate docking results.</b> For cognate re-docking, a <b>“Validate Docking Results”</b> button computes the heavy-atom <b>RMSD</b> between the docked pose and the experimental ligand and displays a 3D <b>overlay</b> (docked pose magenta, native crystal ligand green). An RMSD below ≈ 2 Å indicates the docking reproduces the crystallographic pose. Works for covalent poses via common-substructure alignment.</Callout>
      </Section>

      <Section id="doc-covalent" tone="emerald" icon={<Link />} title="Covalent docking — the two protocols" sub="Targeted covalent inhibitors, made routine">
        <p>Covalent docking couples non-covalent recognition with the geometry of bond formation. The electrophilic <b>warhead</b> is perceived from the ligand's connectivity (RDKit SMARTS — acrylamides, haloacetamides, vinyl sulfones, sulfonyl fluorides, epoxides, nitriles, boronic acids, aldehydes), and the target <b>nucleophilic residue</b> is chosen from those inside the box (Cys · Sγ, Ser · Oγ, Thr · Oγ1, Lys · Nζ, Tyr · Oη, His · Nε2/Nδ1).</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-accent/40 bg-accent/[0.05] p-3.5"><div className="mb-1 flex items-center gap-2"><span className="rounded-md bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">FAST</span><span className="text-[13px] font-semibold text-white">Geometry-guided</span></div><p className="text-[12px] leading-relaxed text-slate-300">A normal Vina run, after which poses are re-ranked by binding affinity <i>plus</i> the proximity of the warhead to the nucleophile. A pose is flagged compatible when this distance is within a chosen cutoff. No bond is formed; ideal for screening large libraries.</p></div>
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/[0.05] p-3.5"><div className="mb-1 flex items-center gap-2"><span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">RIGOROUS</span><span className="text-[13px] font-semibold text-white">Tethered (bond-restrained)</span></div><p className="text-[12px] leading-relaxed text-slate-300">The top pose is refined under a harmonic distance restraint that pulls the warhead to its ideal covalent bond length, receptor rigid and ligand relaxed on the UFF force field (Open Babel). The explicit covalent bond is formed; DDS reports the achieved bond distance.</p></div>
        </div>
        <p className="text-[11.5px] text-slate-400">Both protocols operate identically for single-ligand docking and full-library covalent virtual screening.</p>
      </Section>

      <Section id="doc-tutorial" tone="violet" icon={<Book />} title="Quick-start tutorial" sub="From a PDB ID to an annotated pose in five steps">
        <Steps items={[
          <><b>Load a receptor.</b> Enter a PDB ID (e.g. <code className="rounded bg-ink-900 px-1 text-[11px]">1HSG</code>) and Fetch, or upload a .pdb. Set retain-waters/ions and the protonation pH.</>,
          <><b>Provide a ligand.</b> Paste a SMILES string or upload SDF / MOL2 / MOL / PDB. The live preview confirms the structure parsed correctly.</>,
          <><b>Define the binding site.</b> Adjust the grid box. For covalent work, switch on <b>Covalent docking</b>, pick the reactive residue and method.</>,
          <><b>Dock.</b> Press <b>Run</b> — the calculation runs as a background job.</>,
          <><b>Analyse &amp; export.</b> Inspect affinity, poses and interactions (Off / 3D / 2D), validate, and export a report or MD-ready complex.</>,
        ]} />
      </Section>

      <Section id="doc-export" tone="rose" icon={<Beaker />} title="Export &amp; downstream MD" sub="Take the complex further">
        <p>One-click exports produce publication-quality figures (2D / 3D interaction diagrams as PNG / SVG) and simulation-ready inputs for <b>AMBER</b>, <b>CHARMM</b> and <b>GROMACS</b>. A reference-backed Computational Methods section is generated automatically and adapts to the exact protocol used.</p>
      </Section>

      <CiteSection />
      <Footer />
    </>
  )
}

/* ========================= NETWORK PHARMACOLOGY ========================= */
function NetpharmDocs() {
  return (
    <>
      <div className="rounded-2xl bg-gradient-to-br from-violet/15 via-ink-800/40 to-sky-500/10 p-5 ring-1 ring-violet/20">
        <div className="flex items-center gap-3">
          <Logo size={44} className="rounded-xl glow-accent" />
          <div>
            <div className="text-[18px] font-bold text-white">Network Pharmacology</div>
            <div className="mt-0.5 text-[12px] leading-snug text-slate-400">Compound → target → disease networks, hub-gene identification and pathway enrichment — end-to-end, in one workspace.</div>
          </div>
        </div>
      </div>

      <Section id="doc-np-about" tone="violet" icon={<Book />} title="What is the Network Pharmacology module?" sub="From compounds and diseases to the key regulatory hub genes">
        <p>Network pharmacology moves beyond the “one drug, one target” view: it maps how a compound (or several) engages a <b>network</b> of proteins, how those proteins connect to a disease, and which of them are the central regulators worth pursuing. This module automates the full protocol inside DDS — assembling compound targets and disease genes, finding their shared targets, building a protein–protein interaction (PPI) network, ranking <b>hub genes</b>, and computing functional (GO / KEGG) enrichment.</p>
        <Callout tone="violet"><b>Online module.</b> Unlike the offline docking engine, network pharmacology queries live public databases (Open Targets, CTD, DGIdb, ChEMBL, STRING, Enrichr). An internet connection is required; results reflect the current state of those resources and are cached per session.</Callout>
      </Section>

      <Section id="doc-np-install" tone="sky" icon={<Download />} title="Installation &amp; access" sub="Part of DDS — one install, all modules">
        <p>The Network Pharmacology module ships inside the same DDS application as Docking — there is nothing extra to install. Install DDS (see the <b>Docking &amp; VS</b> tab for the macOS <code className="rounded bg-ink-900 px-1 text-[11px]">.dmg</code> and Windows <code className="rounded bg-ink-900 px-1 text-[11px]">.exe</code> steps), launch it, accept the licence, and pick <b>Network pharmacology</b> from the module hub. Use <b>Switch Module</b> (top-right) to move between modules at any time; running jobs continue in the background.</p>
        <Callout tone="emerald"><b>Automatic data retrieval.</b> All resources (Open Targets, CTD, DGIdb, ChEMBL, STRING, Enrichr) are freely available and queried automatically — there is nothing to configure. You may additionally paste or upload your own gene or target lists (e.g. from GeneCards, OMIM, DisGeNET, SwissTargetPrediction or TCMSP).</Callout>
      </Section>

      <Section id="doc-np-protocols" tone="teal" icon={<Net />} title="The workflow — six steps" sub="Each step feeds the next, exactly like the docking workflow">
        <Block n="1" title="Disease targets">Enter a disease; DDS retrieves its associated genes from <b>Open Targets</b> (evidence-scored) and optionally <b>CTD</b>, unioned with any pasted/uploaded list. Genes are ranked by association score and can be filtered by a minimum-score cutoff and a covalent-targetable toggle.</Block>
        <Block n="2" title="Compound targets">Enter a compound (name or SMILES); DDS collects its targets from <b>DGIdb</b> (curated drug–gene interactions) and <b>ChEMBL</b> (measured bioactivity), each mapped to a 0–1 confidence, plus any uploaded target list. Ranked by confidence with a cutoff and covalent toggle.</Block>
        <Block n="3" title="Network (intersection + PPI)">The <b>shared targets</b> (compound ∩ disease) are computed and shown as a Venn diagram, then submitted to <b>STRING</b> to build the protein–protein interaction network at a chosen confidence. Rendered as an interactive Cytoscape map.</Block>
        <Block n="4" title="Hub genes">The PPI network is scored by topological <b>centrality</b> — MCC (Maximal Clique Centrality, the cytoHubba method) by default, or degree / betweenness / closeness. The top-ranked nodes are the <b>hub genes</b>: the most likely key regulators for follow-up (e.g. docking, MD, experiments).</Block>
        <Block n="5" title="Enrichment">The shared-target set is submitted to <b>Enrichr</b> for over-representation analysis against GO (Biological Process / Molecular Function / Cellular Component) and <b>KEGG</b> pathways, shown as a <b>GO dot plot</b>, a <b>KEGG Sankey + bubble figure</b> and a compound–target–pathway network.</Block>
        <Block n="6" title="Structures → Docking">For the top hub genes, DDS resolves a <b>representative experimental structure (PDB)</b> ranked for docking suitability and, with one click, hands it off to the <b>Docking &amp; Virtual Screening module</b> — the receptor is prefetched and the search box is pre-centred on the co-crystallised ligand. This closes the loop from network pharmacology to structure-based docking.</Block>
      </Section>

      <Section id="doc-np-methods" tone="amber" icon={<Cpu />} title="Methods &amp; data sources" sub="What runs behind each step">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Feat tone="sky" icon={<Net />} title="Disease genes" desc="Open Targets (evidence-scored) and CTD curated gene–disease associations, combined with any uploaded list and de-duplicated to official gene symbols." />
          <Feat tone="violet" icon={<Flask />} title="Compound targets" desc="DGIdb curated drug–gene interactions and ChEMBL measured bioactivity, mapped to a 0–1 confidence. Predicted target lists (SwissTargetPrediction / TCMSP) can be added." />
          <Feat tone="teal" icon={<Share />} title="PPI network" desc="STRING protein–protein interactions at a chosen confidence (default 0.4), shown as an interactive map with hub genes highlighted and covalent-targetable proteins ringed." />
          <Feat tone="amber" icon={<Chart />} title="Hub ranking" desc="Topological centrality — MCC (cytoHubba), degree, betweenness or closeness — flags the most central proteins as hub genes, on the network and in a ranked table." />
          <Feat tone="rose" icon={<Spark />} title="Enrichment" desc="Enrichr over-representation for GO BP/MF/CC and KEGG; each term carries its p-value, adjusted p, combined score and member genes." />
          <Feat tone="emerald" icon={<Link />} title="Covalent filter" desc="Targets are cross-referenced against a curated covalent-ligandability reference (targetable Cys / catalytic Ser·Cys / reactive residues) and badged ⚡ — linking network pharmacology to DDS covalent docking." />
        </div>
        <Callout tone="amber"><b>Gene-symbol normalization.</b> All sources are normalised to official HGNC symbols with an alias table (e.g. HER2→ERBB2, COX2→PTGS2), so combined libraries are always clean, de-duplicated lists and cross-source intersections never miss a synonym.</Callout>
      </Section>

      <Section id="doc-np-multi" tone="violet" icon={<Layers />} title="Multi-compound &amp; multi-disease modes" sub="Several compounds or diseases in one run">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-violet/40 bg-violet/[0.05] p-3.5"><div className="mb-1 flex items-center gap-2"><span className="rounded-md bg-violet/15 px-2 py-0.5 text-[10px] font-bold text-violet">UNION</span><span className="text-[13px] font-semibold text-white">Multi-compound</span></div><p className="text-[12px] leading-relaxed text-slate-300">Enter several compounds (one per line). Their targets are <b>pooled (union)</b> and each target is tagged with how many compounds engage it (<b>×N</b>); targets hit by more compounds rank higher. The compound–target–pathway network draws one triangle per compound. Ideal for multi-ingredient formulas or drug combinations.</p></div>
          <div className="rounded-xl border border-sky-500/40 bg-sky-500/[0.05] p-3.5"><div className="mb-1 flex items-center gap-2"><span className="rounded-md bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-sky-400">INTERSECTION</span><span className="text-[13px] font-semibold text-white">Multi-disease</span></div><p className="text-[12px] leading-relaxed text-slate-300">Enter several diseases. DDS takes the <b>common (intersection)</b> genes — the shared / comorbid-mechanism targets — and those proceed into the normal workflow. The disease-intersection Venn is exportable as PNG / SVG.</p></div>
        </div>
        <Callout tone="violet"><b>The deliberate split.</b> Compounds are <b>unioned</b> (you want every target any compound engages); diseases are <b>intersected</b> (you want the targets shared across the diseases). Everything downstream — shared set, PPI, hub genes, enrichment — is unchanged; the multi modes only change how the target sets are assembled. Each input step simply gains a Single / Multi toggle.</Callout>
      </Section>

      <Section id="doc-np-viz" tone="rose" icon={<Chart />} title="Networks, figures &amp; export" sub="Publication-ready outputs">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card tone="teal" title="Interactive networks">The PPI map and the concentric compound–target–pathway (C–T–P) network are interactive figures with node labels, hub highlighting and covalent rings. Fit / re-layout controls and PNG export (transparent / white / dark).</Card>
          <Card tone="sky" title="Venn diagrams">Compound ∩ disease and disease ∩ disease intersections are drawn as themed Venn diagrams, exportable as high-resolution PNG (transparent / white / dark) or vector SVG.</Card>
        </div>
        <Callout tone="rose"><b>Report &amp; data export.</b> The <b>Export report</b> button produces (1) a full <b>PDF report</b> — summary, methods &amp; protocol, disease/compound target tables, shared targets, hub-gene ranking, enrichment tables and references — via print-to-PDF; and (2) a <b>CSV .zip</b> containing every analysis table (target libraries, intersections, PPI nodes/edges, hub genes, enrichment) with clear file names, ready for Excel.</Callout>
      </Section>

      <Section id="doc-np-docking" tone="emerald" icon={<Share />} title="Structures → Docking — automated hand-off" sub="From a ranked hub gene to a ready-to-dock receptor, in one click">
        <p>The <b>Structures</b> step closes the loop from network pharmacology to structure-based docking. For the top hub genes it automatically finds a <b>representative experimental structure (PDB)</b> — the sort of choice that would otherwise need a manual literature search — and streams it straight into the <b>Docking &amp; Virtual Screening</b> module so you can dock your compound against each key regulator.</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Feat tone="sky" icon={<Net />} title="Gene → structure mapping" desc="Each hub gene is resolved to its reviewed human UniProt entry, then to every cross-referenced PDB entry — with experimental method, resolution, chain coverage and bound ligands." />
          <Feat tone="amber" icon={<Chart />} title="Docking-suitability ranking" desc="Candidates are scored for docking: X-ray / cryo-EM over NMR, higher resolution, broader domain coverage, and — most importantly — a bound drug-like ligand that marks the real binding pocket." />
          <Feat tone="violet" icon={<Flask />} title="Recommendation + alternatives" desc="Each gene card shows the recommended PDB (method · resolution · coverage · ligand) plus ranked alternatives, with direct RCSB and UniProt links. A low-coverage caveat flags peptide/fragment entries." />
          <Feat tone="teal" icon={<Download />} title="AlphaFold fallback" desc="When a target has no experimental structure, the predicted AlphaFold model is offered instead, clearly labelled — so even difficult targets have a starting point." />
        </div>
        <Callout tone="emerald"><b>One-click hand-off.</b> Pressing <b>Send to docking</b> on any structure opens the Docking module, <b>prefetches and prepares the receptor</b>, and <b>pre-centres the search box on the co-crystallised ligand</b> (the pocket the structure was solved with). The receptor lands ready on the <b>Receptor</b> step — add your compound, confirm the site, and dock. All structure data comes from public, key-free sources (UniProt, RCSB PDB, AlphaFold DB).</Callout>
      </Section>

      <Section id="doc-np-quick" tone="emerald" icon={<Play />} title="Quick start" sub="From compound + disease to hub genes">
        <Steps items={[
          <><b>Disease targets.</b> Enter a disease (e.g. <code className="rounded bg-ink-900 px-1 text-[11px]">breast cancer</code>) and Fetch — or switch to <b>Multi-disease</b> and enter several to use their common targets. Trim with the score cutoff if desired.</>,
          <><b>Compound targets.</b> Enter a compound (e.g. <code className="rounded bg-ink-900 px-1 text-[11px]">curcumin</code>) and Predict — or switch to <b>Multi-compound</b> for several. Paste a SwissTargetPrediction/TCMSP list for extra breadth if you have one.</>,
          <><b>Run analysis.</b> Press <b>Run analysis</b> (top of the right panel). It builds the PPI network, ranks hub genes and computes enrichment as a background job.</>,
          <><b>Explore.</b> Inspect the <b>Network</b> (PPI map), <b>Hub genes</b> (ranked), and <b>Enrichment</b> (GO dot plot, KEGG Sankey + bubble, and the compound–target–pathway network). Adjust STRING confidence or centrality method and re-run.</>,
          <><b>Dock the hubs.</b> Open the <b>Structures</b> step: DDS resolves a representative PDB for each top hub gene. Press <b>Send to docking</b> on one and the Docking module opens with the receptor prepared and the box centred on its ligand — ready to dock your compound.</>,
          <><b>Export.</b> Use <b>Export report</b> for the PDF report and the CSV .zip of every table; export any figure as PNG/SVG.</>,
        ]} />
        <Callout tone="teal"><b>Validation case.</b> A one-click <b>“Load validation case · curcumin × breast cancer”</b> button pre-fills a benchmarked example so you can reproduce a published-style result and check the protocol end-to-end.</Callout>
      </Section>

      <CiteSection />
      <Footer />
    </>
  )
}

/* ============================== QSAR (soon) ============================== */
function QsarDocs() {
  return (
    <div className="grid min-h-[300px] place-items-center text-center">
      <div>
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-sky-500/15 text-sky-400"><Chart /></div>
        <div className="text-[16px] font-semibold text-white">QSAR module — coming soon</div>
        <p className="mx-auto mt-2 max-w-sm text-[12.5px] leading-relaxed text-slate-400">Descriptor calculation, model training and validation, and activity prediction are on the roadmap. Documentation will appear here when the module ships.</p>
      </div>
    </div>
  )
}

function CiteSection() {
  return (
    <Section id="doc-cite" tone="sky" icon={<Quote />} title="Cite DDS" sub="Please cite if DDS supports your research">
      <div className="space-y-2.5 rounded-xl border border-ink-700/60 bg-ink-800/40 p-3.5 text-[12px] leading-relaxed text-slate-300">
        <div className="flex gap-2"><span className="font-semibold text-slate-500">1.</span><span>{CITATION}</span></div>
        <div className="flex gap-2"><span className="font-semibold text-slate-500">2.</span><span>{CITATION2}</span></div>
      </div>
    </Section>
  )
}

function Footer() {
  return (
    <div className="rounded-2xl border border-ink-700/60 bg-ink-900/50 p-4 text-center">
      <div className="text-[12.5px] font-semibold text-white">Drug Design Studio (DDS) · {DOC_VERSION}</div>
      <div className="mt-1 text-[11px] leading-relaxed text-slate-500">© Prof. Mahmoud E. Soliman — Molecular Bio-computation &amp; Drug Design Laboratory, University of KwaZulu-Natal.<br />Academic &amp; Non-Commercial License. Please cite DDS if it supports your research (see “Cite DDS”).</div>
      <div className="mt-2 text-[11px] text-accent">soliman@ukzn.ac.za · http://soliman.ukzn.ac.za/DDS.aspx</div>
    </div>
  )
}

/* ------------------------- Cite DDS (shared) ------------------------- */
export function CiteModal({ onClose }) {
  const [copied, setCopied] = useState(false)
  const copy = () => { try { navigator.clipboard.writeText(`${CITATION}\n\n${CITATION2}`); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* ignore */ } }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/85 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="glass w-full max-w-lg rounded-2xl p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent"><Quote /></div>
          <div className="flex-1"><div className="text-[15px] font-bold text-white">Cite DDS</div><div className="text-[11px] text-slate-500">Please cite if DDS supports your research</div></div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg bg-ink-800/80 text-slate-400 hover:bg-ink-700 hover:text-white"><X /></button>
        </div>
        <div className="space-y-2.5 rounded-xl border border-ink-700/60 bg-ink-900/60 p-3.5 text-[12px] leading-relaxed text-slate-300">
          <div className="flex gap-2"><span className="font-semibold text-slate-500">1.</span><span>{CITATION}</span></div>
          <div className="flex gap-2"><span className="font-semibold text-slate-500">2.</span><span>{CITATION2}</span></div>
        </div>
        <button onClick={copy} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-accent/90 px-3 py-2 text-[12px] font-semibold text-ink-950 transition hover:bg-accent">
          {copied ? <><Check /> Copied both</> : <><Quote /> Copy citations</>}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------- pieces ------------------------------- */
function Section({ id, tone, icon, title, sub, children }) {
  const c = TONE[tone]
  return (
    <section id={id} className="scroll-mt-2">
      <div className="mb-3 flex items-center gap-2.5">
        <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${c.bg} ${c.text}`}>{icon}</div>
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold leading-none text-white">{title}</h3>
          {sub && <p className="mt-1 text-[11px] text-slate-500">{sub}</p>}
        </div>
      </div>
      <div className="space-y-3 text-[12.5px] leading-relaxed text-slate-300">{children}</div>
    </section>
  )
}

function Card({ tone = 'teal', title, children }) {
  const c = TONE[tone]
  return (
    <div className="rounded-xl border border-ink-700/60 bg-ink-800/40 p-3.5">
      {title && <div className={`mb-1.5 text-[12.5px] font-semibold ${c.text}`}>{title}</div>}
      <div className="text-[12px] leading-relaxed text-slate-300">{children}</div>
    </div>
  )
}

function Callout({ tone = 'amber', children }) {
  const c = TONE[tone]
  return <div className={`rounded-lg ${c.bg} p-3 text-[12px] leading-relaxed text-slate-200 ring-1 ${c.ring}`}>{children}</div>
}

function Feat({ icon, tone = 'teal', title, desc }) {
  const c = TONE[tone]
  return (
    <div className="rounded-xl border border-ink-700/60 bg-ink-800/40 p-3">
      <div className={`mb-1.5 grid h-7 w-7 place-items-center rounded-lg ${c.bg} ${c.text}`}>{icon}</div>
      <div className="text-[12.5px] font-semibold text-white" dangerouslySetInnerHTML={{ __html: title }} />
      <div className="mt-0.5 text-[11px] leading-relaxed text-slate-400" dangerouslySetInnerHTML={{ __html: desc }} />
    </div>
  )
}

function Block({ n, title, children }) {
  return (
    <div className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-amber/15 text-[11px] font-bold text-amber">{n}</span>
      <div>
        <div className="text-[12.5px] font-semibold text-white">{title}</div>
        <div className="mt-0.5 text-[12px] leading-relaxed text-slate-300">{children}</div>
      </div>
    </div>
  )
}

function Steps({ items }) {
  return (
    <ol className="space-y-2.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent/15 text-[10px] font-bold text-accent">{i + 1}</span>
          <div className="text-[12px] leading-relaxed text-slate-300">{it}</div>
        </li>
      ))}
    </ol>
  )
}

/* -------------------------------- icons ------------------------------- */
function Ic(p, path) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" {...p}>{path}</svg> }
function X(p) { return Ic(p, <><path d="M6 6l12 12M18 6L6 18" /></>) }
function Book(p) { return Ic(p, <><path d="M4 5a2 2 0 012-2h12v16H6a2 2 0 00-2 2zM8 3v16" /></>) }
function Download(p) { return Ic(p, <><path d="M12 15V3M8 11l4 4 4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></>) }
function Target(p) { return Ic(p, <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>) }
function Layers(p) { return Ic(p, <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 12l9 5 9-5M3 17l9 5 9-5" /></>) }
function Link(p) { return Ic(p, <><path d="M9 15l6-6M10.5 6.5l1-1a4 4 0 015.66 5.66l-1.5 1.5M13.5 17.5l-1 1a4 4 0 01-5.66-5.66l1.5-1.5" /></>) }
function Flask(p) { return Ic(p, <><path d="M9 3h6M10 3v6l-5 8a2 2 0 002 3h10a2 2 0 002-3l-5-8V3" /><path d="M7 14h10" /></>) }
function Play(p) { return Ic(p, <><path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none" /></>) }
function Check(p) { return Ic(p, <><path d="M20 6L9 17l-5-5" /></>) }
function Chart(p) { return Ic(p, <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>) }
function Beaker(p) { return Ic(p, <><path d="M6 3h12M8 3v6l-4 9a1.5 1.5 0 001.4 2h13.2a1.5 1.5 0 001.4-2l-4-9V3" /><path d="M6.5 15h11" /></>) }
function Spark(p) { return Ic(p, <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="currentColor" stroke="none" /></>) }
function Cpu(p) { return Ic(p, <><rect x="7" y="7" width="10" height="10" rx="1.5" /><path d="M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2" /></>) }
function Quote(p) { return Ic(p, <><path d="M7 7H4a1 1 0 00-1 1v4a1 1 0 001 1h2v3a1 1 0 01-1 1H4M17 7h-3a1 1 0 00-1 1v4a1 1 0 001 1h2v3a1 1 0 01-1 1h-1" /></>) }
function Net(p) { return Ic(p, <><circle cx="12" cy="5" r="2.2" /><circle cx="5" cy="18" r="2.2" /><circle cx="19" cy="18" r="2.2" /><circle cx="12" cy="12" r="2.2" /><path d="M12 7.2V9.8M10.4 13.4l-3.8 3M13.6 13.4l3.8 3" /></>) }
function Share(p) { return Ic(p, <><circle cx="6" cy="12" r="2.4" /><circle cx="18" cy="6" r="2.4" /><circle cx="18" cy="18" r="2.4" /><path d="M8.1 11L16 6.7M8.1 13L16 17.3" /></>) }
