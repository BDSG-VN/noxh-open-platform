export const governmentPortals = [
  {
    id: 'national',
    name: 'Cổng Dịch vụ công Quốc gia',
    url: 'https://dichvucong.gov.vn/',
    audience: 'both',
    stage:
      'Thủ tục đầu tư, xây dựng, đất đai và xác nhận hồ sơ người dân theo cơ quan có thẩm quyền.',
    instructions:
      'Chọn đúng thủ tục, địa phương và cơ quan. Tự đăng nhập định danh trên cổng chính thức; lưu biên nhận vào bước công việc tương ứng.',
    source: 'https://dichvucong.gov.vn/',
    mode: 'handoff',
  },
  {
    id: 'housing-data',
    name: 'Hệ thống thông tin nhà ở và thị trường bất động sản',
    url: 'https://bds.moc.gov.vn/',
    audience: 'investor',
    stage: 'Báo cáo, cập nhật và tra cứu dữ liệu nhà ở, dự án, giao dịch theo NĐ 357/2025/NĐ-CP.',
    instructions:
      'Chủ đầu tư liên hệ Sở Xây dựng để được hướng dẫn tài khoản, phân cấp và biểu báo cáo. Chưa có hợp đồng API được xác minh cho ứng dụng này.',
    source:
      'https://www.moc.gov.vn/vn/tin-tuc/1305/93502/so-xay-dung-tp-can-tho--khan-truong-trien-khai-he-thong-thong-tin-ve-nha-o-va-thi-truong-bat-dong-san.aspx',
    mode: 'handoff',
  },
  {
    id: 'planning',
    name: 'Cổng thông tin quy hoạch xây dựng và quy hoạch đô thị Việt Nam',
    url: 'https://quyhoach.xaydung.gov.vn/',
    audience: 'both',
    stage: 'Tra cứu đồ án, quyết định và thông tin quy hoạch được công bố.',
    instructions:
      'Đối chiếu đồ án và văn bản tại địa phương; nội dung tra cứu không thay quyết định hoặc thông tin do cơ quan có thẩm quyền cung cấp.',
    source: 'https://quyhoach.xaydung.gov.vn/vn/Pages/DSQuyHoach.aspx?tID=1',
    mode: 'lookup',
  },
  {
    id: 'construction',
    name: 'Cổng Dịch vụ công Bộ Xây dựng',
    url: 'https://dichvucong.moc.gov.vn/',
    audience: 'investor',
    stage: 'Tra cứu thủ tục thuộc thẩm quyền Bộ Xây dựng.',
    instructions:
      'Kiểm tra thẩm quyền và kênh tiếp nhận hiện hành. Nhiều thủ tục địa phương thực hiện qua Cổng Dịch vụ công Quốc gia.',
    source: 'https://dichvucong.moc.gov.vn/',
    mode: 'handoff',
  },
  {
    id: 'environment',
    name: 'Cổng Dịch vụ công Bộ Nông nghiệp và Môi trường',
    url: 'https://dichvucong.mae.gov.vn/',
    audience: 'investor',
    stage: 'Thủ tục môi trường, thông tin dữ liệu đất đai/tài nguyên theo thẩm quyền.',
    instructions:
      'Xác định thủ tục cấp trung ương hay địa phương; không gửi hồ sơ đất đai địa phương vào sai cơ quan. Tự thực hiện ký số trên hệ thống cơ quan.',
    source: 'https://dichvucong.mae.gov.vn/_layouts/15/wordTmp/HuongDanSuDung/HuongDanDangKy.pdf',
    mode: 'handoff',
  },
  {
    id: 'procurement',
    name: 'Hệ thống mạng đấu thầu quốc gia',
    url: 'https://muasamcong.mpi.gov.vn/home',
    audience: 'investor',
    stage: 'Lựa chọn nhà thầu/nhà đầu tư khi thuộc trường hợp phải áp dụng.',
    instructions:
      'Không mặc định mọi dự án NOXH phải đấu thầu lựa chọn chủ đầu tư; đối chiếu cơ chế giao chủ đầu tư theo NQ 201 và quy định hiện hành. Nhà thầu xây dựng là nghiệp vụ khác.',
    source: 'https://muasamcong.mpi.gov.vn/home',
    mode: 'handoff',
  },
  {
    id: 'tax',
    name: 'Thuế điện tử',
    url: 'https://thuedientu.gdt.gov.vn/',
    audience: 'investor',
    stage: 'Kê khai, nộp và theo dõi nghĩa vụ thuế của doanh nghiệp.',
    instructions:
      'Đăng nhập, ký số và thanh toán trên cổng thuế. Phần mềm chưa có kết nối khai thuế, phát hành hóa đơn hoặc ngân hàng được cấp quyền.',
    source:
      'https://xaydungchinhsach.chinhphu.vn/6-cong-thong-tin-dien-tu-cua-nganh-thue-giup-ke-khai-nop-thue-va-tra-cuu-thong-tin-thuan-loi-119260115095037532.htm',
    mode: 'handoff',
  },
] as const;
