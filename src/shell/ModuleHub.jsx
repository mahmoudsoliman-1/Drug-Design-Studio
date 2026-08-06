import Logo from '../components/Logo.jsx'
import { ACCENTS, isOpenable } from '../modules/registry.jsx'

// The module hub — the landing screen after the licence agreement. Users pick a
// workspace here; the shell opens it and keeps it alive so background jobs run on
// while they visit other modules. Reached again from any module via "Switch modules".

export default function ModuleHub({ modules, onOpen, runningCount = 0 }) {
  return (
    <div className="h-full w-full overflow-y-auto bg-ink-950 text-slate-200">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-8 py-8">

        {/* header */}
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Logo size={38} className="rounded-xl glow-accent" />
            <div>
              <div className="text-[15px] font-bold leading-none tracking-tight text-white">Drug Design</div>
              <div className="mt-1 text-[11px] font-medium tracking-wide text-accent">STUDIO · DDS</div>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-400">
              <OfflineIcon className="h-4 w-4" /> Runs locally
            </span>
            {runningCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/12 px-2.5 py-1 text-[12px] text-accent">
                <SpinIcon className="h-3.5 w-3.5 animate-spin" />
                {runningCount} job{runningCount > 1 ? 's' : ''} running
              </span>
            )}
          </div>
        </div>

        {/* title */}
        <div className="mb-5">
          <h1 className="text-[20px] font-semibold text-white">Choose a module</h1>
          <p className="mt-1 text-[13px] text-slate-400">
            Each module is its own workspace. Switch anytime — running jobs keep going in the background.
          </p>
        </div>

        {/* module cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => <ModuleCard key={m.id} m={m} onOpen={onOpen} />)}
        </div>

        <div className="mt-auto pt-6 text-right text-[10px] text-slate-600">DDS v4.1</div>
      </div>
    </div>
  )
}

function ModuleCard({ m, onOpen }) {
  const a = ACCENTS[m.accent] || ACCENTS.dock
  const openable = isOpenable(m)
  const Icon = ICONS[m.icon] || TargetIcon

  if (!openable) {
    return (
      <div className="flex flex-col rounded-xl border border-ink-700/60 bg-ink-900/40 p-4 opacity-60">
        <div className="mb-3 flex items-start justify-between">
          <div className="grid h-9 w-9 place-items-center rounded-[10px] bg-ink-800 text-slate-500">
            <Icon className="h-5 w-5" />
          </div>
          <span className="rounded-full bg-ink-700/70 px-2.5 py-0.5 text-[11px] text-slate-400">Coming soon</span>
        </div>
        <div className="text-[14px] font-semibold text-slate-300">{m.name}</div>
        <p className="mb-3 mt-1 text-[12px] leading-relaxed text-slate-500">{m.blurb}</p>
        <div className="mt-auto flex items-center justify-end">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-500">
            <LockIcon className="h-3.5 w-3.5" /> Locked
          </span>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={() => onOpen(m.id)}
      className="group flex flex-col rounded-xl border border-ink-600/70 bg-ink-850 p-4 text-left transition hover:border-ink-600 hover:bg-ink-800/70">
      <div className="mb-3 flex items-start justify-between">
        <div className="grid h-9 w-9 place-items-center rounded-[10px]" style={{ background: a.soft, color: a.color }}>
          <Icon className="h-5 w-5" />
        </div>
        <span className="rounded-full px-2.5 py-0.5 text-[11px]" style={{ background: a.soft, color: a.text }}>Ready</span>
      </div>
      <div className="text-[14px] font-semibold text-white">{m.name}</div>
      <p className="mb-3 mt-1 text-[12px] leading-relaxed text-slate-400">{m.blurb}</p>
      {m.tags?.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {m.tags.map((t) => (
            <span key={t} className="rounded-md bg-ink-800 px-2 py-0.5 text-[10.5px] text-slate-400">{t}</span>
          ))}
        </div>
      )}
      <div className="mt-auto flex items-center justify-end">
        <span className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-ink-950"
          style={{ background: a.color }}>
          Open <ArrowIcon className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  )
}

/* ---- icons ---- */
function I(props, path) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>{path}</svg>
}
function TargetIcon(p) { return I(p, <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>) }
function NetworkIcon(p) { return I(p, <><circle cx="12" cy="5" r="2.2" /><circle cx="5" cy="18" r="2.2" /><circle cx="19" cy="18" r="2.2" /><circle cx="12" cy="12" r="2.2" /><path d="M12 7.2V9.8M10.4 13.4l-3.8 3M13.6 13.4l3.8 3" /></>) }
function ChartIcon(p) { return I(p, <><circle cx="6" cy="17" r="1.6" /><circle cx="11" cy="9" r="1.6" /><circle cx="17" cy="13" r="1.6" /><circle cx="20" cy="6" r="1.6" /><path d="M4 20V4" /></>) }
function FlaskIcon(p) { return I(p, <><path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3" /><path d="M7.5 15h9" /></>) }
function ArrowIcon(p) { return I(p, <path d="M5 12h14M13 6l6 6-6 6" />) }
function LockIcon(p) { return I(p, <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>) }
function OfflineIcon(p) { return I(p, <><path d="M12 20h.01M2 8.5a15 15 0 0120 0M5 12a10 10 0 0114 0M8.5 15.5a5 5 0 017 0" /><path d="M3 3l18 18" /></>) }
function SpinIcon(p) { return I(p, <><path d="M12 3a9 9 0 109 9" /></>) }

const ICONS = { target: TargetIcon, network: NetworkIcon, chart: ChartIcon, flask: FlaskIcon }
