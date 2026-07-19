"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

/**
 * UX-BTN: 統一按鈕元件。
 * 目的：新功能一律用這顆，舊的 btn-mini / act-btn / rc-quick-btn 等
 * 20+ 個 class 先不動，讓它們自然被汰換掉。
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "secondary",
      size = "md",
      loading = false,
      fullWidth = false,
      disabled,
      className,
      children,
      ...rest
    },
    ref
  ) => {
    const classes = [
      "nb-btn",
      `nb-btn--${variant}`,
      `nb-btn--${size}`,
      fullWidth ? "nb-btn--full" : "",
      loading ? "nb-btn--loading" : "",
      className || "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        ref={ref}
        className={classes}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...rest}
      >
        {loading ? <span className="nb-btn__spinner" aria-hidden="true" /> : null}
        <span className="nb-btn__label">{children}</span>
      </button>
    );
  }
);

Button.displayName = "Button";
