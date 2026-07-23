import Logo from './Logo.jsx'

/* ------------------------------------------------------------------ */
/*  In-app documentation — a tall, narrow, elegant scrollable panel    */
/*  opened from the sidebar. Rich, colour-coded sections for students  */
/*  and researchers: overview, capabilities, install, theory, docking, */
/*  covalent protocols, tutorial, exports and references.              */
/* ------------------------------------------------------------------ */

export const DOC_VERSION = 'v1.0.0'

const TONE = {
  teal:    { bg: 'bg-accent/15',        text: 'text-accent',        ring: 'ring-accent/30' },
  violet:  { bg: 'bg-violet/15',        text: 'text-violet',        ring: 'ring-violet/30' },
  amber:   { bg: 'bg-amber/15',         text: 'text-amber',         ring: 'ring-amber/30' },
  emerald: { bg: 'bg-emerald-500/15',   text: 'text-emerald-400',   ring: 'ring-emerald-500/30' },
  sky:     { bg: 'bg-sky-500/15',       text: 'text-sky-400',       ring: 'ring-sky-500/30' },
  rose:    { bg: 'bg-rose-500/15',      text: 'text-rose-400',      ring: 'ring-rose-500/30' },
}

const SECTIONS = [
  ['about', 'Overview'], ['features', 'Capabilities'], ['install', 'Installation'],
  ['theory', 'System setup'], ['docking', 'Docking'], ['covalent', 'Covalent docking'],
  ['tutorial', 'Tutorial'], ['export', 'Export & MD'], ['refs', 'References'],
]

export default function DocsModal({ onClose }) {
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

        {/* table of contents */}
        <div className="flex flex-wrap gap-1.5 border-b border-ink-700/60 bg-ink-900/40 px-5 py-2.5">
          {SECTIONS.map(([id, label]) => (
            <button key={id} onClick={() => go(`doc-${id}`)}
              className="rounded-full bg-ink-800/70 px-2.5 py-1 text-[10.5px] font-medium text-slate-300 transition hover:bg-accent/15 hover:text-accent">{label}</button>
          ))}
        </div>

        {/* body */}
        <div className="min-h-0 flex-1 space-y-9 overflow-auto px-5 py-5">
          {/* hero */}
          <div className="rounded-2xl bg-gradient-to-br from-accent/15 via-ink-800/40 to-violet/10 p-5 ring-1 ring-accent/20">
            <div className="flex items-center gap-3">
              <Logo size={44} className="rounded-xl glow-accent" />
              <div>
                <div className="text-[18px] font-bold text-white">Drug Design Studio <span className="text-accent">(DDS)</span></div>
                <div className="mt-0.5 text-[12px] leading-snug text-slate-400">An all-in-one desktop platform for covalent &amp; non-covalent docking, virtual screening and protein–ligand interaction analysis.</div>
              </div>
            </div>
          </div>

          {/* Overview */}
          <Section id="doc-about" tone="teal" icon={<Book />} title="What is DDS?"
            sub="A single, offline window from structure to annotated result">
            <p>DDS unifies the entire structure-based design workflow — receptor and ligand preparation, binding-site definition, docking (non-covalent <b>and</b> covalent), and two- and three-dimensional interaction analysis — inside one elegant, fully offline desktop application. It wraps a curated suite of trusted open-source engines behind a clean interface, so no command-line expertise is required and no data ever leaves your machine.</p>
            <Callout tone="teal"><b>Design philosophy.</b> DDS does not try to mirror the breadth of large commercial suites. It is deliberately built around a focused, well-chosen set of features that serve one purpose exceptionally well: setting up, running and analysing docking and virtual-screening campaigns with ease — while standardized exports connect the results to advanced downstream analyses.</Callout>
          </Section>

          {/* Capabilities */}
          <Section id="doc-features" tone="violet" icon={<Spark />} title="Capabilities"
            sub="Everything from a single ligand to a full covalent library">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Feat tone="teal" icon={<Target />} title="Molecular docking" desc="AutoDock Vina 1.2.5 with Vina and Vinardo scoring; ranked poses with per-pose interactions." />
              <Feat tone="violet" icon={<Layers />} title="Virtual screening" desc="Batch-dock SMILES libraries; rank hits with drug-likeness (Lipinski / QED) filters." />
              <Feat tone="emerald" icon={<Link />} title="Covalent docking &amp; screening" desc="Automatic warhead perception + reactive-residue targeting; geometry-guided and tethered protocols." />
              <Feat tone="amber" icon={<Flask />} title="Automated preparation" desc="Receptor (waters/ions, pH protonation, chain/cofactor editing) and ligand (3D, protonation) prep." />
              <Feat tone="sky" icon={<Chart />} title="Interaction analysis" desc="Publication-quality 2D and 3D interaction diagrams with PNG / SVG export." />
              <Feat tone="rose" icon={<Beaker />} title="MD-ready exports" desc="One-click, simulation-ready exports for AMBER, CHARMM and GROMACS." />
            </div>
            <p className="text-[11.5px] text-slate-400">Additional tools: pose energy-minimization (UFF / MMFF94), optional AI insights, and robust background jobs that survive navigation and refreshes.</p>
          </Section>

          {/* Installation */}
          <Section id="doc-install" tone="sky" icon={<Download />} title="Installation"
            sub="Native installers · everything runs locally">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Card tone="sky" title="macOS (.dmg)">
                <Steps items={[
                  'Download the DDS .dmg and open it.',
                  'Drag Drug Design Studio into Applications.',
                  'First launch: right-click the app → Open (to bypass the unidentified-developer prompt).',
                ]} />
              </Card>
              <Card tone="sky" title="Windows (.exe)">
                <Steps items={[
                  'Download the DDS Setup .exe and run it.',
                  'Follow the installer; launch from the Start menu.',
                  'The first launch can take up to a minute while Windows scans the app.',
                ]} />
              </Card>
            </div>
            <Callout tone="emerald"><b>Fully offline &amp; private.</b> DDS bundles its own local engine (AutoDock Vina + Python toolchain). All calculations run on your computer; nothing is uploaded. Only the optional AI insights make an outbound request.</Callout>
          </Section>

          {/* System setup / theory */}
          <Section id="doc-theory" tone="amber" icon={<Cpu />} title="System setup — theory &amp; protocol"
            sub="How DDS prepares the receptor, site and ligand">
            <Block n="1" title="Receptor preparation">
              Crystallographic waters and heteroatoms are removed (unless explicitly retained). Polar hydrogens are added and the protonation states of titratable residues are assigned at a user-chosen <b>pH</b> using the Open Babel pK<sub>a</sub> model, then Gasteiger–Marsili partial charges are applied and the receptor is written as a rigid PDBQT. A structure editor lets you delete individual chains, cofactors, nucleic-acid fragments or the co-crystal ligand before preparation.
            </Block>
            <Block n="2" title="Binding-site definition">
              The search grid is auto-centred on the detected co-crystal ligand (or the receptor centroid). Box centre and size (X/Y/Z, in Å) are fully adjustable, and the box is rendered live in 3D.
            </Block>
            <Block n="3" title="Ligand preparation">
              Ligands (SMILES or SDF / MOL2 / MOL / PDB) are parsed with RDKit, embedded to a 3D conformer with the ETKDG algorithm, optimised with MMFF94, protonated at physiological pH, and converted to PDBQT with rotatable bonds via Meeko. A live 2D + 3D preview confirms correct parsing.
            </Block>
          </Section>

          {/* Docking */}
          <Section id="doc-docking" tone="teal" icon={<Play />} title="Docking"
            sub="AutoDock Vina — Vina &amp; Vinardo scoring">
            <p>Docking is performed with <b>AutoDock Vina 1.2.5</b>. Choose between the <b>Vina</b> (default) and <b>Vinardo</b> scoring functions, and set the <b>exhaustiveness</b> to trade speed against thoroughness. Vina returns multiple binding modes ranked by predicted binding free energy (kcal·mol⁻¹); DDS builds a full protein–ligand complex and detects interactions for every pose so you can switch between them.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Card tone="teal" title="Interaction detection">Hydrogen bonds (polar N/O···N/O, 2.4–3.5 Å), salt bridges (opposite charges ≤ 4.0 Å) and hydrophobic contacts (C···C ≤ 4.0 Å) are assigned geometrically from the 3D coordinates.</Card>
              <Card tone="teal" title="Pose cleanup">An optional UFF / MMFF94 energy-minimization relieves steric clashes in the ligand, pocket or whole complex — a light geometric relaxation, not a rigorous MM simulation.</Card>
            </div>
          </Section>

          {/* Covalent */}
          <Section id="doc-covalent" tone="emerald" icon={<Link />} title="Covalent docking — the two protocols"
            sub="Targeted covalent inhibitors, made routine">
            <p>Covalent docking couples non-covalent recognition with the geometry of bond formation. DDS automates the hard parts: the electrophilic <b>warhead</b> is perceived directly from the ligand's connectivity (RDKit SMARTS — acrylamides, haloacetamides, vinyl sulfones, sulfonyl fluorides, epoxides, nitriles, boronic acids, aldehydes), and the target <b>nucleophilic residue</b> is chosen interactively from those inside the box (Cys · Sγ, Ser · Oγ, Thr · Oγ1, Lys · Nζ, Tyr · Oη, His · Nε2/Nδ1).</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-accent/40 bg-accent/[0.05] p-3.5">
                <div className="mb-1 flex items-center gap-2"><span className="rounded-md bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">FAST</span><span className="text-[13px] font-semibold text-white">Geometry-guided</span></div>
                <p className="text-[12px] leading-relaxed text-slate-300">A normal Vina run, after which poses are re-ranked by a combined criterion — binding affinity <i>plus</i> the proximity of the warhead to the nucleophile. A pose is flagged compatible when this distance is within a chosen cutoff. No bond is formed; ideal for screening large libraries.</p>
              </div>
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/[0.05] p-3.5">
                <div className="mb-1 flex items-center gap-2"><span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">RIGOROUS</span><span className="text-[13px] font-semibold text-white">Tethered (bond-restrained)</span></div>
                <p className="text-[12px] leading-relaxed text-slate-300">The top pose is refined under a harmonic distance restraint that pulls the warhead to its ideal covalent bond length, with the receptor held rigid and the ligand relaxed on the UFF force field (Open Babel). The explicit covalent bond is formed; DDS reports the achieved bond distance and how far the warhead was pulled.</p>
              </div>
            </div>
            <Callout tone="amber"><b>How to read the results.</b> A covalent pose is judged first on its ability to form the bond with the target residue, and secondarily on binding energy. The pose shown with the covalent bond is the recommended reactive orientation; it may not carry the single most favourable predicted energy, which is expected and appropriate — for a covalent inhibitor the bound state is defined by the formed bond, so a modest energetic trade-off in favour of correct covalent geometry validates the result rather than weakening it.</Callout>
            <p className="text-[11.5px] text-slate-400">Both protocols operate identically for single-ligand docking and full-library covalent virtual screening.</p>
          </Section>

          {/* Tutorial */}
          <Section id="doc-tutorial" tone="violet" icon={<Book />} title="Quick-start tutorial"
            sub="From a PDB ID to an annotated pose in five steps">
            <Steps items={[
              <><b>Load a receptor.</b> In the Receptor step, enter a PDB ID (e.g. <code className="rounded bg-ink-900 px-1 text-[11px]">1HSG</code>) and Fetch, or upload a .pdb. Set retain-waters/ions and the protonation pH; delete unwanted chains or cofactors if needed.</>,
              <><b>Provide a ligand.</b> In the Ligand step, paste a SMILES string or upload SDF / MOL2 / MOL / PDB. The live preview confirms the structure parsed correctly.</>,
              <><b>Define the binding site.</b> In the Binding Site step, adjust the grid box (auto-centred). For covalent work, switch on <b>Covalent docking</b> in the left panel, pick the reactive residue, confirm the auto-detected warhead, and choose Geometry-guided or Bond-restrained.</>,
              <><b>Dock.</b> Press <b>Run</b> (top bar) or the Dock step button. The calculation runs as a background job — you can navigate away and it keeps going.</>,
              <><b>Analyse &amp; export.</b> In Results, inspect the best affinity, poses and interactions (Off / 3D / 2D), the covalent bond (tethered), minimize if desired, and export a publication-ready report or an MD-ready complex.</>,
            ]} />
            <Callout tone="violet"><b>Virtual screening.</b> Switch to <b>Virtual</b> mode in the sidebar, paste a SMILES library in the Library step, and Screen. Hits are ranked by affinity (and covalent reach, if covalent is on). Use the "New Run" button in the top bar to clear the workspace and start over — running jobs continue in the Jobs panel.</Callout>
          </Section>

          {/* Export */}
          <Section id="doc-export" tone="rose" icon={<Beaker />} title="Export &amp; downstream MD"
            sub="Take the complex further">
            <p>From the Results view, one-click exports produce publication-quality figures (2D / 3D interaction diagrams as PNG / SVG) and simulation-ready inputs for the major molecular-dynamics engines — <b>AMBER</b>, <b>CHARMM</b> and <b>GROMACS</b> — so a docked complex flows straight into downstream refinement. A detailed, reference-backed Computational Methods section is generated automatically and adapts to the exact protocol used (including the covalent mode).</p>
          </Section>

          {/* References */}
          <Section id="doc-refs" tone="sky" icon={<Quote />} title="References &amp; credits"
            sub="Built on trusted open-source science">
            <ol className="list-decimal space-y-1.5 pl-5 text-[11.5px] leading-relaxed text-slate-400 marker:text-slate-600">
              <li>Trott O, Olson AJ. AutoDock Vina. <i>J Comput Chem.</i> 2010;31:455–461.</li>
              <li>Eberhardt J, Santos-Martins D, Tillack AF, Forli S. AutoDock Vina 1.2.0. <i>J Chem Inf Model.</i> 2021;61:3891–3898.</li>
              <li>Quiroga R, Villarreal MA. Vinardo. <i>PLoS One.</i> 2016;11:e0155183.</li>
              <li>Landrum G, <i>et al.</i> RDKit: Open-source cheminformatics. https://www.rdkit.org</li>
              <li>O'Boyle NM, Banck M, James CA, <i>et al.</i> Open Babel. <i>J Cheminform.</i> 2011;3:33.</li>
              <li>Rego N, Koes D. 3Dmol.js: molecular visualization with WebGL. <i>Bioinformatics.</i> 2015;31:1322–1324.</li>
              <li>Bianco G, Forli S, Goodsell DS, Olson AJ. Covalent docking using AutoDock. <i>Protein Sci.</i> 2016;25:295–301.</li>
              <li>Scarpino A, Ferenczy GG, Keserű GM. Comparative evaluation of covalent docking tools. <i>J Chem Inf Model.</i> 2018;58:1441–1458.</li>
              <li>Rappé AK, Casewit CJ, Colwell KS, Goddard WA III, Skiff WM. UFF. <i>J Am Chem Soc.</i> 1992;114:10024–10035.</li>
            </ol>
          </Section>

          {/* footer */}
          <div className="rounded-2xl border border-ink-700/60 bg-ink-900/50 p-4 text-center">
            <div className="text-[12.5px] font-semibold text-white">Drug Design Studio (DDS) · {DOC_VERSION}</div>
            <div className="mt-1 text-[11px] leading-relaxed text-slate-500">© Prof. Mahmoud E. Soliman — Molecular Bio-computation &amp; Drug Design Laboratory, University of KwaZulu-Natal.<br />Academic &amp; Non-Commercial License. Please cite DDS if it supports your research (see “Cite DDS”).</div>
            <div className="mt-2 text-[11px] text-accent">soliman@ukzn.ac.za · http://soliman.ukzn.ac.za/DDS.aspx</div>
          </div>
        </div>
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
function Chart(p) { return Ic(p, <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>) }
function Beaker(p) { return Ic(p, <><path d="M6 3h12M8 3v6l-4 9a1.5 1.5 0 001.4 2h13.2a1.5 1.5 0 001.4-2l-4-9V3" /><path d="M6.5 15h11" /></>) }
function Spark(p) { return Ic(p, <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="currentColor" stroke="none" /></>) }
function Cpu(p) { return Ic(p, <><rect x="7" y="7" width="10" height="10" rx="1.5" /><path d="M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2" /></>) }
function Quote(p) { return Ic(p, <><path d="M7 7H4a1 1 0 00-1 1v4a1 1 0 001 1h2v3a1 1 0 01-1 1H4M17 7h-3a1 1 0 00-1 1v4a1 1 0 001 1h2v3a1 1 0 01-1 1h-1" /></>) }
