"""Reproducible page extraction from downloaded government originals. No legal-text rewrite."""
from pathlib import Path
from pypdf import PdfReader, PdfWriter
import json,hashlib
root=Path(__file__).resolve().parent.parent/'legal'
sources={s['id']:s for s in json.loads((root/'sources/manifest.json').read_text())}
T='17-vbhn-bxd-2026-phu-luc';N='24-vbhn-bxd-2026-phu-luc'
def form(id,title,source,start,end,category,basis,modes,groups,confirmation=None):
 return dict(id=id,title=title,sourceId=source,sourcePages=list(range(start,end+1)),category=category,legalBasis=basis,modes=modes,groups=groups,externalConfirmation=confirmation)
forms=[
 form('nd100-application-01','Đơn đăng ký mua, thuê mua, thuê nhà ở xã hội',N,3,5,'registration','Mẫu 01 Phụ lục II NĐ 100/2024, thay thế bởi NĐ 136/2026',['buy','rent-buy','rent'],[1,2,3,4,5,6,7,8,9,10,11]),
 form('nd100-worker-rent-02','Đơn đăng ký thuê nhà lưu trú công nhân trong khu công nghiệp',N,6,6,'worker-accommodation','Mẫu 02 Phụ lục II NĐ 100/2024',['rent'],[6,12]),
 form('nd100-forces-application-03','Đơn đăng ký mua, thuê mua, thuê nhà ở cho lực lượng vũ trang nhân dân',N,7,8,'forces','Mẫu 03 Phụ lục II NĐ 100/2024',['buy','rent-buy','rent'],[7]),
 form('tt05-subject-01','Giấy xác nhận về đối tượng (khoản 9, 10, 11)',T,3,4,'subject','Mẫu 01 Phụ lục I TT 05/2024, thay thế bởi TT 08/2026',['buy','rent-buy','rent'],[9,10,11],'Cơ quan theo từng đối tượng tại Điều 6; trường hợp cụ thể phải được kiểm tra'),
 form('tt05-income-subject-01a','Giấy chứng minh đối tượng, thu nhập (khoản 5, 6, 8)',T,5,6,'income-subject','Mẫu 01a Phụ lục I TT 05/2024, bổ sung bởi TT 32/2025',['buy','rent-buy','rent'],[5,6,8],'Cơ quan, đơn vị, doanh nghiệp hoặc cơ quan quản lý trường hợp hưởng lương hưu theo hướng dẫn'),
 form('tt05-housing-02','Giấy chứng minh điều kiện nhà ở — chưa có nhà ở',T,7,8,'housing','Mẫu 02 Phụ lục I TT 05/2024, thay thế bởi TT 08/2026',['buy','rent-buy'],[1,2,3,4,5,6,7,8,9,10],'Cơ quan có thẩm quyền theo Điều 29 NĐ 100/2024 đã sửa đổi'),
 form('tt05-housing-03','Giấy chứng minh điều kiện nhà ở — có nhà ở',T,9,10,'housing','Mẫu 03 Phụ lục I TT 05/2024',['buy','rent-buy'],[1,2,3,4,5,6,7,8,9,10],'UBND cấp xã theo trường hợp diện tích bình quân'),
 form('tt05-forces-income-04','Giấy chứng minh điều kiện thu nhập — lực lượng vũ trang',T,11,11,'income','Mẫu 04 Phụ lục I TT 05/2024, thay thế bởi TT 32/2025',['buy','rent-buy'],[7],'Cơ quan, đơn vị quản lý theo phạm vi thẩm quyền'),
 form('tt05-free-worker-05','Giấy chứng minh đối tượng, thu nhập — không có HĐLĐ, không hưởng lương hưu BHXH',T,12,13,'income-subject','Mẫu 05 Phụ lục I TT 05/2024, thay thế bởi TT 08/2026',['buy','rent-buy','rent'],[5],'Công an cấp xã theo nội dung và thẩm quyền trên mẫu'),
 form('tt05-loan-06','Giấy chứng minh điều kiện vay NHCSXH để tự xây dựng, cải tạo, sửa chữa nhà ở',T,14,15,'self-build-financing','Mẫu 06 Phụ lục I TT 05/2024',[],[1,2,3,4,5,6,7,8],'Cơ quan có thẩm quyền theo chương trình vay'),
 form('tt05-loan-07','Giấy chứng minh điều kiện vay tại tổ chức tín dụng được chỉ định để tự xây dựng, cải tạo, sửa chữa',T,16,17,'self-build-financing','Mẫu 07 Phụ lục I TT 05/2024',[],[1,2,3,4,5,6,7,8],'Cơ quan có thẩm quyền theo chương trình vay'),
 form('tt05-contract-buy-01','Hợp đồng mua bán nhà ở xã hội',T,47,53,'contract','Mẫu 01 Phụ lục VI TT 05/2024',['buy'],[]),
 form('tt05-contract-rent-buy-02','Hợp đồng thuê mua nhà ở xã hội',T,54,60,'contract','Mẫu 02 Phụ lục VI TT 05/2024',['rent-buy'],[]),
 form('tt05-contract-rent-03','Hợp đồng thuê nhà ở xã hội',T,61,68,'contract','Mẫu 03 Phụ lục VI TT 05/2024',['rent'],[]),
 form('nd100-investor-price','Đơn đề nghị thẩm định giá bán, giá thuê mua',N,1,1,'investor','Phụ lục I NĐ 100/2024',['buy','rent-buy'],[]),
]
for f in forms:
 source=sources[f['sourceId']];raw=(root/'sources'/source['file']).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=source['sha256']:raise ValueError('Source checksum mismatch')
 reader=PdfReader(root/'sources'/source['file']);writer=PdfWriter()
 for page in f['sourcePages']:writer.add_page(reader.pages[page-1])
 writer.add_metadata({'/Title':f['title'],'/Subject':f['legalBasis'],'/SourceURL':source['url'],'/SourceSHA256':source['sha256'],'/SourcePages':','.join(map(str,f['sourcePages']))})
 path=root/'forms'/(f['id']+'.pdf');path.parent.mkdir(exist_ok=True)
 with path.open('wb') as stream:writer.write(stream)
 f.update(file=f['id']+'.pdf',sha256=hashlib.sha256(path.read_bytes()).hexdigest(),pages=len(f['sourcePages']),sourceUrl=source['url'],sourceSha256=source['sha256'],reviewStatus='source-extracted-pending-project-approval')
(root/'catalog.json').write_text(json.dumps({'version':'vn-noxh-2026-10-15','researchedOn':'2026-10-15','forms':forms,'scope':'National base sources; local project applicability requires separate review. Not a legal eligibility engine.'},ensure_ascii=False,indent=2)+'\n')
print('Extracted',len(forms),'forms without changing source page content')
