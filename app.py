"""
BOG Digital Transformation - PM Dashboard
Live integration with Odoo for timesheets + project management
"""
from flask import Flask, render_template, jsonify, request
import pandas as pd
import os
import sys
import xmlrpc.client
import traceback
from datetime import datetime, timedelta
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    stream=sys.stdout
)
logger = logging.getLogger(__name__)

ODOO_URL = os.environ.get('ODOO_URL', 'https://erp.envnt.co')
ODOO_DB = os.environ.get('ODOO_DB', 'envnt')
ODOO_USERNAME = os.environ.get('ODOO_USERNAME', '')
ODOO_PASSWORD = os.environ.get('ODOO_PASSWORD', '')
PROJECT_NAME = os.environ.get('PROJECT_NAME', 'BOG Digital Transformation')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, 'data', 'services.xlsx')

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, 'templates'),
    static_folder=os.path.join(BASE_DIR, 'static')
)

logger.info(f"Starting app — BASE_DIR={BASE_DIR}")
logger.info(f"DATA_FILE={DATA_FILE} exists={os.path.exists(DATA_FILE)}")
logger.info(f"ODOO configured: user={'yes' if ODOO_USERNAME else 'no'}")


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
            logger.error(f"Odoo connection error: {e}")
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
            logger.error(f"Error fetching timesheets: {e}")
            return None

odoo = OdooClient()

_services_cache = None

def load_services():
    """Load services in scope from Excel — cached, resilient"""
    global _services_cache
    if _services_cache is not None:
        return _services_cache
    try:
        if not os.path.exists(DATA_FILE):
            logger.warning(f"Data file not found: {DATA_FILE}")
            _services_cache = []
            return _services_cache
        df = pd.read_excel(DATA_FILE)
        services = []
        for record in df.to_dict(orient='records'):
            clean = {}
            for k, v in record.items():
                if pd.isna(v):
                    clean[k] = None
                elif isinstance(v, (pd.Timestamp, datetime)):
                    clean[k] = v.isoformat()
                else:
                    clean[k] = v
            services.append(clean)
        _services_cache = services
        logger.info(f"Loaded {len(services)} services")
        return services
    except Exception as e:
        logger.error(f"Error loading services: {e}\n{traceback.format_exc()}")
        return []

def get_demo_timesheets():
    return [
        {'date': '2026-04-28', 'employee': 'Ahmed Hassan', 'task': 'API Development - User Auth', 'description': '', 'hours': 7.5},
        {'date': '2026-04-28', 'employee': 'Mariam Elmasry', 'task': 'PM Review & Planning', 'description': '', 'hours': 6.0},
        {'date': '2026-04-29', 'employee': 'Ahmed Hassan', 'task': 'Database Schema Design', 'description': '', 'hours': 8.0},
        {'date': '2026-04-29', 'employee': 'Sara Ali', 'task': 'UI/UX - Dashboard Mockups', 'description': '', 'hours': 7.0},
        {'date': '2026-04-30', 'employee': 'Omar Khaled', 'task': 'Frontend Components', 'description': '', 'hours': 8.0},
        {'date': '2026-04-30', 'employee': 'Mariam Elmasry', 'task': 'Stakeholder Meeting', 'description': '', 'hours': 4.5},
        {'date': '2026-05-01', 'employee': 'Ahmed Hassan', 'task': 'Code Review', 'description': '', 'hours': 5.0},
        {'date': '2026-05-01', 'employee': 'Sara Ali', 'task': 'Wireframes - Case Management', 'description': '', 'hours': 7.5},
        {'date': '2026-05-02', 'employee': 'Omar Khaled', 'task': 'Integration Testing', 'description': '', 'hours': 6.0},
        {'date': '2026-05-02', 'employee': 'Mariam Elmasry', 'task': 'Sprint Planning', 'description': '', 'hours': 5.5},
    ]

def safe_float(v, default=0):
    try:
        if v is None or pd.isna(v):
            return default
        return float(v)
    except (ValueError, TypeError):
        return default

@app.errorhandler(Exception)
def handle_error(e):
    logger.error(f"Unhandled exception: {e}\n{traceback.format_exc()}")
    return jsonify({'error': str(e), 'type': type(e).__name__}), 500

@app.route('/')
def index():
    try:
        return render_template('index.html', project_name=PROJECT_NAME)
    except Exception as e:
        logger.error(f"Index error: {e}\n{traceback.format_exc()}")
        return f"<h1>Setup error</h1><pre>{traceback.format_exc()}</pre>", 500

@app.route('/api/overview')
def api_overview():
    try:
        services = load_services()
        df = pd.DataFrame(services) if services else pd.DataFrame()
        total_services = len(df)
        total_wd = safe_float(df['WD'].sum()) if 'WD' in df.columns else 0
        total_dev_md = safe_float(df['Dev MDs'].sum()) if 'Dev MDs' in df.columns else 0
        total_all_md = safe_float(df['ALL'].sum()) if 'ALL' in df.columns else 0
        complexity_dist = {}
        if 'Complexity' in df.columns:
            for c in ['Basic', 'Simple', 'Medium', 'Complex']:
                complexity_dist[c] = int((df['Complexity'] == c).sum())
        return jsonify({
            'project_name': PROJECT_NAME,
            'total_services': int(total_services),
            'total_working_days': total_wd,
            'total_dev_mds': total_dev_md,
            'total_all_mds': total_all_md,
            'complexity_distribution': complexity_dist,
            'budget_sar': 10257885.00,
            'revenue_sar': 20150344.00,
            'profit_sar': 9892459.00,
            'profit_pct': 49,
            'progress_pct': 0,
            'support_start': '2027-05-18',
            'support_end': '2028-05-17',
        })
    except Exception as e:
        logger.error(f"Overview error: {e}\n{traceback.format_exc()}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/services')
def api_services():
    try:
        return jsonify(load_services())
    except Exception as e:
        logger.error(f"Services error: {e}\n{traceback.format_exc()}")
        return jsonify([]), 500

@app.route('/api/timesheets')
def api_timesheets():
    try:
        days = int(request.args.get('days', 30))
        ts = odoo.get_timesheets(days=days)
        if ts is None:
            return jsonify({
                'connected': False,
                'message': 'Demo data (Odoo not configured or unreachable). Set ODOO_USERNAME/ODOO_PASSWORD.',
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
    except Exception as e:
        logger.error(f"Timesheets error: {e}\n{traceback.format_exc()}")
        return jsonify({'connected': False, 'message': f'Error: {e}', 'data': get_demo_timesheets()})

@app.route('/api/timesheets/analysis')
def api_timesheets_analysis():
    try:
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
            return jsonify({'by_employee': [], 'by_date': [], 'total_hours': 0,
                          'total_entries': 0, 'unique_employees': 0})
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
    except Exception as e:
        logger.error(f"Analysis error: {e}\n{traceback.format_exc()}")
        return jsonify({'by_employee': [], 'by_date': [], 'total_hours': 0,
                      'total_entries': 0, 'unique_employees': 0})

@app.route('/api/budget')
def api_budget():
    return jsonify({
        'project_name': PROJECT_NAME,
        'pm': 'Abdelrahman Doghish',
        'contract_type': 'FS',
        'support_start': '2027-05-18',
        'support_end': '2028-05-17',
        'progress': 0,
        'total_mandays': 6556,
        'approved': {'cost_usd': 2735436.00, 'cost_sar': 10257885.00, 'revenue_sar': 20570344.00,
                    'profit_sar': 10312459.00, 'profit_pct': 50},
        'final': {'cost_sar': 10257885.00, 'revenue_sar': 20150344.00, 'profit_sar': 9892459.00, 'profit_pct': 49},
        'changes': [{'reason': 'Third party license', 'plan_id': '', 'changes_cost': 0, 'changes_revenue': -420000.00}],
        'total_change_cost': 0,
        'total_change_revenue': -420000.00
    })

@app.route('/health')
def health():
    return jsonify({
        'status': 'ok',
        'time': datetime.now().isoformat(),
        'data_file_exists': os.path.exists(DATA_FILE),
        'services_loaded': len(load_services()),
        'odoo_configured': bool(ODOO_USERNAME and ODOO_PASSWORD)
    })

@app.route('/debug')
def debug():
    """Diagnostic endpoint — visit /debug on your Railway URL to see what's wrong"""
    templates_dir = os.path.join(BASE_DIR, 'templates')
    static_dir = os.path.join(BASE_DIR, 'static')
    info = {
        'cwd': os.getcwd(),
        'base_dir': BASE_DIR,
        'data_file': DATA_FILE,
        'data_file_exists': os.path.exists(DATA_FILE),
        'base_dir_listing': sorted(os.listdir(BASE_DIR)) if os.path.exists(BASE_DIR) else 'missing',
        'data_dir_listing': sorted(os.listdir(os.path.join(BASE_DIR, 'data'))) if os.path.exists(os.path.join(BASE_DIR, 'data')) else 'data/ not found',
        'templates_dir_exists': os.path.exists(templates_dir),
        'templates_dir_listing': sorted(os.listdir(templates_dir)) if os.path.exists(templates_dir) else 'NOT FOUND',
        'index_html_exists': os.path.exists(os.path.join(templates_dir, 'index.html')),
        'static_dir_exists': os.path.exists(static_dir),
        'static_dir_listing': sorted(os.listdir(static_dir)) if os.path.exists(static_dir) else 'NOT FOUND',
        'flask_template_folder': app.template_folder,
        'flask_static_folder': app.static_folder,
        'env_vars_set': {
            'ODOO_URL': bool(os.environ.get('ODOO_URL')),
            'ODOO_DB': bool(os.environ.get('ODOO_DB')),
            'ODOO_USERNAME': bool(os.environ.get('ODOO_USERNAME')),
            'ODOO_PASSWORD': bool(os.environ.get('ODOO_PASSWORD')),
            'PORT': os.environ.get('PORT', 'not set'),
        },
        'python_version': sys.version,
    }
    try:
        services = load_services()
        info['services_count'] = len(services)
    except Exception as e:
        info['services_error'] = str(e)
        info['services_traceback'] = traceback.format_exc()
    return jsonify(info)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    logger.info(f"Starting Flask on 0.0.0.0:{port}")
    app.run(host='0.0.0.0', port=port, debug=False)
