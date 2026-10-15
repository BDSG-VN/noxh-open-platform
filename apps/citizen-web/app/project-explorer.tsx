'use client';
import { useState } from 'react';
import type { Project } from '@noxh/contracts';
import { Card, CardHeader, CardTitle, CardContent } from '@noxh/ui';
export default function ProjectExplorer({ projects }: { projects: Project[] }) {
  const [query, setQuery] = useState('');
  const filtered = projects.filter((p) =>
    `${p.name} ${p.locality}`.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi')),
  );
  return (
    <>
      <label htmlFor="project-search" className="text-sm">
        Tìm trong danh mục giả lập
      </label>
      <input
        id="project-search"
        className="search-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Nhập tên dự án hoặc địa bàn…"
      />
      <div aria-live="polite" className="mb-4 text-sm text-muted-foreground">
        {filtered.length} dự án mẫu
      </div>
      <div className="grid-two">
        {filtered.map((p) => (
          <Card key={p.id}>
            <CardHeader>
              <div className="project-art" aria-hidden="true">
                ▥
              </div>
              {p.synthetic && <span className="pill w-fit mt-3">DỮ LIỆU GIẢ LẬP</span>}
              <CardTitle>{p.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <p>{p.locality}</p>
              <p className="text-sm">
                {p.phase === 'intake'
                  ? 'Minh họa giai đoạn tiếp nhận'
                  : 'Minh họa giai đoạn chuẩn bị'}
              </p>
              <a className="font-bold text-sm" href={`/projects/${p.id}`}>
                Xem cấu trúc dự án →
              </a>
            </CardContent>
          </Card>
        ))}
      </div>
      {filtered.length === 0 && <p>Không có dự án mẫu phù hợp.</p>}
    </>
  );
}
