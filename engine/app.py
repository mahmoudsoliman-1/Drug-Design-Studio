"""Drug Design Studio (DDS) — local docking engine API.

Runs AutoDock Vina and the RDKit/Meeko/OpenBabel preparation pipeline locally.
Docking runs as background JOBS that live in the engine process and are persisted
to disk, so they survive frontend refreshes / navigation and can be reviewed later.
No data leaves the machine.
"""
import os
import json
import time
import uuid
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List

from ddsengine import prep, dock, interactions, analysis, minimize

app = FastAPI(title="Drug Design Studio Engine", version="1.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

from ddsengine.paths import data_dir  # noqa: E402

_ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
JOB_DIR = os.path.join(data_dir(), "jobs")
COMPLEX_DIR = os.path.join(JOB_DIR, "complexes")
os.makedirs(COMPLEX_DIR, exist_ok=True)

RECEPTORS = {}       # receptor_id -> {pdbqt, protein_pdb, meta}   (in-memory, current run)
COMPLEXES = {}       # complex_id -> pdb text                       (memory cache)
JOBS = {}            # job_id -> job dict
EXECUTOR = ThreadPoolExecutor(max_workers=2)
_LOCK = threading.Lock()


# --------------------------- models ---------------------------
class FetchReq(BaseModel):
    pdb_id: str
    keep_waters: bool = False
    keep_ions: bool = False
    ph: float = 7.4


class RepRepReq(BaseModel):
    receptor_id: str
    keep_waters: bool = False
    keep_ions: bool = False
    remove: List[str] = []
    ph: float = 7.4


class DockReq(BaseModel):
    receptor_id: str
    smiles: Optional[str] = None
    molblock: Optional[str] = None
    ligand_text: Optional[str] = None
    ligand_fmt: Optional[str] = None
    protonate: bool = True
    ph: float = 7.4
    center: dict
    size: dict
    scoring: str = "vina"
    exhaustiveness: int = 16
    num_modes: int = 9
    label: Optional[str] = None


class MinimizeReq(BaseModel):
    complex_id: Optional[str] = None
    complex_pdb: Optional[str] = None
    mode: str = "pocket"        # ligand | pocket | complex
    forcefield: str = "uff"     # uff | mmff94
    steps: int = 500


class LigandPreviewReq(BaseModel):
    smiles: Optional[str] = None
    molblock: Optional[str] = None
    ligand_text: Optional[str] = None
    ligand_fmt: Optional[str] = None


class ScreenItem(BaseModel):
    id: str
    smiles: str


class ScreenReq(BaseModel):
    receptor_id: str
    ligands: List[ScreenItem]
    center: dict
    size: dict
    scoring: str = "vina"
    exhaustiveness: int = 8
    label: Optional[str] = None


class AiReq(BaseModel):
    action: str
    context: dict = {}


# --------------------------- AI (Groq / Llama) ---------------------------
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = os.environ.get("DDS_AI_MODEL", "llama-3.3-70b-versatile")

def _load_bundled_key():
    """Load the Groq key bundled with the app (or engine/.env in dev) into the
    environment, unless one is already set. The .env is gitignored — the key is
    inside the built app but never in the public source."""
    if os.environ.get("GROQ_API_KEY"):
        return
    from ddsengine.paths import resource_dir
    try:
        with open(os.path.join(resource_dir(), ".env")) as f:
            for line in f:
                s = line.strip()
                if s.startswith("GROQ_API_KEY="):
                    os.environ["GROQ_API_KEY"] = s.split("=", 1)[1].strip().strip('"').strip("'")
                    return
    except Exception:
        pass

_AI_ASKS = {
    "pocket": "Assess this receptor and its likely binding pocket for docking readiness.",
    "druglikeness": "Assess the ligand's drug-likeness (Lipinski / QED) and flag any liabilities.",
    "admet": "Give a brief, qualitative ADMET triage (absorption, metabolism, likely tox flags) from the ligand's "
             "properties. State clearly that this is a rough heuristic from 2D properties, not a measurement.",
    "box": "Comment on whether the search-box placement and size look reasonable for this binding site.",
    "explain": "Explain the predicted binding of the top docked pose: the key interactions, which residues are involved, "
               "and what they suggest about affinity and selectivity.",
    "analogs": "Suggest 3-5 specific analog modifications that could improve affinity or drug-likeness, each with a "
               "one-line rationale.",
    "step": "Give one helpful, specific insight for the user's current step.",
}


def _groq_chat(system, user, max_tokens=700, temperature=0.4):
    key = os.environ.get("GROQ_API_KEY")
    if not key:
        raise RuntimeError("GROQ_API_KEY not set")
    body = json.dumps({
        "model": GROQ_MODEL,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": temperature, "max_tokens": max_tokens,
    }).encode()
    req = urllib.request.Request(GROQ_URL, data=body, method="POST", headers={
        "Authorization": "Bearer " + key, "Content-Type": "application/json",
        "User-Agent": "DrugDesignStudio/1.1"})  # Groq's Cloudflare 403s the default Python-urllib UA
    with urllib.request.urlopen(req, timeout=45) as r:
        data = json.loads(r.read().decode())
    return data["choices"][0]["message"]["content"].strip()


# --------------------------- jobs plumbing ---------------------------
def _job_path(jid):
    return os.path.join(JOB_DIR, jid + ".json")


def _save_job(job):
    try:
        with open(_job_path(job["job_id"]), "w") as f:
            json.dump(job, f)
    except Exception:
        pass


def _save_complex(cid, pdb):
    COMPLEXES[cid] = pdb
    try:
        with open(os.path.join(COMPLEX_DIR, cid + ".pdb"), "w") as f:
            f.write(pdb)
    except Exception:
        pass


def _load_jobs():
    if not os.path.isdir(JOB_DIR):
        return
    for fn in os.listdir(JOB_DIR):
        if not fn.endswith(".json"):
            continue
        try:
            job = json.load(open(os.path.join(JOB_DIR, fn)))
            if job.get("status") == "running":  # a run left over from a previous engine process
                job["status"] = "error"
                job["error"] = "interrupted — engine was restarted"
            JOBS[job["job_id"]] = job
        except Exception:
            pass


def _new_job(kind, label, request, receptor_id):
    jid = uuid.uuid4().hex[:12]
    job = {
        "job_id": jid, "kind": kind, "status": "running", "label": label,
        "created": time.time(), "progress": {"done": 0, "total": 1},
        "request": request, "receptor_id": receptor_id,
        "result": None, "error": None,
    }
    JOBS[jid] = job
    _save_job(job)
    return job


def _summary(job):
    s = {k: job[k] for k in ("job_id", "kind", "status", "label", "created", "progress", "error")}
    r = job.get("result")
    if r:
        if job["kind"] == "dock":
            s["best_affinity"] = r.get("best_affinity")
            s["ligand"] = (r.get("properties") or {}).get("formula")
        else:
            rows = r.get("results", [])
            s["best_affinity"] = rows[0]["affinity"] if rows else None
            s["n"] = r.get("n_ok")
    return s


# --------------------------- job runners ---------------------------
def _run_dock(jid):
    job = JOBS[jid]
    req = job["request"]
    try:
        rec = RECEPTORS.get(req["receptor_id"])
        if not rec:
            raise RuntimeError("receptor no longer available (engine restarted) — re-prepare it")
        lig_pdbqt, props = prep.prepare_ligand(
            smiles=req.get("smiles"), molblock=req.get("molblock"),
            text=req.get("ligand_text"), fmt=req.get("ligand_fmt"),
            ph=req.get("ph", 7.4), protonate=req.get("protonate", True))
        res = dock.run_vina(rec["pdbqt"], lig_pdbqt, req["center"], req["size"],
                            scoring=req.get("scoring", "vina"),
                            exhaustiveness=req.get("exhaustiveness", 16),
                            num_modes=req.get("num_modes", 9))
        poses = res["poses"]
        if not poses:
            raise RuntimeError("no poses returned")
        # build a complex + interactions for EVERY pose so the UI can switch poses
        ligand_2d = None
        pose_rows = []
        for p in poses:
            try:
                l2d, inter_p = analysis.analyze(rec["pdbqt"], p["pdbqt"])
                if ligand_2d is None:
                    ligand_2d = l2d
            except Exception:
                inter_p = interactions.detect(rec["pdbqt"], p["pdbqt"])
            cpdb = _build_complex(rec["protein_pdb"], p["pdbqt"])
            cpid = uuid.uuid4().hex[:12]
            _save_complex(cpid, cpdb)
            pose_rows.append({
                "pose": p["pose"], "affinity": p["affinity"],
                "rmsd_lb": p["rmsd_lb"], "rmsd_ub": p["rmsd_ub"],
                "complex_pdb": cpdb, "complex_id": cpid,
                "interactions": inter_p,
            })
        job["result"] = {
            "complex_id": pose_rows[0]["complex_id"],
            "properties": props,
            "lipinski_pass": prep.lipinski_pass(props),
            "poses": pose_rows,
            "interactions": pose_rows[0]["interactions"],
            "ligand_2d": ligand_2d,
            "complex_pdb": pose_rows[0]["complex_pdb"],
            "best_affinity": poses[0]["affinity"],
            "ligand_efficiency": round(poses[0]["affinity"] / max(1, props["mw"] / 12.0), 2),
            "params": {
                "engine": "AutoDock Vina 1.2.5",
                "scoring": req.get("scoring", "vina"),
                "exhaustiveness": req.get("exhaustiveness", 16),
                "num_modes": req.get("num_modes", 9),
                "center": req.get("center"), "size": req.get("size"),
                "protonate": req.get("protonate", True), "ph": req.get("ph", 7.4),
                "receptor_ph": rec.get("ph", 7.4),
            },
        }
        job["status"] = "done"
    except Exception as e:
        job["status"] = "error"
        job["error"] = str(e)[:300]
    job["progress"] = {"done": 1, "total": 1}
    _save_job(job)


def _run_screen(jid):
    job = JOBS[jid]
    req = job["request"]
    try:
        rec = RECEPTORS.get(req["receptor_id"])
        if not rec:
            raise RuntimeError("receptor no longer available (engine restarted) — re-prepare it")
        ligs = req["ligands"]
        job["progress"] = {"done": 0, "total": len(ligs)}
        _save_job(job)
        results = []
        for idx, item in enumerate(ligs):
            row = {"id": item["id"], "smiles": item["smiles"]}
            try:
                lig_pdbqt, props = prep.prepare_ligand(smiles=item["smiles"])
                res = dock.run_vina(rec["pdbqt"], lig_pdbqt, req["center"], req["size"],
                                    scoring=req.get("scoring", "vina"),
                                    exhaustiveness=req.get("exhaustiveness", 8), num_modes=5)
                best = res["poses"][0]
                try:
                    l2d, inter = analysis.analyze(rec["pdbqt"], best["pdbqt"])
                except Exception:
                    l2d, inter = None, interactions.detect(rec["pdbqt"], best["pdbqt"])
                cid = uuid.uuid4().hex[:12]
                _save_complex(cid, _build_complex(rec["protein_pdb"], best["pdbqt"]))
                row.update({
                    "affinity": best["affinity"], "status": "ok",
                    "mw": props["mw"], "logp": props["logp"], "hbd": props["hbd"],
                    "hba": props["hba"], "qed": props["qed"],
                    "lipinski_pass": prep.lipinski_pass(props),
                    "interactions": inter, "ligand_2d": l2d, "complex_id": cid,
                })
            except Exception as e:
                row.update({"status": "error", "error": str(e)[:120], "affinity": None})
            results.append(row)
            job["progress"] = {"done": idx + 1, "total": len(ligs)}
            _save_job(job)
        ok = sorted([r for r in results if r.get("affinity") is not None], key=lambda r: r["affinity"])
        fail = [r for r in results if r.get("affinity") is None]
        job["result"] = {
            "results": ok + fail, "n_ok": len(ok), "n_fail": len(fail),
            "params": {
                "engine": "AutoDock Vina 1.2.5",
                "scoring": req.get("scoring", "vina"),
                "exhaustiveness": req.get("exhaustiveness", 8),
                "num_modes": 5,
                "center": req.get("center"), "size": req.get("size"),
                "protonate": True, "ph": 7.4, "n_ligands": len(ligs),
                "receptor_ph": rec.get("ph", 7.4),
            },
        }
        job["status"] = "done"
    except Exception as e:
        job["status"] = "error"
        job["error"] = str(e)[:300]
    _save_job(job)


# --------------------------- receptor helpers ---------------------------
def _store_receptor(pdb_text, keep_waters=False, keep_ions=False, remove=None, rid=None, ph=7.4):
    rec_pdbqt, protein_pdb, display_pdb, ligand_pdb, meta = prep.prepare_receptor(
        pdb_text, ph=ph, keep_waters=keep_waters, keep_ions=keep_ions, remove=remove)
    rid = rid or uuid.uuid4().hex[:12]
    RECEPTORS[rid] = {"pdbqt": rec_pdbqt, "protein_pdb": protein_pdb,
                      "ligand_pdb": ligand_pdb, "meta": meta, "pdb_text": pdb_text,
                      "keep_waters": keep_waters, "keep_ions": keep_ions,
                      "remove": list(remove or []), "ph": ph}
    return {"receptor_id": rid, "display_pdb": display_pdb, **meta}


def _build_complex(protein_pdb, pose_pdbqt):
    lig = interactions.pose_to_pdb_hetatm(pose_pdbqt)
    body = protein_pdb.replace("END\n", "").rstrip()
    return body + "\n" + lig + "\nEND\n"


# --------------------------- routes ---------------------------
@app.on_event("startup")
def _startup():
    _load_jobs()
    _load_bundled_key()


@app.get("/api/health")
def health():
    running = sum(1 for j in JOBS.values() if j["status"] == "running")
    return {"status": "ok", "engine": "AutoDock Vina 1.2.5",
            "vina_binary": os.path.exists(dock.VINA),
            "receptors_loaded": len(RECEPTORS), "jobs": len(JOBS), "running": running}


@app.post("/api/receptor/fetch")
def receptor_fetch(req: FetchReq):
    pid = req.pdb_id.strip().upper()
    if not pid.isalnum() or len(pid) != 4:
        raise HTTPException(400, "invalid PDB id")
    try:
        pdb_text = urllib.request.urlopen("https://files.rcsb.org/download/%s.pdb" % pid, timeout=30).read().decode()
    except Exception as e:
        raise HTTPException(502, "could not fetch %s: %s" % (pid, e))
    try:
        return _store_receptor(pdb_text, req.keep_waters, req.keep_ions, ph=req.ph)
    except Exception as e:
        raise HTTPException(400, "receptor preparation failed: %s" % e)


@app.post("/api/receptor/upload")
async def receptor_upload(file: UploadFile = File(...), keep_waters: bool = False, keep_ions: bool = False, ph: float = 7.4):
    pdb_text = (await file.read()).decode(errors="ignore")
    try:
        return _store_receptor(pdb_text, keep_waters, keep_ions, ph=ph)
    except Exception as e:
        raise HTTPException(400, "receptor preparation failed: %s" % e)


@app.post("/api/receptor/reprep")
def receptor_reprep(req: RepRepReq):
    """Re-prepare an already-loaded receptor with new waters/ions flags and/or a
    new set of removed components — reuses the stored structure and the same id."""
    rec = RECEPTORS.get(req.receptor_id)
    if not rec or not rec.get("pdb_text"):
        raise HTTPException(404, "receptor not available — re-load it")
    try:
        return _store_receptor(rec["pdb_text"], req.keep_waters, req.keep_ions,
                               req.remove, rid=req.receptor_id, ph=req.ph)
    except Exception as e:
        raise HTTPException(400, "re-preparation failed: %s" % e)


@app.post("/api/ligand/preview")
def ligand_preview(req: LigandPreviewReq):
    """Parse a ligand (SMILES or structure file) and return its real 2D depiction
    + properties — for live confirmation in the Ligand step, no docking."""
    from rdkit import Chem
    try:
        mol = prep._read_ligand_any(smiles=req.smiles, molblock=req.molblock,
                                    text=req.ligand_text, fmt=req.ligand_fmt)
        if mol is None:
            raise ValueError("could not parse structure")
        mol = Chem.RemoveHs(mol)
        try:
            ligand_pdb = prep.ligand_3d_pdb(mol)
        except Exception:
            ligand_pdb = None
        return {"ok": True, "ligand_2d": analysis._depiction(mol),
                "ligand_pdb": ligand_pdb, "properties": prep.ligand_props(mol)}
    except Exception as e:
        raise HTTPException(400, "invalid ligand: %s" % e)


@app.get("/api/ai/status")
def ai_status():
    return {"enabled": bool(os.environ.get("GROQ_API_KEY")), "model": GROQ_MODEL}


@app.post("/api/ai/insight")
def ai_insight(req: AiReq):
    if not os.environ.get("GROQ_API_KEY"):
        raise HTTPException(400, "AI not configured — set GROQ_API_KEY for the engine.")
    system = (
        "You are a structural-chemistry and drug-discovery assistant embedded in Drug Design Studio (DDS), "
        "a molecular-docking desktop app. You receive real data from the user's current docking session as JSON. "
        "Base every statement only on that data; never invent numbers or interactions. If key data is missing, say "
        "briefly what you'd need. Be concise and practical: short paragraphs or bullets, plain scientific language, "
        "150-200 words max. Do not repeat the raw JSON back."
    )
    ask = _AI_ASKS.get(req.action, _AI_ASKS["step"])
    user = ask + "\n\nCurrent session data (JSON):\n" + json.dumps(req.context, ensure_ascii=False)[:6000]
    try:
        text = _groq_chat(system, user)
    except Exception as e:
        raise HTTPException(502, "AI request failed: %s" % str(e)[:200])
    return {"text": text}


@app.post("/api/dock")
def submit_dock(req: DockReq):
    rec = RECEPTORS.get(req.receptor_id)
    if not rec:
        raise HTTPException(404, "unknown receptor_id (prepare a receptor first)")
    label = req.label or "Docking"
    job = _new_job("dock", label, req.dict(), req.receptor_id)
    EXECUTOR.submit(_run_dock, job["job_id"])
    return {"job_id": job["job_id"]}


@app.post("/api/screen")
def submit_screen(req: ScreenReq):
    rec = RECEPTORS.get(req.receptor_id)
    if not rec:
        raise HTTPException(404, "unknown receptor_id")
    label = req.label or ("Virtual screening · %d compounds" % len(req.ligands))
    job = _new_job("screen", label, req.dict(), req.receptor_id)
    job["progress"] = {"done": 0, "total": len(req.ligands)}
    _save_job(job)
    EXECUTOR.submit(_run_screen, job["job_id"])
    return {"job_id": job["job_id"]}


@app.get("/api/jobs")
def list_jobs():
    jobs = sorted(JOBS.values(), key=lambda j: j["created"], reverse=True)
    return {"jobs": [_summary(j) for j in jobs]}


@app.get("/api/job/{job_id}")
def get_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "unknown job")
    return job


@app.delete("/api/job/{job_id}")
def delete_job(job_id: str):
    job = JOBS.pop(job_id, None)
    if job:
        try:
            os.remove(_job_path(job_id))
        except Exception:
            pass
    return {"ok": True}


@app.post("/api/minimize")
def do_minimize(req: MinimizeReq):
    pdb = req.complex_pdb
    if not pdb and req.complex_id:
        pdb = COMPLEXES.get(req.complex_id)
        if pdb is None:
            path = os.path.join(COMPLEX_DIR, req.complex_id + ".pdb")
            if os.path.exists(path):
                pdb = open(path).read()
    if not pdb:
        raise HTTPException(400, "provide complex_pdb or a valid complex_id")
    try:
        out = minimize.minimize_complex(pdb, mode=req.mode, forcefield=req.forcefield,
                                        steps=max(1, min(5000, req.steps)))
    except Exception as e:
        raise HTTPException(500, "minimization failed: %s" % e)
    cid = uuid.uuid4().hex[:12]
    _save_complex(cid, out["pdb"])
    out["complex_id"] = cid
    return out


@app.get("/api/complex/{complex_id}")
def get_complex(complex_id: str):
    pdb = COMPLEXES.get(complex_id)
    if pdb is None:
        path = os.path.join(COMPLEX_DIR, complex_id + ".pdb")
        if os.path.exists(path):
            pdb = open(path).read()
            COMPLEXES[complex_id] = pdb
    if pdb is None:
        raise HTTPException(404, "unknown complex_id")
    return {"complex_id": complex_id, "complex_pdb": pdb}


# --------------------------- bundled frontend ---------------------------
# Serve the built React UI at "/" when packaged (webdist present). Mounted LAST
# so all /api routes take precedence.
from fastapi.staticfiles import StaticFiles  # noqa: E402
from ddsengine.paths import webdist_dir  # noqa: E402

_WEB = webdist_dir()
if os.path.isdir(_WEB):
    app.mount("/", StaticFiles(directory=_WEB, html=True), name="web")
