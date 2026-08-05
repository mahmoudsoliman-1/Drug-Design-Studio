import { useState } from 'react'
import Logo from './Logo.jsx'

/* ------------------------------------------------------------------ */
/*  In-app documentation — module-tabbed, scrollable panel. Each DDS   */
/*  module (Docking & VS, Network pharmacology, QSAR) has its own tab   */
/*  with overview, install, protocols/methods, quick start, references. */
/* ------------------------------------------------------------------ */

export const DOC_VERSION = 'v4.0.0'

export const CITATION = 'Mahmoud E. Soliman. Drug Design Studio (DDS): An all-in-one cross-platform for covalent/non-covalent docking, covalent binders virtual screening and protein–ligand interaction analysis. (Under review).'
export const CITATION2 = 'Mahmoud E. Soliman. Drug Design Suite (DDS) 2.0: A Unified Platform for Network Pharmacology Integrated with Docking and Virtual Screening Workflow for Covalent/Non-Covalent Binders. (Under review).'
export const CITATION3 = 'Mahmoud E. Soliman. Drug Design Studio (DDS) 3.0: A Streamlined QSAR, 3D-QSAR and Pharmacophore Modelling Platform Coupling Ligand-Based Activity Prediction to Covalent and Non-Covalent Structure-Based Discovery. (Under review).'
export const CITATION4 = 'Mahmoud E. Soliman. Drug Design Studio (DDS) 4.0: A Nanopharmaceutical Simulation Platform for Automated Modelling of Drug–Nanocarrier Encapsulation and Drug–Drug Complexation. (Under review).'
export const CITATIONS = [CITATION, CITATION2, CITATION3, CITATION4]

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
  ['qsar', 'QSAR / 3D-QSAR', false],
  ['nano', 'Nano bio-pharma', false],
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
  qsar: [
    ['qs-about', 'Overview'], ['qs-install', 'Installation'], ['qs-workflow', 'Workflow'],
    ['qs-descriptors', 'Descriptors & models'], ['qs-validation', 'Validation'],
    ['qs-design', 'Design (DMTA)'], ['qs-viz', 'Structures & export'],
    ['qs-quick', 'Quick start'], ['cite', 'Cite DDS'],
  ],
  nano: [
    ['nb-about', 'Overview'], ['nb-install', 'Installation'], ['nb-workflow', 'Workflow'],
    ['nb-carriers', 'Nanocarriers'], ['nb-method', 'Method & scope'],
    ['nb-validation', 'Validation'], ['nb-quick', 'Quick start'], ['cite', 'Cite DDS'],
  ],
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
          {mod === 'nano' && <NanoDocs />}
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
        <p>DDS covers the structure-based design workflow — receptor and ligand preparation, binding-site definition, docking (non-covalent <b>and</b> covalent), and two- and three-dimensional interaction analysis — in a single, fully offline desktop application built on established open-source engines. It requires no command-line use, and no data leaves the local machine.</p>
        <Callout tone="teal"><b>Scope.</b> The module covers the setup, execution and analysis of docking and virtual-screening calculations; standardized exports connect the results to downstream analyses.</Callout>
      </Section>

      <Section id="doc-features" tone="violet" icon={<Spark />} title="Capabilities" sub="Everything from a single ligand to a full covalent library">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Feat tone="teal" icon={<Target />} title="Molecular docking" desc="AutoDock Vina 1.2.5 with Vina and Vinardo scoring; ranked poses with per-pose interactions." />
          <Feat tone="violet" icon={<Layers />} title="Virtual screening" desc="Batch-dock SMILES libraries; rank hits with drug-likeness (Lipinski / QED) filters." />
          <Feat tone="emerald" icon={<Link />} title="Covalent docking &amp; screening" desc="Automatic warhead perception + reactive-residue targeting; geometry-guided and tethered protocols." />
          <Feat tone="amber" icon={<Flask />} title="Automated preparation" desc="Receptor (waters/ions, pH protonation, chain/cofactor editing) and ligand (3D, protonation) prep." />
          <Feat tone="sky" icon={<Chart />} title="Interaction analysis" desc="2D and 3D interaction diagrams with PNG / SVG export." />
          <Feat tone="rose" icon={<Beaker />} title="MD-ready exports" desc="One-click, simulation-ready exports for AMBER, CHARMM and GROMACS." />
          <Feat tone="emerald" icon={<Check />} title="Docking validation" desc="Re-dock a co-crystal ligand and report the RMSD and a 3D overlay of the docked pose on the native crystal structure — downloadable as an image." />
        </div>
        <p className="text-[11.5px] text-slate-400">Additional tools: pose energy-minimization (UFF / MMFF94), optional AI insights, and background jobs that persist across navigation and refreshes.</p>
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

      <Section id="doc-covalent" tone="emerald" icon={<Link />} title="Covalent docking — the two protocols" sub="Warhead perception and reactive-residue targeting">
        <p>Covalent docking couples non-covalent recognition with the geometry of bond formation. The electrophilic <b>warhead</b> is perceived from the ligand's connectivity (RDKit SMARTS — acrylamides, haloacetamides, vinyl sulfones, sulfonyl fluorides, epoxides, nitriles, boronic acids, aldehydes), and the target <b>nucleophilic residue</b> is chosen from those inside the box (Cys · Sγ, Ser · Oγ, Thr · Oγ1, Lys · Nζ, Tyr · Oη, His · Nε2/Nδ1).</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-accent/40 bg-accent/[0.05] p-3.5"><div className="mb-1 flex items-center gap-2"><span className="rounded-md bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">FAST</span><span className="text-[13px] font-semibold text-white">Geometry-guided</span></div><p className="text-[12px] leading-relaxed text-slate-300">A normal Vina run, after which poses are re-ranked by binding affinity <i>plus</i> the proximity of the warhead to the nucleophile. A pose is flagged compatible when this distance is within a chosen cutoff. No bond is formed; suitable for large-library screening.</p></div>
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
        <Block n="1" title="Disease targets">Enter a disease; DDS retrieves its associated genes from <b>Open Targets</b> (evidence-scored) and optionally <b>CTD</b>, unioned with any pasted/uploaded list. Genes are ranked by association score and can be filtered by a minimum-score cutoff, a <b>covalent-targetable</b> toggle and a <b>mutation-associated</b> toggle (🧬 targets carrying somatic or germline mutation evidence — for resistance / mutation-focused studies).</Block>
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
          <Feat tone="violet" icon={<Spark />} title="Mutation / resistance filter" desc="Targets with somatic-mutation or germline (genetic-association) mutation evidence for the disease (Open Targets) are badged 🧬 and can be isolated — for focusing on mutated drivers and resistance mutations." />
        </div>
        <Callout tone="amber"><b>Gene-symbol normalization.</b> All sources are normalised to official HGNC symbols with an alias table (e.g. HER2→ERBB2, COX2→PTGS2), so combined libraries are always clean, de-duplicated lists and cross-source intersections never miss a synonym.</Callout>
        <Callout tone="violet"><b>Studying resistant strains &amp; mutations.</b> Toggle <b>Mutation-associated only</b> to keep the targets whose disease link is driven by mutation evidence (somatic in cancers, or germline/genetic for subtype and hereditary diseases). These flags carry through to the shared targets and hub genes, so a whole analysis can be focused on the mutation-driven core — and, at the Structures step, resolved to <b>mutant PDB structures</b> for docking (see below).</Callout>
      </Section>

      <Section id="doc-np-multi" tone="violet" icon={<Layers />} title="Multi-compound &amp; multi-disease modes" sub="Several compounds or diseases in one run">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-violet/40 bg-violet/[0.05] p-3.5"><div className="mb-1 flex items-center gap-2"><span className="rounded-md bg-violet/15 px-2 py-0.5 text-[10px] font-bold text-violet">UNION</span><span className="text-[13px] font-semibold text-white">Multi-compound</span></div><p className="text-[12px] leading-relaxed text-slate-300">Enter several compounds (one per line). Their targets are <b>pooled (union)</b> and each target is tagged with how many compounds engage it (<b>×N</b>); targets hit by more compounds rank higher. The compound–target–pathway network draws one triangle per compound. Ideal for multi-ingredient formulas or drug combinations.</p></div>
          <div className="rounded-xl border border-sky-500/40 bg-sky-500/[0.05] p-3.5"><div className="mb-1 flex items-center gap-2"><span className="rounded-md bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-sky-400">INTERSECTION</span><span className="text-[13px] font-semibold text-white">Multi-disease</span></div><p className="text-[12px] leading-relaxed text-slate-300">Enter several diseases. DDS takes the <b>common (intersection)</b> genes — the shared / comorbid-mechanism targets — and those proceed into the normal workflow. The disease-intersection Venn is exportable as PNG / SVG.</p></div>
        </div>
        <Callout tone="violet"><b>The deliberate split.</b> Compounds are <b>unioned</b> (you want every target any compound engages); diseases are <b>intersected</b> (you want the targets shared across the diseases). Everything downstream — shared set, PPI, hub genes, enrichment — is unchanged; the multi modes only change how the target sets are assembled. Each input step simply gains a Single / Multi toggle.</Callout>
      </Section>

      <Section id="doc-np-viz" tone="rose" icon={<Chart />} title="Networks, figures &amp; export" sub="Figures and data export">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card tone="teal" title="Interactive networks">The PPI map and the concentric compound–target–pathway (C–T–P) network are interactive figures with node labels, hub highlighting and covalent rings. Fit / re-layout controls and PNG export (transparent / white / dark).</Card>
          <Card tone="sky" title="Venn diagrams">Compound ∩ disease and disease ∩ disease intersections are drawn as themed Venn diagrams, exportable as high-resolution PNG (transparent / white / dark) or vector SVG.</Card>
        </div>
        <Callout tone="rose"><b>Report &amp; data export.</b> The <b>Export report</b> button produces (1) a full <b>PDF report</b> — summary, methods &amp; protocol, disease/compound target tables, shared targets, hub-gene ranking, enrichment tables and references — via print-to-PDF; and (2) a <b>CSV .zip</b> containing every analysis table (target libraries, intersections, PPI nodes/edges, hub genes, enrichment) with clear file names, ready for Excel.</Callout>
      </Section>

      <Section id="doc-np-docking" tone="emerald" icon={<Share />} title="Structures → Docking — automated hand-off" sub="From a ranked hub gene to a ready-to-dock receptor, in one click">
        <p>The <b>Structures</b> step connects network pharmacology to structure-based docking. For the top hub genes it resolves a <b>representative experimental structure (PDB)</b> and passes it to the <b>Docking &amp; Virtual Screening</b> module, so the compound can be docked against each hub target.</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Feat tone="sky" icon={<Net />} title="Gene → structure mapping" desc="Each hub gene is resolved to its reviewed human UniProt entry, then to every cross-referenced PDB entry — with experimental method, resolution, chain coverage and bound ligands." />
          <Feat tone="amber" icon={<Chart />} title="Docking-suitability ranking" desc="Candidates are scored for docking: X-ray / cryo-EM over NMR, higher resolution, broader domain coverage, and — most importantly — a bound drug-like ligand that marks the real binding pocket." />
          <Feat tone="violet" icon={<Flask />} title="Recommendation + alternatives" desc="Each gene card shows the recommended PDB (method · resolution · coverage · ligand) plus ranked alternatives, with direct RCSB and UniProt links. A low-coverage caveat flags peptide/fragment entries." />
          <Feat tone="teal" icon={<Download />} title="AlphaFold fallback" desc="When a target has no experimental structure, the predicted AlphaFold model is offered instead, clearly labelled, providing a starting structure when no experimental one exists." />
          <Feat tone="rose" icon={<Spark />} title="Mutant structures (resistance)" desc="A 🧬 'Mutant structures only' toggle lists PDB entries carrying engineered mutations (wild-type excluded) and shows the mutation string (e.g. T790M) so you can read it and pick the resistant form to dock." />
        </div>
        <Callout tone="emerald"><b>One-click hand-off.</b> Pressing <b>Send to docking</b> on any structure opens the Docking module, <b>prefetches and prepares the receptor</b>, and <b>pre-centres the search box on the co-crystallised ligand</b> (the pocket the structure was solved with). The receptor lands ready on the <b>Receptor</b> step — add your compound, confirm the site, and dock. All structure data comes from public, key-free sources (UniProt, RCSB PDB, AlphaFold DB).</Callout>
        <Callout tone="rose"><b>Resistance-mutation docking.</b> For a mutation-flagged hub gene, switch on <b>Mutant structures only</b> to exclude wild-type entries and list the PDB structures that carry engineered mutations, each annotated with its mutation string. Because that count also includes crystallisation/construct mutations, the string is shown so you distinguish the true resistance mutation (e.g. <span className="font-mono">T790M</span>) from an incidental one — then send the chosen mutant straight to docking.</Callout>
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

/* ========================= QSAR / 3D-QSAR & PHARMACOPHORE ========================= */
function QsarDocs() {
  return (
    <>
      <div className="rounded-2xl bg-gradient-to-br from-sky-500/15 via-ink-800/40 to-accent/10 p-5 ring-1 ring-sky-500/20">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-400"><Chart /></div>
          <div>
            <div className="text-[17px] font-bold leading-tight text-white">QSAR / 3D-QSAR &amp; Pharmacophore Modelling</div>
            <div className="mt-0.5 text-[12px] leading-snug text-slate-400">Ligand-based activity prediction, model validation and prospective molecular design — from data to synthesis candidates.</div>
          </div>
        </div>
      </div>

      <Section id="doc-qs-about" tone="sky" icon={<Book />} title="Overview" sub="Learn from many molecules to predict the activity of new ones">
        <p>Quantitative structure–activity relationship (QSAR) modelling relates a molecule's chemical structure to a measured property or activity, so that the activity of new, unmade molecules can be predicted. The DDS QSAR module covers the ligand-based workflow — data assembly, standardisation, descriptor calculation, machine-learning model training, validation, and a prospective <b>design</b> step — using established open-source engines: molecular handling and descriptors with <b>RDKit</b>, machine learning with <b>scikit-learn</b>.</p>
        <Callout tone="sky"><b>Approach.</b> The module does not introduce a new algorithm; it applies established engines and enables standard validation by default (external test set, Y-scrambling and applicability domain), so a model is accompanied by the diagnostics needed to judge its reliability before it is used for prospective design.</Callout>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Feat tone="sky" icon={<Layers />} title="Descriptors &amp; fingerprints" desc="Morgan/ECFP, RDKit 2D descriptors, MACCS keys, alignment-free 3D-QSAR descriptors and pharmacophore fingerprints." />
          <Feat tone="teal" icon={<Cpu />} title="Machine-learning models" desc="Random Forest (default), gradient boosting, SVM and PLS — for regression or classification." />
          <Feat tone="amber" icon={<Check />} title="Validation" desc="Cross-validated Q²/AUC, external test metrics, Y-scrambling control and applicability-domain flagging." />
          <Feat tone="emerald" icon={<Spark />} title="Prospective design (DMTA)" desc="Enumerate analogues from a scaffold, predict and rank them by activity, domain and drug-likeness." />
        </div>
        <Callout tone="emerald"><b>Offline &amp; private.</b> All descriptor calculation, model training, prediction and structure drawing run locally. The only optional online operation is assembling a dataset from ChEMBL.</Callout>
      </Section>

      <Section id="doc-qs-install" tone="teal" icon={<Download />} title="Installation" sub="Ships inside the same DDS application">
        <p>The QSAR module is part of the same DDS desktop application as Docking and Network Pharmacology — there is nothing extra to install. Install DDS (see the <b>Docking &amp; VS</b> tab for the macOS <code className="rounded bg-ink-900 px-1 text-[11px]">.dmg</code> and Windows <code className="rounded bg-ink-900 px-1 text-[11px]">.exe</code> steps), launch it, accept the licence, and pick <b>QSAR / 3D-QSAR</b> from the module hub. Use <b>Switch Module</b> (top-right) to move between modules at any time; long-running model builds continue in the background.</p>
      </Section>

      <Section id="doc-qs-workflow" tone="sky" icon={<Chart />} title="The workflow — five steps" sub="Each step feeds the next, exactly like the docking workflow">
        <Block n="1" title="Dataset">Assemble a modelling set of molecules, each a SMILES plus an activity value. Fetch measured bioactivities for a target from <b>ChEMBL</b> (by name or ChEMBL ID, returned as pChEMBL values); <b>upload your own CSV/TSV</b> file (the SMILES and activity columns are auto-detected, with or without a header); paste <b>SMILES,value</b> rows; or load a bundled <b>reproducibility test case</b> (ESOL solubility, or BBBP blood–brain-barrier penetration).</Block>
        <Block n="2" title="Descriptors">Choose one descriptor family: Morgan/ECFP fingerprint (default), RDKit 2D descriptors (interpretable, Hansch-like), MACCS keys, alignment-free 3D-QSAR descriptors, or pharmacophore fingerprints.</Block>
        <Block n="3" title="Model">Pick an algorithm (Random Forest, gradient boosting, SVM, or PLS for regression) and a train/test split (random or Bemis–Murcko scaffold). The model trains on 80% with 5-fold cross-validation as a background job; the task (regression/classification) is inferred from the data.</Block>
        <Block n="4" title="Validation">Inspect the metrics and plots on a held-out 20% test set: Q²/R²/RMSE/MAE (regression) or AUC/accuracy/MCC/sensitivity/specificity (classification), plus the Y-scramble control, applicability-domain coverage and top descriptors.</Block>
        <Block n="5" title="Design">Use the validated model prospectively — enumerate a virtual library from a scaffold and R-groups (or score a pasted list), then rank candidates by predicted activity with applicability-domain and drug-likeness annotations.</Block>
      </Section>

      <Section id="doc-qs-descriptors" tone="violet" icon={<Layers />} title="Descriptors &amp; models" sub="What the molecule is turned into, and what learns from it">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Card tone="sky" title="Morgan / ECFP fingerprint">2048-bit circular fingerprint (radius 2) encoding local atomic environments — the default for most tasks.</Card>
          <Card tone="teal" title="RDKit 2D descriptors">The full set of interpretable physicochemical/topological descriptors (logP, TPSA, H-bond counts, ring &amp; connectivity indices) — the modern, whole-molecule analogue of classic Hansch parameters.</Card>
          <Card tone="amber" title="MACCS keys">166-bit dictionary of predefined substructural patterns.</Card>
          <Card tone="violet" title="Pharmacophore fingerprint">2D pharmacophore-feature-pair fingerprint (Gobbi–Poppinger) — relates activity to the pattern of pharmacophoric features.</Card>
          <Card tone="emerald" title="Alignment-free 3D-QSAR">Shape and property descriptors (WHIM, autocorrelation-3D, RDF, asphericity, NPR) from an ETKDG conformer + MMFF94 — captures 3D determinants of activity without manual superposition.</Card>
          <Card tone="rose" title="Learning algorithms">Random Forest (robust default), gradient-boosted trees, support-vector machines, and PLS regression — with class-weighting for imbalanced classification.</Card>
        </div>
      </Section>

      <Section id="doc-qs-validation" tone="amber" icon={<Check />} title="Validation" sub="External test set, Y-scrambling and applicability domain">
        <p>Each model is validated automatically following the OECD-aligned validation principles. The data is split 80:20 into a training and an external test set; the training set is assessed by 5-fold cross-validation (reported as <b>Q²</b> for regression or cross-validated <b>ROC-AUC</b> for classification), and the held-out test set gives the external metrics (R²/RMSE/MAE, or AUC/accuracy/MCC/sensitivity/specificity).</p>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Feat tone="amber" icon={<Spark />} title="Y-scrambling control" desc="The activities are shuffled and the model rebuilt; a valid model collapses to Q²≈0 / AUC≈0.5, proving it is not a chance correlation." />
          <Feat tone="sky" icon={<Target />} title="Applicability domain" desc="A k-nearest-neighbour distance domain flags every prediction as inside (reliable) or outside (extrapolation)." />
        </div>
        <Callout tone="amber"><b>Reproducibility.</b> All randomness (splitting, folds, model init, scrambling) is seeded, so the two bundled test cases reproduce their reported metrics exactly on repeated runs (ESOL Q²≈0.67; BBBP AUC≈0.91), and every setting is recorded in the exported report.</Callout>
      </Section>

      <Section id="doc-qs-design" tone="emerald" icon={<Spark />} title="Prospective design — the DMTA loop" sub="From a validated model to a ranked list of what to synthesise">
        <p>The workflow closes with a prospective design step framed as the <b>design–make–test–analyse (DMTA)</b> cycle: rather than stopping at a retrospective model, the validated model is used to rank candidate structures for synthesis.</p>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Card tone="emerald" title="Enumerate">Provide a scaffold with attachment points (<code className="rounded bg-ink-900 px-1 text-[11px]">[*:1]</code>, <code className="rounded bg-ink-900 px-1 text-[11px]">[*:2]</code>) and pick substituents per position from a medicinal-chemistry R-group palette; DDS combinatorially builds the virtual library with RDKit.</Card>
          <Card tone="sky" title="Score a list">Alternatively, paste candidate SMILES directly to score an existing set.</Card>
          <Card tone="amber" title="Rank &amp; prioritise">Each candidate is predicted, flagged for applicability domain, and scored for drug-likeness (MW, logP, Lipinski rule-of-five). Candidates are ranked by predicted activity; the top, in-domain, drug-like molecules are starred as the set to synthesise.</Card>
          <Card tone="violet" title="See the structures">The top candidates render as 2D structures with their pharmacophoric features highlighted — not just SMILES strings.</Card>
          <Card tone="teal" title="Send to Docking">One click hands the top-ranked candidates to the <b>Docking &amp; Virtual Screening</b> module as a screening library — turning ligand-based prioritisation into a structure-based screen.</Card>
        </div>
        <Callout tone="teal"><b>Send top candidates to Docking.</b> After a design run, press <b>Send top N to Docking</b>: the top-ranked candidates are loaded into the Docking module as a <b>virtual-screening library</b> (in screen mode). QSAR is ligand-based, so it hands over the <b>molecules</b>, not a protein — you supply the receptor in Docking (fetch a PDB or upload a structure). When the dataset came from a <b>ChEMBL target</b>, DDS also <b>suggests that protein</b> so you know which structure to load (resolve it directly, or via the Network Pharmacology module). This couples ligand-based design to structure-based screening within one application.</Callout>
        <Callout tone="emerald"><b>Note.</b> DMTA is long-established medicinal-chemistry practice; DDS's contribution is its automated, applicability-domain-aware, offline implementation, coupled in the same application to covalent-aware structure-based docking — so prioritised analogues can be docked to rationalise the prediction.</Callout>
      </Section>

      <Section id="doc-qs-viz" tone="rose" icon={<Chart />} title="Structures, figures &amp; export" sub="Figure and report export">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Card tone="sky" title="2D structures + pharmacophore">Dataset and top-candidate molecules are drawn as 2D chemical structures (RDKit), with pharmacophoric features — donors, acceptors, aromatic, hydrophobic, and charged centres — highlighted in colour with a legend.</Card>
          <Card tone="teal" title="Validation &amp; design figures">Predicted-vs-observed scatter (regression), ROC curve (classification), design-space scatter and top-candidate ranking — each with its own export menu.</Card>
        </div>
        <Callout tone="rose"><b>Report &amp; export.</b> Every figure exports as high-resolution <b>PNG (transparent / white)</b> or vector <b>SVG</b>. The <b>Export report</b> button produces a comprehensive PDF — dataset, model configuration, full validation statistics, most-influential descriptors, and the ranked design candidates — with a methods paragraph and a guidance note to review each candidate before synthesis.</Callout>
      </Section>

      <Section id="doc-qs-quick" tone="sky" icon={<Play />} title="Quick start" sub="A full run end to end">
        <Steps items={[
          <><b>Load data.</b> On the <b>Dataset</b> step, press <b>Test · ESOL</b> (or fetch a target from ChEMBL / upload your CSV).</>,
          <><b>Choose a descriptor</b> (Morgan is a good default) on the <b>Descriptors</b> step.</>,
          <><b>Build the model.</b> On the <b>Model</b> step keep Random Forest + random split and press <b>Build model</b>.</>,
          <><b>Review validation.</b> Check Q²/AUC, the plot, the Y-scramble collapse and the applicability domain.</>,
          <><b>Design.</b> On the <b>Design</b> step press <b>Load example scaffold</b>, choose R-groups, and <b>Enumerate &amp; rank</b> — then read off the top candidates and export the report.</>,
          <><b>Send to Docking (optional).</b> Press <b>Send top N to Docking</b> to load the best candidates into the Docking module as a screening library, then supply the receptor there.</>,
        ]} />
        <Callout tone="sky"><b>Reproducibility cases.</b> The bundled <b>ESOL</b> (regression) and <b>BBBP</b> (classification) test cases run the full pipeline end-to-end with one click, reproducing their reported metrics under fixed seeds.</Callout>
      </Section>

      <CiteSection />
      <Footer />
    </>
  )
}

/* ============================= NANO BIO-PHARMA ============================= */
function NanoDocs() {
  return (
    <>
      <div className="rounded-2xl bg-gradient-to-br from-amber-500/15 via-ink-800/40 to-accent/10 p-5 ring-1 ring-amber-500/20">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-400"><Layers /></div>
          <div>
            <div className="text-[17px] font-bold leading-tight text-white">Nano Bio-Pharmaceutical Modelling</div>
            <div className="mt-0.5 text-[12px] leading-snug text-slate-400">How drugs co-formulate with one another, and how a drug (or the drug–drug assembly) loads onto a pharmaceutical nanocarrier.</div>
          </div>
        </div>
      </div>

      <Section id="doc-nb-about" tone="amber" icon={<Book />} title="Overview" sub="Two questions in co-formulation and nanocarrier loading">
        <p>The Nano module addresses two questions in formulation and nano-medicine: <b>(1)</b> how two or three drugs/compounds associate with one another when co-formulated (for example curcumin + piperine), and <b>(2)</b> how that compound — or the drug–drug assembly — sits in or on a common pharmaceutical <b>nanocarrier</b> (cyclodextrins, dendrimers, polymer chains, or a phospholipid/liposome model). The module addresses both with a workflow built on established third-party engines: 3D structure generation and the <b>MMFF94</b> force field from <b>RDKit</b>.</p>
        <Callout tone="amber"><b>Approach.</b> The method uses 3D conformer generation, an orientational search, and energy-minimisation of the assembled complex with the <b>inter-fragment non-bonded terms included</b> (which yields the physically meaningful interaction energy) — no molecular dynamics. It reports the lowest-energy pose, its interaction energy, and the specific contacts, and visualises the result in 3D.</Callout>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Feat tone="amber" icon={<Layers />} title="Drug–drug co-formulation" desc="Assemble 2–3 compounds and read off how strongly and where they associate." />
          <Feat tone="teal" icon={<Target />} title="Nanocarrier loading" desc="Load a drug or the assembly into a cyclodextrin cavity, or onto a dendrimer, polymer or lipid surface." />
          <Feat tone="sky" icon={<Cpu />} title="MMFF94 force-field scoring" desc="Interaction energy computed with inter-fragment non-bonded terms — a reproducible, physics-based relative score." />
          <Feat tone="emerald" icon={<Check />} title="Reference test cases" desc="Reproduces documented cyclodextrin inclusion complexes." />
        </div>
        <Callout tone="emerald"><b>Offline &amp; private.</b> Every step — 3D building, the orientational search, minimisation, interaction analysis and 3D rendering — runs locally on your machine.</Callout>
      </Section>

      <Section id="doc-nb-install" tone="teal" icon={<Download />} title="Installation" sub="Ships inside the same DDS application">
        <p>The Nano module is part of the same DDS desktop application as the other modules — nothing extra to install. Install DDS (see the <b>Docking &amp; VS</b> tab for the macOS <code className="rounded bg-ink-900 px-1 text-[11px]">.dmg</code> and Windows <code className="rounded bg-ink-900 px-1 text-[11px]">.exe</code> steps), launch it, accept the licence, and pick <b>Nano bio-pharmaceutical modelling</b> from the module hub. Use <b>Switch Module</b> (top-right) to move between modules at any time; a running model continues in the background.</p>
      </Section>

      <Section id="doc-nb-workflow" tone="amber" icon={<Chart />} title="The workflow — three steps" sub="Compounds → carrier → result">
        <Block n="1" title="Compounds">Add one to three compounds as SMILES (or load a preset). With two or three, DDS first assembles them together — the drug–drug co-formulation. With one, it goes straight to carrier loading.</Block>
        <Block n="2" title="Carrier">Choose a nanocarrier — a cyclodextrin (cavity host), a PAMAM dendrimer, a PEG or PLGA polymer segment, a DPPC phospholipid (liposome/membrane model), or a carbon nanomaterial (graphene, graphene oxide or a carbon nanotube) — or choose <b>None</b> to model just the drug–drug assembly. Set the <b>drug:carrier stoichiometry</b> — <b>1:1</b> (default), <b>1:2</b> (one drug capped by two carriers) or <b>2:1</b> (two drugs per carrier) — the canonical Higuchi–Connors host–guest ratios.</Block>
        <Block n="3" title="Result">Read the interaction energy, how far the guest is drawn into the cavity, and the specific H-bond / hydrophobic / π–π contacts, all on an interactive 3D view (with an optional translucent cavity surface). Export the pose as a high-resolution PNG.</Block>
      </Section>

      <Section id="doc-nb-carriers" tone="violet" icon={<Layers />} title="The nanocarrier library" sub="The most common pharmaceutical carriers, ready to use">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Card tone="amber" title="Cyclodextrins (α, β, γ)">Cyclic oligosaccharide macrocycles with a hydrophobic cavity — the classic inclusion hosts. α (6 glucose, small), β (7, mid-sized/aromatic guests), γ (8, bulky guests or 1:2 inclusion).</Card>
          <Card tone="teal" title="PAMAM dendrimer (G0)">A generation-0 PAMAM dendrimer; drugs associate with its branched interior and surface amines.</Card>
          <Card tone="sky" title="PEG &amp; PLGA polymer segments">Poly(ethylene glycol) and poly(lactic-co-glycolic acid) oligomer segments — proxies for PEGylated micelles and polymeric nanoparticles.</Card>
          <Card tone="emerald" title="Phospholipid (DPPC)">A single DPPC molecule as a simplified membrane/liposome probe — polar head versus hydrophobic tails.</Card>
          <Card tone="rose" title="Graphene &amp; graphene oxide">A polyaromatic graphene nanoflake, and an oxidised variant bearing edge carboxyl/hydroxyl groups. Aromatic drugs adsorb flat by π-stacking; graphene oxide adds hydrogen bonding to its oxygens.</Card>
          <Card tone="amber" title="Carbon nanotube (SWCNT)">A single-walled (5,5) armchair nanotube segment; drugs adsorb on the sidewall by π-stacking and hydrophobic contact.</Card>
        </div>
        <Callout tone="violet"><b>Fragment/patch models.</b> A whole liposome, nanoparticle, nanotube or graphene sheet is far too large for a force-field minimisation; as is standard for this kind of rapid screen, each carrier is represented by a single, chemically representative molecule, oligomer segment or nanoscale fragment. For the carbon nanomaterials in particular, the adsorption geometry and π/H-bond pattern are reliable, but — because part of the driving force is the hydrophobic effect that a continuum model does not fully capture — the energy remains a relative indicator, not an absolute affinity.</Callout>
      </Section>

      <Section id="doc-nb-method" tone="sky" icon={<Cpu />} title="Method &amp; scope" sub="What the interaction energy represents, and its limits">
        <p>For each pairing DDS generates one or more 3D conformers (RDKit ETKDGv3), samples orientations — threading the guest along the cavity axis for cavity hosts — and minimises each combined complex with the MMFF94 force field (gradient minimisation to convergence, with inter-fragment non-bonded terms). The lowest-energy pose is selected (with a burial preference for cavity hosts). The reported <b>interaction energy</b> is <code className="rounded bg-ink-900 px-1 text-[11px]">E(complex) − E(host) − E(guest)</code>. The exact conformer/placement counts, force field, minimisation and solvent settings are shown in the <b>Method</b> popover on every result and in the exported report.</p>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Feat tone="teal" icon={<Cpu />} title="Search thoroughness" desc="Quick / Balanced / Thorough scale the number of guest conformers and orientations tried (the levers that actually improve results); minimisation always runs to convergence." />
          <Feat tone="sky" icon={<Beaker />} title="Solvent model" desc="Gas phase (raw MMFF), or an implicit-water correction: distance-dependent dielectric screening of electrostatics (ε=4·r) plus a SASA non-polar term — a simple GB/SA-style continuum model. The energy is decomposed into van-der-Waals, electrostatic and non-polar terms, with an estimated solvation energy." />
          <Feat tone="amber" icon={<Spark />} title="A relative indicator" desc="The interaction energy ranks and compares poses/options; it is not an absolute binding free energy or a loading capacity." />
          <Feat tone="violet" icon={<Layers />} title="Stoichiometry-aware" desc="1:1, 1:2 and 2:1 drug:carrier ratios; higher-order complexes are built by docking each added molecule against the growing assembly, and the energy is reported both total and per guest so ratios stay comparable." />
        </div>
        <Callout tone="rose"><b>Scope.</b> This is a force-field pose- and interaction-prediction tool for triage and visualisation. The implicit-solvent correction is a continuum approximation (dielectric screening + SASA), not explicit-water molecular dynamics or Poisson–Boltzmann; it is reproducible and physically motivated but still qualitative — for comparing options and generating testable hypotheses, not a substitute for experiment.</Callout>
      </Section>

      <Section id="doc-nb-validation" tone="emerald" icon={<Check />} title="Validation" sub="Reproducing documented inclusion complexes">
        <p>Two bundled test cases check the method against well-characterised cyclodextrin inclusion complexes with polar/aromatic guests — the regime where the MMFF94 force field is reliable, because binding is carried by hydrogen-bond, π and van-der-Waals terms it represents well. A case is judged reproduced when the guest is genuinely drawn into the cavity (buried fraction ≥ 50%) with a favourable interaction energy and a chemically sensible contact pattern.</p>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Card tone="emerald" title="Ibuprofen · β-cyclodextrin">A classic pharmaceutical inclusion complex — the aromatic ring inserts into the β-CD cavity while the carboxylate hydrogen-bonds to the rim hydroxyls.</Card>
          <Card tone="sky" title="p-Nitrophenol · α-cyclodextrin">A well-studied α-CD complex — the small nitro-aromatic threads the narrow α-CD cavity, H-bonding to the rims.</Card>
        </div>
        <Callout tone="emerald"><b>Run them yourself.</b> Both appear as one-click <b>Validation cases</b> on the Compounds step; each opens the reproduced pose in the 3D viewer with its interaction energy and contacts.</Callout>
      </Section>

      <Section id="doc-nb-quick" tone="amber" icon={<Play />} title="Quick start" sub="A full run end to end">
        <Steps items={[
          <><b>Add compounds.</b> On the <b>Compounds</b> step, paste a SMILES and press <b>Add compound</b> (up to three) — or press a preset such as <b>Curcumin + piperine</b>.</>,
          <><b>Pick a carrier.</b> On the <b>Carrier</b> step choose, for example, <b>β-Cyclodextrin</b> — or <b>None</b> to model just the drug–drug assembly.</>,
          <><b>Run.</b> Press <b>Run modelling</b>; the complex is built and minimised as a background job.</>,
          <><b>Read the result.</b> Inspect the interaction energy, the buried fraction, and the H-bond/hydrophobic/π contacts on the 3D view; toggle the cavity surface and export a PNG.</>,
          <><b>Validate (optional).</b> Press a bundled <b>Validation case</b> to reproduce a documented cyclodextrin inclusion complex.</>,
        ]} />
      </Section>

      <CiteSection />
      <Footer />
    </>
  )
}

function CiteSection() {
  return (
    <Section id="doc-cite" tone="sky" icon={<Quote />} title="References &amp; citing DDS" sub="Please cite the relevant work if DDS supports your research">
      <div className="space-y-2.5 rounded-xl border border-ink-700/60 bg-ink-800/40 p-3.5 text-[12px] leading-relaxed text-slate-300">
        {CITATIONS.map((c, i) => (
          <div key={i} className="flex gap-2"><span className="font-semibold text-slate-500">{i + 1}.</span><span>{c}</span></div>
        ))}
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
  const copy = () => { try { navigator.clipboard.writeText(CITATIONS.join('\n\n')); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* ignore */ } }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/85 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="glass w-full max-w-lg rounded-2xl p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent"><Quote /></div>
          <div className="flex-1"><div className="text-[15px] font-bold text-white">Cite DDS</div><div className="text-[11px] text-slate-500">Please cite if DDS supports your research</div></div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg bg-ink-800/80 text-slate-400 hover:bg-ink-700 hover:text-white"><X /></button>
        </div>
        <div className="space-y-2.5 rounded-xl border border-ink-700/60 bg-ink-900/60 p-3.5 text-[12px] leading-relaxed text-slate-300">
          {CITATIONS.map((c, i) => (
            <div key={i} className="flex gap-2"><span className="font-semibold text-slate-500">{i + 1}.</span><span>{c}</span></div>
          ))}
        </div>
        <button onClick={copy} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-accent/90 px-3 py-2 text-[12px] font-semibold text-ink-950 transition hover:bg-accent">
          {copied ? <><Check /> Copied all</> : <><Quote /> Copy citations</>}
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
