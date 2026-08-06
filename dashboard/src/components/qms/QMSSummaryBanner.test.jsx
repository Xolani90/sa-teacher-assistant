import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import QMSSummaryBanner from './QMSSummaryBanner';

describe('QMSSummaryBanner', () => {
  it('renders nothing when there is no strength message', () => {
    const { container } = render(<QMSSummaryBanner strength={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an empty string either', () => {
    const { container } = render(<QMSSummaryBanner strength="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the message and an "On track" pill when a strength is given', () => {
    render(<QMSSummaryBanner strength="Your assessment evidence is ahead of pace this term." />);
    expect(screen.getByText('On track')).toBeInTheDocument();
    expect(screen.getByText('Your assessment evidence is ahead of pace this term.')).toBeInTheDocument();
  });
});
