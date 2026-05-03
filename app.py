"""
BOG Digital Transformation - PMO Dashboard v3
Modular templates + service mapping + filters
"""
from flask import Flask, render_template, jsonify, request, Response
import pandas as pd
import os
import sys
import xmlrpc.client
import traceback
import csv
import io
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

WORK_HOURS_PER_DAY = 8
WEEKEND_DAYS = [4, 5]  # Friday, Saturday

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, 'data', 'services.xlsx')

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, 'templates'),
    static_folder=os.path.join(BASE_DIR, 'static')
)


# ============================================================
# ODOO CLIENT
# ============================================================
class OdooClient:
    def __init__(self):
        self.uid = None
        self.models = None
        self.last_error = None

    def connect(self):
        if not ODOO_USERNAME or not ODOO_PASSWORD:
            self.last_error = "Credentials not set"
            return False
        try:
            common = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/common')
            self.uid = common.authenticate(ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD, {})
            if self.uid:
                self.models = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/object')
                logger.info(f"Odoo connected: uid={self.uid}")
                self.last_error = None
                return True
            self.last_error = "Authentication failed"
            return False
        except Exception as e:
            self.last_error = f"{type(e).__name__}: {str(e)}"
            logger.error(f"Odoo connect: {e}")
            return False

    def get_timesheets(self, project_name=PROJECT_NAME, date_from=None, date_to=None,
                       service_filter=None, all_projects=False):
        """Get timesheets. If all_projects=True, fetch all (for cross-project missing hours check)."""
        # Always re-attempt connection if not connected
        if not self.uid:
            if not self.connect():
                return None
        try:
            domain = []
            if not all_projects and project_name:
                domain.append(('project_id.name', 'ilike', project_name))
            if date_from:
                domain.append(('date', '>=', date_from))
            if date_to:
                domain.append(('date', '<=', date_to))
            result = self.models.execute_kw(
                ODOO_DB, self.uid, ODOO_PASSWORD,
                'account.analytic.line', 'search_read', [domain],
                {'fields': ['date', 'employee_id', 'project_id', 'task_id',
                            'parent_task_id', 'name', 'unit_amount'], 'limit': 5000}
            )
            logger.info(f"Odoo timesheets fetched: {len(result)} entries (filter: {domain})")
            return result
        except Exception as e:
            self.last_error = f"{type(e).__name__}: {str(e)}"
            logger.error(f"Odoo timesheets: {e}")
            # Reset connection on error
            self.uid = None
            self.models = None
            return None

odoo = OdooClient()

# ============================================================
# SERVICE MAPPING
# ============================================================
DEPT_COLUMNS = ['Dev MDs', 'Analysis MD', 'UI/UX', 'QC', 'UAT', 'PM']
DEPT_LABELS = {'Dev MDs': 'Dev', 'Analysis MD': 'Analysis', 'UI/UX': 'UI/UX',
               'QC': 'QC', 'UAT': 'UAT', 'PM': 'PM'}

_services_cache = None

def load_services():
    """Load services from Excel and merge with roadmap data"""
    global _services_cache
    if _services_cache is not None:
        return _services_cache
    try:
        if not os.path.exists(DATA_FILE):
            _services_cache = []
            return _services_cache
        df = pd.read_excel(DATA_FILE)
        services = []

        # Map roadmap by name (fuzzy)
        roadmap_by_name = {item['name']: item for item in ROADMAP}

        for record in df.to_dict(orient='records'):
            clean = {}
            for k, v in record.items():
                if pd.isna(v):
                    clean[k] = None
                elif isinstance(v, (pd.Timestamp, datetime)):
                    clean[k] = v.isoformat()
                else:
                    clean[k] = v

            # Map roadmap
            name = clean.get('اسم الخدمة المستقبلي', '') or ''
            rm = roadmap_by_name.get(name)
            if not rm and name:
                for rm_name, rm_data in roadmap_by_name.items():
                    if name in rm_name or (rm_name in name and len(rm_name) > 4):
                        rm = rm_data
                        break

            clean['planned_team'] = rm['team'] if rm else None
            clean['planned_start'] = rm['start'] if rm else None
            clean['planned_end'] = rm['end'] if rm else None
            clean['planned_wd_roadmap'] = rm['wd'] if rm else None

            # Department-wise baseline (from presales)
            baseline_by_dept = {}
            for col in DEPT_COLUMNS:
                val = clean.get(col)
                if val is not None and not (isinstance(val, float) and pd.isna(val)):
                    try:
                        baseline_by_dept[DEPT_LABELS[col]] = float(val)
                    except (ValueError, TypeError):
                        pass  # skip non-numeric values like "Total"
            clean['baseline_by_dept'] = baseline_by_dept

            # Placeholder for planned/actual/assignation (to be filled from Odoo or WBD)
            clean['planned_by_dept'] = {k: None for k in DEPT_LABELS.values()}
            clean['actuals_hours'] = 0  # will be computed dynamically
            clean['actuals_days'] = 0
            clean['remaining_baseline'] = clean.get('ALL') or 0
            clean['status'] = 'Not Started'  # auto, but overridable
            clean['status_manual'] = None  # if PM overrides
            clean['expected_end'] = None  # computed: today + remaining/8

            services.append(clean)

        _services_cache = services
        return services
    except Exception as e:
        logger.error(f"load_services: {e}\n{traceback.format_exc()}")
        return []

def normalize_timesheet(entry):
    """Convert Odoo timesheet entry to flat dict.
    Uses parent_task_id when available — that's the SERVICE the task belongs to."""
    project = entry.get('project_id', [None, ''])
    task = entry.get('task_id', [None, ''])
    parent = entry.get('parent_task_id', [None, ''])

    # SERVICE = parent task name (if exists), else task name
    service_name = parent[1] if (parent and parent[1]) else (task[1] if task and task[1] else '')

    return {
        'date': entry.get('date'),
        'employee': entry.get('employee_id', [None, 'Unknown'])[1] if entry.get('employee_id') else 'Unknown',
        'project': project[1] if project else '',
        'task': task[1] if task and task[1] else (entry.get('name') or ''),
        'service': service_name,  # this is what we group actuals by
        'description': entry.get('name', ''),
        'hours': float(entry.get('unit_amount', 0)),
    }

def get_demo_timesheets():
    """Demo data with parent service grouping"""
    return [
        # Service: إدارة الصلاحيات
        {'date': '2026-04-26', 'employee': 'Ahmed Hassan', 'project': PROJECT_NAME, 'task': 'JWT Setup', 'service': 'إدارة الصلاحيات', 'description': 'Auth flow', 'hours': 7.5},
        {'date': '2026-04-27', 'employee': 'Ahmed Hassan', 'project': PROJECT_NAME, 'task': 'Token refresh', 'service': 'إدارة الصلاحيات', 'description': '', 'hours': 8.0},
        {'date': '2026-05-03', 'employee': 'Ahmed Hassan', 'project': PROJECT_NAME, 'task': 'Bug fix', 'service': 'إدارة الصلاحيات', 'description': '', 'hours': 6.5},
        {'date': '2026-05-02', 'employee': 'Omar Khaled', 'project': PROJECT_NAME, 'task': 'Frontend auth', 'service': 'إدارة الصلاحيات', 'description': '', 'hours': 7.0},
        # Service: قيد دعوى إدارية
        {'date': '2026-04-28', 'employee': 'Ahmed Hassan', 'project': PROJECT_NAME, 'task': 'Cases schema', 'service': 'قيد دعوى إدارية', 'description': '', 'hours': 6.0},
        {'date': '2026-04-29', 'employee': 'Ahmed Hassan', 'project': PROJECT_NAME, 'task': 'Cases schema', 'service': 'قيد دعوى إدارية', 'description': '', 'hours': 8.0},
        {'date': '2026-04-28', 'employee': 'Sara Ali', 'project': PROJECT_NAME, 'task': 'Wireframes', 'service': 'قيد دعوى إدارية', 'description': '', 'hours': 7.5},
        {'date': '2026-04-29', 'employee': 'Sara Ali', 'project': PROJECT_NAME, 'task': 'Wireframes', 'service': 'قيد دعوى إدارية', 'description': '', 'hours': 8.0},
        # Service: الفهارس العامة
        {'date': '2026-04-27', 'employee': 'Sara Ali', 'project': PROJECT_NAME, 'task': 'Dashboard mockups', 'service': 'الفهارس العامة', 'description': '', 'hours': 7.0},
        {'date': '2026-04-29', 'employee': 'Omar Khaled', 'project': PROJECT_NAME, 'task': 'Dashboard layout', 'service': 'الفهارس العامة', 'description': '', 'hours': 7.5},
        # Service: تسجيل الدخول
        {'date': '2026-04-28', 'employee': 'Omar Khaled', 'project': PROJECT_NAME, 'task': 'Login form', 'service': 'تسجيل الدخول', 'description': '', 'hours': 8.0},
        # PM activities (no service)
        {'date': '2026-04-26', 'employee': 'Mariam Elmasry', 'project': PROJECT_NAME, 'task': 'PM Review', 'service': '', 'description': '', 'hours': 6.0},
        {'date': '2026-04-27', 'employee': 'Mariam Elmasry', 'project': PROJECT_NAME, 'task': 'Stakeholder Meeting', 'service': '', 'description': '', 'hours': 4.5},
        {'date': '2026-04-28', 'employee': 'Mariam Elmasry', 'project': PROJECT_NAME, 'task': 'Sprint Planning', 'service': '', 'description': '', 'hours': 5.5},
        {'date': '2026-04-29', 'employee': 'Mariam Elmasry', 'project': PROJECT_NAME, 'task': 'Documentation', 'service': '', 'description': '', 'hours': 7.0},
        {'date': '2026-04-30', 'employee': 'Mariam Elmasry', 'project': PROJECT_NAME, 'task': 'Sprint Review', 'service': '', 'description': '', 'hours': 4.0},
        # Cross-project entry — Mariam logged on another project (won't count as missing)
        {'date': '2026-05-03', 'employee': 'Mariam Elmasry', 'project': 'Other Project X', 'task': 'External work', 'service': '', 'description': '', 'hours': 8.0},
        {'date': '2026-05-04', 'employee': 'Omar Khaled', 'project': 'Other Project X', 'task': 'External', 'service': '', 'description': '', 'hours': 8.0},
    ]

def get_all_timesheets(date_from=None, date_to=None, all_projects=False):
    """Unified getter — Odoo if available, else demo"""
    ts = odoo.get_timesheets(date_from=date_from, date_to=date_to, all_projects=all_projects)
    if ts is None:
        data = get_demo_timesheets()
        if not all_projects:
            data = [d for d in data if d['project'] == PROJECT_NAME]
        if date_from:
            data = [d for d in data if d.get('date', '') >= date_from]
        if date_to:
            data = [d for d in data if d.get('date', '') <= date_to]
        return data, False
    return [normalize_timesheet(e) for e in ts], True

def is_working_day(d):
    if isinstance(d, str):
        d = datetime.strptime(d, '%Y-%m-%d').date()
    return d.weekday() not in WEEKEND_DAYS

def get_working_days_between(start_date, end_date):
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
    total_all = float(df['ALL'].sum()) if 'ALL' in df.columns and not df.empty else 0
    complexity_dist = {}
    if 'Complexity' in df.columns and not df.empty:
        for c in ['Basic', 'Simple', 'Medium', 'Complex']:
            complexity_dist[c] = int((df['Complexity'] == c).sum())
    return jsonify({
        'project_name': PROJECT_NAME,
        'phase': PROJECT_INFO['phase'],
        'roadmap_start': PROJECT_INFO['start_date'],
        'roadmap_end': PROJECT_INFO['end_date'],
        'total_services': len(df),
        'total_working_days': total_wd,
        'total_all_mds': total_all,
        'complexity_distribution': complexity_dist,
        'budget_sar': 10257885.00,
        'profit_sar': 9892459.00,
        'profit_pct': 49,
        'progress_pct': 0,
    })

@app.route('/api/services')
def api_services():
    """Services with full mapping: baseline / planned / actuals / status"""
    services = load_services()

    # Compute actuals from Odoo timesheets grouped by service (parent_task)
    data, _ = get_all_timesheets()
    actuals_by_service = {}
    for entry in data:
        s = entry.get('service', '')
        if not s:
            continue
        if s not in actuals_by_service:
            actuals_by_service[s] = {'hours': 0, 'employees': set()}
        actuals_by_service[s]['hours'] += entry.get('hours', 0)
        actuals_by_service[s]['employees'].add(entry.get('employee'))

    today = date.today().isoformat()

    result = []
    for s in services:
        name = s.get('اسم الخدمة المستقبلي', '') or ''
        # Match service name to actuals (exact or fuzzy)
        actual_entry = actuals_by_service.get(name)
        if not actual_entry and name:
            for k, v in actuals_by_service.items():
                if k and (name in k or k in name):
                    actual_entry = v
                    break

        actual_hours = actual_entry['hours'] if actual_entry else 0
        actual_days = round(actual_hours / WORK_HOURS_PER_DAY, 1)
        s['actuals_hours'] = actual_hours
        s['actuals_days'] = actual_days

        # Baseline total in days
        baseline_total = 0
        try:
            baseline_total = float(s.get('ALL') or 0)
        except (ValueError, TypeError):
            baseline_total = 0
        remaining = max(0, baseline_total - actual_days)
        s['remaining_baseline'] = remaining

        # Auto status
        if s.get('status_manual'):
            s['status'] = s['status_manual']
        else:
            planned_start = s.get('planned_start')
            planned_end = s.get('planned_end')
            if remaining == 0 and actual_days > 0:
                s['status'] = 'Done'
            elif planned_start and planned_start <= today and (not planned_end or planned_end >= today):
                s['status'] = 'In Progress'
            elif planned_end and planned_end < today and remaining > 0:
                s['status'] = 'Overdue'
            elif planned_start and planned_start > today:
                s['status'] = 'Not Started'
            elif actual_days > 0 and remaining > 0:
                s['status'] = 'In Progress'
            else:
                s['status'] = 'Not Started'

        # Expected end = today + remaining/8 (skipping weekends)
        if remaining > 0:
            try:
                d = date.today()
                days_left = int(remaining)
                while days_left > 0:
                    d = d + timedelta(days=1)
                    if d.weekday() not in WEEKEND_DAYS:
                        days_left -= 1
                s['expected_end'] = d.isoformat()
            except Exception:
                s['expected_end'] = None
        else:
            s['expected_end'] = s.get('planned_end')

        result.append(s)

    return jsonify(result)

@app.route('/api/services/projects')
def api_service_projects():
    """List of unique services/parent-tasks for filter dropdown"""
    services = load_services()
    items = []
    for s in services:
        name = s.get('اسم الخدمة المستقبلي', '')
        if name:
            items.append(name)
    return jsonify({'services': sorted(items)})

@app.route('/api/timesheets/employees')
def api_ts_employees():
    """Aggregated by employee with optional service filter"""
    date_from = request.args.get('from')
    date_to = request.args.get('to')
    service = request.args.get('service')

    data, connected = get_all_timesheets(date_from=date_from, date_to=date_to)

    # Filter by service if provided
    if service:
        data = [d for d in data if d.get('service') == service]

    df = pd.DataFrame(data) if data else pd.DataFrame()
    if df.empty:
        return jsonify({'connected': connected, 'employees': [], 'total_hours': 0})

    by_emp = df.groupby('employee').agg(
        total_hours=('hours', 'sum'),
        days_logged=('date', 'nunique'),
        entries=('hours', 'count')
    ).reset_index().sort_values('total_hours', ascending=False)

    return jsonify({
        'connected': connected,
        'service_filter': service,
        'employees': [{
            'name': r['employee'],
            'total_hours': float(r['total_hours']),
            'days_logged': int(r['days_logged']),
            'entries': int(r['entries']),
        } for _, r in by_emp.iterrows()],
        'total_hours': float(df['hours'].sum()),
        'date_from': date_from,
        'date_to': date_to,
    })

@app.route('/api/timesheets/employee/<name>')
def api_ts_employee_detail(name):
    """Drill-down: days only by default, tasks via expand"""
    date_from = request.args.get('from')
    date_to = request.args.get('to')
    service = request.args.get('service')

    data, _ = get_all_timesheets(date_from=date_from, date_to=date_to)
    if service:
        data = [d for d in data if d.get('service') == service]
    data = [d for d in data if d.get('employee') == name]

    by_date = {}
    for entry in data:
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

    return jsonify({
        'employee': name,
        'total_hours': sum(e.get('hours', 0) for e in data),
        'total_days': len(by_date),
        'days': days,
    })

@app.route('/api/timesheets/export')
def api_ts_export():
    """CSV export of timesheets"""
    date_from = request.args.get('from')
    date_to = request.args.get('to')
    service = request.args.get('service')

    data, _ = get_all_timesheets(date_from=date_from, date_to=date_to)
    if service:
        data = [d for d in data if d.get('service') == service]

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['Date', 'Employee', 'Project', 'Service', 'Task', 'Description', 'Hours'])
    for d in data:
        writer.writerow([
            d.get('date', ''), d.get('employee', ''), d.get('project', ''),
            d.get('service', ''), d.get('task', ''), d.get('description', ''),
            d.get('hours', 0)
        ])

    csv_content = output.getvalue()
    output.close()
    filename = f"timesheets_{date.today().isoformat()}.csv"
    # Add UTF-8 BOM for Excel Arabic support
    return Response(
        '\ufeff' + csv_content,
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'}
    )

@app.route('/api/missing-hours')
def api_missing_hours():
    """Missing hours: last 30 days default, skip if logged on other projects"""
    date_to = request.args.get('to') or date.today().isoformat()
    date_from = request.args.get('from')

    if not date_from:
        # Default: 30 days back
        from_date = (date.today() - timedelta(days=30))
        date_from = from_date.isoformat()

    # Get THIS project entries
    project_data, connected = get_all_timesheets(date_from=date_from, date_to=date_to, all_projects=False)
    # Get ALL projects entries (for cross-project check)
    all_data, _ = get_all_timesheets(date_from=date_from, date_to=date_to, all_projects=True)

    if not project_data and not all_data:
        return jsonify({'connected': connected, 'employees': [], 'date_from': date_from, 'date_to': date_to})

    # Hours per employee per date — across ALL projects
    all_hours_by_emp_date = {}  # {emp: {date: hours}}
    for e in all_data:
        emp = e.get('employee')
        d = e.get('date')
        all_hours_by_emp_date.setdefault(emp, {})
        all_hours_by_emp_date[emp][d] = all_hours_by_emp_date[emp].get(d, 0) + e.get('hours', 0)

    # Hours per employee per date — THIS project only
    proj_hours_by_emp_date = {}
    for e in project_data:
        emp = e.get('employee')
        d = e.get('date')
        proj_hours_by_emp_date.setdefault(emp, {})
        proj_hours_by_emp_date[emp][d] = proj_hours_by_emp_date[emp].get(d, 0) + e.get('hours', 0)

    # Working days in range
    working_days = get_working_days_between(date_from, date_to)

    employees_summary = []
    # Only employees who appeared in THIS project at least once
    employees_in_project = set(proj_hours_by_emp_date.keys())

    for emp_name in employees_in_project:
        proj_hours = proj_hours_by_emp_date.get(emp_name, {})
        all_hours = all_hours_by_emp_date.get(emp_name, {})

        missing_dates_detail = []
        underlogged_dates_detail = []
        total_missing = 0

        for d in working_days:
            proj_h = proj_hours.get(d, 0)
            all_h = all_hours.get(d, 0)

            if all_h >= WORK_HOURS_PER_DAY:
                # full day logged somewhere — not missing
                continue
            elif proj_h == 0 and all_h == 0:
                # nothing logged at all
                missing_dates_detail.append({'date': d, 'logged_hrs': 0, 'missing_hrs': WORK_HOURS_PER_DAY,
                                             'reason': 'No entries'})
                total_missing += WORK_HOURS_PER_DAY
            elif all_h < WORK_HOURS_PER_DAY:
                # partial day
                missing = WORK_HOURS_PER_DAY - all_h
                underlogged_dates_detail.append({'date': d, 'logged_hrs': all_h, 'missing_hrs': missing,
                                                 'reason': f'Only {all_h}h logged total'})
                total_missing += missing

        total_logged = sum(proj_hours.values())
        total_logged_all = sum(all_hours.values())
        expected_total = len(working_days) * WORK_HOURS_PER_DAY

        employees_summary.append({
            'name': emp_name,
            'expected_days': len(working_days),
            'logged_days_project': len(proj_hours),
            'logged_days_total': len(all_hours),
            'missing_days_count': len(missing_dates_detail),
            'underlogged_days_count': len(underlogged_dates_detail),
            'logged_hours_project': float(total_logged),
            'logged_hours_total': float(total_logged_all),
            'expected_hours': float(expected_total),
            'missing_hours': float(total_missing),
            'compliance_pct': float((expected_total - total_missing) / expected_total * 100) if expected_total else 100,
            'missing_dates_detail': missing_dates_detail,
            'underlogged_dates_detail': underlogged_dates_detail,
        })

    employees_summary.sort(key=lambda x: x['missing_hours'], reverse=True)

    return jsonify({
        'connected': connected,
        'date_from': date_from,
        'date_to': date_to,
        'work_hours_per_day': WORK_HOURS_PER_DAY,
        'employees': employees_summary,
    })

@app.route('/api/roadmap')
def api_roadmap():
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

@app.route('/debug/timesheets')
def debug_timesheets():
    """Test the actual timesheet fetching path used by the app"""
    date_from = request.args.get('from', (date.today() - timedelta(days=30)).isoformat())
    date_to = request.args.get('to', date.today().isoformat())

    info = {
        'date_from': date_from,
        'date_to': date_to,
        'project_name': PROJECT_NAME,
        'odoo_uid': odoo.uid,
        'odoo_last_error': odoo.last_error,
    }

    # Try fetching
    raw = odoo.get_timesheets(date_from=date_from, date_to=date_to)
    if raw is None:
        info['result'] = 'FAILED — odoo.get_timesheets returned None'
        info['odoo_last_error_after'] = odoo.last_error
    else:
        info['result'] = f'SUCCESS — {len(raw)} entries'
        info['sample_raw'] = raw[:2] if raw else []
        normalized = [normalize_timesheet(e) for e in raw[:3]]
        info['sample_normalized'] = normalized

    # Test with no date filter
    raw_all = odoo.get_timesheets()
    info['no_filter_count'] = len(raw_all) if raw_all is not None else 'FAILED'

    return jsonify(info)


@app.route('/debug')
def debug():
    info = {
        'base_dir': BASE_DIR,
        'data_file_exists': os.path.exists(DATA_FILE),
        'templates': sorted(os.listdir(os.path.join(BASE_DIR, 'templates'))) if os.path.exists(os.path.join(BASE_DIR, 'templates')) else 'NA',
        'partials': sorted(os.listdir(os.path.join(BASE_DIR, 'templates', 'partials'))) if os.path.exists(os.path.join(BASE_DIR, 'templates', 'partials')) else 'NA',
        'env_vars': {
            'ODOO_URL': ODOO_URL,
            'ODOO_DB': ODOO_DB,
            'ODOO_USERNAME_set': bool(ODOO_USERNAME),
            'ODOO_USERNAME_preview': ODOO_USERNAME[:3] + '***' if ODOO_USERNAME else None,
            'ODOO_PASSWORD_set': bool(ODOO_PASSWORD),
            'ODOO_PASSWORD_length': len(ODOO_PASSWORD) if ODOO_PASSWORD else 0,
            'PROJECT_NAME': PROJECT_NAME,
        },
        'odoo_test': {}
    }

    # Test Odoo connection step by step
    try:
        common = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/common')
        version = common.version()
        info['odoo_test']['1_server_reachable'] = True
        info['odoo_test']['2_odoo_version'] = version.get('server_version', 'unknown') if version else 'unknown'
    except Exception as e:
        info['odoo_test']['1_server_reachable'] = False
        info['odoo_test']['error'] = f"Cannot reach {ODOO_URL}: {str(e)}"
        return jsonify(info)

    if not ODOO_USERNAME or not ODOO_PASSWORD:
        info['odoo_test']['3_credentials'] = 'NOT SET — add ODOO_USERNAME and ODOO_PASSWORD in Railway Variables'
        return jsonify(info)

    try:
        common = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/common')
        uid = common.authenticate(ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD, {})
        if uid:
            info['odoo_test']['3_auth'] = f'SUCCESS — uid={uid}'
        else:
            info['odoo_test']['3_auth'] = 'FAILED — check ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD'
            info['odoo_test']['hint'] = 'Most common: wrong ODOO_DB name OR using regular password instead of API key'
            return jsonify(info)
    except Exception as e:
        info['odoo_test']['3_auth'] = f'ERROR — {type(e).__name__}: {str(e)}'
        return jsonify(info)

    # Test fetching timesheets
    try:
        models = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/object')
        # Check if project exists
        projects = models.execute_kw(
            ODOO_DB, uid, ODOO_PASSWORD,
            'project.project', 'search_read',
            [[('name', 'ilike', PROJECT_NAME)]],
            {'fields': ['name', 'id'], 'limit': 5}
        )
        info['odoo_test']['4_project_search'] = {
            'matches_found': len(projects),
            'projects': [{'id': p['id'], 'name': p['name']} for p in projects]
        }

        # Sample timesheets
        ts = models.execute_kw(
            ODOO_DB, uid, ODOO_PASSWORD,
            'account.analytic.line', 'search_read',
            [[('project_id.name', 'ilike', PROJECT_NAME)]],
            {'fields': ['date', 'employee_id', 'project_id'], 'limit': 3}
        )
        info['odoo_test']['5_sample_timesheets'] = {
            'count': len(ts),
            'sample': ts[:2] if ts else []
        }
    except Exception as e:
        info['odoo_test']['4_data_fetch'] = f'ERROR — {type(e).__name__}: {str(e)}'

    return jsonify(info)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
