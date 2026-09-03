import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTeacher } from '../auth/TeacherContext';
import { ApiError } from '../api/client';
import Layout from '../components/Layout';
import { Card, ErrorBanner, Spinner, SectionHeader, Pill, Button } from '../components/ui';

const STATUS_LOADING = 'loading';
const STATUS_READY = 'ready';
const STATUS_ERROR = 'error';

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

/**
 * Single incident view, backed by GET /api/incidents/:id
 * (routes/api.js -> incidentService.getIncident — the exact row the
 * WhatsApp flow or POST /api/incidents wrote). Supports editing via
 * PATCH /api/incidents/:id, same inline edit-in-place convention as
 * ReflectionPanel.jsx, since incidentService.updateIncident already
 * existed and this only exposes it.
 *
 * A 404 here (wrong owner or missing row) surfaces the same generic
 * "not found" message either way — no existence oracle, matching the
 * API's own convention.
 */
export default function IncidentDetail() {
  const { incidentId } = useParams();
  const navigate = useNavigate();
  const { authedFetch } = useTeacher();

  const [status, setStatus] = useState(STATUS_LOADING);
  const [incident, setIncident] = useState(null);
  const [error, setError] = useState(null);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Deletion (Phase 6 continuation — incident lifecycle closure) — a
  // thin wrapper around DELETE /api/incidents/:id (incidentService.js's
  // deleteIncident()). Same confirm-then-delete pattern as ClassDetail.jsx
  // and ResourceDetail.jsx, scoped to this one incident. `incidents` is a
  // leaf table nothing else references, so — like deleteSavedResource —
  // there's no dependent-record guard to surface here.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const load = useCallback(
    async ({ cancelledRef } = {}) => {
      setStatus(STATUS_LOADING);
      setError(null);
      try {
        const res = await authedFetch(`/api/incidents/${incidentId}`);
        if (cancelledRef?.current) return;
        setIncident(res.incident);
        setStatus(STATUS_READY);
      } catch (err) {
        if (cancelledRef?.current) return;
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
        setStatus(STATUS_ERROR);
      }
    },
    [authedFetch, incidentId]
  );

  // Guard against a slow-resolving request for a previous incidentId
  // overwriting the currently-viewed incident's state after rapid
  // navigation between two incident detail pages (same pattern as
  // ClassDetail.jsx / ObservationWorkspace.jsx).
  useEffect(() => {
    const cancelledRef = { current: false };
    load({ cancelledRef });
    return () => {
      cancelledRef.current = true;
    };
  }, [load]);

  function startEdit() {
    setForm({
      incidentDate: incident.incidentDate,
      incidentTime: incident.incidentTime,
      incidentType: incident.incidentType,
      description: incident.description,
      actionTaken: incident.actionTaken,
    });
    setSaveError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setForm(null);
    setSaveError(null);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await authedFetch(`/api/incidents/${incidentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setIncident(res.incident);
      setEditing(false);
      setForm(null);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not save changes. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteIncident() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await authedFetch(`/api/incidents/${incidentId}`, { method: 'DELETE' });
      navigate('/incidents');
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Could not delete this incident. Please try again.');
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Layout>
      <button onClick={() => navigate('/incidents')} style={styles.backButton}>
        ← Back to Incident Book
      </button>

      {status === STATUS_LOADING && <Spinner label="Loading incident…" />}

      {status === STATUS_ERROR && <ErrorBanner message={error} onRetry={load} />}

      {status === STATUS_READY && incident && !editing && (
        <>
          <div style={{ marginBottom: 'var(--space-4)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
            <div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
                <Pill tone="accent">{INCIDENT_TYPE_LABELS[incident.incidentType] || incident.incidentType}</Pill>
              </div>
              <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 var(--space-2)' }}>
                Incident on {formatDate(incident.incidentDate)}
              </h1>
              <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: 'var(--text-sm)' }}>
                {incident.incidentTime ? `${incident.incidentTime} · ` : ''}
                Logged {formatDateTime(incident.createdAt)}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
              <Button variant="secondary" onClick={startEdit}>Edit</Button>
              {confirmDelete ? (
                <>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                    Delete this incident?
                  </span>
                  <Button variant="danger" onClick={handleDeleteIncident} disabled={deleting}>
                    {deleting ? 'Deleting…' : 'Confirm'}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              )}
            </div>
          </div>
          {deleteError && <p style={styles.formError}>{deleteError}</p>}

          <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
            <SectionHeader title="Description" />
            <pre style={styles.contentBlock}>{incident.description}</pre>
          </Card>

          <Card style={{ padding: 'var(--space-5)' }}>
            <SectionHeader title="Action Taken" />
            <pre style={styles.contentBlock}>{incident.actionTaken}</pre>
          </Card>
        </>
      )}

      {status === STATUS_READY && incident && editing && form && (
        <Card style={{ padding: 'var(--space-5)' }}>
          <SectionHeader title="Edit Incident" />
          {saveError && <ErrorBanner message={saveError} />}
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
            />
          </label>
          <label style={{ ...styles.fieldLabel, marginTop: 'var(--space-3)' }}>
            Action Taken
            <textarea
              value={form.actionTaken}
              onChange={(e) => setForm((f) => ({ ...f, actionTaken: e.target.value }))}
              style={styles.textarea}
              rows={2}
            />
          </label>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
            <Button variant="secondary" onClick={cancelEdit} disabled={saving}>Cancel</Button>
          </div>
        </Card>
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

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  return d.toLocaleString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const styles = {
  formError: {
    color: 'var(--color-danger)',
    fontSize: 'var(--text-sm)',
    margin: '0.4rem 0 var(--space-4)',
  },
  backButton: {
    background: 'none',
    border: 'none',
    color: 'var(--color-accent)',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    padding: 0,
    marginBottom: 'var(--space-5)',
    fontWeight: 500,
  },
  contentBlock: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontFamily: 'inherit',
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text-primary)',
    lineHeight: 1.6,
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
