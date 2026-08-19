"use client";

function initials(name: string) {
  return name.split(" ").filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "?";
}

export function Avatar({ name, src, className = "avatar", lazy = false }: { name: string; src?: string; className?: string; lazy?: boolean }) {
  return (
    <span className={className} aria-hidden="true">
      {src ? <img src={src} alt="" loading={lazy ? "lazy" : undefined} decoding="async" /> : initials(name)}
    </span>
  );
}

export function EntityLogo({ name, src, className = "company-logo", lazy = false }: { name: string; src?: string; className?: string; lazy?: boolean }) {
  return (
    <span className={className} aria-hidden="true">
      {src ? <img src={src} alt="" loading={lazy ? "lazy" : undefined} decoding="async" /> : name.slice(0, 2).toUpperCase()}
    </span>
  );
}
