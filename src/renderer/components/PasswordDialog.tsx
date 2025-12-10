import React, { useState, useEffect } from "react";
import { X, Lock, Eye, EyeOff } from "lucide-react";

interface PasswordDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: (password: string) => void;
  onCancel: () => void;
  showStrengthIndicator?: boolean;
}

const PasswordDialog: React.FC<PasswordDialogProps> = ({ isOpen, title, message, onConfirm, onCancel, showStrengthIndicator = false }) => {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState(0);

  // Reset password state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setPassword("");
      setShowPassword(false);
      setPasswordStrength(0);
    }
  }, [isOpen]);

  const calculateStrength = (pwd: string) => {
    let strength = 0;
    if (pwd.length >= 8) strength += 1;
    if (pwd.length >= 12) strength += 1;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) strength += 1;
    if (/\d/.test(pwd)) strength += 1;
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwd)) strength += 1;
    return Math.min(5, strength);
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pwd = e.target.value;
    setPassword(pwd);
    if (showStrengthIndicator) {
      setPasswordStrength(calculateStrength(pwd));
    }
  };

  const handleConfirm = () => {
    if (!password) {
      alert("Please enter a password");
      return;
    }
    onConfirm(password);
    setPassword("");
    setPasswordStrength(0);
    setShowPassword(false); // Reset to hide password state
  };

  const handleCancel = () => {
    setPassword("");
    setPasswordStrength(0);
    setShowPassword(false); // Reset to hide password state
    onCancel();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleConfirm();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

  const getStrengthColor = () => {
    switch (passwordStrength) {
      case 0:
      case 1:
        return "bg-red-500";
      case 2:
        return "bg-orange-500";
      case 3:
        return "bg-yellow-500";
      case 4:
        return "bg-blue-500";
      case 5:
        return "bg-green-500";
      default:
        return "bg-gray-500";
    }
  };

  const getStrengthLabel = () => {
    switch (passwordStrength) {
      case 0:
        return "Very Weak";
      case 1:
        return "Weak";
      case 2:
        return "Fair";
      case 3:
        return "Good";
      case 4:
        return "Strong";
      case 5:
        return "Very Strong";
      default:
        return "";
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-lg shadow-2xl p-6 w-full max-w-md">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <Lock size={20} className="text-primary" />
            <h2 className="text-lg font-semibold">{title}</h2>
          </div>
          <button onClick={handleCancel} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Message */}
        <p className="text-sm text-muted-foreground mb-4">{message}</p>

        {/* Password Input */}
        <div className="space-y-2 mb-4">
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={handlePasswordChange}
              onKeyDown={handleKeyDown}
              placeholder="Enter password"
              className="w-full px-3 py-2 bg-input border border-border rounded text-sm focus:outline-none focus:border-primary transition-colors pr-10"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              title={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {/* Strength Indicator */}
          {showStrengthIndicator && password && (
            <div className="space-y-1">
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((level) => (
                  <div
                    key={level}
                    className={`h-1 flex-1 rounded transition-colors ${level <= passwordStrength ? getStrengthColor() : "bg-border"}`}
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Strength: <span className={passwordStrength > 0 ? "text-foreground" : ""}>{getStrengthLabel()}</span>
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <button onClick={handleCancel} className="px-4 py-2 text-sm bg-secondary hover:bg-secondary/80 rounded transition-colors">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground hover:opacity-90 rounded transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

export default PasswordDialog;
