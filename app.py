"""
BOG Digital Transformation - PMO Dashboard v2
Light theme + drill-down timesheets + missing hours + roadmap
"""
from flask import Flask, render_template, jsonify, request
import pandas as pd
import os
import sys
import xmlrpc.client
import traceback
from datetime import datetime, timedelta, date
import logging
from roadmap_data import ROADMAP, MILESTONES, PROJECT_INFO

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', stream=sys.stdout)
logger = logging.getLogger(__name__)

# Configuration
ODOO_URL = os.environ.get('ODOO_URL', 'https://erp.envnt.co')
ODOO_DB = os.environ.get('ODOO_DB', 'envnt')
ODOO_USERNAME = os.environ.get('ODOO_USERNAME', '')
ODOO_PASSWORD = os.environ.get('ODOO_PASSWORD', '')
PROJECT_NAME = os.environ.get('PROJECT_NAME', 'BOG Digital Transformation')

# Working hours config
WORK_HOURS_PER_DAY = 8
WEEKEND_DAYS = [4, 5]  # Friday=4, Saturday=5 in Python's weekday() (Mon=0)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, 'data', 'services.xlsx')

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, 'templates'),
    static_folder=os.path.join(BASE_DIR, 'static')
)

logger.info(f"Starting v2 — BASE_DIR={BASE_DIR}")
logger.info(f"DATA_FILE exists: {os.path.exists(DATA_FILE)}")


# ============================================================
# ODOO CLIENT
# ============================================================
class OdooClient:
    def __init__(self):
        self.uid = None
        self.models = None

    def connect(self):
        if not ODOO_USERNAME or not ODOO_PASSWORD:
            return False
        try:
            common = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/common')
            self.uid = common.authenticate(ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD, {})
            if self.uid:
                self.models = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/object')
                return True
            return False
        except Exception as e:
            logger.error(f"Odoo connect: {e}")
            return False

    def get_timesheets(self, project_name=PROJECT_NAME, date_from=None, date_to=None):
        if not self.uid and not self.connect():
            return None
        try:
            domain = [('project_id.name', 'ilike', project_name)]
            if date_from:
                domain.append(('date', '>=', date_from))
            if date_to:
                domain.append(('date', '<=', date_to))
            return self.models.execute_kw(
                ODOO_DB, self.uid, ODOO_PASSWORD,
                'account.analytic.line', 'search_read', [domain],
                {'fields': ['date', 'employee_id', 'project_id', 'task_id', 'name', 'unit_amount'], 'limit': 5000}
            )
        except Exception as e:
            logger.error(f"Odoo timesheets: {e}")
            return None

    def get_employees(self, project_name=PROJECT_NAME):
        """Get employees who logged time on this project"""
        ts = self.get_timesheets(project_name)
        if ts is None:
            return None
        seen = {}
        for entry in ts:
            emp = entry.get('employee_id')
            if emp:
                emp_id, emp_name = emp[0], emp[1]
                if emp_id not in seen:
                    seen[emp_id] = {'id': emp_id, 'name': emp_name, 'first_entry': entry.get('date')}
                else:
                    if entry.get('date') < seen[emp_id]['first_entry']:
                        seen[emp_id]['first_entry'] = entry.get('date')
        return list(seen.values())

odoo = OdooClient()

# ============================================================
# DATA LOADERS
# ============================================================
_services_cache = None

def load_services():
    global _services_cache
    if _services_cache is not None:
        return _services_cache
    try:
        if not os.path.exists(DATA_FILE):
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
        return services
    except Exception as e:
        logger.error(f"load_services: {e}")
        return []

def get_demo_timesheets():
    """Demo timesheet data — varies by employee with task details"""
    return [
        # Ahmed Hassan - Dev
        {'date': '2026-04-26', 'employee': 'Ahmed Hassan', 'task': 'API Development - User Auth', 'description': 'JWT authentication setup', 'hours': 7.5, 'service': 'إدارة الصلاحيات'},
        {'date': '2026-04-27', 'employee': 'Ahmed Hassan', 'task': 'API Development - User Auth', 'description': 'Token refresh logic', 'hours': 8.0, 'service': 'إدارة الصلاحيات'},
        {'date': '2026-04-28', 'employee': 'Ahmed Hassan', 'task': 'Database Schema Design', 'description': 'Cases table design', 'hours': 6.0, 'service': 'قيد دعوى إدارية'},
        {'date': '2026-04-29', 'employee': 'Ahmed Hassan', 'task': 'Database Schema Design', 'description': '', 'hours': 8.0, 'service': 'قيد دعوى إدارية'},
        {'date': '2026-04-30', 'employee': 'Ahmed Hassan', 'task': 'Code Review', 'description': '', 'hours': 5.0, 'service': ''},
        {'date': '2026-05-03', 'employee': 'Ahmed Hassan', 'task': 'Bug fixing', 'description': '', 'hours': 6.5, 'service': 'إدارة الصلاحيات'},
        # Mariam Elmasry - PM
        {'date': '2026-04-26', 'employee': 'Mariam Elmasry', 'task': 'PM Review & Planning', 'description': '', 'hours': 6.0, 'service': ''},
        {'date': '2026-04-27', 'employee': 'Mariam Elmasry', 'task': 'Stakeholder Meeting', 'description': 'Client sync', 'hours': 4.5, 'service': ''},
        {'date': '2026-04-28', 'employee': 'Mariam Elmasry', 'task': 'Sprint Planning', 'description': '', 'hours': 5.5, 'service': ''},
        {'date': '2026-04-29', 'employee': 'Mariam Elmasry', 'task': 'Documentation', 'description': '', 'hours': 7.0, 'service': ''},
        {'date': '2026-04-30', 'employee': 'Mariam Elmasry', 'task': 'Sprint Review', 'description': '', 'hours': 4.0, 'service': ''},
        # Sara Ali - UI/UX
        {'date': '2026-04-27', 'employee': 'Sara Ali', 'task': 'UI/UX - Dashboard Mockups', 'description': '', 'hours': 7.0, 'service': 'الفهارس العامة'},
        {'date': '2026-04-28', 'employee': 'Sara Ali', 'task': 'Wireframes - Case Management', 'description': '', 'hours': 7.5, 'service': 'قيد دعوى إدارية'},
        {'date': '2026-04-29', 'employee': 'Sara Ali', 'task': 'Wireframes - Case Management', 'description': '', 'hours': 8.0, 'service': 'قيد دعوى إدارية'},
        {'date': '2026-04-30', 'employee': 'Sara Ali', 'task': 'Design Review', 'description': '', 'hours': 6.0, 'service': ''},
        # Omar Khaled - Frontend
        {'date': '2026-04-28', 'employee': 'Omar Khaled', 'task': 'Frontend Components', 'description': 'Login form', 'hours': 8.0, 'service': 'تسجيل الدخول'},
        {'date': '2026-04-29', 'employee': 'Omar Khaled', 'task': 'Frontend Components', 'description': 'Dashboard layout', 'hours': 7.5, 'service': 'الفهارس العامة'},
        {'date': '2026-04-30', 'employee': 'Omar Khaled', 'task': 'Integration Testing', 'description': '', 'hours': 6.0, 'service': ''},
        {'date': '2026-05-02', 'employee': 'Omar Khaled', 'task': 'Bug fixing', 'description': 'Auth flow bugs', 'hours': 7.0, 'service': 'إدارة الصلاحيات'},
    ]

def normalize_timesheets(odoo_data):
    """Convert Odoo response to flat list"""
    result = []
    for entry in odoo_data:
        result.append({
            'date': entry.get('date'),
            'employee': entry.get('employee_id', [None, 'Unknown'])[1] if entry.get('employee_id') else 'Unknown',
            'project': entry.get('project_id', [None, ''])[1] if entry.get('project_id') else '',
            'task': entry.get('task_id', [None, ''])[1] if entry.get('task_id') else (entry.get('name') or ''),
            'description': entry.get('name', ''),
            'hours': entry.get('unit_amount', 0),
            'service': '',
        })
    return result

def is_working_day(d):
    """Check if date is a working day (not Friday/Saturday)"""
    if isinstance(d, str):
        d = datetime.strptime(d, '%Y-%m-%d').date()
    return d.weekday() not in WEEKEND_DAYS

def get_working_days_between(start_date, end_date):
    """Count working days between two dates (inclusive)"""
    if isinstance(start_date, str):
        start_date = datetime.strptime(start_date, '%Y-%m-%d').date()
    if isinstance(end_date, str):
        end_date = datetime.strptime(end_date, '%Y-%m-%d').date()
    days = []
    current = start_date
    while current <= end_date:
        if is_working_day(current):
            days.append(current.isoformat())
        current += timedelta(days=1)
    return days

# ============================================================
# ROUTES
# ============================================================
@app.errorhandler(Exception)
def handle_error(e):
    logger.error(f"Error: {e}\n{traceback.format_exc()}")
    return jsonify({'error': str(e)}), 500

@app.route('/')
def index():
    return render_template('index.html', project_name=PROJECT_NAME)

@app.route('/api/overview')
def api_overview():
    services = load_services()
    df = pd.DataFrame(services) if services else pd.DataFrame()
    total_wd = float(df['WD'].sum()) if 'WD' in df.columns and not df.empty else 0
    total_dev = float(df['Dev MDs'].sum()) if 'Dev MDs' in df.columns and not df.empty else 0
    total_all = float(df['ALL'].sum()) if 'ALL' in df.columns and not df.empty else 0
    complexity_dist = {}
    if 'Complexity' in df.columns and not df.empty:
        for c in ['Basic', 'Simple', 'Medium', 'Complex']:
            complexity_dist[c] = int((df['Complexity'] == c).sum())

    return jsonify({
        'project_name': PROJECT_NAME,
        'project_full_name': PROJECT_INFO['name'],
        'phase': PROJECT_INFO['phase'],
        'roadmap_start': PROJECT_INFO['start_date'],
        'roadmap_end': PROJECT_INFO['end_date'],
        'roadmap_services': PROJECT_INFO['total_services'],
        'roadmap_teams': PROJECT_INFO['teams_count'],
        'roadmap_months': PROJECT_INFO['duration_months'],
        'total_services': len(df),
        'total_working_days': total_wd,
        'total_dev_mds': total_dev,
        'total_all_mds': total_all,
        'complexity_distribution': complexity_dist,
        'budget_sar': 10257885.00,
        'revenue_sar': 20150344.00,
        'profit_sar': 9892459.00,
        'profit_pct': 49,
        'progress_pct': 0,
    })

@app.route('/api/services')
def api_services():
    """Services with assignation column added (from roadmap)"""
    services = load_services()
    # Build name -> roadmap entry
    roadmap_by_name = {item['name']: item for item in ROADMAP}
    result = []
    for s in services:
        name = s.get('اسم الخدمة المستقبلي', '')
        # Try fuzzy match
        rm = roadmap_by_name.get(name)
        if not rm:
            for rm_name, rm_data in roadmap_by_name.items():
                if name and (name in rm_name or rm_name in name):
                    rm = rm_data
                    break
        s['assignation_team'] = rm['team'] if rm else None
        s['assignation_ba'] = None  # to be filled later from WBD
        s['assignation_dev'] = None
        s['planned_start'] = rm['start'] if rm else None
        s['planned_end'] = rm['end'] if rm else None
        s['planned_wd'] = rm['wd'] if rm else None
        result.append(s)
    return jsonify(result)

@app.route('/api/timesheets/employees')
def api_timesheets_by_employee():
    """View 1: Aggregated by employee — total hours per person"""
    date_from = request.args.get('from')
    date_to = request.args.get('to')

    ts = odoo.get_timesheets(date_from=date_from, date_to=date_to)
    if ts is None:
        connected = False
        data = get_demo_timesheets()
        if date_from:
            data = [d for d in data if d['date'] >= date_from]
        if date_to:
            data = [d for d in data if d['date'] <= date_to]
    else:
        connected = True
        data = normalize_timesheets(ts)

    df = pd.DataFrame(data) if data else pd.DataFrame()
    if df.empty:
        return jsonify({'connected': connected, 'employees': [], 'total_hours': 0})

    by_emp = df.groupby('employee').agg(
        total_hours=('hours', 'sum'),
        days_logged=('date', 'nunique'),
        entries=('hours', 'count')
    ).reset_index()
    by_emp = by_emp.sort_values('total_hours', ascending=False)

    employees = []
    for _, row in by_emp.iterrows():
        employees.append({
            'name': row['employee'],
            'total_hours': float(row['total_hours']),
            'days_logged': int(row['days_logged']),
            'entries': int(row['entries']),
            'avg_per_day': float(row['total_hours'] / row['days_logged']) if row['days_logged'] else 0
        })

    return jsonify({
        'connected': connected,
        'employees': employees,
        'total_hours': float(df['hours'].sum()),
        'date_from': date_from,
        'date_to': date_to,
    })

@app.route('/api/timesheets/employee/<name>')
def api_employee_detail(name):
    """View 2: Drill-down — specific employee's days and tasks"""
    date_from = request.args.get('from')
    date_to = request.args.get('to')

    ts = odoo.get_timesheets(date_from=date_from, date_to=date_to)
    if ts is None:
        data = get_demo_timesheets()
    else:
        data = normalize_timesheets(ts)

    if date_from:
        data = [d for d in data if d.get('date', '') >= date_from]
    if date_to:
        data = [d for d in data if d.get('date', '') <= date_to]

    employee_data = [d for d in data if d.get('employee') == name]
    employee_data.sort(key=lambda x: x.get('date', ''), reverse=True)

    # Group by date
    by_date = {}
    for entry in employee_data:
        d = entry.get('date')
        if d not in by_date:
            by_date[d] = {'date': d, 'total_hours': 0, 'tasks': []}
        by_date[d]['total_hours'] += entry.get('hours', 0)
        by_date[d]['tasks'].append({
            'task': entry.get('task'),
            'description': entry.get('description'),
            'hours': entry.get('hours'),
            'service': entry.get('service', ''),
        })
    days = sorted(by_date.values(), key=lambda x: x['date'], reverse=True)

    total = sum(e.get('hours', 0) for e in employee_data)

    return jsonify({
        'employee': name,
        'total_hours': total,
        'total_days': len(by_date),
        'days': days,
    })

@app.route('/api/missing-hours')
def api_missing_hours():
    """View 3: Missing hours per employee — based on first entry date"""
    date_to = request.args.get('to') or date.today().isoformat()

    ts = odoo.get_timesheets()
    if ts is None:
        data = get_demo_timesheets()
        connected = False
    else:
        data = normalize_timesheets(ts)
        connected = True

    if not data:
        return jsonify({'connected': connected, 'employees': []})

    # Per-employee analysis
    df = pd.DataFrame(data)
    today_str = date_to

    employees_summary = []
    for emp_name in df['employee'].unique():
        emp_df = df[df['employee'] == emp_name]
        # First entry date = when employee started
        first_date = emp_df['date'].min()
        # Days they logged
        logged_dates = set(emp_df['date'].unique())
        # Total hours per logged day
        hours_by_date = emp_df.groupby('date')['hours'].sum().to_dict()

        # Expected working days from first_date to today
        expected_days = get_working_days_between(first_date, today_str)
        expected_hours = len(expected_days) * WORK_HOURS_PER_DAY

        # Logged hours
        logged_hours = sum(hours_by_date.values())
        actual_logged_days = len([d for d in expected_days if d in logged_dates])

        # Missing days = working days that are not logged
        missing_days = [d for d in expected_days if d not in logged_dates]
        # Underlogged days = days where hours < 8
        under_logged = [{'date': d, 'hours': hours_by_date[d]}
                        for d in expected_days if d in logged_dates and hours_by_date[d] < WORK_HOURS_PER_DAY]

        missing_hours = expected_hours - logged_hours

        employees_summary.append({
            'name': emp_name,
            'first_entry': first_date,
            'expected_days': len(expected_days),
            'logged_days': actual_logged_days,
            'missing_days_count': len(missing_days),
            'expected_hours': expected_hours,
            'logged_hours': float(logged_hours),
            'missing_hours': float(missing_hours),
            'completion_pct': float(logged_hours / expected_hours * 100) if expected_hours else 0,
            'missing_dates': missing_days[:30],
            'underlogged_dates': under_logged[:30],
        })

    employees_summary.sort(key=lambda x: x['missing_hours'], reverse=True)

    return jsonify({
        'connected': connected,
        'as_of_date': today_str,
        'work_hours_per_day': WORK_HOURS_PER_DAY,
        'weekend_days': ['Friday', 'Saturday'],
        'employees': employees_summary,
    })

@app.route('/api/roadmap')
def api_roadmap():
    """Roadmap timeline + milestones from PPT"""
    # Per-team breakdown
    team1 = [s for s in ROADMAP if s['team'] == 'الفريق 1']
    team2 = [s for s in ROADMAP if s['team'] == 'الفريق 2']
    admin = [s for s in ROADMAP if s['team'] == 'الإدارة']

    return jsonify({
        'project_info': PROJECT_INFO,
        'milestones': MILESTONES,
        'services': ROADMAP,
        'team_breakdown': {
            'team_1': {'name': 'الفريق الأول', 'count': len(team1), 'total_wd': sum(s.get('wd') or 0 for s in team1)},
            'team_2': {'name': 'الفريق الثاني', 'count': len(team2), 'total_wd': sum(s.get('wd') or 0 for s in team2)},
            'admin': {'name': 'نقل البيانات', 'count': len(admin)},
        }
    })

@app.route('/api/budget')
def api_budget():
    return jsonify({
        'project_name': PROJECT_NAME,
        'pm': 'Abdelrahman Doghish',
        'contract_type': 'FS',
        'support_start': '2027-05-18',
        'support_end': '2028-05-17',
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
    return jsonify({'status': 'ok', 'time': datetime.now().isoformat()})

@app.route('/debug')
def debug():
    return jsonify({
        'base_dir': BASE_DIR,
        'data_file_exists': os.path.exists(DATA_FILE),
        'templates_dir_listing': sorted(os.listdir(os.path.join(BASE_DIR, 'templates'))) if os.path.exists(os.path.join(BASE_DIR, 'templates')) else 'NOT FOUND',
        'static_dir_listing': sorted(os.listdir(os.path.join(BASE_DIR, 'static'))) if os.path.exists(os.path.join(BASE_DIR, 'static')) else 'NOT FOUND',
        'env_set': {k: bool(os.environ.get(k)) for k in ['ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_PASSWORD']},
        'roadmap_count': len(ROADMAP),
        'milestones_count': len(MILESTONES),
    })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
