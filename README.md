# Sale Ecosystem (Google Apps Script Web App SaaS)

ระบบนี้เป็นตัวอย่าง **Sale ครบวงจรแบบอัตโนมัติ** บน Google Apps Script โดยออกแบบให้ deploy เป็น Web App และต่อยอดเป็น SaaS ได้ทันที

## ความสามารถหลัก
- รับลีดใหม่ผ่าน API (`/api/leads`)
- จัดการดีล (Pipeline: NEW, QUALIFIED, PROPOSAL, WON, LOST)
- สร้างใบเสนอราคาอัตโนมัติ
- สร้างใบแจ้งหนี้อัตโนมัติเมื่อดีลชนะ
- บันทึกการชำระเงิน (พร้อม webhook endpoint)
- ระบบ Follow-up อัตโนมัติผ่าน Time Trigger
- Dashboard summary สำหรับภาพรวมยอดขาย
- API Key Authentication สำหรับโหมด SaaS
- **หน้า HTML Web UI** สำหรับใช้งานทีมขายโดยไม่ต้องเรียก API เอง

## โครงสร้างข้อมูล (Google Sheets)
สคริปต์จะสร้างชีตให้อัตโนมัติ:
- `Leads`
- `Deals`
- `Quotations`
- `Invoices`
- `Payments`
- `Activities`
- `Config`

## การติดตั้ง
1. สร้าง Google Sheet ใหม่ และเปิด Extensions > Apps Script
2. คัดลอกไฟล์ในโปรเจกต์นี้ไปไว้ใน Apps Script project (`Code.gs`, `Index.html`, `appsscript.json`)
3. รันฟังก์ชัน `setupSystem()` ครั้งแรกเพื่อสร้างชีตและตั้งค่าเริ่มต้น
4. Deploy > New deployment > Web app
   - Execute as: Me
   - Who has access: Anyone (หรือกำหนดตามความต้องการ)
5. คัดลอก URL ของ Web App

## การใช้งานหน้า HTML
- เปิด URL Web App ปกติ จะเห็นหน้า UI (`Index.html`)
- ใส่ `Web App URL` และ `API Key` จากชีต `Config`
- สามารถเพิ่ม Lead, อัปเดต Stage ดีล, บันทึกชำระเงิน และดู Dashboard ได้จากหน้าเดียว
- ถ้าต้องการดูสถานะ API แบบ JSON ให้เปิด `?view=api`

## API Endpoints
ทุก endpoint ใช้วิธี `POST` และส่ง JSON body

### 1) สร้าง Lead
`POST /api/leads`
```json
{
  "apiKey": "YOUR_API_KEY",
  "name": "John Doe",
  "email": "john@demo.com",
  "phone": "0812345678",
  "source": "Facebook Ads",
  "value": 25000,
  "owner": "sales-a"
}
```

### 2) อัปเดตสถานะดีล
`POST /api/deals/update`
```json
{
  "apiKey": "YOUR_API_KEY",
  "dealId": "DL-...",
  "stage": "WON",
  "note": "ปิดดีลเรียบร้อย"
}
```

### 3) บันทึกชำระเงิน (Webhook)
`POST /api/payments/webhook`
```json
{
  "apiKey": "YOUR_API_KEY",
  "invoiceId": "INV-...",
  "amount": 25000,
  "channel": "PromptPay",
  "txRef": "PAY-REF-001"
}
```

### 4) Dashboard
`POST /api/dashboard`
```json
{
  "apiKey": "YOUR_API_KEY"
}
```

## งานอัตโนมัติ
- รัน `setupFollowupTrigger()` เพื่อตั้ง Trigger ทุก 1 ชั่วโมง
- Trigger จะเรียก `runFollowupAutomation()` เพื่อหา lead/deal ที่ยังไม่ follow-up ตาม SLA

## Multi-tenant (SaaS)
โค้ดนี้ตั้งต้นแบบ **single spreadsheet per tenant** (ง่ายและปลอดภัย)

แนวทางขยาย:
1. 1 spreadsheet ต่อ tenant
2. เก็บ mapping tenant->spreadsheetId ใน master project
3. อ่าน `tenantId` จาก request แล้ว route ไปยังไฟล์ของ tenant

## หมายเหตุความปลอดภัย
- เปลี่ยน API Key หลังติดตั้ง
- จำกัดการเข้าถึง Web App ให้เหมาะสม
- หากเชื่อม Payment Gateway จริง ให้ตรวจลายเซ็น webhook
