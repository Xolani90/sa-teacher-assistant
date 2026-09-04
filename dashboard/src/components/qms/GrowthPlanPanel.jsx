// dashboard/src/components/qms/GrowthPlanPanel.jsx
import { useState, useEffect } from 'react';
import { useTeacher } from '../../auth/TeacherContext';
import { ApiError } from '../../api/client';
import { Card, EmptyState, Pill, SectionHeader, Button } from '../ui';
import { formatDate } from '../../utils/dateFormat';

const MODE_IDLE = 'idle';
const MODE_ADDING = 'adding';
const MODE_EDITING = 'editing';

// Mirrors services/growthPlanService.js's VALID_STATUSES exactly — kept
// as a literal list here (rather than fetched) since it's a fixed,
// code-level contract, same treatment growthPlanService.js itself gives
// it (a frozen array, not a DB-driven taxonomy like QMS topics are).
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'abandoned', label: 'Abandoned' },
];

const STATUS_TONE = {
  active: 'accent',
  in_progress: 'accent',
  completed: 'success',
  abandoned: 'neutral',
};

const STATUS_LABEL = STATUS_OPTIONS.reduce((acc, s) => ({ ...acc, [s.value]: s.label }), {});

/**
 * Growth Plans panel — full CRUD against the write routes added
 * alongside this panel (GET/POST/PATCH/DELETE /api/growth-plans), which
 * are themselves thin wrappers over the pre-existing
 * services/growthPlanService.js (createGrowthPlan/getGrowthPlan/
 * listGrowthPlans/updateGrowthPlan/deleteGrowthPlan) — the SAME service
 * flows/growthPlanFlow.js's WhatsApp NEW GOAL flow already calls. No new
 * service, no second growth-plan storage model: this panel is a second
 * *entry point* into the one qms_growth_plans table, exactly the
 * relationship ReflectionPanel.jsx already has with reflectionService.js.
 *
 * Architecture deliberately mirrors ReflectionPanel.jsx: same
 * idle/adding/editing mode state machine, same "re-fetch via onChange
 * after any successful write" pattern (matches QMS.jsx's existing
 * load()), same topic-selector-on-create-only shape. The one addition
 * Reflections doesn't need is a status control, since growth plans have
 * a real lifecycle (ADR-011 §2: active -> in_progress -> completed, or
 * abandoned) that reflections don't.
 */
export default function GrowthPlanPanel({ growthPlans, onChange }) {
  const { authedFetch } = useTeacher();

  const [mode, setMode] = useState(MODE_IDLE);
  const [editingId, setEditingId] = useState(null);
  const [goalText, setGoalText] = useState('');
  const [topicId, setTopicId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState(null);
  const [topics, setTopics] = useState([]);

  // Fetched once on mount — small, static taxonomy (ADR-013 §3), same
  // convention and same endpoint ReflectionPanel.jsx already uses.
  useEffect(() => {
    let cancelled = false;
    authedFetch('/api/qms/topics')
      .then((data) => { if (!cancelled) setTopics(data.topics || []); })
      .catch(() => { if (!cancelled) setTopics([]); });
    return () => { cancelled = true; };
  }, [authedFetch]);

  function startAdd() {
    setMode(MODE_ADDING);
    setEditingId(null);
    setGoalText('');
    setTopicId('');
    setError(null);
  }

  function startEdit(plan) {
    setMode(MODE_EDITING);
    setEditingId(plan.id);
    setGoalText(plan.goalText);
    setTopicId(plan.topicId || '');
    setError(null);
  }

  function cancelEditing() {
    setMode(MODE_IDLE);
    setEditingId(null);
    setGoalText('');
    setTopicId('');
    setError(null);
  }

  async function handleSave() {
    const trimmed = goalText.trim();
    if (!trimmed) {
      setError('Goal cannot be empty.');
      return;
    }
    if (!topicId) {
      setError('Please select a coaching area.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (mode === MODE_EDITING) {
        await authedFetch(`/api/growth-plans/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goalText: trimmed, topicId }),
        });
      } else {
        await authedFetch('/api/growth-plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goalText: trimmed, topicId }),
        });
      }
      cancelEditing();
      await onChange?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // Status changes are their own action, separate from the edit form —
  // a teacher marking a goal complete shouldn't have to re-open and
  // re-submit the whole goal text to do it. PATCHes the same route with
  // a status-only body (services/growthPlanService.js's updateGrowthPlan
  // already supports a partial update).
  async function handleStatusChange(id, nextStatus) {
    setStatusUpdatingId(id);
    setError(null);
    try {
      await authedFetch(`/api/growth-plans/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      await onChange?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update status. Please try again.');
    } finally {
      setStatusUpdatingId(null);
    }
  }

  async function handleDelete(id) {
    setDeletingId(id);
    setError(null);
    try {
      await authedFetch(`/api/growth-plans/${id}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      await onChange?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this goal. Please try again.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
      <SectionHeader
        title="Growth Plans"
        subtitle="Set via WhatsApp (NEW GOAL) — or add one here"
        action={
          mode === MODE_IDLE && (
            <Button variant="secondary" onClick={startAdd}>
              + Add Goal
            </Button>
          )
        }
      />

      {mode === MODE_ADDING && (
        <GrowthPlanForm
          goalText={goalText}
          setGoalText={setGoalText}
          topics={topics}
          topicId={topicId}
          setTopicId={setTopicId}
          onSave={handleSave}
          onCancel={cancelEditing}
          saving={saving}
          error={error}
          saveLabel="Save Goal"
        />
      )}

      {growthPlans.length === 0 && mode !== MODE_ADDING ? (
        <EmptyState
          title="No growth plans yet"
          description='Set one anytime by messaging your assistant on WhatsApp — just say "new goal" to get started — or add one above.'
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: mode === MODE_ADDING ? 'var(--space-4)' : 0 }}>
          {growthPlans.map((g) =>
            mode === MODE_EDITING && editingId === g.id ? (
              <GrowthPlanForm
                key={g.id}
                goalText={goalText}
                setGoalText={setGoalText}
                topics={topics}
                topicId={topicId}
                setTopicId={setTopicId}
                onSave={handleSave}
                onCancel={cancelEditing}
                saving={saving}
                error={error}
                saveLabel="Save Changes"
              />
            ) : (
              <div key={g.id} style={{ paddingBottom: 'var(--space-4)', borderBottom: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <Pill tone={STATUS_TONE[g.status] || 'neutral'}>{STATUS_LABEL[g.status] || g.status}</Pill>
                    <Pill tone="neutral">{g.term ? `Term ${g.term}` : 'Unscoped'}</Pill>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                      {formatDate(g.createdAt)}
                    </span>
                  </div>
                  {mode === MODE_IDLE && (
                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                      <select
                        value={g.status}
                        onChange={(e) => handleStatusChange(g.id, e.target.value)}
                        disabled={statusUpdatingId === g.id}
                        aria-label={`Update status for goal: ${g.goalText}`}
                        style={styles.statusSelect}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                      <Button variant="ghost" onClick={() => startEdit(g)}>
                        Edit
                      </Button>
                      {confirmDeleteId === g.id ? (
                        <>
                          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', alignSelf: 'center' }}>
                            Delete this goal?
                          </span>
                          <Button
                            variant="danger"
                            onClick={() => handleDelete(g.id)}
                            disabled={deletingId === g.id}
                          >
                            {deletingId === g.id ? 'Deleting…' : 'Confirm'}
                          </Button>
                          <Button variant="ghost" onClick={() => setConfirmDeleteId(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button variant="ghost" onClick={() => setConfirmDeleteId(g.id)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                  {g.goalText}
                </p>
              </div>
            )
          )}
        </div>
      )}
    </Card>
  );
}

function GrowthPlanForm({ goalText, setGoalText, topics = [], topicId, setTopicId, onSave, onCancel, saving, error, saveLabel }) {
  return (
    <div style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
      <select
        value={topicId}
        onChange={(e) => setTopicId(e.target.value)}
        style={{
          width: '100%',
          marginBottom: 'var(--space-3)',
          padding: 'var(--space-3)',
          fontSize: 'var(--text-sm)',
          fontFamily: 'inherit',
          border: '1px solid var(--color-border-strong)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-surface)',
          color: 'var(--color-text-primary)',
          boxSizing: 'border-box',
        }}
      >
        <option value="" disabled>Which coaching area does this goal relate to?</option>
        {topics.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
      <textarea
        value={goalText}
        onChange={(e) => setGoalText(e.target.value)}
        rows={4}
        placeholder="What are you working towards this term?"
        autoFocus
        style={{
          width: '100%',
          padding: 'var(--space-3)',
          fontSize: 'var(--text-sm)',
          fontFamily: 'inherit',
          border: '1px solid var(--color-border-strong)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-surface)',
          color: 'var(--color-text-primary)',
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />
      {error && (
        <p style={{ color: 'var(--color-danger)', fontSize: 'var(--text-sm)', margin: '0.4rem 0 0' }}>{error}</p>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
        <Button onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : saveLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}


const styles = {
  statusSelect: {
    padding: '0.35rem var(--space-2)',
    fontSize: 'var(--text-sm)',
    fontFamily: 'inherit',
    border: '1px solid var(--color-border-strong)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
  },
};