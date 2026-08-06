import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QMSCategoryCard from './QMSCategoryCard';

// Wraps in a bare Router (not the full provider stack): expanding renders
// QMSCategoryActions, which calls useNavigate() unconditionally even for
// CTA types that don't navigate, so it needs Router context to mount.
function renderCard(props) {
  return render(
    <MemoryRouter>
      <QMSCategoryCard {...props} />
    </MemoryRouter>
  );
}

describe('QMSCategoryCard', () => {
  it('starts collapsed, showing only the count and label', () => {
    renderCard({ categoryKey: 'curriculum', label: 'Curriculum Coverage', count: 4, isMissing: false });
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Curriculum Coverage')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/curriculum coverage is being tracked/i)).not.toBeInTheDocument();
  });

  it('shows a "No evidence yet" pill only when isMissing is true', () => {
    const { rerender } = renderCard({ categoryKey: 'curriculum', label: 'Curriculum Coverage', count: 0, isMissing: true });
    expect(screen.getByText('No evidence yet')).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <QMSCategoryCard categoryKey="curriculum" label="Curriculum Coverage" count={4} isMissing={false} />
      </MemoryRouter>
    );
    expect(screen.queryByText('No evidence yet')).not.toBeInTheDocument();
  });

  it('expands to show the "empty" variant copy when count is 0', async () => {
    const user = userEvent.setup();
    renderCard({ categoryKey: 'curriculum', label: 'Curriculum Coverage', count: 0, isMissing: true });

    await user.click(screen.getByRole('button'));

    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('No curriculum evidence recorded yet this term.')).toBeInTheDocument();
    expect(screen.getByText('Generate a CAPS-aligned lesson plan')).toBeInTheDocument();
  });

  it('expands to show the "populated" variant copy when count is greater than 0', async () => {
    const user = userEvent.setup();
    renderCard({ categoryKey: 'curriculum', label: 'Curriculum Coverage', count: 6, isMissing: false });

    await user.click(screen.getByRole('button'));

    expect(screen.getByText('Curriculum coverage is being tracked this term.')).toBeInTheDocument();
    expect(screen.queryByText('No curriculum evidence recorded yet this term.')).not.toBeInTheDocument();
  });

  it('collapses again on a second click, hiding the recommendations', async () => {
    const user = userEvent.setup();
    renderCard({ categoryKey: 'observation', label: 'Observation', count: 2, isMissing: false });

    const toggle = screen.getByRole('button');
    await user.click(toggle);
    expect(screen.getByText('Observation evidence is being captured this term.')).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Observation evidence is being captured this term.')).not.toBeInTheDocument();
  });
});
