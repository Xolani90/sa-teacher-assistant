import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeacher } from '../auth/TeacherContext';
import Layout from '../components/Layout';
import { Card, Button, Spinner, IconBadge, SectionHeader, Pill, ErrorBanner } from '../components/ui';
import { parseSqliteUtc } from '../utils/dateFormat';

// Real commands the WhatsApp bot actually supports today (see README.md
// "Supported commands"). The command bar below is a reference/copy tool,
// not a live chat surface — there's no in-dashboard AI endpoint yet, so
// it points teachers at the real thing instead of faking one.
const COMMANDS = [
  {
    icon: '📄',
    tone: 'indigo',
    label: 'Worksheet',
    template: 'Grade 7 algebra worksheet',
    hint: 'Grade [N] [subject] worksheet',
  },
  {
    icon: '📘',
    tone: 'lavender',
    label: 'Lesson plan',
    template: 'Lesson plan Grade 9 English poetry',
    hint: 'Lesson plan Grade [N] [topic]',
  },
  {
    icon: '📝',
    tone: 'mint',
    label: 'Test + memo',
    template: 'Make a 20-mark test on fractions',
    hint: '[N]-mark test on [topic]',
  },
  {
    icon: '💡',
    tone: 'amber',
    label: 'Explanation',
    template: 'Explain photosynthesis Grade 8',
    hint: 'Explain [topic] Grade [N]',
  },
];

const NOT_YET_ON_DASHBOARD = [
  { icon: '📊', tone: 'mint', title: 'Coverage Reports', note: 'Coming to the dashboard' },
  { icon: '🎯', tone: 'amber', title: 'Intervention Insights', note: 'Coming to the dashboard' },
];

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THREE_WEEKS_MS = 21 * 24 * 60 * 60 * 1000;

// Counts items whose createdAt falls within the last `windowMs`, relative
// to `now`. Shared by the weekly pulse and the needs-attention nudge below
// so both agree on what "recent" means.
function countRecent(items, windowMs, now) {
  return items.filter((item) => {
    const created = parseSqliteUtc(item.createdAt);
    return created && now - created.getTime() <= windowMs;
  }).length;
}

// Real stats only — computed from the two endpoints that actually exist
// (GET /api/classes, GET /api/learners). No fabricated coverage,
// performance, or "hours saved" numbers until a backend service
// produces them; an honest "not yet available" beats a fake metric,
// but it's presented with the same visual polish as everything else.
export default function Home() {
  const { teacher, authedFetch } = useTeacher();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [classes, setClasses] = useState([]);
  const [learnerCount, setLearnerCount] = useState(0);

  // Weekly pulse + needs-attention nudge: a second, independent fetch from
  // the stats above. It's deliberately allowed to fail quietly (see catch
  // below) — a hiccup fetching "how active was I this week" shouldn't take
  // down the classes/learners stats that already work, and it's not
  // something worth an ErrorBanner over.
  const [pulse, setPulse] = useState(null); // null = not loaded / unavailable
  const [needsAttention, setNeedsAttention] = useState([]);

  const [activeCommand, setActiveCommand] = useState(COMMANDS[0]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError(null);
      try {
        const [classesRes, learnersRes] = await Promise.all([
          authedFetch('/api/classes'),
          authedFetch('/api/learners'),
        ]);
        if (cancelled) return;
        const loadedClasses = classesRes?.classes || [];
        setClasses(loadedClasses);
        setLearnerCount((learnersRes?.learners || []).length);

        // Independent try/catch: this section is a bonus view on top of
        // data other pages already own (Assessments Workspace,
        // Observations, Reflections & Goals) — if it fails to load, the
        // rest of Overview should still work normally.
        try {
          const [assessmentsRes, observationsRes, reflectionsRes] = await Promise.all([
            authedFetch('/api/assessments'),
            authedFetch('/api/observations'),
            authedFetch('/api/reflections'),
          ]);
          if (cancelled) return;
          const assessments = assessmentsRes?.assessments || [];
          const observations = observationsRes?.observations || [];
          const reflections = reflectionsRes?.reflections || [];
          const now = Date.now();

          setPulse({
            assessments: countRecent(assessments, SEVEN_DAYS_MS, now),
            observations: countRecent(observations, SEVEN_DAYS_MS, now),
            reflections: countRecent(reflections, SEVEN_DAYS_MS, now),
          });

          const classIdsWithRecentAssessment = new Set(
            assessments
              .filter((a) => {
                const created = parseSqliteUtc(a.createdAt);
                return created && now - created.getTime() <= THREE_WEEKS_MS;
              })
              .map((a) => a.class?.id)
              .filter((id) => id != null)
          );
          setNeedsAttention(
            loadedClasses.filter((c) => !classIdsWithRecentAssessment.has(c.id)).slice(0, 3)
          );
        } catch {
          if (!cancelled) {
            setPulse(null);
            setNeedsAttention([]);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Could not load your dashboard.');
          setClasses([]);
          setLearnerCount(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [authedFetch]);

  const firstName = (teacher?.name || 'there').split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  async function copyActiveCommand() {
    try {
      await navigator.clipboard.writeText(activeCommand.template);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API can be unavailable (older browsers, insecure
      // context) — fail quietly, the text is still visible to copy by hand.
    }
  }

  return (
    <Layout>
      {/* Hero — AI command center */}
      <section className="mb-7 rounded-lg border border-border bg-grad-indigo p-6">
        <h1 className="m-0 mb-2 text-2xl font-bold tracking-tight text-text-primary">
          {greeting}, {firstName}.
        </h1>
        <p className="m-0 mb-5 text-md text-text-secondary">
          Everything here starts as a WhatsApp message. Pick a command to see how it's phrased.
        </p>

        {/* Command bar */}
        <div className="rounded-md border border-border-strong bg-surface p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap gap-2">
            {COMMANDS.map((cmd) => {
              const isActive = cmd.label === activeCommand.label;
              return (
                <button
                  key={cmd.label}
                  onClick={() => {
                    setActiveCommand(cmd);
                    setCopied(false);
                  }}
                  className={
                    'flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition-colors duration-fast ease-standard ' +
                    (isActive
                      ? 'border-transparent bg-accent text-white'
                      : 'border-border-strong bg-transparent text-text-secondary hover:text-text-primary')
                  }
                >
                  <span aria-hidden="true">{cmd.icon}</span>
                  {cmd.label}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-col gap-3 rounded-sm bg-bg p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="truncate font-mono text-base text-text-primary">{activeCommand.template}</div>
              <div className="mt-1 text-xs text-text-tertiary">Pattern: {activeCommand.hint}</div>
            </div>
            <Button variant="secondary" onClick={copyActiveCommand} style={{ flexShrink: 0 }}>
              {copied ? 'Copied ✓' : 'Copy message'}
            </Button>
          </div>

          <p className="mb-0 mt-3 text-xs text-text-tertiary">
            Copy it, then send it to your SA Teacher Assistant number on WhatsApp.
          </p>
        </div>
      </section>

      {error && (
        <div className="mb-6">
          <ErrorBanner message={error} onRetry={() => window.location.reload()} />
        </div>
      )}

      {/* Real stats. Gated on !error as well as !loading: when the
          /api/classes or /api/learners fetch fails, `classes`/`learnerCount`
          are reset to []/0 in the catch block above (see comment there),
          which would otherwise render as genuine "0 classes, 0 learners"
          stats and a "No classes yet — create one on WhatsApp" empty state
          directly below the error banner — presenting a fetch failure as
          if the teacher's account is simply empty. The ErrorBanner above
          is the only thing shown for this state; nothing here should imply
          a successful, empty result. */}
      {loading ? (
        <Spinner label="Loading your overview…" />
      ) : !error ? (
        <section className="mb-7 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
          <Card className="p-5" style={{ animation: 'fadeSlideUp var(--duration-base) var(--ease-standard)' }}>
            <div className="flex items-center gap-4">
              <IconBadge tone="indigo">👨‍🏫</IconBadge>
              <div>
                <div className="text-2xl font-bold leading-tight tracking-tight text-accent">{classes.length}</div>
                <div className="mt-1 text-sm text-text-secondary">Classes</div>
              </div>
            </div>
          </Card>
          <Card className="p-5" style={{ animation: 'fadeSlideUp var(--duration-base) var(--ease-standard)' }}>
            <div className="flex items-center gap-4">
              <IconBadge tone="lavender">🧑‍🎓</IconBadge>
              <div>
                <div className="text-2xl font-bold leading-tight tracking-tight text-accent">{learnerCount}</div>
                <div className="mt-1 text-sm text-text-secondary">Learners</div>
              </div>
            </div>
          </Card>
        </section>
      ) : null}

      {/* My Classes — real data. Gated on !error for the same reason as
          the stats section above: an empty `classes` array caused by a
          failed fetch must not render the "No classes yet" empty state,
          which would misleadingly tell a teacher who actually has classes
          to go create one. */}
      {!error && (
      <section className="mb-7">
        <SectionHeader
          title="My Classes"
          subtitle={classes.length ? `${classes.length} class${classes.length === 1 ? '' : 'es'}` : undefined}
          action={
            classes.length > 0 && (
              <Button variant="ghost" onClick={() => navigate('/classes')}>
                View all →
              </Button>
            )
          }
        />

        {!loading && classes.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="m-0 mb-2 text-md font-semibold">No classes yet</p>
            <p className="m-0 mb-4 text-base text-text-secondary">
              Create a class on WhatsApp with <code>NEW CLASS</code> to see it here.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
            {classes.slice(0, 6).map((c) => (
              <Card key={c.id} onClick={() => navigate(`/classes/${c.id}`)} className="p-5">
                <div className="mb-3 flex items-center gap-3">
                  <IconBadge tone="indigo" size={40}>👥</IconBadge>
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold">{c.name}</div>
                    <div className="text-xs text-text-secondary">
                      {[c.grade && `Grade ${c.grade}`, c.subject].filter(Boolean).join(' · ') || 'No grade/subject set'}
                    </div>
                  </div>
                </div>
                <Pill tone="accent">{c.learnerCount ?? 0} learner{(c.learnerCount ?? 0) === 1 ? '' : 's'}</Pill>
              </Card>
            ))}
          </div>
        )}
      </section>
      )}

      {/* Weekly pulse — real activity counts, not a fabricated "hours
          saved" metric. Only rendered once loaded successfully; if the
          background fetch failed, `pulse` stays null and this section
          simply doesn't appear (see the independent try/catch above) —
          Overview as a whole still works. */}
      {!error && !loading && pulse && (
        <section className="mb-7">
          <SectionHeader title="This week" subtitle="Real activity from your account, last 7 days" />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
            <Card className="p-5">
              <div className="flex items-center gap-4">
                <IconBadge tone="mint">📝</IconBadge>
                <div>
                  <div className="text-2xl font-bold leading-tight tracking-tight text-accent">{pulse.assessments}</div>
                  <div className="mt-1 text-sm text-text-secondary">
                    Assessment{pulse.assessments === 1 ? '' : 's'} captured
                  </div>
                </div>
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-4">
                <IconBadge tone="indigo">◎</IconBadge>
                <div>
                  <div className="text-2xl font-bold leading-tight tracking-tight text-accent">{pulse.observations}</div>
                  <div className="mt-1 text-sm text-text-secondary">
                    Observation{pulse.observations === 1 ? '' : 's'} logged
                  </div>
                </div>
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-4">
                <IconBadge tone="lavender">✎</IconBadge>
                <div>
                  <div className="text-2xl font-bold leading-tight tracking-tight text-accent">{pulse.reflections}</div>
                  <div className="mt-1 text-sm text-text-secondary">
                    Reflection{pulse.reflections === 1 ? '' : 's'} added
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </section>
      )}

      {/* Needs a nudge — classes with no assessment captured in the last
          3 weeks. Deterministic, derived entirely from real
          GET /api/assessments + GET /api/classes data (no AI, no
          heuristic scoring) — same "class has an assessment or it
          doesn't" check a teacher could do by hand. Capped at 3 so it
          reads as a nudge, not a guilt list. */}
      {!error && !loading && needsAttention.length > 0 && (
        <section className="mb-7">
          <SectionHeader title="Could use a nudge" subtitle="No assessment captured in the last 3 weeks" />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
            {needsAttention.map((c) => (
              <Card key={c.id} onClick={() => navigate(`/classes/${c.id}`)} className="p-5">
                <div className="flex items-center gap-3">
                  <IconBadge tone="amber" size={40}>👥</IconBadge>
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold">{c.name}</div>
                    <div className="text-xs text-text-secondary">
                      {[c.grade && `Grade ${c.grade}`, c.subject].filter(Boolean).join(' · ') || 'No grade/subject set'}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* AI tools — honest roadmap, styled with the same polish */}
      <section>
        <SectionHeader title="AI-Powered Teaching Tools" subtitle="Generate everything you need, on WhatsApp" />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
          {COMMANDS.map((cmd) => (
            <Card key={cmd.label} className="p-5">
              <IconBadge tone={cmd.tone} size={44}>{cmd.icon}</IconBadge>
              <div className="mb-1 mt-3 text-base font-semibold">{cmd.label}</div>
              <div className="text-sm text-text-secondary">Generate on WhatsApp today</div>
            </Card>
          ))}
          {NOT_YET_ON_DASHBOARD.map((tool) => (
            <Card key={tool.title} className="p-5">
              <IconBadge tone={tool.tone} size={44}>{tool.icon}</IconBadge>
              <div className="mb-1 mt-3 text-base font-semibold">{tool.title}</div>
              <div className="text-sm text-text-secondary">{tool.note}</div>
            </Card>
          ))}
        </div>
        <p className="mt-4 text-xs text-text-tertiary">
          Coverage, performance, and intervention summaries will appear here once those services are wired up on the
          backend — everything above reflects real data from your account today.
        </p>
      </section>
    </Layout>
  );
}
