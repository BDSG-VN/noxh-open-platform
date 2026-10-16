import { CAMPAIGN, DOSSIER, LOTTERY, PROJECT, STAFF_TOKEN } from './fake-api';
export type Role =
  | 'citizen-web'
  | 'investor-console'
  | 'partner-console'
  | 'transparency-web'
  | 'zalo-miniapp';
export interface PageCase {
  app: Role;
  path: string;
  name: string;
  cookie?: string;
  /** Cookie value; the fake API maps STAFF_TOKEN to a non-admin staff identity. */
  cookieValue?: string;
}
const page = (
  app: Role,
  path: string,
  name: string,
  cookie?: string,
  cookieValue?: string,
): PageCase => ({ app, path, name, cookie, cookieValue });
const admin = (tab: string, name: string) =>
  page('investor-console', tab ? `/?tab=${tab}` : '/', `Quản trị · ${name}`, 'noxh_staff');
const partner = (tab: string, name: string) =>
  page('partner-console', tab ? `/?tab=${tab}` : '/', `Đối tác · ${name}`, 'noxh_partner');
// Every role's entry and main working pages. Pages render against the synthetic API in
// tests/a11y/fake-api.ts; panels whose endpoints are not in that file show their real
// error or empty states, which are part of what must be accessible.
// Not covered here: Zalo-only stages of the Mini App (need the real SDK) and generated
// PDF content.
export const pages: PageCase[] = [
  page('citizen-web', '/', 'Trang chủ công dân'),
  page('citizen-web', '/login', 'Đăng nhập công dân'),
  page('citizen-web', '/trai-nghiem', 'Tài khoản trải nghiệm'),
  page('citizen-web', '/privacy', 'Thông báo bảo vệ dữ liệu (khách)'),
  page('citizen-web', `/projects/${PROJECT}`, 'Trang dự án'),
  page('citizen-web', `/tu-van/${CAMPAIGN}`, 'Yêu cầu tư vấn'),
  page('citizen-web', '/dashboard', 'Bảng điều khiển công dân', 'noxh_citizen'),
  page('citizen-web', `/dossiers/${DOSSIER}`, 'Hồ sơ chuẩn bị', 'noxh_citizen'),
  page('citizen-web', '/privacy', 'Trung tâm quyền riêng tư', 'noxh_citizen'),
  page('investor-console', '/login', 'Đăng nhập quản trị'),
  admin('', 'tổng quan'),
  admin('projects', 'dự án'),
  admin('rounds', 'lịch tiếp nhận'),
  admin('requests', 'yêu cầu hỗ trợ'),
  admin('applications', 'hồ sơ khách hàng'),
  admin('notifications', 'thông báo'),
  admin('forms', 'biểu mẫu & pháp lý'),
  admin('form-mappings', 'thiết kế mẫu điền'),
  admin('checklists', 'danh mục chuẩn bị'),
  admin('knowledge', 'tri thức AI'),
  admin('inventory', 'bảng hàng & giá'),
  admin('tenancy', 'hợp đồng & công nợ'),
  admin('lotteries', 'bốc thăm'),
  admin('partners', 'đối tác'),
  admin('operations', 'điều hành'),
  admin('government', 'cổng cơ quan nhà nước'),
  admin('privacy', 'bảo vệ dữ liệu'),
  admin('openai', 'trợ lý AI'),
  admin('audit', 'nhật ký'),
  admin('zalo-miniapp', 'đăng nhập Mini App'),
  admin('zalo', 'Zalo OTP'),
  page('investor-console', '/', 'Không gian nhân sự nghiệp vụ', 'noxh_staff', STAFF_TOKEN),
  page('partner-console', '/login', 'Đăng nhập đối tác'),
  partner('', 'tổng quan'),
  partner('leads', 'yêu cầu tư vấn'),
  partner('campaigns', 'chiến dịch'),
  partner('team', 'nhân viên'),
  partner('projects', 'dự án được giao'),
  page('transparency-web', '/', 'Cổng minh bạch'),
  page('transparency-web', `/lotteries/${LOTTERY}`, 'Phòng bốc thăm công khai'),
  page('zalo-miniapp', '/', 'Zalo Mini App (trình duyệt)'),
];
