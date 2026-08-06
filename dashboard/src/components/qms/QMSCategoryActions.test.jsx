import { describe, it, expect } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QMSCategoryActions from './QMSCategoryActions';

// Only needs a Router (for useNavigate), not the full Theme/Teacher
// provider stack -- this component takes everything else as props.
function renderActions(props, { route = '/' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/" element={<QMSCategoryActions {...props} />} />
        <Route path="/assessments" element={<div>Assessments page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('QMSCategoryActions', () => {
  it('renders the status text and recommendation list', () => {
    renderActions({
      status: 'No assessments captured yet this term.',
      recommendations: ['Create your first assessment', 'Open a class'],
      ctas: [],
    });
    expect(screen.getByText('No assessments captured yet this term.')).toBeInTheDocument();
    expect(screen.getByText('Create your first assessment')).toBeInTheDocument();
    expect(screen.getByText('Open a class')).toBeInTheDocument();
  });

  it('navigates when a "route" CTA is clicked', async () => {
    const user = userEvent.setup();
    renderActions({
      status: 'Status',
      recommendations: [],
      ctas: [{ label: 'View Assessments', type: 'route', target: '/assessments' }],
    });

    await user.click(screen.getByRole('button', { name: 'View Assessments' }));
    expect(screen.getByText('Assessments page')).toBeInTheDocument();
  });

  it('renders a "whatsapp" CTA as instruction text with the command, not a clickable link', () => {
    renderActions({
      status: 'Status',
      recommendations: [],
      ctas: [{ label: 'Generate Worksheet', type: 'whatsapp', command: 'worksheet' }],
    });

    expect(screen.getByText(/generate worksheet/i)).toBeInTheDocument();
    expect(screen.getByText(/worksheet/)).toBeInTheDocument(); // rendered as “worksheet” with curly quotes
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();
    // Never rendered as a dead button/link per ADR-012 §4.1.
    expect(screen.queryByRole('button', { name: /generate worksheet/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders a "comingSoon" CTA as a disabled button', () => {
    renderActions({
      status: 'Status',
      recommendations: [],
      ctas: [{ label: 'Bulk export', type: 'comingSoon' }],
    });

    const button = screen.getByRole('button', { name: /bulk export/i });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Bulk export · Coming soon');
  });

  it('renders nothing extra when there are no recommendations or ctas', () => {
    renderActions({ status: 'Status only', recommendations: [], ctas: [] });
    expect(screen.getByText('Status only')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
