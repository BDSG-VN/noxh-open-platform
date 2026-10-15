import type { ReactNode } from 'react';
export function Icon({ name = 'home', size = 20 }: { name?: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    home: (
      <>
        <path d="m3 10 9-7 9 7v10H3Z" />
        <path d="M9 20v-7h6v7" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    folder: <path d="M3 7V4h6l3 3h9v13H3Z" />,
    building: (
      <>
        <path d="M4 21V3h12v18M16 10h4v11M2 21h20M8 7h4M8 11h4M8 15h4M9 21v-3h3v3" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v5m10-5v5M3 11h18m-14 5h3m4 0h3" />
      </>
    ),
    chat: <path d="M21 4H3v14h5l4 4v-4h9ZM7 9h10M7 13h6" />,
    shield: (
      <>
        <path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    plus: <path d="M12 4v16M4 12h16" />,
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-3a8 8 0 0 1 16 0v3" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6v6l4 2" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="16" cy="17" r="3" />
      </>
    ),
    file: (
      <>
        <path d="M5 2h10l4 4v16H5ZM14 2v5h5M8 12h8M8 16h8" />
      </>
    ),
    pin: (
      <>
        <path d="M19 10c0 6-7 12-7 12S5 16 5 10a7 7 0 1 1 14 0Z" />
        <circle cx="12" cy="9" r="2" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.file}
    </svg>
  );
}
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a href="/" className="platform-brand">
      <span className="brand-mark">
        <Icon name="building" size={25} />
      </span>
      <span>
        NOXH<span className="brand-open"> OPEN</span>
        <small>{compact ? 'KHÔNG GIAN LÀM VIỆC' : 'BDSG FOUNDATION'}</small>
      </span>
    </a>
  );
}
export function Workspace({
  children,
  nav,
  active,
  audience,
  actions,
}: {
  children: ReactNode;
  nav: { href: string; label: string; icon: string }[];
  active: string;
  audience: string;
  actions?: ReactNode;
}) {
  return (
    <div className="workspace">
      <aside className="workspace-sidebar">
        <Brand compact />
        <div className="workspace-label">{audience}</div>
        <nav aria-label="Điều hướng không gian">
          {nav.map((n) => (
            <a key={n.href} href={n.href} aria-current={active === n.href ? 'page' : undefined}>
              <Icon name={n.icon} />
              {n.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Icon name="shield" />
          <strong>Dữ liệu thuộc về bạn</strong>
          <p>Nền tảng mở, triển khai trên hạ tầng của chủ đầu tư.</p>
          <a href="https://github.com/BDSG-VN/noxh-open-platform">BDSG Foundation ↗</a>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="workspace-top">
          <span>{audience}</span>
          <div className="top-actions">
            <span className="environment-dot">Bản phát triển</span>
            {actions}
          </div>
        </header>
        <main className="workspace-content">{children}</main>
        <footer className="workspace-footer">NOXH Open Platform · BDSG Foundation · MIT</footer>
      </div>
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="kicker">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name="folder" size={30} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
