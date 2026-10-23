import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Clock3, Dices, ImagePlus, KeyRound, LogOut, RefreshCw, Shield, Trash2, UserPlus, UsersRound, X } from "lucide-react";
import { useTheme } from "@/app/theme-provider";
import { useAuth } from "@/app/auth-provider";
import { useOrganizationRoster } from "@/app/organization-provider";
import { getOperationalRoster } from "@/features/organization/organization-data";
import { Button } from "@/components/ui/Button";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { manageAccounts, signedOwnProfilePhoto, uploadOwnProfilePhoto } from "@/lib/backend-repositories";
import { subscribeToTables } from "@/lib/backend/shared";
import { useBranding } from "@/app/branding-provider";
import { loadRunbookSessionSettings, saveRunbookSessionSettings } from "@/lib/backend/session";
import { fetchCachedQuery, queryClient, queryKeys, readCachedQuery } from "@/lib/backend/query-cache";
import { generateStrongPassword } from "@/lib/strong-password";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { configured, user, account, accountProfile, canEdit, updateAccountProfile, updateEmail, updatePassword, signOut, refreshSessionStatus } = useAuth();
  const canManageAccounts = configured && ["admin", "super_admin"].includes(account?.role);
  const { members: rosterMembers } = useOrganizationRoster();
  const members = useMemo(() => getOperationalRoster(rosterMembers), [rosterMembers]);
  const { branding, logoUrl, save: saveBranding } = useBranding();
  const accountsKey = useMemo(() => queryKeys.accounts(user?.id ?? "anonymous"), [user?.id]);
  const sessionSettingsKey = useMemo(() => queryKeys.runbookSessionSettings(user?.id ?? "anonymous"), [user?.id]);
  const cachedAccounts = readCachedQuery(accountsKey);
  const cachedSessionSettings = readCachedQuery(sessionSettingsKey);
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
  const [accounts, setAccounts] = useState(cachedAccounts ?? []);
  const [accountListLoading, setAccountListLoading] = useState(Boolean(canManageAccounts && !cachedAccounts));
  const [accountListError, setAccountListError] = useState("");
  const accountLoadSequence = useRef(0);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");
  const [accountError, setAccountError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletePhrase, setDeletePhrase] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [sessionPolicy, setSessionPolicy] = useState(cachedSessionSettings ?? { inactivity_timeout_minutes: 30, absolute_timeout_hours: 12, warning_minutes: 2 });
  const [sessionPolicyBusy, setSessionPolicyBusy] = useState(false);
  const [sessionPolicyMessage, setSessionPolicyMessage] = useState("");
  const [sessionPolicyError, setSessionPolicyError] = useState("");
  const [invite, setInvite] = useState({ email: "", displayName: "", role: "user", employeeId: "", confirmAdmin: false });
  const [directAccount, setDirectAccount] = useState({ email: "", displayName: "", role: "user", employeeId: "", password: "", confirmPassword: "", confirmAdmin: false });
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
  }, [account?.display_name, accountProfile?.summary, accountProfile?.photo_path, user?.email]);

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
    if (!canManageAccounts) return undefined;
    void refreshAccounts("", { force: false }).catch(() => {});
    return () => { accountLoadSequence.current += 1; };
  }, [accountsKey, canManageAccounts, user?.id]);

  useEffect(() => {
    let active = true;
    if (!canManageAccounts) return undefined;
    void fetchCachedQuery(sessionSettingsKey, loadRunbookSessionSettings).then((settings) => {
      if (active && settings) setSessionPolicy(settings);
    }).catch((error) => {
      if (active) setSessionPolicyError(error.message || "Could not load session settings.");
    });
    return () => { active = false; };
  }, [canManageAccounts, sessionSettingsKey]);

  useEffect(() => {
    if (!canManageAccounts) return undefined;
    let active = true;
    let timer;
    const unsubscribe = subscribeToTables([{ table: "realtime_sync_signals", filter: "source_table=eq.app_accounts" }], () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!active) return;
        void refreshAccounts().catch(() => {});
      }, 160);
    }, "settings-accounts");
    return () => { active = false; window.clearTimeout(timer); accountLoadSequence.current += 1; unsubscribe(); };
  }, [canManageAccounts, user?.id]);

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

  async function saveSessionPolicy(event) {
    event.preventDefault(); setSessionPolicyError(""); setSessionPolicyMessage(""); setSessionPolicyBusy(true);
    try {
      await saveRunbookSessionSettings({ ...sessionPolicy, inactivity_timeout_minutes: 30 });
      queryClient.setQueryData(sessionSettingsKey, { ...sessionPolicy, inactivity_timeout_minutes: 30 });
      await refreshSessionStatus();
      setSessionPolicyMessage("Session security settings saved for everyone.");
    } catch (error) { setSessionPolicyError(error.message || "Session settings could not be saved."); }
    finally { setSessionPolicyBusy(false); }
  }

  async function refreshAccounts(message = "", { force = true } = {}) {
    const requestSequence = ++accountLoadSequence.current;
    if (!readCachedQuery(accountsKey)) setAccountListLoading(true);
    setAccountListError("");
    try {
      const result = await fetchCachedQuery(accountsKey, () => manageAccounts({ action: "list" }), { force });
      if (requestSequence === accountLoadSequence.current) {
        setAccounts(result.accounts ?? []);
        queryClient.setQueryData(accountsKey, result.accounts ?? []);
        if (message) setAccountMessage(message);
      }
      return result;
    } catch (error) {
      if (requestSequence === accountLoadSequence.current) setAccountListError(error.message || "Could not load accounts.");
      throw error;
    } finally {
      if (requestSequence === accountLoadSequence.current) setAccountListLoading(false);
    }
  }

  async function sendInvite(event) {
    event.preventDefault(); setAccountBusy(true); setAccountMessage(""); setAccountError("");
    try {
      const result = await manageAccounts({ ...invite, action: "invite", redirectTo: window.location.origin + "/setup-password" });
      setInvite({ email: "", displayName: "", role: "user", employeeId: "", confirmAdmin: false });
      setAccountMessage(result.message || "Invitation sent.");
      // The invite is complete once the server accepts it. A slow directory
      // refresh must not keep the invite button locked or mask that success.
      void refreshAccounts().catch(() => {});
    } catch (error) { setAccountError(error.message || "Invitation could not be sent."); }
    finally { setAccountBusy(false); }
  }

  async function createAccountWithPassword(event) {
    event.preventDefault(); setAccountBusy(true); setAccountMessage(""); setAccountError("");
    if (directAccount.password.length < 8) { setAccountError("Use a password with at least 8 characters."); setAccountBusy(false); return; }
    if (directAccount.password !== directAccount.confirmPassword) { setAccountError("The passwords do not match."); setAccountBusy(false); return; }
    try {
      const result = await manageAccounts({ ...directAccount, action: "create-with-password" });
      setDirectAccount({ email: "", displayName: "", role: "user", employeeId: "", password: "", confirmPassword: "", confirmAdmin: false });
      setAccountMessage(result.message || "Account created.");
      void refreshAccounts().catch(() => {});
    } catch (error) { setAccountError(error.message || "Account could not be created."); }
    finally { setAccountBusy(false); }
  }

  function generateAccountPassword() {
    try {
      const generated = generateStrongPassword();
      setDirectAccount((value) => ({ ...value, password: generated, confirmPassword: generated }));
      setAccountError("");
      setAccountMessage("Strong password generated and copied into both password fields.");
    } catch (error) {
      setAccountError(error.message || "Could not generate a secure password.");
    }
  }

  async function setAccountPassword(accountRow, nextPassword) {
    setAccountBusy(true); setAccountMessage(""); setAccountError("");
    try {
      await manageAccounts({ action: "set-password", userId: accountRow.userId, password: nextPassword });
      setAccountMessage(`Password updated for ${accountRow.email}.`);
    } catch (error) { setAccountError(error.message || "Password could not be updated."); throw error; }
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

  function requestAccountDeletion(accountRow) {
    if (!canEdit || accountRow.role === "super_admin" || accountRow.userId === user?.id) return;
    setDeleteTarget(accountRow); setDeletePhrase(""); setDeleteError("");
  }

  async function confirmAccountDeletion() {
    if (!deleteTarget || deletePhrase !== "delete account") return;
    setAccountBusy(true); setDeleteError(""); setAccountMessage(""); setAccountError("");
    try {
      const result = await manageAccounts({ action: "delete", userId: deleteTarget.userId });
      setDeleteTarget(null); setDeletePhrase(""); setAccountMessage(result.message || "Account permanently deleted.");
      void refreshAccounts().catch(() => {});
    } catch (error) { setDeleteError(error.message || "Account could not be deleted."); }
    finally { setAccountBusy(false); }
  }

  const previewPhoto = filePreview || photoUrl;
  return (
    <section className="page-content settings-page">
      <div className="page-heading settings-page-heading"><div><p className="eyebrow">WORKSPACE CONTROL CENTER</p><h1>Settings</h1><p className="page-description">Account, appearance, and workspace controls in one place.</p></div><span className="settings-heading-badge"><Shield size={15} /> {canEdit ? "Editor controls enabled" : "Personal settings"}</span></div>
      <nav className="settings-quick-nav" aria-label="Settings sections">
        <a href="#appearance">Appearance</a>
        {configured && user && <><a href="#profile">My profile</a><a href="#login-email">Login email</a><a href="#password">Password</a></>}
        {configured && canEdit && <><a href="#branding">Branding</a><a href="#session-security">Session security</a></>}
        {canManageAccounts && <a href="#account-access">User management</a>}
      </nav>
      <div id="appearance" className="settings-card settings-appearance-card">
        <div><h2>Appearance</h2><p>Choose a theme or follow your device setting.</p></div>
        <label className="theme-select-label" htmlFor="theme-select">Theme</label>
        <select id="theme-select" className="theme-select" value={theme} onChange={(event) => setTheme(event.target.value)}>
          <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
        </select>
      </div>
      {configured && user && <>
        <section id="profile" className="settings-card account-settings-card settings-account-section">
          <div><h2>Account profile</h2><p>Update your name, photo, and summary. If your account is linked to an employee, those profile details stay in sync.</p></div>
          <form className="settings-account-form" onSubmit={saveProfile}>
            <div className="settings-profile-photo"><span>{previewPhoto ? <img src={previewPhoto} alt="Profile preview" /> : (displayName || user.email || "U").slice(0, 1).toUpperCase()}</span><label className="photo-upload-button"><ImagePlus size={15} />Change photo<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)} /></label><small>JPEG, PNG, WebP, or animated GIF · max 5 MB</small></div>
            <label className="form-field"><span>Display name</span><input required maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
            <label className="form-field"><span>Profile summary</span><textarea rows={3} maxLength={500} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="A short introduction about you" /></label>
            {profileError && <p className="auth-error" role="alert">{profileError}</p>}{profileMessage && <p className="auth-success" role="status">{profileMessage}</p>}
            <Button type="submit" disabled={savingProfile}>{savingProfile ? "Saving…" : "Save profile"}</Button>
          </form>
          {account?.employee_id && <small>Linked Agent Profile · {rosterMembers.find((member) => member.id === account.employee_id)?.name ?? account.employee_id}</small>}
        </section>
        <section id="login-email" className="settings-card account-settings-card settings-account-section">
          <div><h2>Login email / username</h2><p>Supabase verifies the email change before it becomes the new login name.</p></div>
          <form className="settings-account-form" onSubmit={saveEmail}><label className="form-field"><span>Email address</span><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>{emailError && <p className="auth-error" role="alert">{emailError}</p>}{emailMessage && <p className="auth-success" role="status">{emailMessage}</p>}<Button type="submit">Request email change</Button></form>
        </section>
        <section id="password" className="settings-card account-settings-card settings-account-section">
          <div><h2>Password</h2><p>Set a new password for this account.</p></div>
          <form className="account-password-form" onSubmit={changePassword}>
            <label>New password<PasswordInput autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <label>Confirm new password<PasswordInput autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
            {passwordError && <p className="auth-error" role="alert">{passwordError}</p>}{passwordMessage && <p className="auth-success" role="status">{passwordMessage}</p>}
            <Button type="submit" disabled={savingPassword}>{savingPassword ? "Updating…" : "Update password"}</Button>
          </form>
        </section>
        <div className="settings-signout"><span>Signed in as <strong>{user.email}</strong> · {account?.role === "super_admin" ? "Super Admin" : account?.role ?? "user"}</span><Button variant="outline" onClick={() => void signOut()}><LogOut size={15} /> Sign out</Button></div>
      </>}
      {configured && canEdit && <section id="branding" className="settings-card settings-admin-section">
        <div><h2>Sidebar branding</h2><p>Changes appear in the sidebar for everyone signed in.</p></div>
        <form className="settings-branding-form" onSubmit={saveWorkspaceBranding}>
          <label className="form-field"><span>Sidebar title</span><input maxLength={48} required value={brandingTitle} onChange={(event) => setBrandingTitle(event.target.value)} /></label>
          <div className="settings-branding-logo"><span>{brandingPreview || logoUrl ? <img src={brandingPreview || logoUrl} alt="Sidebar logo preview" /> : "VF"}</span><label className="photo-upload-button"><ImagePlus size={15} />{brandingFile ? "Change image" : "Upload logo"}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setBrandingFile(event.target.files?.[0] ?? null)} /></label><small>JPEG, PNG, WebP, or GIF · max 5 MB</small></div>
          {brandingError && <p className="auth-error" role="alert">{brandingError}</p>}{brandingMessage && <p className="auth-success" role="status">{brandingMessage}</p>}
          <Button type="submit" disabled={brandingBusy}>{brandingBusy ? "Saving…" : "Save sidebar branding"}</Button>
        </form>
      </section>}
      {canManageAccounts && <section id="account-access" className="settings-card settings-admin-section">
        <div><h2><Shield size={19} /> Account access</h2><p>Invite employees, manage user access, and control who can edit RUNBOOK.</p></div>
        {accountError && <p className="auth-error" role="alert">{accountError}</p>}{accountMessage && <p className="auth-success" role="status">{accountMessage}</p>}
        <form className="settings-invite-form" onSubmit={sendInvite}>
          <label className="form-field"><span>Employee name</span><input required maxLength={80} value={invite.displayName} onChange={(event) => setInvite((value) => ({ ...value, displayName: event.target.value }))} /></label>
          <label className="form-field"><span>Email / login username</span><input type="email" required value={invite.email} onChange={(event) => setInvite((value) => ({ ...value, email: event.target.value }))} /></label>
          <label className="form-field"><span>Link employee record</span><select value={invite.employeeId} onChange={(event) => setInvite((value) => ({ ...value, employeeId: event.target.value }))}><option value="">No employee link</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}</select></label>
          <label className="form-field"><span>Access level</span><select value={invite.role} onChange={(event) => setInvite((value) => ({ ...value, role: event.target.value, confirmAdmin: false }))}><option value="user">User · view and own profile</option><option value="admin">Admin · full edit access</option></select></label>
          {invite.role === "admin" && <label className="settings-confirm-admin"><input type="checkbox" checked={invite.confirmAdmin} onChange={(event) => setInvite((value) => ({ ...value, confirmAdmin: event.target.checked }))} /><span>Confirm this account should have full administrator access.</span></label>}
          <Button type="submit" disabled={accountBusy || (invite.role === "admin" && !invite.confirmAdmin)}><UserPlus size={15} />{accountBusy ? "Sending…" : "Send secure invitation"}</Button>
        </form>
        {account?.role === "super_admin" && <div className="settings-direct-account">
          <div><h3><KeyRound size={17} /> Create account with password</h3><p>Creates a confirmed sign-in account directly without sending an email. Share the password securely with its owner.</p></div>
          <form className="settings-invite-form" onSubmit={createAccountWithPassword}>
            <label className="form-field"><span>Employee name</span><input required maxLength={80} value={directAccount.displayName} onChange={(event) => setDirectAccount((value) => ({ ...value, displayName: event.target.value }))} /></label>
            <label className="form-field"><span>Email / login username</span><input type="email" autoComplete="off" required value={directAccount.email} onChange={(event) => setDirectAccount((value) => ({ ...value, email: event.target.value }))} /></label>
            <label className="form-field"><span>Link employee record</span><select value={directAccount.employeeId} onChange={(event) => setDirectAccount((value) => ({ ...value, employeeId: event.target.value }))}><option value="">No employee link</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}</select></label>
            <label className="form-field"><span>Access level</span><select value={directAccount.role} onChange={(event) => setDirectAccount((value) => ({ ...value, role: event.target.value, confirmAdmin: false }))}><option value="user">User · view and own profile</option><option value="admin">Admin · full edit access</option></select></label>
            <label className="form-field"><span>Temporary password</span><PasswordInput autoComplete="new-password" minLength={8} maxLength={128} required value={directAccount.password} onChange={(event) => setDirectAccount((value) => ({ ...value, password: event.target.value }))} /></label>
            <label className="form-field"><span>Confirm password</span><PasswordInput autoComplete="new-password" minLength={8} maxLength={128} required value={directAccount.confirmPassword} onChange={(event) => setDirectAccount((value) => ({ ...value, confirmPassword: event.target.value }))} /></label>
            <div className="settings-password-generator"><Button type="button" variant="outline" disabled={accountBusy} onClick={generateAccountPassword}><Dices size={15} /> Generate strong password</Button><small>Creates a random 20-character password and fills both fields.</small></div>
            {directAccount.role === "admin" && <label className="settings-confirm-admin"><input type="checkbox" checked={directAccount.confirmAdmin} onChange={(event) => setDirectAccount((value) => ({ ...value, confirmAdmin: event.target.checked }))} /><span>Confirm this account should have full administrator access.</span></label>}
            <Button type="submit" disabled={accountBusy || (directAccount.role === "admin" && !directAccount.confirmAdmin)}><UserPlus size={15} />{accountBusy ? "Creating…" : "Create account"}</Button>
          </form>
        </div>}
        <div className="settings-account-list">
          <div className="settings-account-list-heading"><div><h3><UsersRound size={17} /> User management</h3><p>Review accounts, change access, suspend sign-in, or manage passwords.</p></div><Button type="button" variant="outline" disabled={accountListLoading} onClick={() => void refreshAccounts().catch(() => {})}><RefreshCw size={14} className={accountListLoading ? "settings-refresh-spinning" : ""} />{accountListLoading ? "Refreshing…" : "Refresh users"}</Button></div>
          {accountListLoading && <p className="page-description" role="status">Loading saved accounts…</p>}
          {accountListError && <div className="settings-account-list-error"><p className="auth-error" role="alert">{accountListError}</p><Button type="button" variant="outline" onClick={() => void refreshAccounts().catch(() => {})}>Retry account list</Button></div>}
          {!accountListLoading && !accountListError && accounts.length === 0 && <p className="page-description">No editable accounts to show.</p>}
          {!accountListLoading && !accountListError && accounts.length > 0 && <div className="settings-account-table-wrap"><table className="settings-account-table"><thead><tr><th>Account</th><th>Status</th><th>Access</th><th>Employee</th><th>Last sign-in</th><th>Actions</th></tr></thead><tbody>
            {accounts.map((row) => {
              const linkedManager = rosterMembers.find((member) => member.id === row.employee_id);
              const accountMembers = linkedManager && !members.some((member) => member.id === linkedManager.id) ? [...members, linkedManager] : members;
              return <AccountRow key={row.userId} row={row} members={accountMembers} busy={accountBusy} canSetPassword={account?.role === "super_admin"} canDelete={account?.role === "super_admin" || row.role !== "admin"} onSave={updateAccess} onToggleSuspend={toggleSuspend} onSetPassword={setAccountPassword} onDelete={requestAccountDeletion} />;
            })}
          </tbody></table></div>}
        </div>
      </section>}
      {deleteTarget && <AccountDeletionDialog account={deleteTarget} phrase={deletePhrase} error={deleteError} busy={accountBusy} onPhraseChange={setDeletePhrase} onClose={() => { if (!accountBusy) { setDeleteTarget(null); setDeletePhrase(""); setDeleteError(""); } }} onConfirm={() => void confirmAccountDeletion()} />}
      {configured && canEdit && <section id="session-security" className="settings-card settings-admin-section">
        <div><h2><Clock3 size={19} /> Session security</h2><p>Inactive sessions are ended after 30 minutes. The timeout is enforced by the database.</p></div>
        <form className="session-policy-form" onSubmit={saveSessionPolicy}>
          <div className="session-policy-fixed"><span>Inactivity timeout</span><strong>30 minutes</strong></div>
          <label className="form-field"><span>Maximum session lifetime (hours)</span><input type="number" min="1" max="168" required value={sessionPolicy.absolute_timeout_hours} onChange={(event) => setSessionPolicy((value) => ({ ...value, absolute_timeout_hours: event.target.value }))} /></label>
          {sessionPolicyError && <p className="auth-error" role="alert">{sessionPolicyError}</p>}{sessionPolicyMessage && <p className="auth-success" role="status">{sessionPolicyMessage}</p>}
          <Button type="submit" disabled={sessionPolicyBusy}>{sessionPolicyBusy ? "Saving…" : "Save session settings"}</Button>
        </form>
      </section>}
    </section>
  );
}

function AccountDeletionDialog({ account, phrase, error, busy, onPhraseChange, onClose, onConfirm }) {
  useEffect(() => {
    function handleKeyDown(event) { if (event.key === "Escape" && !busy) onClose(); }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);
  return <div className="settings-delete-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="settings-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="settings-delete-title" aria-describedby="settings-delete-description">
      <div className="settings-delete-icon"><AlertTriangle size={20} /></div>
      <Button className="settings-delete-close" type="button" variant="ghost" size="icon" aria-label="Close confirmation" disabled={busy} onClick={onClose}><X size={17} /></Button>
      <p className="eyebrow">PERMANENT ACTION</p>
      <h2 id="settings-delete-title">Delete this account?</h2>
      <p id="settings-delete-description">This permanently deletes <strong>{account.email}</strong>, including its login, account profile, sessions, and account-only profile image. A linked employee record and its operational data will remain. This action cannot be undone.</p>
      <label className="settings-delete-phrase">Type <code>delete account</code> to continue
        <input autoFocus autoComplete="off" autoCapitalize="off" spellCheck="false" value={phrase} onChange={(event) => onPhraseChange(event.target.value)} aria-label="Type delete account to confirm" />
      </label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="settings-delete-actions"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="button" className="settings-delete-confirm" disabled={busy || phrase !== "delete account"} onClick={onConfirm}><Trash2 size={15} />{busy ? "Deleting…" : "Delete account"}</Button></div>
    </section>
  </div>;
}

function AccountRow({ row, members, busy, canSetPassword, canDelete, onSave, onToggleSuspend, onSetPassword, onDelete }) {
  const [role, setRole] = useState(row.role ?? "user");
  const [employeeId, setEmployeeId] = useState(row.employee_id ?? "");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  useEffect(() => { setRole(row.role ?? "user"); setEmployeeId(row.employee_id ?? ""); }, [row]);
  async function submitPassword(event) {
    event.preventDefault(); setPasswordError("");
    if (password.length < 8) { setPasswordError("Use at least 8 characters."); return; }
    if (password !== confirmPassword) { setPasswordError("The passwords do not match."); return; }
    try { await onSetPassword(row, password); setPassword(""); setConfirmPassword(""); setPasswordOpen(false); }
    catch (error) { setPasswordError(error.message || "Password could not be updated."); }
  }
  const suspended = row.bannedUntil && new Date(row.bannedUntil).getTime() > Date.now();
  const lastSignIn = row.lastSignInAt ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.lastSignInAt)) : "Never";
  return <>
    <tr>
      <td className="settings-account-identity"><strong>{row.display_name || row.email}</strong><span>{row.email}</span></td>
      <td><span className={`settings-account-status ${suspended ? "is-suspended" : row.confirmed ? "is-active" : "is-pending"}`}>{suspended ? "Suspended" : row.confirmed ? "Active" : "Invite pending"}</span></td>
      <td><select aria-label={`Access level for ${row.email}`} value={role} onChange={(event) => setRole(event.target.value)}><option value="user">User</option><option value="admin">Admin</option></select></td>
      <td><select aria-label={`Employee link for ${row.email}`} value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">None</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></td>
      <td className="settings-account-last-signin">{lastSignIn}</td>
      <td><div className="settings-account-actions">
        <Button size="sm" variant="outline" disabled={busy || (role === row.role && employeeId === (row.employee_id ?? ""))} onClick={() => onSave(row, role, employeeId)}>Save access</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onToggleSuspend(row)}>{suspended ? "Reactivate" : "Suspend"}</Button>
        {canSetPassword && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setPasswordOpen((open) => !open); setPasswordError(""); }}>Change password</Button>}
        {canDelete && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDelete(row)}><Trash2 size={14} /> Delete user</Button>}
      </div></td>
    </tr>
    {canSetPassword && passwordOpen && <tr><td colSpan={6}><form className="settings-account-password-form" onSubmit={submitPassword}>
      <label><span>New password</span><PasswordInput autoComplete="new-password" minLength={8} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <label><span>Confirm password</span><PasswordInput autoComplete="new-password" minLength={8} maxLength={128} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
      {passwordError && <p className="auth-error" role="alert">{passwordError}</p>}
      <div><Button type="submit" disabled={busy}>Save password</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => { setPasswordOpen(false); setPassword(""); setConfirmPassword(""); setPasswordError(""); }}>Cancel</Button></div>
    </form></td></tr>}
  </>;
}
