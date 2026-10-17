-- OPEN DEMO FIXTURE · SYNTHETIC ONLY. Applied by scripts/seed.mjs when DEMO_OPEN_ACCESS=true.
-- Fictional project "Mây Trắng": no real investor, locality, prices, forms or citizens.
INSERT INTO organizations(id,name) VALUES('10000000-0000-4000-8000-000000000001','Chủ đầu tư giả lập · Bản trải nghiệm mở') ON CONFLICT DO NOTHING;
INSERT INTO projects(id,organization_id,name,locality,publication_status,is_synthetic) VALUES
('20000000-0000-4000-8000-00000000d3a0','10000000-0000-4000-8000-000000000001','Khu nhà ở xã hội Mây Trắng · Bản trải nghiệm','Phường Sương Mai, tỉnh Giả Lập · Dự án hư cấu, không đại diện chủ đầu tư nào','published',true)
ON CONFLICT DO NOTHING;
INSERT INTO intake_rounds(id,organization_id,project_id,name,status,opens_at,closes_at) VALUES
('50000000-0000-4000-8000-00000000d3a0','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-00000000d3a0','Đợt trải nghiệm kỹ thuật (không phải thông báo tiếp nhận thật)','open',now()-interval '1 day',now()+interval '365 days')
ON CONFLICT DO NOTHING;
INSERT INTO privacy_notices(id,organization_id,version,payload,content_hash,created_by,status,approved_by,approved_at)
SELECT '60000000-0000-4000-8000-00000000d3a0','10000000-0000-4000-8000-000000000001',COALESCE(max(version),0)+1,'{"controller":"Chủ đầu tư giả lập · Bản trải nghiệm mở","contact":"demo@example.test (hộp thư giả lập, không nhận thư thật)","purposes":"Trải nghiệm luồng chuẩn bị hồ sơ nhà ở xã hội trên dữ liệu giả lập. Không tiếp nhận hồ sơ thật.","categories":"Số điện thoại giả lập và nội dung bạn tự nhập để thử nghiệm.","legalBasis":"Đồng ý của người dùng thử nghiệm. Đây không phải thông báo xử lý dữ liệu cá nhân có hiệu lực pháp lý.","recipients":"Không chia sẻ với bên nào; dữ liệu có thể bị xóa bất cứ lúc nào khi làm mới bản trải nghiệm.","retention":"Dữ liệu trải nghiệm bị xóa khi làm mới môi trường demo.","transfers":"Không chuyển dữ liệu ra ngoài máy chủ demo.","safeguards":"Mã hóa như bản chính thức; không dùng dữ liệu người thật.","rights":"Bạn có thể dừng thử nghiệm và yêu cầu xóa dữ liệu demo bất cứ lúc nào.","consequences":"Không có hệ quả pháp lý; đây là bản trải nghiệm."}','974a0e65c0b4447ac208114965338fba6a053ed61d6c3091fca9c278b9d11be5','SYNTHETIC DEMO AUTHOR','approved','SYNTHETIC DEMO REVIEWER',now()
FROM privacy_notices WHERE organization_id='10000000-0000-4000-8000-000000000001'
  AND NOT EXISTS (SELECT 1 FROM privacy_notices WHERE id='60000000-0000-4000-8000-00000000d3a0');
