import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export function PasswordInput({ className = "", ...props }) {
  const [visible, setVisible] = useState(false);
  return <span className={`password-input-control ${className}`.trim()}>
    <input {...props} type={visible ? "text" : "password"} />
    <button
      className="password-visibility-button"
      type="button"
      aria-label={visible ? "Hide password" : "Show password"}
      aria-pressed={visible}
      onClick={() => setVisible((current) => !current)}
    >
      {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
    </button>
  </span>;
}
