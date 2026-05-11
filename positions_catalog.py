"""
Positions catalog - hourly + MD rates per position.
Used as seed data on first DB init.
After seeding, positions live in DB and can be edited via portal.
"""

# Seeded positions (from Mariam's reference table)
POSITIONS_SEED = [
    # KSA positions (onsite by definition - based in Saudi)
    {'position': 'KSA - Technical Support',           'hour_rate': 56,  'md_rate': 450,    'country': 'KSA', 'is_onsite': False},
    {'position': 'KSA - Sr. Technical Support',       'hour_rate': 79,  'md_rate': 633,    'country': 'KSA', 'is_onsite': False},
    {'position': 'KSA - Software Engineer',           'hour_rate': 56,  'md_rate': 450,    'country': 'KSA', 'is_onsite': False},
    {'position': 'KSA - Sr. Software Engineer',       'hour_rate': 79,  'md_rate': 633,    'country': 'KSA', 'is_onsite': False},
    {'position': 'KSA - Lead Software Engineer',      'hour_rate': 87,  'md_rate': 696,    'country': 'KSA', 'is_onsite': False},
    {'position': 'KSA - Business Analyst',            'hour_rate': 56,  'md_rate': 450,    'country': 'KSA', 'is_onsite': False},
    {'position': 'KSA - Sr Business Analyst',         'hour_rate': 79,  'md_rate': 633,    'country': 'KSA', 'is_onsite': False},
    {'position': 'KSA - Lead Business Analyst',       'hour_rate': 87,  'md_rate': 696,    'country': 'KSA', 'is_onsite': False},
    {'position': 'KSA - Solution Architect / Manager','hour_rate': 112, 'md_rate': 898,    'country': 'KSA', 'is_onsite': False},
    {'position': 'KSA - Project Manager',             'hour_rate': 112, 'md_rate': 898,    'country': 'KSA', 'is_onsite': False},

    # EGY positions (regular - working from Egypt)
    {'position': 'EGY - Software Engineer',           'hour_rate': 28,  'md_rate': 223,    'country': 'EGY', 'is_onsite': False},
    {'position': 'EGY - Sr. Software Engineer',       'hour_rate': 32,  'md_rate': 253,    'country': 'EGY', 'is_onsite': False},
    {'position': 'EGY - Lead Software Engineer',      'hour_rate': 35,  'md_rate': 277,    'country': 'EGY', 'is_onsite': False},
    {'position': 'EGY - Business Analyst',            'hour_rate': 28,  'md_rate': 223,    'country': 'EGY', 'is_onsite': False},
    {'position': 'EGY - Sr Business Analyst',         'hour_rate': 29,  'md_rate': 235,    'country': 'EGY', 'is_onsite': False},
    {'position': 'EGY - Lead Business Analyst',       'hour_rate': 35,  'md_rate': 277,    'country': 'EGY', 'is_onsite': False},
    {'position': 'EGY - Project Manager',             'hour_rate': 38,  'md_rate': 301,    'country': 'EGY', 'is_onsite': False},
    {'position': 'EGY - Quality Engineer',            'hour_rate': 28,  'md_rate': 223,    'country': 'EGY', 'is_onsite': False},
    {'position': 'EGY - Sr Quality Engineer',         'hour_rate': 32,  'md_rate': 253,    'country': 'EGY', 'is_onsite': False},
    {'position': 'EGY - Lead Quality Engineer',       'hour_rate': 35,  'md_rate': 277,    'country': 'EGY', 'is_onsite': False},
    {'position': 'EGY - UX Designer',                 'hour_rate': 28,  'md_rate': 223,    'country': 'EGY', 'is_onsite': False},
    {'position': 'EGY - Sr UX Designer',              'hour_rate': 32,  'md_rate': 253,    'country': 'EGY', 'is_onsite': False},
    {'position': 'EGY - Lead UX Designer',            'hour_rate': 35,  'md_rate': 277,    'country': 'EGY', 'is_onsite': False},

    # EGY - onsite variants (when traveling to client site)
    {'position': 'EGY - Software Engineer - onsite',  'hour_rate': 45,  'md_rate': 361.72, 'country': 'EGY', 'is_onsite': True},
    {'position': 'EGY - Sr. Software Engineer - onsite','hour_rate': 52,'md_rate': 413.05, 'country': 'EGY', 'is_onsite': True},
    {'position': 'EGY - Lead Software Engineer - onsite','hour_rate': 58,'md_rate': 466.39,'country': 'EGY', 'is_onsite': True},
    {'position': 'EGY - Business Analyst - onsite',   'hour_rate': 45,  'md_rate': 361.72, 'country': 'EGY', 'is_onsite': True},
    {'position': 'EGY - Sr Business Analyst - onsite','hour_rate': 52,  'md_rate': 413.05, 'country': 'EGY', 'is_onsite': True},
    {'position': 'EGY - Lead Business Analyst - onsite','hour_rate': 58,'md_rate': 466.39, 'country': 'EGY', 'is_onsite': True},
    {'position': 'EGY - Project Manager - onsite',    'hour_rate': 63,  'md_rate': 505.05, 'country': 'EGY', 'is_onsite': True},
    {'position': 'EGY - Quality Engineer - onsite',   'hour_rate': 45,  'md_rate': 361.72, 'country': 'EGY', 'is_onsite': True},
    {'position': 'EGY - Sr Quality Engineer - onsite','hour_rate': 52,  'md_rate': 413.05, 'country': 'EGY', 'is_onsite': True},
    {'position': 'EGY - Lead Quality Engineer - onsite','hour_rate': 58,'md_rate': 466.39, 'country': 'EGY', 'is_onsite': True},
    {'position': 'EGY - UX Designer - onsite',        'hour_rate': 45,  'md_rate': 361.72, 'country': 'EGY', 'is_onsite': True},
    {'position': 'EGY - Sr UX Designer - onsite',     'hour_rate': 52,  'md_rate': 413.05, 'country': 'EGY', 'is_onsite': True},
    {'position': 'EGY - Lead UX Designer - onsite',   'hour_rate': 58,  'md_rate': 466.39, 'country': 'EGY', 'is_onsite': True},
]

# Tunis people: paid per name, not per position
TUNIS_RATES_SEED = [
    {'name': 'Tarek GUIZANI',             'hour_rate': 21.30},
    {'name': 'SOUHAIL HAJRI',             'hour_rate': 21.30},
    {'name': 'Houda BOUZAZI',             'hour_rate': 14.70},
    {'name': 'Marwen Reguigui',           'hour_rate': 31.00},
    {'name': 'Emna ZOUAOUI',              'hour_rate': 13.30},
    {'name': 'Safouene ZID',              'hour_rate': 25.80},
    {'name': 'Khoubaieb GHAOUARI',        'hour_rate': 19.30},
    {'name': 'Rafeh ZEKRI',               'hour_rate': 12.80},
    {'name': 'Samia ACHOURI',             'hour_rate': 25.80},
    {'name': 'Achraf SALMI',              'hour_rate': 19.30},
    {'name': 'Zein el Abidin TRABELSI',   'hour_rate': 25.80},
    {'name': 'Arafet ZOUARI',             'hour_rate': 16.00},
    {'name': 'Sarra OUNISSI',             'hour_rate': 13.30},
    {'name': 'Aicha CHATTI',              'hour_rate': 25.80},
    {'name': 'Abir HAMMAMI',              'hour_rate': 19.30},
    {'name': 'Naiim BSILI',               'hour_rate': 21.30},
    {'name': 'IKbel BOUZRATI',            'hour_rate': 31.00},
    {'name': 'Iheb MAATALI RIAHI',        'hour_rate': 26.50},
]


def seed_positions_if_empty(db):
    """If positions catalog is empty in DB, seed it. Returns count of seeded rows.
    Safe to call on every boot - only inserts if empty.
    """
    existing = db.get_namespace_overrides('positions_catalog', '')
    if existing:
        return 0  # already seeded

    count = 0
    for pos in POSITIONS_SEED:
        # Key = position name. Value = dict with rate info.
        db.set_override('positions_catalog', '', pos['position'], pos)
        count += 1

    for t in TUNIS_RATES_SEED:
        db.set_override('tunis_rates', '', t['name'], t)
        count += 1

    return count


def get_all_positions(db):
    """Get full catalog from DB."""
    raw = db.get_namespace_overrides('positions_catalog', '')
    # Returns dict {position_name: {position, hour_rate, md_rate, ...}}
    positions = []
    for name, info in raw.items():
        if isinstance(info, dict):
            positions.append(info)
        else:
            positions.append({'position': name, 'hour_rate': None, 'md_rate': None})
    # Sort by country then position
    positions.sort(key=lambda x: (x.get('country', 'ZZ'), x.get('is_onsite', False), x.get('position', '')))
    return positions


def get_position_by_name(db, position_name):
    """Lookup a single position. Returns full dict or None."""
    info = db.get_override('positions_catalog', '', position_name)
    if info and isinstance(info, dict):
        return info
    return None


def get_all_tunis_rates(db):
    raw = db.get_namespace_overrides('tunis_rates', '')
    rates = []
    for name, info in raw.items():
        if isinstance(info, dict):
            rates.append(info)
        else:
            rates.append({'name': name, 'hour_rate': info})
    rates.sort(key=lambda x: x.get('name', ''))
    return rates


def get_tunis_rate_by_name(db, name):
    """Fuzzy lookup of tunis person rate by name."""
    if not name:
        return None
    # Strip [code] prefix
    import re
    clean = re.sub(r'\[[A-Z]\d+\]\s*', '', name).strip().lower()
    if not clean:
        return None

    all_rates = get_all_tunis_rates(db)
    # Exact (case-insensitive)
    for r in all_rates:
        if r.get('name', '').lower() == clean:
            return r
    # Partial: first 2 words match
    target_words = clean.split()[:2]
    for r in all_rates:
        rname_words = r.get('name', '').lower().split()[:2]
        if target_words and rname_words and target_words[0] == rname_words[0]:
            if len(target_words) > 1 and len(rname_words) > 1:
                if target_words[1] == rname_words[1]:
                    return r
            else:
                return r
    return None


def upsert_position(db, position_name, hour_rate=None, md_rate=None, country=None, is_onsite=None):
    """Add or update a position in catalog (editable from portal)."""
    existing = db.get_override('positions_catalog', '', position_name) or {}
    if not isinstance(existing, dict):
        existing = {}
    new = {
        'position': position_name,
        'hour_rate': hour_rate if hour_rate is not None else existing.get('hour_rate'),
        'md_rate': md_rate if md_rate is not None else existing.get('md_rate'),
        'country': country if country is not None else existing.get('country', ''),
        'is_onsite': is_onsite if is_onsite is not None else existing.get('is_onsite', False),
    }
    db.set_override('positions_catalog', '', position_name, new)
    return new


def upsert_tunis_rate(db, name, hour_rate):
    """Add or update a Tunis person rate."""
    db.set_override('tunis_rates', '', name, {'name': name, 'hour_rate': hour_rate})


def delete_position(db, position_name):
    db.set_override('positions_catalog', '', position_name, None)


def delete_tunis_rate(db, name):
    db.set_override('tunis_rates', '', name, None)
