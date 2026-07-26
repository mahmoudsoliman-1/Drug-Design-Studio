// DDS module registry — the single source of truth for the module hub.
//
// Each module is a self-contained workspace that plugs into the shell. Adding a
// module later means registering one entry here and pointing `component` at it;
// nothing else in the shell needs to change. Modules receive an `onSwitchModules`
// prop from the shell so they can offer a "Switch modules" control back to the hub.
//
// `status`:
//   'ready' — built and openable (has a component)
//   'soon'  — planned / on the roadmap (shown dimmed, not openable, component: null)
//
// `accent` maps to a theme colour used across the module's chrome so users always
// know which module they are in: dock = teal, net = violet, qsar = sky.

import DockingModule from '../App.jsx'
import NetPharmModule from './netpharm/NetPharmModule.jsx'

export const MODULES = [
  {
    id: 'docking',
    name: 'Docking & virtual screening',
    blurb: 'Prepare, dock, screen, analyze and validate — covalent and non-covalent.',
    tags: ['AutoDock Vina', 'Covalent', 'RMSD'],
    icon: 'target',
    accent: 'dock',
    status: 'ready',
    component: DockingModule,
  },
  {
    id: 'netpharm',
    name: 'Network pharmacology',
    blurb: 'Compound–target–disease networks, enrichment and hub-gene analysis.',
    tags: ['Targets', 'Pathways', 'Graph'],
    icon: 'network',
    accent: 'net',
    status: 'ready',
    component: NetPharmModule,
  },
  {
    id: 'qsar',
    name: 'QSAR',
    blurb: 'Descriptors, model training and validation, activity prediction.',
    tags: ['Descriptors', 'Models', 'Predict'],
    icon: 'chart',
    accent: 'qsar',
    status: 'soon',
    component: null,
  },
]

export function findModule(id) {
  return MODULES.find((m) => m.id === id) || null
}

// A module can be opened only if it is built (ready) and actually has a component.
export function isOpenable(m) {
  return !!m && m.status === 'ready' && !!m.component
}

// per-accent colour tokens (hex kept here so the hub and any module chrome agree)
export const ACCENTS = {
  dock: { color: '#2dd4bf', soft: 'rgba(45,212,191,0.14)', text: '#2dd4bf' },
  net: { color: '#a78bfa', soft: 'rgba(167,139,250,0.15)', text: '#c4b5fd' },
  qsar: { color: '#38bdf8', soft: 'rgba(56,189,248,0.14)', text: '#7dd3fc' },
}
