import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HealthScoreGauge, qualityBand } from './HealthScoreGauge';

/**
 * Tests for the Health Score gauge quality-band mapping (R4.3):
 *   0–40 Poor · 41–60 Fair · 61–80 Good · 81–100 Excellent.
 */
describe('qualityBand', () => {
  it('maps scores to the correct quality band including boundaries (R4.3)', () => {
    expect(qualityBand(0).label).toBe('Poor');
    expect(qualityBand(40).label).toBe('Poor');
    expect(qualityBand(41).label).toBe('Fair');
    expect(qualityBand(60).label).toBe('Fair');
    expect(qualityBand(61).label).toBe('Good');
    expect(qualityBand(80).label).toBe('Good');
    expect(qualityBand(81).label).toBe('Excellent');
    expect(qualityBand(100).label).toBe('Excellent');
  });

  it('clamps out-of-range scores into a valid band', () => {
    expect(qualityBand(-10).label).toBe('Poor');
    expect(qualityBand(150).label).toBe('Excellent');
  });
});

describe('HealthScoreGauge', () => {
  it('renders the numeric score and its band label (R4.3)', () => {
    render(<HealthScoreGauge score={64} />);
    expect(screen.getByText('64')).not.toBeNull();
    expect(screen.getByText('Good')).not.toBeNull();
  });

  it('rounds the score for display', () => {
    render(<HealthScoreGauge score={83.6} />);
    expect(screen.getByText('84')).not.toBeNull();
    expect(screen.getByText('Excellent')).not.toBeNull();
  });
});
