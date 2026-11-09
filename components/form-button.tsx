"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

export function FormAwareButton({
  className = "",
  disabled,
  children,
  type,
  ...props
}: ComponentProps<"button">) {
  const { pending } = useFormStatus();
  const isSubmit = type === "submit" || type === undefined;
  const isBusy = Boolean(disabled) || (isSubmit && pending);

  return (
    <button
      type={type}
      disabled={isBusy}
      aria-busy={isBusy}
      className={className}
      {...props}
    >
      {isSubmit && pending && (
        <span
          aria-hidden
          className="mr-2 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}
