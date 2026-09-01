import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeacher } from '../auth/TeacherContext';
import { ApiError } from '../api/client';
import Layout from '../components/Layout';
import { Card, EmptyState, ErrorBanner, Spinner, Pill, Button, SectionHeader } from '../components/ui';

const STATUS_LOADING = 'loading';
const STATUS_READY = 'ready';
const STATUS_ERROR = 'error';

// Mirrors utils/incidentTypes.js exactly (id -> label, in the same
// `order`). Not fetched from an endpoint because there isn't one for
// this static taxonomy (same convention QMS.jsx follows for QMS
// topics being fetched, vs. this — a genuinely fixed 7-item list — being
// inlined, matching RESOURCE_TYPE_LABELS in ResourcesWorkspace.jsx).
const INCIDENT_TYPES = [
  { id: 'INJURY', label: 'Injury' },
  { id: 'BULLYING', label: 'Bullying' },
  { id: 'DISCIPLINE', label: 'Discipline / Behaviour' },
  { id: 'PROPERTY_DAMAGE', label: 'Property Damage' },
  { id: 'HEALTH', label: 'Health / Illness' },
  { id: 'SAFETY', label: 'Safety Concern' },
  { id: 'OTHER', label: 'Other' },
];
const INCIDENT_TYPE_LABELS = Object.fromEntries(INCIDENT_TYPES.map((t) => [t.id, t.label]));

const MODE_IDLE = 'idle';
const MODE_ADDING = 'adding';

const EMPTY_FORM = { incidentDate: '', incidentTime: '', incidentType: '', description: '', actionTaken: '' };

/**
 * Incidents Workspace — browse/filter the teacher's Incident Book
 * (Feature 3), backed by GET /api/incidents (routes/api.js ->
 * incidentService.listIncidents), plus an inline create form against
 * POST /api/incidents. Same list-page convention as
 * ResourcesWorkspace.jsx: server-side filters for the structured
 * fields (incidentType, fromDate, toDate), client-side free-text
 * search over description on top of whatever the server returned.
 *
 * Entries can also be logged via WhatsApp ("log an incident") — this
 * page reads/writes the exact same incidents table, nothing dashboard-only.
 */
export default function IncidentsWorkspace() {
  const { authedFetch } = useTeacher();
  const navigate = useNavigate();

  const [status, setStatus] = useState(STATUS_LOADING);
  const [incidents, setIncidents] = useState([]);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [mode, setMode] = useState(MODE_IDLE);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = useCallback(async () => {
    setStatus(STATUS_LOADING);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.set('incidentType', typeFilter);
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);
      const qs = params.toString();
      const body = await authedFetch(`/api/incidents${qs ? `?${qs}` : ''}`);
      setIncidents(body?.incidents || []);
      setStatus(STATUS_READY);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setStatus(STATUS_ERROR);
    }
  }, [authedFetch, typeFilter, fromDate, toDate]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = query.trim()
    ? incidents.filter((i) =>
        [i.description, i.actionTaken, INCIDENT_TYPE_LABELS[i.incidentType]]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query.trim().toLowerCase())
      )
    : incidents;

  function startAdd() {
    setMode(MODE_ADDING);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  function cancelAdd() {
    setMode(MODE_IDLE);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  async function handleCreate() {
    setSaving(true);
    setFormError(null);
    try {
      await authedFetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setMode(MODE_IDLE);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save this incident. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Incident Book</h1>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search description or action taken…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={styles.search}
            aria-label="Search incidents"
          />
          {mode === MODE_IDLE && (
            <Button variant="primary" onClick={startAdd}>+ Log Incident</Button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-5)', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={styles.select} aria-label="Filter by incident type">
          <option value="">All incident types</option>
          {INCIDENT_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <label style={styles.dateLabel}>
          From
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={styles.dateInput} aria-label="From date" />
        </label>
        <label style={styles.dateLabel}>
          To
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={styles.dateInput} aria-label="To date" />
        </label>
        {(typeFilter || fromDate || toDate) && (
          <Button variant="ghost" onClick={() => { setTypeFilter(''); setFromDate(''); setToDate(''); }}>
            Clear filters
          </Button>
        )}
      </div>

      {mode === MODE_ADDING && (
        <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
          <SectionHeader title="Log a New Incident" />
          {formError && <ErrorBanner message={formError} />}
          <div style={styles.formGrid}>
            <label style={styles.fieldLabel}>
              Date
              <input
                type="date"
                value={form.incidentDate}
                onChange={(e) => setForm((f) => ({ ...f, incidentDate: e.target.value }))}
                style={styles.fieldInput}
              />
            </label>
            <label style={styles.fieldLabel}>
              Time
              <input
                type="time"
                value={form.incidentTime}
                onChange={(e) => setForm((f) => ({ ...f, incidentTime: e.target.value }))}
                style={styles.fieldInput}
              />
            </label>
            <label style={styles.fieldLabel}>
              Type
              <select
                value={form.incidentType}
                onChange={(e) => setForm((f) => ({ ...f, incidentType: e.target.value }))}
                style={styles.fieldInput}
              >
                <option value="">Select a type…</option>
                {INCIDENT_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </label>
          </div>
          <label style={{ ...styles.fieldLabel, marginTop: 'var(--space-3)' }}>
            Description
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              style={styles.textarea}
              rows={3}
              placeholder="What happened?"
            />
          </label>
          <label style={{ ...styles.fieldLabel, marginTop: 'var(--space-3)' }}>
            Action Taken
            <textarea
              value={form.actionTaken}
              onChange={(e) => setForm((f) => ({ ...f, actionTaken: e.target.value }))}
              style={styles.textarea}
              rows={2}
              placeholder="What was done in response?"
            />
          </label>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
            <Button variant="primary" onClick={handleCreate} disabled={saving}>
              {saving ? 'Saving…' : 'Save Incident'}
            </Button>
            <Button variant="secondary" onClick={cancelAdd} disabled={saving}>Cancel</Button>
          </div>
        </Card>
      )}

      {status === STATUS_LOADING && <Spinner label="Loading incidents…" />}

      {status === STATUS_ERROR && <ErrorBanner message={error} onRetry={load} />}

      {status === STATUS_READY && incidents.length === 0 && mode === MODE_IDLE && (
        <EmptyState
          title="No incidents logged yet"
          description={
            <>
              Log one from WhatsApp — send <code style={styles.code}>log an incident</code> — or use{' '}
              <code style={styles.code}>+ Log Incident</code> above. Either way it lands in the same Incident Book.
            </>
          }
        />
      )}

      {status === STATUS_READY && incidents.length > 0 && filtered.length === 0 && (
        <p style={{ color: 'var(--color-text-secondary)' }}>No incidents match "{query}".</p>
      )}

      {status === STATUS_READY && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {filtered.map((i) => (
            <Card key={i.id} onClick={() => navigate(`/incidents/${i.id}`)} style={styles.rowCard}>
              <div>
                <div style={{ fontWeight: 600 }}>{truncate(i.description, 90) || 'No description'}</div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                  {formatDate(i.incidentDate)}
                  {i.incidentTime ? ` · ${i.incidentTime}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                <Pill tone="neutral">{INCIDENT_TYPE_LABELS[i.incidentType] || i.incidentType}</Pill>
                <Pill>View →</Pill>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Layout>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' });
}

function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

const styles = {
  search: {
    padding: '0.55rem var(--space-4)',
    fontSize: 'var(--text-sm)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: 'var(--radius-full)',
    minWidth: 260,
    background: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
    outline: 'none',
  },
  select: {
    padding: '0.5rem var(--space-3)',
    fontSize: 'var(--text-sm)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
  },
  dateLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text-secondary)',
  },
  dateInput: {
    padding: '0.45rem var(--space-2)',
    fontSize: 'var(--text-sm)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
  },
  code: {
    background: 'var(--color-bg)',
    padding: '0.1rem 0.4rem',
    borderRadius: 4,
    fontSize: '0.9em',
  },
  rowCard: {
    padding: 'var(--space-4) var(--space-5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 'var(--space-3)',
  },
  fieldLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text-secondary)',
    fontWeight: 500,
  },
  fieldInput: {
    padding: '0.5rem var(--space-3)',
    fontSize: 'var(--text-sm)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
  },
  textarea: {
    padding: '0.5rem var(--space-3)',
    fontSize: 'var(--text-sm)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
    fontFamily: 'inherit',
    resize: 'vertical',
    width: '100%',
    boxSizing: 'border-box',
  },
};
