import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test/test-utils';
import Layout from './Layout';

// Regression test for the sidebar nav — specifically that 'Assessment
// Blueprints' sits directly after 'Assessments'. A Blueprint (ADR-005) is
// reusable question metadata an Assessment can optionally be generated
// from; they were previously separated by four unrelated items
// (Observations, Reflections & Goals, Incident Book), making it easy to
// lose the connection between them while scanning the sidebar.
describe('Layout sidebar navigation', () => {
  it('renders all nav destinations', () => {
    renderWithProviders(<Layout>content</Layout>, { authenticated: true });

    [
      'Overview',
      'Classes',
      'Resources',
      'Assessments',
      'Assessment Blueprints',
      'Observations',
      'Reflections & Goals',
      'Incident Book',
      'QMS & Readiness',
    ].forEach((label) => {
      expect(screen.getByRole('link', { name: new RegExp(label) })).toBeInTheDocument();
    });
  });

  it('places Assessment Blueprints directly after Assessments', () => {
    renderWithProviders(<Layout>content</Layout>, { authenticated: true });

    const links = screen.getAllByRole('link').map((el) => el.textContent);
    const assessmentsIndex = links.findIndex((t) => t.endsWith('Assessments'));
    const blueprintsIndex = links.findIndex((t) => t.endsWith('Assessment Blueprints'));

    expect(assessmentsIndex).toBeGreaterThan(-1);
    expect(blueprintsIndex).toBe(assessmentsIndex + 1);
  });
});
