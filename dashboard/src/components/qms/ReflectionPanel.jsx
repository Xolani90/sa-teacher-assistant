// dashboard/src/components/qms/ReflectionPanel.jsx
import { useState } from 'react';
import { useTeacher } from '../../auth/TeacherContext';
import { ApiError } from '../../api/client';
import { Card, EmptyState, Pill, SectionHeader, Button } from '../ui';

const MODE_IDLE = 'idle';
const MODE_ADDING = 'adding';
const MODE_EDITING = 'editing';

/**
 * Recent reflections list — extended from the original read-only
 * version (ADR-012 section 4.3) to support create/edit/delete against
 * the reflectionService write routes (POST/PATCH/DELETE /api/reflections).
 *
 * No new service or ADR: reflectionService.js already had
 * createReflection/updateReflection/deleteReflection implemented --
 * this only exposes them via thin routes and this UI. Reflections are
 * still primarily logged via WhatsApp; this panel adds the ability to
 * fix a mistake or jot a quick one from the dashboard without
 * replacing that primary flow.
 *
 * Re-fetches the reflections list from the parent (via onChange) after
 * any successful write, rather than reconciling local state -- keeps
 * this component's state machine small and matches the parent's
 * existing load() pattern in QMS.jsx.
 */
export default function ReflectionPanel({ reflections, onChange }) {
  const { authedFetch } = useTeacher();

  const [mode, setMode] = useState(MODE_IDLE);
  const [editingId, setEditingId] = useState(null);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  function startAdd() {
    setMode(MODE_ADDING);
    setEditingId(null);
    setContent('');
    setError(null);
  }

  function startEdit(reflection) {
    setMode(MODE_EDITING);
    setEditingId(reflection.id);
    setContent(reflection.content);
    setError(null);
  }

  function cancelEditing() {
    setMode(MODE_IDLE);
    setEditingId(null);
    setContent('');
    setError(null);
  }

  async function handleSave() {
    const trimmed = content.trim();
    if (!trimmed) {
      setError('Reflection cannot be empty.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (mode === MODE_EDITING) {
        await authedFetch(`/api/reflections/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: trimmed }),
        });
      } else {
        await authedFetch('/api/reflections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: trimmed }),
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

  async function handleDelete(id) {
    setDeletingId(id);
    setError(null);
    try {
      await authedFetch(`/api/reflections/${id}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      await onChange?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this reflection. Please try again.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
      <SectionHeader
        title="Recent Reflections"
        subtitle="Logged via WhatsApp — or add one here"
        action={
          mode === MODE_IDLE && (
            <Button variant="secondary" onClick={startAdd}>
              + Add Reflection
            </Button>
          )
        }
      />

      {mode === MODE_ADDING && (
        <ReflectionForm
          content={content}
          setContent={setContent}
          onSave={handleSave}
          onCancel={cancelEditing}
          saving={saving}
          error={error}
          saveLabel="Save Reflection"
        />
      )}

      {reflections.length === 0 && mode !== MODE_ADDING ? (
        <EmptyState
          title="No reflections yet"
          description='Log one anytime by messaging your assistant on WhatsApp — just say "reflect" to get started — or add one above.'
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: mode === MODE_ADDING ? 'var(--space-4)' : 0 }}>
          {reflections.map((r) =>
            mode === MODE_EDITING && editingId === r.id ? (
              <ReflectionForm
                key={r.id}
                content={content}
                setContent={setContent}
                onSave={handleSave}
                onCancel={cancelEditing}
                saving={saving}
                error={error}
                saveLabel="Save Changes"
              />
            ) : (
              <div key={r.id} style={{ paddingBottom: 'var(--space-4)', borderBottom: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    <Pill tone="neutral">{r.term ? `Term ${r.term}` : 'Unscoped'}</Pill>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                      {formatDate(r.createdAt)}
                    </span>
                  </div>
                  {mode === MODE_IDLE && (
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <Button variant="ghost" onClick={() => startEdit(r)}>
                        Edit
                      </Button>
                      {confirmDeleteId === r.id ? (
                        <>
                          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', alignSelf: 'center' }}>
                            Delete this reflection?
                          </span>
                          <Button
                            variant="danger"
                            onClick={() => handleDelete(r.id)}
                            disabled={deletingId === r.id}
                          >
                            {deletingId === r.id ? 'Deleting…' : 'Confirm'}
                          </Button>
                          <Button variant="ghost" onClick={() => setConfirmDeleteId(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button variant="ghost" onClick={() => setConfirmDeleteId(r.id)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                  {r.content}
                </p>
              </div>
            )
          )}
        </div>
      )}
    </Card>
  );
}

function ReflectionForm({ content, setContent, onSave, onCancel, saving, error, saveLabel }) {
  return (
    <div style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={4}
        placeholder="What went well? What would you change next time?"
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

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  return d.toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' });
}
