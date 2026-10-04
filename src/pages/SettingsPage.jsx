import { useTheme } from "@/app/theme-provider";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  return (
    <section className="page-content">
      <div className="page-heading"><div><p className="eyebrow">PREFERENCES</p><h1>Settings</h1><p className="page-description">Choose how the workspace looks on this device.</p></div></div>
      <div className="settings-card">
        <div><h2>Appearance</h2><p>Choose a theme or follow your device setting.</p></div>
        <label className="theme-select-label" htmlFor="theme-select">Theme</label>
        <select id="theme-select" className="theme-select" value={theme} onChange={(event) => setTheme(event.target.value)}>
          <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
        </select>
      </div>
    </section>
  );
}
