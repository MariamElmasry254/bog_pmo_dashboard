"""
BOG Digital Transformation - PM Dashboard
Live integration with Odoo for timesheets + project management
"""
from flask import Flask, render_template, jsonify, request
import pandas as pd
import os
import xmlrpc.client
from datetime import datetime, timedelta
from functools import lru_cache
import json

app = Flask(__name__)

# ============================================================
# CONFIGURATION
# ============================================================
ODOO_URL = os.environ.get('ODOO_URL', 'https://erp.envnt.co')
ODOO_DB = os.environ.get('ODOO_DB', 'envnt')
ODOO_USERNAME = os.environ.get('ODOO_USERNAME', '')
ODOO_PASSWORD = os.environ.get('ODOO_PASSWORD', '')
PROJECT_NAME = os.environ.get('PROJECT_NAME', 'BOG Digital Transformation')

DATA_FILE = os.path.join(os.path.dirname(__file__), 'data', 'services.xlsx')

# ============================================================
# ODOO CONNECTION (Live API via XML-RPC)
# ============================================================
class OdooClient:
    def __init__(self):
        self.url = ODOO_URL
        self.db = ODOO_DB
        self.username = ODOO_USERNAME
        self.password = ODOO_PASSWORD
        self.uid = None
        self.models = None

    def connect(self):
        if not self.username or not self.password:
            return False
        try:
            common = xmlrpc.client.ServerProxy(f'{self.url}/xmlrpc/2/common')
            self.uid = common.authenticate(self.db, self.username, self.password, {})
            if self.uid:
                self.models = xmlrpc.client.ServerProxy(f'{self.url}/xmlrpc/2/object')
                return True
            return False
        except Exception as e:
            print(f"Odoo connection error: {e}")
            return False

    def get_timesheets(self, project_name=PROJECT_NAME, days=30):
        if not self.uid:
            if not self.connect():
                return None
        try:
            date_from = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
            domain = [
                ('project_id.name', 'ilike', project_name),
                ('date', '>=', date_from)
            ]
            timesheets = self.models.execute_kw(
                self.db, self.uid, self.password,
                'account.analytic.line', 'search_read',
                [domain],
                {'fields': ['date', 'employee_id', 'project_id', 'task_id',
                           'name', 'unit_amount'], 'limit': 1000}
            )
            return timesheets
        except Exception as e:
            print(f"Error fetching timesheets: {e}")
            return None

odoo = OdooClient()

# ============================================================
# DATA LOADERS
# ============================================================
def load_services():
    """Load services in scope from Excel"""
    try:
        df = pd.read_excel(DATA_FILE)
        services = []
        for record in df.to_dict(orient='records'):
            clean = {}
            for k, v in record.items():
                if pd.isna(v):
                    clean[k] = None
                else:
                    clean[k] = v
            services.append(clean)
        return services
    except Exception as e:
        print(f"Error loading services: {e}")
        return []

def get_demo_timesheets():
    """Demo timesheet data when Odoo not connected"""
    return [
        {'date': '2026-04-28', 'employee': 'Ahmed Hassan', 'task': 'API Development - User Auth', 'hours': 7.5},
        {'date': '2026-04-28', 'employee': 'Mariam Elmasry', 'task': 'PM Review & Planning', 'hours': 6.0},
        {'date': '2026-04-29', 'employee': 'Ahmed Hassan', 'task': 'Database Schema Design', 'hours': 8.0},
        {'date': '2026-04-29', 'employee': 'Sara Ali', 'task': 'UI/UX - Dashboard Mockups', 'hours': 7.0},
        {'date': '2026-04-30', 'employee': 'Omar Khaled', 'task': 'Frontend Components', 'hours': 8.0},
        {'date': '2026-04-30', 'employee': 'Mariam Elmasry', 'task': 'Stakeholder Meeting', 'hours': 4.5},
        {'date': '2026-05-01', 'employee': 'Ahmed Hassan', 'task': 'Code Review', 'hours': 5.0},
        {'date': '2026-05-01', 'employee': 'Sara Ali', 'task': 'Wireframes - Case Management', 'hours': 7.5},
        {'date': '2026-05-02', 'employee': 'Omar Khaled', 'task': 'Integration Testing', 'hours': 6.0},
        {'date': '2026-05-02', 'employee': 'Mariam Elmasry', 'task': 'Sprint Planning', 'hours': 5.5},
    ]

# ============================================================
# ROUTES
# ============================================================
@app.route('/')
def index():
    return render_template('index.html', project_name=PROJECT_NAME)

@app.route('/api/overview')
def api_overview():
    """KPIs for dashboard tab"""
    services = load_services()
    df = pd.DataFrame(services)

    total_services = len(df)
    total_wd = df['WD'].sum() if 'WD' in df.columns else 0
    total_dev_md = df['Dev MDs'].sum() if 'Dev MDs' in df.columns else 0
    total_all_md = df['ALL'].sum() if 'ALL' in df.columns else 0

    complexity_dist = {}
    if 'Complexity' in df.columns:
        valid = ['Basic', 'Simple', 'Medium', 'Complex']
        for c in valid:
            complexity_dist[c] = int((df['Complexity'] == c).sum())

    return jsonify({
        'project_name': PROJECT_NAME,
        'total_services': int(total_services),
        'total_working_days': float(total_wd) if pd.notna(total_wd) else 0,
        'total_dev_mds': float(total_dev_md) if pd.notna(total_dev_md) else 0,
        'total_all_mds': float(total_all_md) if pd.notna(total_all_md) else 0,
        'complexity_distribution': complexity_dist,
        'budget_sar': 10257885.00,
        'revenue_sar': 20150344.00,
        'profit_sar': 9892459.00,
        'profit_pct': 49,
        'progress_pct': 0,
        'support_start': '2027-05-18',
        'support_end': '2028-05-17',
    })

@app.route('/api/services')
def api_services():
    services = load_services()
    return jsonify(services)

@app.route('/api/timesheets')
def api_timesheets():
    """Live from Odoo, falls back to demo data"""
    days = int(request.args.get('days', 30))
    ts = odoo.get_timesheets(days=days)

    if ts is None:
        return jsonify({
            'connected': False,
            'message': 'Demo data (Odoo not configured). Set ODOO_USERNAME and ODOO_PASSWORD env vars.',
            'data': get_demo_timesheets()
        })

    formatted = []
    for entry in ts:
        formatted.append({
            'date': entry.get('date'),
            'employee': entry.get('employee_id', [None, 'Unknown'])[1] if entry.get('employee_id') else 'Unknown',
            'project': entry.get('project_id', [None, ''])[1] if entry.get('project_id') else '',
            'task': entry.get('task_id', [None, ''])[1] if entry.get('task_id') else (entry.get('name') or ''),
            'description': entry.get('name', ''),
            'hours': entry.get('unit_amount', 0)
        })
    return jsonify({'connected': True, 'data': formatted})

@app.route('/api/timesheets/analysis')
def api_timesheets_analysis():
    """Aggregated analysis"""
    days = int(request.args.get('days', 30))
    ts = odoo.get_timesheets(days=days)

    if ts is None:
        data = get_demo_timesheets()
    else:
        data = []
        for entry in ts:
            data.append({
                'date': entry.get('date'),
                'employee': entry.get('employee_id', [None, 'Unknown'])[1] if entry.get('employee_id') else 'Unknown',
                'task': entry.get('task_id', [None, ''])[1] if entry.get('task_id') else (entry.get('name') or ''),
                'hours': entry.get('unit_amount', 0)
            })

    df = pd.DataFrame(data)
    if df.empty:
        return jsonify({'by_employee': [], 'by_date': [], 'total_hours': 0})

    by_employee = df.groupby('employee')['hours'].sum().reset_index().to_dict('records')
    by_date = df.groupby('date')['hours'].sum().reset_index().to_dict('records')
    by_date.sort(key=lambda x: x['date'])

    return jsonify({
        'by_employee': by_employee,
        'by_date': by_date,
        'total_hours': float(df['hours'].sum()),
        'total_entries': len(df),
        'unique_employees': int(df['employee'].nunique())
    })

@app.route('/api/budget')
def api_budget():
    """Budget breakdown"""
    return jsonify({
        'project_name': PROJECT_NAME,
        'pm': 'Abdelrahman Doghish',
        'contract_type': 'FS',
        'support_start': '2027-05-18',
        'support_end': '2028-05-17',
        'progress': 0,
        'total_mandays': 6556,
        'approved': {
            'cost_usd': 2735436.00,
            'cost_sar': 10257885.00,
            'revenue_sar': 20570344.00,
            'profit_sar': 10312459.00,
            'profit_pct': 50
        },
        'final': {
            'cost_sar': 10257885.00,
            'revenue_sar': 20150344.00,
            'profit_sar': 9892459.00,
            'profit_pct': 49
        },
        'changes': [
            {'reason': 'Third party license', 'plan_id': '', 'changes_cost': 0, 'changes_revenue': -420000.00}
        ],
        'total_change_cost': 0,
        'total_change_revenue': -420000.00
    })

@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'time': datetime.now().isoformat()})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
