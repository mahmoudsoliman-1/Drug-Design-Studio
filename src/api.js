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

// re-docking validation: RMSD of a docked pose vs the co-crystal ligand + overlay
export function validateDocking(payload) {
  return call('/api/validate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
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

// --------------------------- network pharmacology ---------------------------
function post(path, body) {
  return call(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function netpharmDiseaseTargets({ disease, sources, uploaded, limit }) {
  return post('/api/netpharm/disease-targets', {
    disease: disease || '', sources: sources || ['opentargets'],
    uploaded: uploaded || '', limit: limit || 2000,
  })
}

export function netpharmCompoundTargets({ query, isSmiles, sources, uploaded, limit }) {
  return post('/api/netpharm/compound-targets', {
    query: query || '', is_smiles: !!isSmiles, sources: sources || ['dgidb', 'chembl'],
    uploaded: uploaded || '', limit: limit || 400,
  })
}

export function netpharmDiseaseTargetsMulti({ diseases, sources, uploaded, limit }) {
  return post('/api/netpharm/disease-targets-multi', {
    diseases: diseases || [], sources: sources || ['opentargets'],
    uploaded: uploaded || '', limit: limit || 2000,
  })
}

export function netpharmCompoundTargetsMulti({ compounds, isSmiles, sources, uploaded, limit }) {
  return post('/api/netpharm/compound-targets-multi', {
    compounds: compounds || [], is_smiles: !!isSmiles, sources: sources || ['dgidb', 'chembl'],
    uploaded: uploaded || '', limit: limit || 400,
  })
}

export function netpharmRun(payload) {
  return post('/api/netpharm/run', payload)
}

export function netpharmHubStructures(genes) {
  return post('/api/netpharm/hub-structures', { genes })
}

export function qsarTestCase(name) {
  return post('/api/qsar/test-case', { name })
}
export function qsarChembl({ target, activity_type, limit }) {
  return post('/api/qsar/chembl', { target, activity_type, limit })
}
export function qsarBuild(payload) {
  return post('/api/qsar/build', payload)
}
export function qsarPredict(model_id, smiles) {
  return post('/api/qsar/predict', { model_id, smiles })
}
export function qsarDesign(payload) {
  return post('/api/qsar/design', payload)
}
export function qsarDepict(payload) {
  return post('/api/qsar/depict', payload)
}

// --------------------------- nano bio-pharmaceutical ---------------------------
export function nanoCarriers() {
  return call('/api/nano/carriers')
}
export function nanoValidationCases() {
  return call('/api/nano/validation-cases')
}
export function nanoValidate(caseId, solvent = 'water') {
  return post('/api/nano/validate', { case: caseId, solvent })
}
export function nanoRun(payload) {
  return post('/api/nano/run', payload)
}
export function nanoStructure({ smiles, carrier }) {
  return post('/api/nano/structure', { smiles, carrier })
}
export function nanoIdentify(smiles) {
  return post('/api/nano/identify', { smiles })
}
export function nanoDepict(smiles, legends) {
  // slate base tone: legible on both the dark app UI and a white export background
  return post('/api/qsar/depict', { smiles, legends, pharmacophore: true, per_row: Math.min(smiles.length || 1, 3), base_color: '#64748b' })
}
