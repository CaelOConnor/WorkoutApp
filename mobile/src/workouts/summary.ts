import type { TemplateDetail, WorkoutDetailSet } from '@shared/models';

// 'Squat, Bench Press'. By name, not exercise_id, so a custom exercise named like a built-in one
// doesn't appear twice.
export function exerciseNames(sets: readonly WorkoutDetailSet[]): string {
  if (sets.length === 0) {
    return 'No exercises';
  }
  return [...new Set(sets.map((s) => s.exercise_name))].join(', ');
}

export function setCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'set' : 'sets'}`;
}

// 'Squat 3 · RDL 3 · Leg press 4'
export function templateSummary(template: TemplateDetail): string {
  return template.exercises.map((e) => `${e.exercise_name} ${e.set_count}`).join(' · ');
}
