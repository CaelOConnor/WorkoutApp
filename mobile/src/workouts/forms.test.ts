import type { WorkoutDetailSet } from '@shared/models';

import {
  addSetBodyFrom,
  parseSetForm,
  parseWorkoutForm,
  repsError,
  setFormFrom,
  weightError,
  workoutFormFrom,
} from './forms';

function set(overrides: Partial<WorkoutDetailSet>): WorkoutDetailSet {
  return {
    id: 1,
    exercise_id: 1,
    set_number: 1,
    reps: 5,
    weight: '100.00',
    unit: 'lb',
    exercise_name: 'Squat',
    ...overrides,
  };
}

describe('setFormFrom', () => {
  it('prefills the form as text, without trailing zeros on the weight', () => {
    expect(setFormFrom(set({ reps: 8, weight: '132.50', unit: 'kg' }))).toEqual({
      reps: '8',
      weight: '132.5',
      unit: 'kg',
    });
  });
});

describe('parseSetForm', () => {
  it('builds the PATCH body with numbers', () => {
    expect(parseSetForm({ reps: '8', weight: '135', unit: 'lb' })).toEqual({
      ok: true,
      value: { reps: 8, weight: 135, unit: 'lb' },
    });
  });

  it('trims spaces and accepts a comma as the decimal point', () => {
    expect(parseSetForm({ reps: ' 5 ', weight: ' 102,5 ', unit: 'kg' })).toEqual({
      ok: true,
      value: { reps: 5, weight: 102.5, unit: 'kg' },
    });
  });

  it('accepts zero reps and zero weight (bodyweight, a failed attempt)', () => {
    expect(parseSetForm({ reps: '0', weight: '0', unit: 'lb' })).toEqual({
      ok: true,
      value: { reps: 0, weight: 0, unit: 'lb' },
    });
  });

  it.each(['', 'abc', '1.5', '-1', '5 reps', '2147483648'])('rejects reps %p', (reps) => {
    expect(parseSetForm({ reps, weight: '100', unit: 'lb' })).toEqual({
      ok: false,
      error: 'Reps must be a whole number.',
    });
  });

  // The backend's limits for NUMERIC(6,2): up to 9999.99, at most two decimals.
  it.each(['', 'abc', '-5', '1.234', '10000', '1e3', '.5'])('rejects weight %p', (weight) => {
    expect(parseSetForm({ reps: '5', weight, unit: 'lb' })).toEqual({
      ok: false,
      error: 'Weight must be a number up to 9999.99, with at most 2 decimals.',
    });
  });

  it('accepts the largest weight the column holds', () => {
    expect(parseSetForm({ reps: '1', weight: '9999.99', unit: 'lb' })).toMatchObject({ ok: true });
  });
});

describe('addSetBodyFrom', () => {
  it("copies the exercise's last set, without a set_number (the server assigns it)", () => {
    expect(addSetBodyFrom(set({ exercise_id: 4, reps: 3, weight: '132.50', unit: 'kg' }))).toEqual({
      exercise_id: 4,
      reps: 3,
      weight: 132.5,
      unit: 'kg',
    });
  });
});

describe('workoutFormFrom', () => {
  it('prefills the date, and empty text for no notes', () => {
    expect(workoutFormFrom({ date: '2026-10-14', notes: null })).toEqual({
      date: '2026-10-14',
      notes: '',
    });
    expect(workoutFormFrom({ date: '2026-10-14', notes: 'Leg day' })).toEqual({
      date: '2026-10-14',
      notes: 'Leg day',
    });
  });
});

describe('parseWorkoutForm', () => {
  it('builds the PATCH body, trimming both fields', () => {
    expect(parseWorkoutForm({ date: ' 2026-10-14 ', notes: '  Heavy day  ' })).toEqual({
      ok: true,
      value: { date: '2026-10-14', notes: 'Heavy day' },
    });
  });

  it('sends null for empty notes, which clears them', () => {
    expect(parseWorkoutForm({ date: '2026-10-14', notes: '   ' })).toEqual({
      ok: true,
      value: { date: '2026-10-14', notes: null },
    });
  });

  it.each(['', '14/10/2026', '2026-10-14T00:00:00Z', '2026-02-30', '2026-13-01', '0000-01-01'])(
    'rejects date %p',
    (date) => {
      expect(parseWorkoutForm({ date, notes: '' })).toEqual({
        ok: false,
        error: 'Enter a real date as YYYY-MM-DD.',
      });
    }
  );

  it('accepts a leap day only in a leap year', () => {
    expect(parseWorkoutForm({ date: '2024-02-29', notes: '' })).toMatchObject({ ok: true });
    expect(parseWorkoutForm({ date: '2026-02-29', notes: '' })).toMatchObject({ ok: false });
  });
});

// The per-field checks behind parseSetForm, for showing an error next to each field.
describe('repsError and weightError', () => {
  it('are null for valid values', () => {
    expect(repsError('5')).toBeNull();
    expect(weightError('102,5')).toBeNull();
  });

  it('give the same messages as parseSetForm', () => {
    expect(repsError('')).toBe('Reps must be a whole number.');
    expect(weightError('1.234')).toBe(
      'Weight must be a number up to 9999.99, with at most 2 decimals.'
    );
  });
});
