import { useState, useEffect } from 'react'
import AgreementGate, { AGREEMENT_VERSION } from '../components/Agreement.jsx'
import * as api from '../api.js'
import { MODULES, findModule, isOpenable } from '../modules/registry.jsx'
import ModuleHub from './ModuleHub.jsx'

// The DDS shell — the thin frame every module lives inside. It owns everything
// shared across modules: the licence gate, the module hub, and a global view of
// background jobs. Modules themselves are self-contained; the shell just decides
// which one is visible.
//
// Opened modules are kept mounted (hidden, not unmounted) so their workspace state
// survives switching to the hub or another module, and their engine job pollers keep
// running. The actual compute lives in the engine, so a run never stops when you
// switch away — you can peek at another module and come back to an intact workspace.

function validInitialModule() {
  try {
    const id = localStorage.getItem('dds_active_module')
    return id && isOpenable(findModule(id)) ? id : null
  } catch { return null }
}

export default function Shell() {
  // null = still checking; true = accepted; false = show the gate.
  const [agreed, setAgreed] = useState(() => {
    try { return localStorage.getItem('dds_agreed') === AGREEMENT_VERSION ? true : null } catch { return null }
  })
  const [activeModule, setActiveModule] = useState(validInitialModule)
  const [opened, setOpened] = useState(() => { const id = validInitialModule(); return id ? [id] : [] })
  const [runningCount, setRunningCount] = useState(0)
  // one-shot cross-module handoff: { module, payload } delivered to the target module
  const [handoff, setHandoff] = useState(null)

  // reconcile the licence agreement with the engine's on-disk marker (durable on mac & windows)
  useEffect(() => {
    let ok = true
    api.getAgreement().then((r) => {
      if (!ok) return
      if (r.agreed_version === AGREEMENT_VERSION) {
        setAgreed(true)
        try { localStorage.setItem('dds_agreed', AGREEMENT_VERSION) } catch { /* ignore */ }
      } else {
        setAgreed((prev) => {
          if (prev === true) { api.setAgreement(AGREEMENT_VERSION).catch(() => {}); return true }
          return false
        })
      }
    }).catch(() => {
      if (ok) setAgreed((prev) => (prev === true ? true : false))
    })
    return () => { ok = false }
  }, [])

  // global jobs badge for the hub — a light read-only poll of the engine's job list,
  // independent of any module, so the hub shows work running anywhere in DDS.
  useEffect(() => {
    if (agreed !== true) return
    let stop = false
    async function tick() {
      try {
        const { jobs } = await api.listJobs()
        if (!stop) setRunningCount(jobs.filter((j) => j.status === 'running').length)
      } catch { /* engine hiccup — keep the last count */ }
    }
    tick()
    const t = setInterval(tick, 3000)
    return () => { stop = true; clearInterval(t) }
  }, [agreed])

  function openModule(id) {
    if (!isOpenable(findModule(id))) return
    setOpened((o) => (o.includes(id) ? o : [...o, id]))
    setActiveModule(id)
    try { localStorage.setItem('dds_active_module', id) } catch { /* ignore */ }
  }
  function switchModules() {
    setActiveModule(null)
    try { localStorage.removeItem('dds_active_module') } catch { /* ignore */ }
  }
  // a module asks the shell to open another module and pass it a payload
  function handoffTo(moduleId, payload) {
    if (!isOpenable(findModule(moduleId))) return
    setHandoff({ module: moduleId, payload })
    openModule(moduleId)
  }

  if (agreed === null) {
    return (
      <div className="grid h-full w-full place-items-center bg-ink-950">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
      </div>
    )
  }
  if (!agreed) {
    return <AgreementGate onAgree={() => {
      try { localStorage.setItem('dds_agreed', AGREEMENT_VERSION) } catch { /* ignore */ }
      api.setAgreement(AGREEMENT_VERSION).catch(() => {})
      setAgreed(true)
    }} />
  }

  return (
    <div className="h-full w-full">
      <div className={activeModule ? 'hidden' : 'h-full w-full'}>
        <ModuleHub modules={MODULES} onOpen={openModule} runningCount={runningCount} />
      </div>

      {opened.map((id) => {
        const m = findModule(id)
        const Module = m?.component
        if (!Module) return null
        const inbound = handoff && handoff.module === id ? handoff.payload : null
        return (
          <div key={id} className={activeModule === id ? 'h-full w-full' : 'hidden'}>
            <Module onSwitchModules={switchModules} onHandoff={handoffTo}
              handoff={inbound} onHandoffConsumed={() => setHandoff(null)} />
          </div>
        )
      })}
    </div>
  )
}
