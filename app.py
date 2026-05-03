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

    def get_phases(self, project_name=PROJECT_NAME):
        """Get list of phases for the project"""
        if not self.uid and not self.connect():
            return None
        try:
            # First find project ID
            projects = self.models.execute_kw(
                ODOO_DB, self.uid, ODOO_PASSWORD,
                'project.project', 'search_read',
                [[('name', 'ilike', project_name)]],
                {'fields': ['id', 'name'], 'limit': 5}
            )
            if not projects:
                return []
            project_ids = [p['id'] for p in projects]

            # Get phases linked to this project
            phases = self.models.execute_kw(
                ODOO_DB, self.uid, ODOO_PASSWORD,
                'project.phase', 'search_read',
                [[('project_id', 'in', project_ids)]],
                {'fields': ['id', 'name', 'project_id']}
            )
            return phases
        except Exception as e:
            logger.error(f"Odoo phases: {e}")
            return None

    def get_timesheets(self, project_name=PROJECT_NAME, date_from=None, date_to=None,
                       phase_filter=None, all_projects=False):
        """Get timesheets. phase_filter can be a single name or list of names."""
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

            # Phase filter — can be string or list
            if phase_filter:
                phase_names = phase_filter if isinstance(phase_filter, list) else [phase_filter]
                phase_names = [p for p in phase_names if p]  # remove empties
                if phase_names:
                    try:
                        phases = self.models.execute_kw(
                            ODOO_DB, self.uid, ODOO_PASSWORD,
                            'project.phase', 'search_read',
                            [[('name', 'in', phase_names)]],
                            {'fields': ['id'], 'limit': 50}
                        )
                        phase_ids = [p['id'] for p in phases]
                        if phase_ids:
                            tasks = self.models.execute_kw(
                                ODOO_DB, self.uid, ODOO_PASSWORD,
                                'project.task', 'search_read',
                                [[('phase_id', 'in', phase_ids)]],
                                {'fields': ['id'], 'limit': 5000}
                            )
                            phase_task_ids = [t['id'] for t in tasks]
                            if phase_task_ids:
                                domain.append(('task_id', 'in', phase_task_ids))
                            else:
                                return []
                        else:
                            return []
                    except Exception as e:
                        logger.warning(f"Phase filter failed: {e}")

            result = self.models.execute_kw(
                ODOO_DB, self.uid, ODOO_PASSWORD,
                'account.analytic.line', 'search_read', [domain],
                {'fields': ['date', 'employee_id', 'project_id', 'task_id',
                            'name', 'unit_amount'], 'limit': 5000}
            )
            logger.info(f"Odoo timesheets fetched: {len(result)} entries (filter: {domain})")

            # Enrich with parent task info (Odoo v14 doesn't have parent_task_id on timesheet)
            # We need to fetch task records to get their parent_id and phase
            task_ids = list(set(e['task_id'][0] for e in result if e.get('task_id')))
            parent_map = {}  # task_id -> parent_task_name
            phase_map = {}   # task_id -> phase_name
            if task_ids:
                try:
                    tasks = self.models.execute_kw(
                        ODOO_DB, self.uid, ODOO_PASSWORD,
                        'project.task', 'read',
                        [task_ids],
                        {'fields': ['id', 'name', 'parent_id', 'phase_id']}
                    )
                    for t in tasks:
                        parent = t.get('parent_id')
                        if parent and isinstance(parent, list) and len(parent) > 1:
                            parent_map[t['id']] = parent[1]
                        else:
                            parent_map[t['id']] = t.get('name')
                        ph = t.get('phase_id')
                        if ph and isinstance(ph, list) and len(ph) > 1:
                            phase_map[t['id']] = ph[1]
                    logger.info(f"Loaded mapping for {len(tasks)} tasks")
                except Exception as e:
                    logger.warning(f"Could not load tasks: {e}")

            # Attach parent task name + phase to each entry
            for entry in result:
                task = entry.get('task_id')
                if task and task[0] in parent_map:
                    entry['_parent_name'] = parent_map[task[0]]
                else:
                    entry['_parent_name'] = task[1] if task else ''
                entry['_phase_name'] = phase_map.get(task[0] if task else None, '')

            return result
        except Exception as e:
            self.last_error = f"{type(e).__name__}: {str(e)}"
            logger.error(f"Odoo timesheets: {e}")
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
    'service' = parent task name (the umbrella service the task belongs to).
    'phase' = phase name (project.phase).
    For Odoo v14, both are computed via task lookup.
    """
    project = entry.get('project_id', [None, ''])
    task = entry.get('task_id', [None, ''])
    task_name = task[1] if task and task[1] else (entry.get('name') or '')

    # SERVICE = parent task name (computed in get_timesheets), fallback to task name itself
    service_name = entry.get('_parent_name') or task_name
    phase_name = entry.get('_phase_name') or ''

    return {
        'date': entry.get('date'),
        'employee': entry.get('employee_id', [None, 'Unknown'])[1] if entry.get('employee_id') else 'Unknown',
        'project': project[1] if project else '',
        'task': task_name,
        'service': service_name,  # umbrella/parent — used to group actuals per service
        'phase': phase_name,
        'description': entry.get('name', ''),
        'hours': float(entry.get('unit_amount', 0)),
    }

def get_demo_timesheets():
    """Demo data with phase + parent service grouping"""
    return [
        # Service: إدارة الصلاحيات (Development Phase)
        {'date': '2026-04-26', 'employee': 'Ahmed Hassan', 'project': PROJECT_NAME, 'task': 'JWT Setup', 'service': 'إدارة الصلاحيات', 'phase': 'Development Phase', 'description': 'Auth flow', 'hours': 7.5},
        {'date': '2026-04-27', 'employee': 'Ahmed Hassan', 'project': PROJECT_NAME, 'task': 'Token refresh', 'service': 'إدارة الصلاحيات', 'phase': 'Development Phase', 'description': '', 'hours': 8.0},
        {'date': '2026-05-03', 'employee': 'Ahmed Hassan', 'project': PROJECT_NAME, 'task': 'Bug fix', 'service': 'إدارة الصلاحيات', 'phase': 'Development Phase', 'description': '', 'hours': 6.5},
        {'date': '2026-05-02', 'employee': 'Omar Khaled', 'project': PROJECT_NAME, 'task': 'Frontend auth', 'service': 'إدارة الصلاحيات', 'phase': 'Development Phase', 'description': '', 'hours': 7.0},
        # Service: قيد دعوى إدارية (Development Phase)
        {'date': '2026-04-28', 'employee': 'Ahmed Hassan', 'project': PROJECT_NAME, 'task': 'Cases schema', 'service': 'قيد دعوى إدارية', 'phase': 'Development Phase', 'description': '', 'hours': 6.0},
        {'date': '2026-04-29', 'employee': 'Ahmed Hassan', 'project': PROJECT_NAME, 'task': 'Cases schema', 'service': 'قيد دعوى إدارية', 'phase': 'Development Phase', 'description': '', 'hours': 8.0},
        {'date': '2026-04-28', 'employee': 'Sara Ali', 'project': PROJECT_NAME, 'task': 'Wireframes', 'service': 'قيد دعوى إدارية', 'phase': 'Development Phase', 'description': '', 'hours': 7.5},
        {'date': '2026-04-29', 'employee': 'Sara Ali', 'project': PROJECT_NAME, 'task': 'Wireframes', 'service': 'قيد دعوى إدارية', 'phase': 'Development Phase', 'description': '', 'hours': 8.0},
        # Consultation phases
        {'date': '2026-04-27', 'employee': 'Sara Ali', 'project': PROJECT_NAME, 'task': 'Stakeholder Interviews', 'service': 'الفهارس العامة', 'phase': 'Consultation phase - Analysis', 'description': '', 'hours': 7.0},
        {'date': '2026-04-29', 'employee': 'Omar Khaled', 'project': PROJECT_NAME, 'task': 'UX Research', 'service': 'الفهارس العامة', 'phase': 'Consultation phase - UX', 'description': '', 'hours': 7.5},
        {'date': '2026-04-28', 'employee': 'Omar Khaled', 'project': PROJECT_NAME, 'task': 'Initiation Meeting', 'service': 'تسجيل الدخول', 'phase': 'Consultation phase - Initiation', 'description': '', 'hours': 8.0},
        # PM activities
        {'date': '2026-04-26', 'employee': 'Mariam Elmasry', 'project': PROJECT_NAME, 'task': 'PM Review', 'service': '', 'phase': 'Development Phase', 'description': '', 'hours': 6.0},
        {'date': '2026-04-27', 'employee': 'Mariam Elmasry', 'project': PROJECT_NAME, 'task': 'Stakeholder Meeting', 'service': '', 'phase': 'Development Phase', 'description': '', 'hours': 4.5},
        {'date': '2026-04-28', 'employee': 'Mariam Elmasry', 'project': PROJECT_NAME, 'task': 'Sprint Planning', 'service': '', 'phase': 'Development Phase', 'description': '', 'hours': 5.5},
        {'date': '2026-04-29', 'employee': 'Mariam Elmasry', 'project': PROJECT_NAME, 'task': 'Documentation', 'service': '', 'phase': 'Development Phase', 'description': '', 'hours': 7.0},
        {'date': '2026-04-30', 'employee': 'Mariam Elmasry', 'project': PROJECT_NAME, 'task': 'Sprint Review', 'service': '', 'phase': 'Development Phase', 'description': '', 'hours': 4.0},
        # Cross-project (no phase)
        {'date': '2026-05-03', 'employee': 'Mariam Elmasry', 'project': 'Other Project X', 'task': 'External work', 'service': '', 'phase': '', 'description': '', 'hours': 8.0},
        {'date': '2026-05-04', 'employee': 'Omar Khaled', 'project': 'Other Project X', 'task': 'External', 'service': '', 'phase': '', 'description': '', 'hours': 8.0},
    ]

def get_all_timesheets(date_from=None, date_to=None, phases=None, all_projects=False):
    """Unified getter — Odoo if available, else demo. phases = list or None."""
    ts = odoo.get_timesheets(date_from=date_from, date_to=date_to,
                             phase_filter=phases, all_projects=all_projects)
    if ts is None:
        data = get_demo_timesheets()
        if not all_projects:
            data = [d for d in data if d['project'] == PROJECT_NAME]
        if date_from:
            data = [d for d in data if d.get('date', '') >= date_from]
        if date_to:
            data = [d for d in data if d.get('date', '') <= date_to]
        if phases:
            phase_list = phases if isinstance(phases, list) else [phases]
            data = [d for d in data if d.get('phase', '') in phase_list]
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

@app.route('/api/phases')
def api_phases():
    """List of phases for the project (from Odoo or fallback)"""
    phases = odoo.get_phases()
    if phases is None:
        # Fallback list (the 5 phases we know exist)
        return jsonify({
            'connected': False,
            'phases': [
                {'name': 'Consultation phase - Initiation'},
                {'name': 'Consultation phase - Analysis'},
                {'name': 'Consultation phase - General'},
                {'name': 'Consultation phase - UX'},
                {'name': 'Development Phase'},
            ],
            'default': 'Development Phase',
        })
    return jsonify({
        'connected': True,
        'phases': [{'id': p['id'], 'name': p['name']} for p in phases],
        'default': 'Development Phase',
    })

def parse_phases_param(args):
    """Parse phases query param. Accepts 'phases=A,B,C' or 'phases=A&phases=B'."""
    phases_csv = args.get('phases')
    if phases_csv:
        return [p.strip() for p in phases_csv.split(',') if p.strip()]
    # Multi-value
    multi = args.getlist('phases')
    return [p for p in multi if p] if multi else None

@app.route('/api/timesheets/employees')
def api_ts_employees():
    """Aggregated by employee with optional phase filter"""
    date_from = request.args.get('from')
    date_to = request.args.get('to')
    phases = parse_phases_param(request.args)

    data, connected = get_all_timesheets(date_from=date_from, date_to=date_to, phases=phases)

    df = pd.DataFrame(data) if data else pd.DataFrame()
    if df.empty:
        return jsonify({'connected': connected, 'employees': [], 'total_hours': 0,
                        'phases_filter': phases, 'date_from': date_from, 'date_to': date_to})

    by_emp = df.groupby('employee').agg(
        total_hours=('hours', 'sum'),
        days_logged=('date', 'nunique'),
        entries=('hours', 'count')
    ).reset_index().sort_values('total_hours', ascending=False)

    return jsonify({
        'connected': connected,
        'phases_filter': phases,
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
    phases = parse_phases_param(request.args)

    data, _ = get_all_timesheets(date_from=date_from, date_to=date_to, phases=phases)
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
            'phase': entry.get('phase', ''),
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
    phases = parse_phases_param(request.args)

    data, _ = get_all_timesheets(date_from=date_from, date_to=date_to, phases=phases)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['Date', 'Employee', 'Project', 'Phase', 'Service', 'Task', 'Description', 'Hours'])
    for d in data:
        writer.writerow([
            d.get('date', ''), d.get('employee', ''), d.get('project', ''),
            d.get('phase', ''), d.get('service', ''), d.get('task', ''),
            d.get('description', ''), d.get('hours', 0)
        ])

    csv_content = output.getvalue()
    output.close()
    filename = f"timesheets_{date.today().isoformat()}.csv"
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

# ============================================================
# VARIANCE — reads variance.xlsx
# ============================================================
VARIANCE_FILE = os.path.join(BASE_DIR, 'data', 'variance.xlsx')
TRAVEL_FILE = os.path.join(BASE_DIR, 'data', 'travel.json')

# Sub-tab definitions: which sheets feed which tab
VARIANCE_TABS = {
    'development': {
        'label': 'Development',
        'sections': [
            {'key': 'budget', 'label': 'Budget', 'sheet': 'Budget - Development', 'parser': 'budget'},
            {'key': 'profitability', 'label': 'Profitability', 'sheet': 'Profitability - Development', 'parser': 'profitability'},
            {'key': 'effort', 'label': 'Current Effort', 'sheet': 'Current Effort - Development', 'parser': 'effort'},
            {'key': 'estimated', 'label': 'Estimated Cost', 'sheet': 'Estimated Cost - Development', 'parser': 'estimated'},
        ]
    },
    'consultation': {
        'label': 'Consultation',
        'sections': [
            {'key': 'budget', 'label': 'Budget', 'sheet': 'Budget - Consultation', 'parser': 'budget'},
            {'key': 'profitability', 'label': 'Profitability', 'sheet': 'Profitability - Consultation', 'parser': 'profitability'},
            {'key': 'effort', 'label': 'Current Effort', 'sheet': 'Current Effort - Consultation', 'parser': 'effort'},
            {'key': 'estimated', 'label': 'Estimated Cost', 'sheet': 'Estimated Cost - Consultation', 'parser': 'estimated'},
        ]
    },
    'support': {
        'label': 'Support',
        'sections': [
            {'key': 'budget', 'label': 'Budget', 'sheet': 'Budget - Support', 'parser': 'budget'},
            {'key': 'estimated', 'label': 'Estimated Cost', 'sheet': 'Estimated Cost - Support', 'parser': 'estimated'},
        ]
    },
    'travel': {
        'label': 'Travel & Onsite',
        'sections': [
            {'key': 'travel', 'label': 'Travel Records', 'parser': 'travel'},
        ]
    },
}

def safe_val(v):
    """Convert pandas value to JSON-safe value"""
    if v is None:
        return None
    if isinstance(v, float) and pd.isna(v):
        return None
    if isinstance(v, (pd.Timestamp, datetime)):
        return v.isoformat()
    if isinstance(v, (int, float)):
        return v
    return str(v)

def parse_budget_sheet(df):
    """Parse a Budget sheet (Development/Consultation/Support)"""
    info = {}
    # Column 2 = label, column 3-4 = values
    label_col, val_col, val_col2 = 2, 3, 4
    rows = df.values.tolist()
    info['contract'] = {}
    contract_keys = ['Project Name', 'Client', 'Contract start date', 'Contract end date',
                     'Contract duration', 'Contract Type', 'Scope', 'Support start and end dates', 'Progress']
    for r in rows:
        if len(r) > val_col and pd.notna(r[label_col]) and r[label_col] in contract_keys:
            v1 = safe_val(r[val_col]) if len(r) > val_col else None
            v2 = safe_val(r[val_col2]) if len(r) > val_col2 else None
            info['contract'][r[label_col]] = {'value': v1, 'value2': v2}

    # Approved budget block (rows 11-18)
    info['approved'] = {}
    info['final'] = {}
    for r in rows:
        if not r or len(r) < 5:
            continue
        lbl = r[label_col] if pd.notna(r[label_col]) else None
        if lbl == 'Total Mandays':
            info['approved']['total_mandays'] = safe_val(r[4])
        elif lbl == 'Total Estimated Cost ($)':
            info['approved']['cost_usd'] = safe_val(r[4])
        elif lbl == 'Total Estimated Cost (SAR)':
            info['approved']['cost_sar'] = safe_val(r[4])
        elif lbl == 'Total Revenue':
            info['approved']['revenue_sar'] = safe_val(r[4])
        elif lbl == 'Budget Profit (SAR)' and 'profit_sar' not in info['approved']:
            info['approved']['profit_sar'] = safe_val(r[4])
        elif lbl == 'Budget Profit (%)' and 'profit_pct' not in info['approved']:
            info['approved']['profit_pct'] = safe_val(r[4])
        # Final budget on right side (col 6 label, col 8 value)
        if len(r) > 8 and pd.notna(r[6]):
            rlabel = r[6]
            rval = safe_val(r[8])
            if rlabel == 'Total Cost after changes':
                info['final']['cost_sar'] = rval
            elif rlabel == 'Total Revenue after changes':
                info['final']['revenue_sar'] = rval
            elif rlabel == 'Budget Profit (SAR)':
                info['final']['profit_sar'] = rval
            elif rlabel == 'Budget Profit (%)':
                info['final']['profit_pct'] = rval
            elif rlabel == 'Total Changes on Budget':
                info['final']['total_change_cost'] = safe_val(r[8])
                if len(r) > 9:
                    info['final']['total_change_revenue'] = safe_val(r[9])

    # Changes log (rows 3-10ish, cols 6,7,8,9)
    changes = []
    for r in rows[3:11]:
        if len(r) > 9 and pd.notna(r[6]) and r[6] != 'Reason':
            changes.append({
                'reason': safe_val(r[6]),
                'plan_id': safe_val(r[7]) if len(r) > 7 else None,
                'changes_cost': safe_val(r[8]) if len(r) > 8 else None,
                'changes_revenue': safe_val(r[9]) if len(r) > 9 else None,
            })
    info['changes'] = changes

    return info

def parse_profitability_sheet(df):
    """Parse Profitability sheet — month-by-month variance metrics"""
    rows = df.values.tolist()
    # Header at row 5 (0-indexed)
    if len(rows) < 6:
        return {'months': [], 'columns': []}

    headers = []
    for v in rows[5]:
        h = str(v) if pd.notna(v) else ''
        headers.append(h.strip())

    months = []
    for r in rows[7:]:  # data starts at row 7
        if not r or len(r) == 0:
            continue
        if pd.isna(r[0]):
            continue
        row_data = {}
        for i, h in enumerate(headers):
            if h and i < len(r):
                row_data[h] = safe_val(r[i])
        months.append(row_data)

    return {'columns': headers, 'months': months}

def parse_effort_sheet(df):
    """Parse Current Effort sheet — team monthly hours"""
    rows = df.values.tolist()
    if len(rows) < 5:
        return {'team': [], 'months': [], 'totals': {}}

    # Row 3: month names; Row 4: column headers
    months_row = rows[3] if len(rows) > 3 else []
    headers = rows[4] if len(rows) > 4 else []

    # Find month columns (skip first 6 cols which are #, Name, Position, Hour Rate, Overtime Rate)
    month_blocks = []
    cur_month = None
    for i, m in enumerate(months_row):
        if pd.notna(m):
            cur_month = str(m).strip()
        if cur_month and i >= 6:
            month_blocks.append({'month': cur_month, 'col': i})

    # Group by month (every 3 cols = Regular, Ramadan, Overtime)
    seen_months = []
    last_month = None
    for b in month_blocks:
        if b['month'] != last_month:
            seen_months.append(b['month'])
            last_month = b['month']

    team = []
    for r in rows[5:]:
        if len(r) < 4 or pd.isna(r[1]):
            continue
        # Stop at totals row
        if isinstance(r[1], str) and 'total' in str(r[1]).lower():
            continue
        if pd.isna(r[0]):
            # could be totals/summary row
            if len(r) > 5 and pd.notna(r[5]) and isinstance(r[5], str) and 'cost' in r[5].lower():
                continue
            if pd.isna(r[1]):
                continue
        member = {
            'num': safe_val(r[0]) if len(r) > 0 else None,
            'name': safe_val(r[1]) if len(r) > 1 else None,
            'position': safe_val(r[3]) if len(r) > 3 else None,
            'hour_rate': safe_val(r[4]) if len(r) > 4 else None,
            'overtime_rate': safe_val(r[5]) if len(r) > 5 else None,
            'monthly': [],
            'total_cost': safe_val(r[39]) if len(r) > 39 else None,
            'current_mds': safe_val(r[40]) if len(r) > 40 else None,
        }
        # 11 months × 3 cols starting at col 6
        for m_idx, month in enumerate(seen_months):
            base = 6 + m_idx * 3
            if base + 2 < len(r):
                member['monthly'].append({
                    'month': month,
                    'regular': safe_val(r[base]),
                    'ramadan': safe_val(r[base + 1]),
                    'overtime': safe_val(r[base + 2]),
                })
        team.append(member)

    return {'team': team, 'months': seen_months}

def parse_estimated_sheet(df):
    """Parse Estimated Cost sheet"""
    rows = df.values.tolist()
    # Header typically at row 5
    if len(rows) < 6:
        return {'positions': [], 'columns': []}

    # Find header row
    header_row = None
    for i, r in enumerate(rows[:10]):
        if r and pd.notna(r[0]) and 'Position' in str(r[0]):
            header_row = i
            break
    if header_row is None:
        header_row = 5

    headers = [str(h) if pd.notna(h) else f'col_{i}' for i, h in enumerate(rows[header_row])]
    positions = []
    for r in rows[header_row + 1:]:
        if not r or pd.isna(r[0]):
            continue
        row_data = {}
        for i, h in enumerate(headers):
            if i < len(r):
                row_data[h] = safe_val(r[i])
        if row_data.get(headers[0]):
            positions.append(row_data)
    return {'columns': headers, 'positions': positions}

# ============================================================
# COMPUTED EFFORT FROM ODOO TIMESHEETS
# ============================================================

# Phase mapping: variance tab → list of Odoo phases
PHASE_MAPPING = {
    'development': ['Development Phase'],
    'consultation': ['Consultation phase - Initiation', 'Consultation phase - Analysis',
                     'Consultation phase - General', 'Consultation phase - UX'],
    'support': [],  # Support phase doesn't exist as Odoo phase yet
}

# Ramadan dates (current year). Update annually.
RAMADAN_RANGES = {
    'KSA': {'start': '2026-02-18', 'end': '2026-03-19'},  # Saudi
    'EGY': {'start': '2026-02-19', 'end': '2026-03-20'},  # Egypt
}

# Tunisia weekend exception
TUNIS_WEEKEND = [5, 6]  # Saturday, Sunday (Mon=0)
DEFAULT_WEEKEND = [4, 5]  # Friday, Saturday
RAMADAN_HOURS = 6
NORMAL_HOURS = 8

def get_country_from_position(position_name):
    """Detect country from position name like 'KSA - PM' or 'EGY - Software Engineer'"""
    if not position_name:
        return 'EGY'  # default
    pn = str(position_name).upper()
    if 'KSA' in pn or 'SAUDI' in pn:
        return 'KSA'
    if 'TUNIS' in pn or 'TUN' in pn:
        return 'TUN'
    return 'EGY'

def is_in_ramadan(date_str, country):
    """Check if a date falls within Ramadan for the given country"""
    rng = RAMADAN_RANGES.get(country, RAMADAN_RANGES['EGY'])
    return rng['start'] <= date_str <= rng['end']

def get_weekend_for_country(country):
    """Tunis: Sat+Sun. Others: Fri+Sat"""
    if country == 'TUN':
        return TUNIS_WEEKEND
    return DEFAULT_WEEKEND

def compute_effort_from_odoo(phase_key, year, month, position_lookup=None):
    """Compute Regular / Ramadan / Overtime hours per person for a specific month.
    phase_key: 'development', 'consultation', 'support'
    year, month: int
    position_lookup: dict {employee_name: position} from positions sheet/Odoo
    Returns: {team: [...], months: [month_label]}
    """
    phases = PHASE_MAPPING.get(phase_key, [])
    if not phases and phase_key != 'support':
        return {'team': [], 'months': [], 'error': f'No phases mapped for {phase_key}'}

    # Date range for the month
    month_start = date(year, month, 1).isoformat()
    if month == 12:
        next_month_start = date(year + 1, 1, 1)
    else:
        next_month_start = date(year, month + 1, 1)
    month_end = (next_month_start - timedelta(days=1)).isoformat()

    # Fetch timesheets
    raw = odoo.get_timesheets(
        date_from=month_start,
        date_to=month_end,
        phase_filter=phases if phases else None
    )
    if raw is None:
        return {'team': [], 'months': [date(year, month, 1).strftime('%B')], 'error': 'Odoo unreachable'}

    entries = [normalize_timesheet(e) for e in raw]

    # Group by employee, then by date
    by_emp = {}
    for entry in entries:
        emp = entry['employee']
        d = entry['date']
        h = entry['hours']
        if emp not in by_emp:
            by_emp[emp] = {}
        if d not in by_emp[emp]:
            by_emp[emp][d] = 0
        by_emp[emp][d] += h

    # Compute per employee
    team = []
    for emp_name, day_hours in by_emp.items():
        position = (position_lookup or {}).get(emp_name) or ''
        country = get_country_from_position(position)
        weekend_days = get_weekend_for_country(country)

        regular_mh = 0
        ramadan_mh = 0
        overtime_mh = 0

        for day_str, total_h in day_hours.items():
            try:
                d_obj = datetime.strptime(day_str, '%Y-%m-%d').date()
            except Exception:
                continue
            wd = d_obj.weekday()
            is_weekend = wd in weekend_days
            in_ramadan = is_in_ramadan(day_str, country)

            if is_weekend:
                # All weekend hours are overtime
                overtime_mh += total_h
            else:
                # Working day
                expected = RAMADAN_HOURS if in_ramadan else NORMAL_HOURS
                if total_h <= expected:
                    if in_ramadan:
                        ramadan_mh += total_h
                    else:
                        regular_mh += total_h
                else:
                    # Excess is overtime
                    if in_ramadan:
                        ramadan_mh += expected
                    else:
                        regular_mh += expected
                    overtime_mh += (total_h - expected)

        total_h = regular_mh + ramadan_mh + overtime_mh
        total_md = round(total_h / NORMAL_HOURS, 2)

        team.append({
            'name': emp_name,
            'position': position,
            'country': country,
            'regular_mh': round(regular_mh, 2),
            'ramadan_mh': round(ramadan_mh, 2),
            'overtime_mh': round(overtime_mh, 2),
            'total_hours': round(total_h, 2),
            'mds': total_md,
        })

    # Sort alphabetically
    team.sort(key=lambda x: (x['name'] or '').lower())

    return {
        'team': team,
        'month_label': date(year, month, 1).strftime('%B %Y'),
        'year': year,
        'month': month,
        'date_from': month_start,
        'date_to': month_end,
        'phases_used': phases,
    }


def get_positions_from_excel():
    """Read Positions sheet and return list of {position, hour_rate, md_rate}"""
    if not os.path.exists(VARIANCE_FILE):
        return []
    try:
        df = pd.read_excel(VARIANCE_FILE, sheet_name='Positions', header=None)
        rows = df.values.tolist()
        positions = []
        for r in rows[1:]:  # skip header row
            if not r or pd.isna(r[0]):
                continue
            positions.append({
                'name': str(r[0]).strip(),
                'hour_rate': safe_val(r[1]) if len(r) > 1 else None,
                'md_rate': safe_val(r[2]) if len(r) > 2 else None,
            })
        return positions
    except Exception as e:
        logger.error(f"Positions parse: {e}")
        return []


def get_odoo_position_for_employee(employee_name):
    """Try to fetch position from Odoo hr.employee model for an employee by name.
    Returns position name or None.
    """
    if not odoo.uid:
        if not odoo.connect():
            return None
    try:
        emps = odoo.models.execute_kw(
            ODOO_DB, odoo.uid, ODOO_PASSWORD,
            'hr.employee', 'search_read',
            [[('name', '=', employee_name)]],
            {'fields': ['name', 'job_title', 'job_id'], 'limit': 1}
        )
        if not emps:
            return None
        emp = emps[0]
        if emp.get('job_id'):
            return emp['job_id'][1]
        return emp.get('job_title') or None
    except Exception as e:
        logger.warning(f"Odoo position lookup for {employee_name}: {e}")
        return None


# ============================================================
# PLAN OVERRIDES (stored in JSON)
# ============================================================
PLAN_FILE = os.path.join(BASE_DIR, 'data', 'plan_overrides.json')

def load_plan_overrides():
    if not os.path.exists(PLAN_FILE):
        return {}
    try:
        import json
        with open(PLAN_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

def save_plan_overrides(data):
    import json
    os.makedirs(os.path.dirname(PLAN_FILE), exist_ok=True)
    with open(PLAN_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


@app.route('/api/positions')
def api_positions():
    """Get list of positions from Excel + simple lookup"""
    positions = get_positions_from_excel()
    return jsonify({
        'positions': positions,
        'count': len(positions),
    })


@app.route('/api/effort/<phase_key>')
def api_effort(phase_key):
    """Computed effort for a phase + month from Odoo"""
    year = int(request.args.get('year') or date.today().year)
    month = int(request.args.get('month') or date.today().month)

    # Build position lookup: try Odoo first, fallback to manual map
    employees_in_data = set()
    raw = odoo.get_timesheets(
        date_from=date(year, month, 1).isoformat(),
        date_to=(date(year, month + 1, 1) if month < 12 else date(year + 1, 1, 1)).isoformat(),
    )
    if raw:
        for e in raw:
            emp = e.get('employee_id')
            if emp and emp[1]:
                employees_in_data.add(emp[1])

    # Try to fetch positions from Odoo for each
    position_lookup = {}
    for emp_name in employees_in_data:
        pos = get_odoo_position_for_employee(emp_name)
        if pos:
            position_lookup[emp_name] = pos

    # Manual override file (for missing positions)
    overrides = load_plan_overrides().get('position_overrides', {})
    position_lookup.update(overrides)

    result = compute_effort_from_odoo(phase_key, year, month, position_lookup)
    return jsonify(result)


@app.route('/api/plan-overrides', methods=['GET'])
def api_plan_overrides_get():
    return jsonify(load_plan_overrides())


@app.route('/api/plan-overrides', methods=['POST'])
def api_plan_overrides_save():
    body = request.json or {}
    data = load_plan_overrides()
    # body should be {phase, month_key, plan_md}
    phase = body.get('phase')
    month_key = body.get('month_key')  # e.g. "2026-04"
    plan_md = body.get('plan_md')
    if not phase or not month_key:
        return jsonify({'error': 'phase and month_key required'}), 400
    if 'plan_overrides' not in data:
        data['plan_overrides'] = {}
    if phase not in data['plan_overrides']:
        data['plan_overrides'][phase] = {}
    if plan_md is None or plan_md == '':
        data['plan_overrides'][phase].pop(month_key, None)
    else:
        data['plan_overrides'][phase][month_key] = float(plan_md)
    save_plan_overrides(data)
    return jsonify({'ok': True, 'data': data})


@app.route('/api/position-overrides', methods=['POST'])
def api_position_overrides_save():
    """Manual position override for an employee (when Odoo doesn't have it)"""
    body = request.json or {}
    name = body.get('name')
    position = body.get('position')
    if not name:
        return jsonify({'error': 'name required'}), 400
    data = load_plan_overrides()
    if 'position_overrides' not in data:
        data['position_overrides'] = {}
    if not position:
        data['position_overrides'].pop(name, None)
    else:
        data['position_overrides'][name] = position
    save_plan_overrides(data)
    return jsonify({'ok': True})


@app.route('/api/project-employees')
def api_project_employees():
    """Get list of employees who have logged time on the project, with their positions"""
    raw = odoo.get_timesheets()
    if raw is None:
        return jsonify({'employees': [], 'connected': False})

    seen = {}
    for e in raw:
        emp = e.get('employee_id')
        if emp and emp[1]:
            name = emp[1]
            if name not in seen:
                seen[name] = {'name': name}

    # Try to fetch positions
    overrides = load_plan_overrides().get('position_overrides', {})
    for name, info in seen.items():
        if name in overrides:
            info['position'] = overrides[name]
            info['source'] = 'override'
        else:
            pos = get_odoo_position_for_employee(name)
            if pos:
                info['position'] = pos
                info['source'] = 'odoo'
            else:
                info['position'] = None
                info['source'] = None

    employees = sorted(seen.values(), key=lambda x: x['name'].lower())
    return jsonify({'employees': employees, 'connected': True, 'count': len(employees)})


# Main API endpoint for variance data
@app.route('/api/variance')
def api_variance():
    """Returns full variance structure"""
    out = {'tabs': {}, 'available': os.path.exists(VARIANCE_FILE)}
    if not out['available']:
        return jsonify(out)

    try:
        for tab_key, tab_info in VARIANCE_TABS.items():
            if tab_key == 'travel':
                continue  # handled separately
            tab_data = {'label': tab_info['label'], 'sections': []}
            for sect in tab_info['sections']:
                try:
                    df = pd.read_excel(VARIANCE_FILE, sheet_name=sect['sheet'], header=None)
                    parser = sect['parser']
                    if parser == 'budget':
                        data = parse_budget_sheet(df)
                    elif parser == 'profitability':
                        data = parse_profitability_sheet(df)
                    elif parser == 'effort':
                        data = parse_effort_sheet(df)
                    elif parser == 'estimated':
                        data = parse_estimated_sheet(df)
                    else:
                        data = {}
                    tab_data['sections'].append({
                        'key': sect['key'],
                        'label': sect['label'],
                        'sheet': sect['sheet'],
                        'data': data,
                    })
                except Exception as e:
                    logger.error(f"Variance parse {sect['sheet']}: {e}")
                    tab_data['sections'].append({
                        'key': sect['key'],
                        'label': sect['label'],
                        'sheet': sect['sheet'],
                        'error': str(e),
                    })
            out['tabs'][tab_key] = tab_data
    except Exception as e:
        logger.error(f"Variance error: {e}\n{traceback.format_exc()}")
        out['error'] = str(e)
    return jsonify(out)

@app.route('/api/variance/export')
def api_variance_export():
    """Export the variance Excel file as-is"""
    from flask import send_file
    if not os.path.exists(VARIANCE_FILE):
        return jsonify({'error': 'File not found'}), 404
    return send_file(
        VARIANCE_FILE,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        as_attachment=True,
        download_name=f'BOG_Variance_{date.today().isoformat()}.xlsx'
    )

# ============================================================
# TRAVEL & ONSITE — manual entries stored in JSON
# ============================================================
def load_travel():
    if not os.path.exists(TRAVEL_FILE):
        return []
    try:
        import json
        with open(TRAVEL_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"load_travel: {e}")
        return []

def save_travel(records):
    import json
    os.makedirs(os.path.dirname(TRAVEL_FILE), exist_ok=True)
    with open(TRAVEL_FILE, 'w', encoding='utf-8') as f:
        json.dump(records, f, indent=2, ensure_ascii=False)

@app.route('/api/travel', methods=['GET'])
def api_travel_list():
    records = load_travel()
    today_str = date.today().isoformat()
    # Compute current status for each record
    for r in records:
        end = r.get('end_date')
        if not end:
            r['status'] = 'Onsite (open-ended)'
            r['days_onsite'] = (date.today() - datetime.strptime(r['start_date'], '%Y-%m-%d').date()).days + 1 if r.get('start_date') else 0
        else:
            try:
                end_d = datetime.strptime(end, '%Y-%m-%d').date()
                start_d = datetime.strptime(r['start_date'], '%Y-%m-%d').date()
                if end_d < date.today():
                    r['status'] = 'Returned'
                else:
                    r['status'] = 'Onsite'
                r['days_onsite'] = (end_d - start_d).days + 1
            except Exception:
                r['status'] = 'Unknown'
                r['days_onsite'] = 0
    return jsonify({'records': records, 'today': today_str})

@app.route('/api/travel', methods=['POST'])
def api_travel_add():
    body = request.json or {}
    records = load_travel()
    new_id = max([r.get('id', 0) for r in records], default=0) + 1
    record = {
        'id': new_id,
        'name': body.get('name', '').strip(),
        'position': body.get('position', '').strip(),
        'start_date': body.get('start_date'),
        'end_date': body.get('end_date') or None,
        'notes': body.get('notes', ''),
        'created_at': datetime.now().isoformat(),
    }
    if not record['name'] or not record['start_date']:
        return jsonify({'error': 'name and start_date required'}), 400
    records.append(record)
    save_travel(records)
    return jsonify({'ok': True, 'record': record})

@app.route('/api/travel/<int:rec_id>', methods=['PUT'])
def api_travel_update(rec_id):
    body = request.json or {}
    records = load_travel()
    for r in records:
        if r.get('id') == rec_id:
            for k in ['name', 'position', 'start_date', 'end_date', 'notes']:
                if k in body:
                    r[k] = body[k] or None if k == 'end_date' else body[k]
            save_travel(records)
            return jsonify({'ok': True, 'record': r})
    return jsonify({'error': 'not found'}), 404

@app.route('/api/travel/<int:rec_id>', methods=['DELETE'])
def api_travel_delete(rec_id):
    records = load_travel()
    new_recs = [r for r in records if r.get('id') != rec_id]
    save_travel(new_recs)
    return jsonify({'ok': True})


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
