# BOG Digital Transformation — PMO Dashboard

داشبورد إدارة مشروع للـPMO، مبني بـFlask مع تكامل مباشر مع Odoo لجلب الـtimesheets.

## ✨ الميزات

- **Overview**: KPIs + complexity breakdown + project progress + recent activity
- **Budget**: Approved vs Final budget + change log + profit analysis
- **Scope & Services**: عرض كل الـ78 خدمة بكل تفاصيلها (Dev MD, Analysis, UI/UX, QC, UAT, PM)
- **Timesheets**: Live من Odoo (XML-RPC API)
- **Analysis**: تحليل بالساعات لكل موظف + daily trend
- **Team**: قابل للتوسعة لربط BOG Members من Google Sheets

## 🚀 التشغيل المحلي

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Set environment variables (copy from .env.example)
export ODOO_URL=https://erp.envnt.co
export ODOO_DB=envnt
export ODOO_USERNAME=your-email@envnt.co
export ODOO_PASSWORD=your-password
export PROJECT_NAME="BOG Digital Transformation"

# 3. Run
python app.py
```

افتح المتصفح على: http://localhost:5000

## ☁️ النشر على Railway

### خطوات النشر:

1. **اعملي repo جديد على GitHub** (مختلف عن website management):
   ```bash
   cd bog_pm_dashboard
   git init
   git add .
   git commit -m "Initial commit - BOG PMO Dashboard"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/bog-pmo-dashboard.git
   git push -u origin main
   ```

2. **على Railway**:
   - اعملي **New Project** (مش نفس الـproject القديم)
   - **Deploy from GitHub repo** → اختاري الـrepo الجديد
   - Railway هيدي لينك جديد تلقائياً (مختلف عن `web-production-a52cd...`)

3. **أضيفي Environment Variables**:
   ```
   ODOO_URL = https://erp.envnt.co
   ODOO_DB = envnt
   ODOO_USERNAME = your-odoo-email
   ODOO_PASSWORD = your-odoo-password
   PROJECT_NAME = BOG Digital Transformation
   ```

4. **Generate Domain** من Settings → اختاري اسم دومين مخصص.

## 🔗 Odoo Connection (Live API)

التطبيق بيستخدم **XML-RPC** عشان يتصل بـOdoo مباشرة. الـAPI ده موجود في كل version من Odoo.

### إيه المعلومات اللي بيجيبها:
- `account.analytic.line` (الـtimesheet entries)
- مفلترة على project name = "BOG Digital Transformation"
- آخر 30 يوم (قابلة للتغيير من الواجهة)

### لو الـOdoo مش متصل:
- التطبيق هيشتغل عادي بـdemo data
- ساعتها هيظهر banner "Demo mode" أصفر

## 📁 Structure

```
bog_pm_dashboard/
├── app.py                  # Flask app + Odoo client
├── requirements.txt
├── Procfile                # Railway/Heroku startup
├── railway.toml            # Railway config
├── runtime.txt             # Python version
├── .env.example
├── data/
│   └── services.xlsx       # 78 services in scope
├── templates/
│   └── index.html          # Main page with 6 tabs
└── static/
    ├── css/style.css
    └── js/app.js
```

## 🎨 Design

التصميم editorial × data — fonts: Fraunces (serif) + Manrope (sans) + JetBrains Mono. اللون الأساسي gold warm (#d4a574) على dark theme.

## 🛣️ الخطوات الجاية

- [ ] ربط Google Sheet للـBOG Members
- [ ] إضافة Risks & Issues register
- [ ] Export PDF reports للإدارة
- [ ] Authentication
- [ ] Email notifications للـmilestones
