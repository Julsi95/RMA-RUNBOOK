import { useState } from "react";
import { Button } from "@/components/ui/Button";

export const RUNBOOK_TERMS_VERSION = "2026-11-01";

export function TermsDialog({ required = false, onAccept, busy = false, error = "", onClose }) {
  const [acknowledged, setAcknowledged] = useState(false);
  return <div className="terms-backdrop" role="presentation" onMouseDown={(event) => !required && event.target === event.currentTarget && onClose?.()}>
    <section className="terms-dialog" role="dialog" aria-modal="true" aria-labelledby="runbook-terms-title">
      <p className="eyebrow">RUNBOOK · ACCOUNT RESPONSIBILITY</p><h2 id="runbook-terms-title">Terms and conditions</h2>
      <div className="terms-copy"><p>RUNBOOK is built for the team and its authorized accounts. Access is limited to the people and purposes approved by the organization.</p><p>You are responsible for protecting your account. Keep your password private, use a strong password, and sign out on devices you do not control.</p><p>Do not share passwords, account access, personal information, or confidential team and company data with unauthorized people. Use information in RUNBOOK only for legitimate work purposes and follow your organization’s data-handling rules.</p><p>Report suspected account misuse or exposed information to an administrator promptly. Access may be reviewed or removed when your team role changes.</p></div>
      {onAccept && <label className="terms-acknowledge"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> I understand and agree to these terms.</label>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="dialog-actions">{!required && <Button type="button" variant="outline" onClick={onClose}>Close</Button>}{onAccept && <Button type="button" disabled={!acknowledged || busy} onClick={onAccept}>{busy ? "Saving…" : "Accept and continue"}</Button>}</div>
    </section>
  </div>;
}
