import { useEffect, useState } from "react";
import { ImagePlus, LogOut, Shield, UserPlus } from "lucide-react";
import { useTheme } from "@/app/theme-provider";
import { useAuth } from "@/app/auth-provider";
import { useOrganizationRoster } from "@/app/organization-provider";
import { Button } from "@/components/ui/Button";
import { manageAccounts, signedOwnProfilePhoto, uploadOwnProfilePhoto } from "@/lib/backend-repositories";
import { subscribeToTables } from "@/lib/backend/shared";
import { useBranding } from "@/app/branding-provider";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { configured, user, account, accountProfile, canEdit, updateAccountProfile, updateEmail, updatePassword, signOut } = useAuth();
  const { members } = useOrganizationRoster();
  const { branding, logoUrl, save: saveBranding } = useBranding();
  const [displayName, setDisplayName] = useState(account?.display_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [summary, setSummary] = useState(accountProfile?.summary ?? "");
  const [photoPath, setPhotoPath] = useState(accountProfile?.photo_path ?? "");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const [filePreview, setFilePreview] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");
  const [emailError, setEmailError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");
  const [accountError, setAccountError] = useState("");
  const [invite, setInvite] = useState({ email: "", displayName: "", role: "user", employeeId: "", confirmAdmin: false });
  const [brandingTitle, setBrandingTitle] = useState(branding.sidebar_title);
  const [brandingFile, setBrandingFile] = useState(null);
  const [brandingPreview, setBrandingPreview] = useState("");
  const [brandingBusy, setBrandingBusy] = useState(false);
  const [brandingMessage, setBrandingMessage] = useState("");
  const [brandingError, setBrandingError] = useState("");

  useEffect(() => setBrandingTitle(branding.sidebar_title), [branding.sidebar_title]);
  useEffect(() => {
    if (!brandingFile) { setBrandingPreview(""); return undefined; }
    const url = URL.createObjectURL(brandingFile); setBrandingPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [brandingFile]);

  useEffect(() => {
    setDisplayName(account?.display_name ?? "");
    setEmail(user?.email ?? "");
    setSummary(accountProfile?.summary ?? "");
    setPhotoPath(accountProfile?.photo_path ?? "");
    setPhotoFile(null);
  }, [account, accountProfile, user]);

  useEffect(() => {
    let active = true;
    if (!configured || !accountProfile?.photo_path) { setPhotoUrl(""); return undefined; }
    void signedOwnProfilePhoto(accountProfile.photo_path).then((url) => { if (active) setPhotoUrl(url); }).catch(() => { if (active) setPhotoUrl(""); });
    return () => { active = false; };
  }, [configured, accountProfile?.photo_path]);

  useEffect(() => {
    if (!photoFile) { setFilePreview(""); return undefined; }
    const objectUrl = URL.createObjectURL(photoFile);
    setFilePreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [photoFile]);

  useEffect(() => {
    if (!canEdit || !configured) return undefined;
    let active = true;
    void manageAccounts({ action: "list" }).then((result) => { if (active) setAccounts(result.accounts ?? []); })
      .catch((error) => { if (active) setAccountError(error.message || "Could not load accounts."); });
    return () => { active = false; };
  }, [canEdit, configured]);

  useEffect(() => {
    if (!canEdit || !configured) return undefined;
    let active = true;
    let timer;
    const unsubscribe = subscribeToTables(["app_accounts"], () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!active) return;
        void manageAccounts({ action: "list" }).then((result) => {
          if (active) { setAccounts(result.accounts ?? []); setAccountError(""); }
        }).catch((error) => { if (active) setAccountError(error.message || "Could not sync account changes."); });
      }, 160);
    }, "settings-accounts");
    return () => { active = false; window.clearTimeout(timer); unsubscribe(); };
  }, [canEdit, configured]);

  async function saveProfile(event) {
    event.preventDefault(); setProfileError(""); setProfileMessage(""); setSavingProfile(true);
    try {
      let nextPhotoPath = photoPath;
      if (photoFile) nextPhotoPath = await uploadOwnProfilePhoto(photoFile, user.id, account?.employee_id);
      await updateAccountProfile({ displayName: displayName.trim(), summary: summary.trim(), photoPath: nextPhotoPath });
      setPhotoPath(nextPhotoPath ?? ""); setPhotoFile(null); setProfileMessage("Profile updated and synced to your Agent Profile.");
    } catch (error) { setProfileError(error.message || "Profile could not be updated."); }
    finally { setSavingProfile(false); }
  }

  async function saveEmail(event) {
    event.preventDefault(); setEmailError(""); setEmailMessage("");
    if (email.trim().toLowerCase() === (user?.email ?? "").toLowerCase()) return;
    try { await updateEmail(email.trim().toLowerCase()); setEmailMessage("Check your current or new email for a confirmation link before the login email changes."); }
    catch (error) { setEmailError(error.message || "Login email could not be changed."); }
  }

  async function changePassword(event) {
    event.preventDefault(); setPasswordError(""); setPasswordMessage("");
    if (password.length < 8) { setPasswordError("Use at least 8 characters."); return; }
    if (password !== confirmPassword) { setPasswordError("The passwords do not match."); return; }
    setSavingPassword(true);
    try { await updatePassword(password); setPassword(""); setConfirmPassword(""); setPasswordMessage("Password updated."); }
    catch (error) { setPasswordError(error.message || "Password could not be updated."); }
    finally { setSavingPassword(false); }
  }

  async function saveWorkspaceBranding(event) {
    event.preventDefault(); setBrandingError(""); setBrandingMessage("");
    if (!brandingTitle.trim()) { setBrandingError("Enter a sidebar title."); return; }
    if (brandingFile && (!/^image\/(jpeg|png|webp|gif)$/.test(brandingFile.type) || brandingFile.size > 5 * 1024 * 1024)) { setBrandingError("Choose a JPEG, PNG, WebP, or GIF image up to 5 MB."); return; }
    setBrandingBusy(true);
    try { await saveBranding({ title: brandingTitle, file: brandingFile, actorId: user?.id }); setBrandingFile(null); setBrandingMessage("Sidebar branding saved and synced for everyone."); }
    catch (cause) { setBrandingError(cause.message || "Branding could not be saved."); }
    finally { setBrandingBusy(false); }
  }

  async function refreshAccounts(message = "") {
    const result = await manageAccounts({ action: "list" });
    setAccounts(result.accounts ?? []); setAccountMessage(message); setAccountError("");
  }

  async function sendInvite(event) {
    event.preventDefault(); setAccountBusy(true); setAccountMessage(""); setAccountError("");
    try {
      const result = await manageAccounts({ ...invite, action: "invite", redirectTo: window.location.origin + "/login" });
      await refreshAccounts(result.message || "Invitation sent.");
      setInvite({ email: "", displayName: "", role: "user", employeeId: "", confirmAdmin: false });
    } catch (error) { setAccountError(error.message || "Invitation could not be sent."); }
    finally { setAccountBusy(false); }
  }

  async function updateAccess(accountRow, role, employeeId) {
    if (role === "admin" && !window.confirm("Give administrator access to " + accountRow.email + "? They will be able to edit all RUNBOOK data.")) return;
    setAccountBusy(true); setAccountMessage(""); setAccountError("");
    try {
      await manageAccounts({ action: "update", userId: accountRow.userId, role, employeeId: employeeId || null, confirmAdmin: role === "admin" });
      await refreshAccounts("Account access updated.");
    } catch (error) { setAccountError(error.message || "Account could not be updated."); }
    finally { setAccountBusy(false); }
  }

  async function toggleSuspend(accountRow) {
    const action = accountRow.bannedUntil ? "restore" : "suspend";
    if (!window.confirm((action === "suspend" ? "Suspend" : "Restore") + " sign-in access for " + accountRow.email + "?")) return;
    setAccountBusy(true); setAccountMessage(""); setAccountError("");
    try { await manageAccounts({ action, userId: accountRow.userId }); await refreshAccounts(action === "suspend" ? "Sign-in suspended." : "Sign-in restored."); }
    catch (error) { setAccountError(error.message || "Account access could not be changed."); }
    finally { setAccountBusy(false); }
  }

  const previewPhoto = filePreview || photoUrl;
  return (
    <section className="page-content settings-page">
      <div className="page-heading"><div><p className="eyebrow">PREFERENCES</p><h1>Settings</h1><p className="page-description">Manage your account and how RUNBOOK looks on this device.</p></div></div>
      <div className="settings-card">
        <div><h2>Appearance</h2><p>Choose a theme or follow your device setting.</p></div>
        <label className="theme-select-label" htmlFor="theme-select">Theme</label>
        <select id="theme-select" className="theme-select" value={theme} onChange={(event) => setTheme(event.target.value)}>
          <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
        </select>
      </div>
      {configured && user && <>
        <section className="settings-card account-settings-card">
          <div><h2>Account profile</h2><p>Update your name, photo, and summary. If your account is linked to an employee, those profile details stay in sync.</p></div>
          <form className="settings-account-form" onSubmit={saveProfile}>
            <div className="settings-profile-photo"><span>{previewPhoto ? <img src={previewPhoto} alt="Profile preview" /> : (displayName || user.email || "U").slice(0, 1).toUpperCase()}</span><label className="photo-upload-button"><ImagePlus size={15} />Change photo<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)} /></label><small>JPEG, PNG, WebP, or animated GIF · max 5 MB</small></div>
            <label className="form-field"><span>Display name</span><input required maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
            <label className="form-field"><span>Profile summary</span><textarea rows={3} maxLength={500} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="A short introduction about you" /></label>
            {profileError && <p className="auth-error" role="alert">{profileError}</p>}{profileMessage && <p className="auth-success" role="status">{profileMessage}</p>}
            <Button type="submit" disabled={savingProfile}>{savingProfile ? "Saving…" : "Save profile"}</Button>
          </form>
          {account?.employee_id && <small>Linked Agent Profile · {members.find((member) => member.id === account.employee_id)?.name ?? account.employee_id}</small>}
        </section>
        <section className="settings-card account-settings-card">
          <div><h2>Login email / username</h2><p>Supabase verifies the email change before it becomes the new login name.</p></div>
          <form className="settings-account-form" onSubmit={saveEmail}><label className="form-field"><span>Email address</span><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>{emailError && <p className="auth-error" role="alert">{emailError}</p>}{emailMessage && <p className="auth-success" role="status">{emailMessage}</p>}<Button type="submit">Request email change</Button></form>
        </section>
        <section className="settings-card account-settings-card">
          <div><h2>Password</h2><p>Set a new password for this account.</p></div>
          <form className="account-password-form" onSubmit={changePassword}>
            <label>New password<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
            {passwordError && <p className="auth-error" role="alert">{passwordError}</p>}{passwordMessage && <p className="auth-success" role="status">{passwordMessage}</p>}
            <Button type="submit" disabled={savingPassword}>{savingPassword ? "Updating…" : "Update password"}</Button>
          </form>
        </section>
        <div className="settings-signout"><span>Signed in as <strong>{user.email}</strong> · {account?.role ?? "user"}</span><Button variant="outline" onClick={() => void signOut()}><LogOut size={15} /> Sign out</Button></div>
      </>}
      {configured && canEdit && <section className="settings-card settings-admin-section">
        <div><h2>Sidebar branding</h2><p>Changes appear in the sidebar for everyone signed in.</p></div>
        <form className="settings-branding-form" onSubmit={saveWorkspaceBranding}>
          <label className="form-field"><span>Sidebar title</span><input maxLength={48} required value={brandingTitle} onChange={(event) => setBrandingTitle(event.target.value)} /></label>
          <div className="settings-branding-logo"><span>{brandingPreview || logoUrl ? <img src={brandingPreview || logoUrl} alt="Sidebar logo preview" /> : "VF"}</span><label className="photo-upload-button"><ImagePlus size={15} />{brandingFile ? "Change image" : "Upload logo"}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setBrandingFile(event.target.files?.[0] ?? null)} /></label><small>JPEG, PNG, WebP, or GIF · max 5 MB</small></div>
          {brandingError && <p className="auth-error" role="alert">{brandingError}</p>}{brandingMessage && <p className="auth-success" role="status">{brandingMessage}</p>}
          <Button type="submit" disabled={brandingBusy}>{brandingBusy ? "Saving…" : "Save sidebar branding"}</Button>
        </form>
      </section>}
      {configured && canEdit && <section className="settings-card settings-admin-section">
        <div><h2><Shield size={19} /> Account access</h2><p>Invite employees and control who can edit RUNBOOK. Invitations never expose or store passwords.</p></div>
        {accountError && <p className="auth-error" role="alert">{accountError}</p>}{accountMessage && <p className="auth-success" role="status">{accountMessage}</p>}
        <form className="settings-invite-form" onSubmit={sendInvite}>
          <label className="form-field"><span>Employee name</span><input required maxLength={80} value={invite.displayName} onChange={(event) => setInvite((value) => ({ ...value, displayName: event.target.value }))} /></label>
          <label className="form-field"><span>Email / login username</span><input type="email" required value={invite.email} onChange={(event) => setInvite((value) => ({ ...value, email: event.target.value }))} /></label>
          <label className="form-field"><span>Link employee record</span><select value={invite.employeeId} onChange={(event) => setInvite((value) => ({ ...value, employeeId: event.target.value }))}><option value="">No employee link</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}</select></label>
          <label className="form-field"><span>Access level</span><select value={invite.role} onChange={(event) => setInvite((value) => ({ ...value, role: event.target.value, confirmAdmin: false }))}><option value="user">User · view and own profile</option><option value="admin">Admin · full edit access</option></select></label>
          {invite.role === "admin" && <label className="settings-confirm-admin"><input type="checkbox" checked={invite.confirmAdmin} onChange={(event) => setInvite((value) => ({ ...value, confirmAdmin: event.target.checked }))} /><span>Confirm this account should have full administrator access.</span></label>}
          <Button type="submit" disabled={accountBusy || (invite.role === "admin" && !invite.confirmAdmin)}><UserPlus size={15} />{accountBusy ? "Sending…" : "Send secure invitation"}</Button>
        </form>
        <div className="settings-account-list"><h3>Existing accounts</h3>{accounts.map((row) => <AccountRow key={row.userId} row={row} members={members} busy={accountBusy} onSave={updateAccess} onToggleSuspend={toggleSuspend} />)}</div>
      </section>}
    </section>
  );
}

function AccountRow({ row, members, busy, onSave, onToggleSuspend }) {
  const [role, setRole] = useState(row.role ?? "user");
  const [employeeId, setEmployeeId] = useState(row.employee_id ?? "");
  useEffect(() => { setRole(row.role ?? "user"); setEmployeeId(row.employee_id ?? ""); }, [row]);
  return <article className="settings-account-row"><div><strong>{row.display_name || row.email}</strong><span>{row.email}{row.confirmed ? " · confirmed" : " · invitation pending"}</span></div><label><span>Role</span><select value={role} onChange={(event) => setRole(event.target.value)}><option value="user">User</option><option value="admin">Admin</option></select></label><label><span>Employee link</span><select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">None</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><Button variant="outline" disabled={busy || (role === row.role && employeeId === (row.employee_id ?? ""))} onClick={() => onSave(row, role, employeeId)}>Save access</Button><Button variant="ghost" disabled={busy} onClick={() => onToggleSuspend(row)}>{row.bannedUntil ? "Restore sign-in" : "Suspend sign-in"}</Button></article>;
}
