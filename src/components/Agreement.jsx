import { useState } from 'react'
import Logo from './Logo.jsx'

// Bump this string if the terms change materially — users will be re-prompted.
export const AGREEMENT_VERSION = '2026-07-v1'

const TERMS = [
  ['Academic & non-commercial use only',
    'Drug Design Studio (DDS) is provided free of charge for academic and other non-commercial use only. You may use and share the software, but you may NOT modify, edit, reverse-engineer, decompile, or create derivative works from it.'],
  ['No commercial or industrial use',
    'Use for any commercial, industrial, for-profit, or fee-generating purpose is not permitted under this licence. For a commercial licence, contact soliman@ukzn.ac.za.'],
  ['Research tool — not for clinical or regulatory use',
    'DDS is a computational research and educational tool. Its outputs (scores, poses, predicted interactions, and any AI commentary) are predictions, not measurements, and may be inaccurate. It is not a medical device and must not be used for clinical, diagnostic, therapeutic, or regulatory decisions. You are responsible for independently validating all results.'],
  ['Intellectual property',
    'All rights in the software, its code, design, and interface are and remain the property of Prof. Mahmoud E. Soliman, except third-party components (AutoDock Vina, RDKit, Open Babel, Meeko), which remain the property of their respective owners.'],
  ['Citation',
    'If DDS contributes to published or presented work, you agree to cite it as shown in the "Cite DDS" dialog.'],
  ['No warranty & limitation of liability',
    'The software is provided "as is", without warranty of any kind. To the maximum extent permitted by law, the author is not liable for any damages arising from its use.'],
]

// First-launch gate: user must tick the box and accept before the app unlocks.
export default function AgreementGate({ onAgree }) {
  const [checked, setChecked] = useState(false)
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-ink-950 p-4 sm:p-6">
      <div className="glass flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl shadow-2xl ring-1 ring-ink-700/60">
        <div className="flex items-center gap-3 border-b border-ink-700/60 px-6 py-4">
          <Logo size={34} className="rounded-lg glow-accent" />
          <div>
            <h2 className="text-[15px] font-bold text-white">Drug Design Studio — Licence & Terms of Use</h2>
            <p className="text-[11px] text-slate-500">Please read and accept to continue</p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          <div className="space-y-3">
            {TERMS.map(([h, b]) => (
              <div key={h} className="rounded-xl bg-ink-800/40 p-3.5 ring-1 ring-ink-700/50">
                <div className="text-[12.5px] font-semibold text-accent">{h}</div>
                <p className="mt-1 text-[12px] leading-relaxed text-slate-300">{b}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
            © 2026 Developed by Prof. Mahmoud E. Soliman, School of Health Sciences, University of
            KwaZulu-Natal, South Africa. Full terms are provided in the LICENSE and TERMS files
            distributed with this software.
          </p>
        </div>

        <div className="border-t border-ink-700/60 px-6 py-4">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-accent" />
            <span className="text-[12.5px] leading-relaxed text-slate-200">
              I have read and agree to the Licence and Terms of Use, and I confirm I will use DDS for
              <b className="text-white"> academic / non-commercial purposes only</b>.
            </span>
          </label>
          <div className="mt-4 flex items-center justify-end gap-2.5">
            <button onClick={() => { try { window.close() } catch { /* ignore */ } }}
              className="rounded-lg bg-ink-800/70 px-4 py-2 text-[12.5px] font-medium text-slate-400 hover:bg-ink-700 hover:text-slate-200">
              Decline &amp; quit
            </button>
            <button onClick={onAgree} disabled={!checked}
              className="rounded-lg bg-gradient-to-r from-accent to-accent-dim px-5 py-2 text-[12.5px] font-semibold text-ink-950 shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
              Agree &amp; continue
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Read-only viewer for re-opening the terms later (from the sidebar).
export function TermsModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-ink-950/80 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="glass flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-6 py-4">
          <h2 className="text-[14px] font-semibold text-white">Licence & Terms of Use</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-slate-400 hover:bg-ink-700 hover:text-white">✕</button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-6 py-4">
          {TERMS.map(([h, b]) => (
            <div key={h} className="rounded-xl bg-ink-800/40 p-3.5 ring-1 ring-ink-700/50">
              <div className="text-[12.5px] font-semibold text-accent">{h}</div>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-300">{b}</p>
            </div>
          ))}
          <p className="pt-1 text-[11px] leading-relaxed text-slate-500">
            © 2026 Prof. Mahmoud E. Soliman · DDS Academic & Non-Commercial License v1.0 · University of KwaZulu-Natal.
          </p>
        </div>
      </div>
    </div>
  )
}
