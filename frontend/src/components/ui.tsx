import type { ButtonHTMLAttributes, HTMLAttributes, PropsWithChildren, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" };
export function Button({ variant = "secondary", className = "", children, ...props }: ButtonProps) {
  return <button className={`${variant === "primary" ? "primary-button" : variant === "quiet" ? "text-button" : "secondary-button"} ${className}`} {...props}>{children}</button>;
}

export function Panel({ className = "", children, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`panel ${className}`} {...props}>{children}</section>;
}

export function PageHeading({ title, description, eyebrow, action }: { title: string; description?: string; eyebrow?: string; action?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}

export function EmptyState({ title, description, icon, className = "" }: PropsWithChildren<{ title: string; description?: string; icon?: ReactNode; className?: string }>) {
  return <div className={`empty-state ${className}`}>{icon && <div className="empty-state-icon">{icon}</div>}<b>{title}</b>{description && <span>{description}</span>}</div>;
}

export function StatusBadge({ status, children }: PropsWithChildren<{ status: "success" | "warning" | "error" | "neutral" }>) {
  return <span className={`status-badge status-${status}`}>{children}</span>;
}
