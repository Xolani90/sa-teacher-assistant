import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTeacher } from '../auth/TeacherContext';
import { ApiError } from '../api/client';
import Layout from '../components/Layout';
import { Card, ErrorBanner, Spinner, SectionHeader, Pill, Button } from '../components/ui';
import { formatDateTime } from '../utils/dateFormat';

const STATUS_LOADING = 'loading';
const STATUS_READY = 'ready';
const STATUS_ERROR = 'error';

const RESOURCE_TYPE_LABELS = {
  lessonPlan: 'Lesson Plan',
  worksheet: 'Worksheet',
  test: 'Test',
  atp: 'ATP',
  sbaTask: 'SBA Task',
  examPaper: 'Exam Paper',
  rubric: 'Rubric',
  moderationPack: 'Moderation Pack',
  mentalMaths: 'Mental Maths',
};

// Content section header, per resource type. Mental Maths content is a
// session (verified questions + answer key), not "lesson content" — the
// generic fallback keeps any future saveable type from silently inheriting
// the lessonPlan-specific label.
const CONTENT_SECTION_TITLES = {
  lessonPlan: 'Lesson Content',
  worksheet: 'Worksheet Content',
  test: 'Test Content',
  atp: 'ATP Content',
  sbaTask: 'SBA Task Content',
  examPaper: 'Exam Paper Content',
  rubric: 'Rubric Content',
  moderationPack: 'Moderation Pack Content',
  mentalMaths: 'Mental Maths Session',
};

/**
 * Single saved-resource view, backed by GET /api/resources/:id
 * (routes/api.js -> teacherWorkspaceService.getSavedResource — the
 * exact row core/commandHandler.js's SAVE handler wrote). No
 * regeneration happens here: `content` and `homework` below are
 * rendered verbatim from what the API returns.
 *
 * The homework section is deliberately its own Card with its own
 * heading (not just left inline inside `content`'s raw text) so it's
 * unambiguous to a teacher scanning the page — satisfying "see the
 * complete Homework section" / "see the actual persisted homework"
 * from the Feature 2 dashboard requirement, without inventing a second
 * copy: `homework` here is one field lifted from the SAME resource
 * object as `content`, not a separate fetch/generation.
 */
export default function ResourceDetail() {
  const { resourceId } = useParams();
  const navigate = useNavigate();
  const { authedFetch } = useTeacher();

  const [status, setStatus] = useState(STATUS_LOADING);
  const [resource, setResource] = useState(null);
  const [error, setError] = useState(null);

  // Deletion (Phase 6 continuation) — a thin wrapper around
  // DELETE /api/resources/:id (routes/api.js -> teacherWorkspaceService.js's
  // pre-existing, ownership-scoped deleteSavedResource()). Same
  // confirm-then-delete pattern as ClassDetail.jsx, scoped to this one
  // resource. saved_resources rows are leaves nothing else references, so
  // unlike deleteClass there's no dependent-record guard to surface here.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const load = useCallback(
    async ({ cancelledRef } = {}) => {
      setStatus(STATUS_LOADING);
      setError(null);
      try {
        const res = await authedFetch(`/api/resources/${resourceId}`);
        if (cancelledRef?.current) return;
        setResource(res);
        setStatus(STATUS_READY);
      } catch (err) {
        if (cancelledRef?.current) return;
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
        setStatus(STATUS_ERROR);
      }
    },
    [authedFetch, resourceId]
  );

  // Guard against a slow-resolving request for a previous resourceId
  // overwriting the currently-viewed resource's state after rapid
  // navigation between two resource detail pages (same pattern as
  // ClassDetail.jsx / ObservationWorkspace.jsx).
  useEffect(() => {
    const cancelledRef = { current: false };
    load({ cancelledRef });
    return () => {
      cancelledRef.current = true;
    };
  }, [load]);

  async function handleDeleteResource() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await authedFetch(`/api/resources/${resourceId}`, { method: 'DELETE' });
      navigate('/resources');
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Could not delete this resource. Please try again.');
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Layout>
      <button onClick={() => navigate('/resources')} style={styles.backButton}>
        ← Back to Resources
      </button>

      {status === STATUS_LOADING && <Spinner label="Loading resource…" />}

      {status === STATUS_ERROR && <ErrorBanner message={error} onRetry={load} />}

      {status === STATUS_READY && resource && (
        <>
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Pill tone="accent">{RESOURCE_TYPE_LABELS[resource.resourceType] || resource.resourceType}</Pill>
              {resource.grade != null && <Pill>Grade {resource.grade}</Pill>}
              {resource.subject && <Pill>{resource.subject}</Pill>}
              {resource.term != null && <Pill tone="neutral">Term {resource.term}</Pill>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
              <div>
                <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 var(--space-2)' }}>
                  {resource.title || 'Untitled resource'}
                </h1>
                <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: 'var(--text-sm)' }}>
                  {resource.topic ? `${resource.topic} · ` : ''}
                  Created {formatDateTime(resource.createdAt)}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                {confirmDelete ? (
                  <>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                      Delete this resource?
                    </span>
                    <Button variant="danger" onClick={handleDeleteResource} disabled={deleting}>
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
          </div>

          {/* Full generated content, verbatim — same text WhatsApp delivered */}
          <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
            <SectionHeader title={CONTENT_SECTION_TITLES[resource.resourceType] || 'Content'} />
            <pre style={styles.contentBlock}>{resource.content}</pre>
          </Card>

          {/* Homework — its own clearly-labelled section, read verbatim
              from the same persisted row (resource.homework), never
              regenerated on the dashboard. */}
          {resource.resourceType === 'lessonPlan' && (
            <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
              <SectionHeader title="Homework" />
              {resource.homework ? (
                <pre style={styles.contentBlock}>{resource.homework}</pre>
              ) : (
                <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
                  No homework section was recorded separately for this lesson plan — check the full lesson
                  content above (this can happen for lesson plans saved before homework tracking was added).
                </p>
              )}
            </Card>
          )}
        </>
      )}
    </Layout>
  );
}


const styles = {
  formError: {
    color: 'var(--color-danger)',
    fontSize: 'var(--text-sm)',
    margin: '0.4rem 0 0',
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
};
