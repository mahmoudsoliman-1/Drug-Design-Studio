// Client for the local DDS docking engine (FastAPI).
export const ENGINE_BASE = 'http://127.0.0.1:8765'

async function call(path, opts) {
  let r
  try {
    r = await fetch(ENGINE_BASE + path, opts)
  } catch (e) {
    throw new Error('ENGINE_OFFLINE')
  }
  if (!r.ok) {
    let msg = r.statusText
    try {
      const body = await r.json()
      msg = body.detail || JSON.stringify(body)
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  return r.json()
}

export function health() {
  return call('/api/health')
}

// licence-agreement marker persisted on disk by the engine (OS-independent)
export function getAgreement() {
  return call('/api/agreement')
}
export function setAgreement(version) {
  return call('/api/agreement', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
  })
}

export function fetchReceptor(pdbId, opts = {}) {
  return call('/api/receptor/fetch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdb_id: pdbId, keep_waters: !!opts.keepWaters, keep_ions: !!opts.keepIons, ph: opts.ph ?? 7.4 }),
  })
}

export function uploadReceptor(file, opts = {}) {
  const fd = new FormData()
  fd.append('file', file)
  const q = `?keep_waters=${!!opts.keepWaters}&keep_ions=${!!opts.keepIons}&ph=${opts.ph ?? 7.4}`
  return call('/api/receptor/upload' + q, { method: 'POST', body: fd })
}

// re-prepare an already-loaded receptor (waters/ions flags + removed components)
export function reprepReceptor(receptorId, opts = {}) {
  return call('/api/receptor/reprep', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      receptor_id: receptorId,
      keep_waters: !!opts.keepWaters, keep_ions: !!opts.keepIons,
      remove: opts.remove || [], ph: opts.ph ?? 7.4,
    }),
  })
}

export function minimize(payload) {
  return call('/api/minimize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function aiStatus() {
  return call('/api/ai/status')
}

export function aiInsight(payload) {
  return call('/api/ai/insight', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function previewLigand(payload) {
  return call('/api/ligand/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function dock(payload) {
  return call('/api/dock', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function screen(payload) {
  return call('/api/screen', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

// covalent docking: nucleophilic residues available as targets (filtered to the box)
export function covalentResidues(receptorId, box) {
  return call('/api/covalent/residues', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receptor_id: receptorId, center: box?.center, size: box?.size }),
  })
}

// catalog of recognised electrophilic warheads (for the override menu)
export function covalentWarheads() {
  return call('/api/covalent/warheads')
}

export function getComplex(id) {
  return call(`/api/complex/${id}`)
}

export function listJobs() {
  return call('/api/jobs')
}

export function getJob(id) {
  return call(`/api/job/${id}`)
}

export function deleteJob(id) {
  return call(`/api/job/${id}`, { method: 'DELETE' })
}
