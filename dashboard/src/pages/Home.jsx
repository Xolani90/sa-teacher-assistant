import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeacher } from '../auth/TeacherContext';
import Layout from '../components/Layout';
import { Card, Button, Spinner, IconBadge, SectionHeader, Pill, ErrorBanner } from '../components/ui';

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
        setClasses(classesRes?.classes || []);
        setLearnerCount((learnersRes?.learners || []).length);
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

      {/* Real stats */}
      {loading ? (
        <Spinner label="Loading your overview…" />
      ) : (
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
      )}

      {/* My Classes — real data */}
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
              <Card key={c.id} onClick={() => navigate('/classes')} className="p-5">
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
