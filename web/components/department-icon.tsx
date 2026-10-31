import type { ReactNode } from 'react';

export function DepartmentIcon({ id }: { id: string }) {
  return (
    <svg className="dept-icon" viewBox="0 0 64 64" aria-hidden="true">
      <rect x="1" y="1" width="62" height="62" rx="14" fill="#e7f6f2" />
      {shapes[id] ?? shapes.other}
    </svg>
  );
}

const stroke = { fill: 'none', stroke: '#0c7a62', strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const shapes: Record<string, ReactNode> = {
  climate: (
    <>
      <path {...stroke} d="M18 44V24M24 44V20M30 44V26M36 44V22" />
      <path {...stroke} d="M44 18c2 3 2 6 0 9M48 16c3 4 3 9 0 13" />
      <path {...stroke} d="M14 46h28" />
    </>
  ),
  trunking: (
    <>
      <path {...stroke} d="M14 22h36v16H14z" />
      <path {...stroke} d="M18 30h28M18 34h20" />
      <path {...stroke} d="M22 38v8M42 38v8" />
    </>
  ),
  hv: (
    <>
      <path {...stroke} d="M20 16h24v32H20z" />
      <path {...stroke} d="M24 22h16M28 28h8" />
      <path d="M32 32l-4 8h5l-1 6 6-9h-5z" fill="#0c7a62" />
    </>
  ),
  cable: (
    <>
      <circle {...stroke} cx="30" cy="32" r="12" />
      <circle {...stroke} cx="30" cy="32" r="4" />
      <path {...stroke} d="M42 32h10M46 28v8" />
    </>
  ),
  wiring: (
    <>
      <path {...stroke} d="M16 22h32v20H16z" />
      <path {...stroke} d="M24 28v8M32 28v8M40 28v8" />
      <path {...stroke} d="M22 42v6M42 42v6" />
    </>
  ),
  light: (
    <>
      <path {...stroke} d="M32 14a12 12 0 0 1 6 22c-1 2-2 3-2 5h-8c0-2-1-3-2-5a12 12 0 0 1 6-22z" />
      <path {...stroke} d="M27 44h10M28 48h8" />
    </>
  ),
  lv: (
    <>
      <path {...stroke} d="M18 18h28v28H18z" />
      <path {...stroke} d="M26 18v-4h12v4M32 28v10" />
      <path {...stroke} d="M26 46h12" />
      <circle cx="32" cy="30" r="3" fill="#0c7a62" />
    </>
  ),
  install: (
    <>
      <circle {...stroke} cx="32" cy="32" r="14" />
      <circle {...stroke} cx="32" cy="32" r="4" />
      <path {...stroke} d="M32 18v6M32 40v6M18 32h6M40 32h6" />
    </>
  ),
  power: (
    <>
      <path {...stroke} d="M16 26h14v16H16z" />
      <path {...stroke} d="M20 26v-4h6v4M30 34h18" />
      <circle {...stroke} cx="44" cy="34" r="8" />
      <path {...stroke} d="M44 30v4l3 2" />
    </>
  ),
  tools: (
    <>
      <path {...stroke} d="M22 18l8 8-12 16-6-4z" />
      <path {...stroke} d="M40 18l-8 8 6 6 8-8a8 8 0 0 0-6-6z" />
      <path {...stroke} d="M28 34l8 8" />
    </>
  ),
  telecom: (
    <>
      <path {...stroke} d="M32 40v8M24 48h16" />
      <path {...stroke} d="M32 40c-8 0-12-6-12-12" />
      <path {...stroke} d="M32 34c-4 0-6-3-6-6M32 28V16" />
      <path {...stroke} d="M32 40c8 0 12-6 12-12M32 34c4 0 6-3 6-6" />
    </>
  ),
  unlinked: (
    <>
      <path {...stroke} d="M18 26l14-8 14 8v18l-14 8-14-8z" />
      <path {...stroke} d="M18 26l14 8 14-8M32 34v18" />
    </>
  ),
  other: (
    <>
      <circle {...stroke} cx="22" cy="26" r="6" />
      <path {...stroke} d="M34 20h14v12H34z" />
      <path {...stroke} d="M18 40h28v8H18z" />
    </>
  ),
  safety: (
    <>
      <path {...stroke} d="M32 14l16 6v12c0 10-7 16-16 18-9-2-16-8-16-18V20z" />
      <path {...stroke} d="M32 24v14M25 31h14" />
    </>
  ),
};
