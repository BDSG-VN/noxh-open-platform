'use client';
import InventoryAdmin from './inventory-admin';
import { useEffect, useState } from 'react';
import { Button } from '@noxh/ui';
import { departmentLabels } from '@noxh/contracts';
import ApplicationsAdmin from './applications-admin';
import OperationsAdmin, { type OperationsStaff } from './operations-admin';
export default function StaffWorkspace({ staff }: { staff: OperationsStaff }) {
  const hasApplications = Boolean(
      staff.permissions?.some((p) =>
        ['intake_officer', 'reviewer', 'approver', 'auditor'].includes(p),
      ),
    ),
    hasPrices = Boolean(staff.permissions?.includes('price_approver')),
    hasOperations = Boolean(
      staff.permissions?.some((p) => ['workflow_read', 'records_read', 'finance_read'].includes(p)),
    );
  const areas = [
    ...(hasApplications
      ? [
          {
            key: 'applications',
            label: 'Hồ sơ được giao',
            description: 'Tiếp nhận, thẩm định và theo dõi các quyết định.',
          },
        ]
      : []),
    ...(hasOperations
      ? [
          {
            key: 'operations',
            label: 'Công việc và tài liệu',
            description: 'Tiến độ dự án, hồ sơ nội bộ và phối hợp phòng ban.',
          },
        ]
      : []),
    ...(hasPrices
      ? [
          {
            key: 'prices',
            label: 'Bảng hàng và giá',
            description: 'Kiểm tra phương án giá trong các dự án được phân công.',
          },
        ]
      : []),
  ];
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]),
    [active, setActive] = useState(areas[0]?.key ?? ''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetch('/api/admin/operations/projects')
      .then(async (r) => {
        if (!r.ok) throw new Error('Chưa tải được danh sách dự án. Hãy tải lại trang.');
        const b = await r.json();
        if (alive) setProjects(b.items);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <main className="container section stack investor-workspace iw-staff-workspace">
      <header className="surface iw-staff-header">
        <div className="surface-body iw-page-heading">
          <div>
            <p className="iw-kicker">BDSG Foundation · Không gian nhân viên</p>
            <h1>Công việc được phân công</h1>
            <p>Xử lý hồ sơ và phối hợp công việc trong phạm vi được giao.</p>
            <span className="tag">
              {staff.department && staff.department in departmentLabels
                ? departmentLabels[staff.department as keyof typeof departmentLabels]
                : 'Nhân sự dự án'}
            </span>
          </div>
          <Button
            variant="outline"
            disabled={loggingOut}
            onClick={async () => {
              setLoggingOut(true);
              try {
                const r = await fetch('/api/admin/logout', { method: 'POST' });
                if (!r.ok) throw new Error('Chưa đăng xuất được. Hãy thử lại.');
                window.location.assign('/login');
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Chưa đăng xuất được');
                setLoggingOut(false);
              }
            }}
          >
            {loggingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}
          </Button>
        </div>
      </header>
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
      <div className="iw-staff-summary">
        <span>
          <strong>{loading ? '…' : projects.length}</strong> dự án được giao
        </span>
        <span>
          <strong>{areas.length}</strong> phân hệ được cấp quyền
        </span>
        <span>Phiên đăng nhập đã xác thực hai lớp</span>
      </div>
      {!areas.length && (
        <section className="surface">
          <div className="surface-body empty-state">
            <h2>Chưa có công việc được cấp quyền</h2>
            <p>Quản trị tổ chức cần giao vai trò và dự án trước khi anh/chị tiếp tục làm việc.</p>
          </div>
        </section>
      )}
      {!!areas.length && (
        <>
          <nav className="iw-area-tabs" aria-label="Không gian làm việc">
            {areas.map((area) => (
              <button
                type="button"
                key={area.key}
                aria-pressed={active === area.key}
                onClick={() => setActive(area.key)}
              >
                <strong>{area.label}</strong>
                <span>{area.description}</span>
              </button>
            ))}
          </nav>
          <section
            aria-label={areas.find((area) => area.key === active)?.label}
            className="iw-workspace-panel"
          >
            {active === 'operations' && hasOperations && <OperationsAdmin staff={staff} />}{' '}
            {active === 'prices' && hasPrices && (
              <InventoryAdmin projects={projects} staff={staff} />
            )}{' '}
            {active === 'applications' && hasApplications && <ApplicationsAdmin staff={staff} />}
          </section>
        </>
      )}
    </main>
  );
}
