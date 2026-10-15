'use client';
import { useState } from 'react';
import type { Project } from '@noxh/contracts';
import { Icon } from '@noxh/ui';
import ArchitectureArt from './architecture-art';
export default function ProjectExplorer({ projects }: { projects: Project[] }) {
  const [query, setQuery] = useState('');
  const filtered = projects.filter((p) =>
    (p.name + ' ' + p.locality).toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi')),
  );
  return (
    <>
      <div className="toolbar">
        <input
          aria-label="Tìm tên dự án hoặc địa bàn"
          className="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm tên dự án hoặc địa bàn…"
        />
        <small aria-live="polite">{filtered.length} dự án phù hợp</small>
      </div>
      <div className="grid-three">
        {filtered.map((p) => (
          <article className="project-card" key={p.id}>
            <div className="project-card-art">
              <ArchitectureArt />
            </div>
            <div className="project-card-content">
              <span className="status-badge blue">
                {p.synthetic ? 'Dữ liệu giả lập' : 'Đã công bố'}
              </span>
              <h3>{p.name}</h3>
              <p style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <Icon name="pin" size={14} />
                {p.locality}
              </p>
              <div className="card-bottom">
                <small style={{ fontSize: 10, color: '#8598a2' }}>Chuẩn bị hồ sơ</small>
                <a className="text-link" href={'/projects/' + p.id}>
                  Xem dự án <Icon name="arrow" size={14} />
                </a>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!filtered.length && <p>Không có dự án phù hợp. Hãy thử tên hoặc địa bàn khác.</p>}
    </>
  );
}
